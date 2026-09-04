using Microsoft.EntityFrameworkCore;
using Munni.Api.Banking;
using Munni.Api.Data;

namespace Munni.Api.GoCardless;

/// <summary>
/// Scheduled transaction fetch: once a night per account, in the 03:00
/// hour at the bank's local time (GcSchedule) — one call per endpoint
/// per day, far inside GoCardless's ~4/day budget. Freshly linked
/// accounts fetch on the next hourly tick instead of waiting for night.
/// There is no on-demand refresh; 429s defer the account.
/// </summary>
public sealed class GcFetchService(IServiceScopeFactory scopeFactory, ILogger<GcFetchService> logger) : BackgroundService
{
    // 429'd accounts wait out the rest of the day instead of burning the
    // remaining daily quota on retries (per-process is enough: a restart
    // retries once, then defers again)
    private readonly Dictionary<string, DateTimeOffset> _rateLimitedUntil = new();
    // consent healing paces itself: a handful of checks per day per consent
    // stays far inside the shared requisitions budget
    private readonly Dictionary<Guid, DateTimeOffset> _healBackoff = new();
    private DateOnly _lastCleanupDay = DateOnly.MinValue;

    /// <summary>abandoned consent journeys younger than this survive cleanup</summary>
    internal TimeSpan IdleGraceDays { get; set; } = TimeSpan.FromDays(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // hourly ticks; GcSchedule decides which accounts are due (the
        // 03:00 bank-local window, or a brand-new link)
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        do
        {
            try
            {
                await FetchAllAsync(stoppingToken);
                var today = DateOnly.FromDateTime(DateTime.UtcNow);
                if (today != _lastCleanupDay)
                {
                    await CleanupIdleRequisitionsAsync(stoppingToken);
                    _lastCleanupDay = today;
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "gocardless fetch cycle failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    /// <summary>
    /// Frees GoCardless connection slots held by dead weight: local
    /// requisitions past the grace age with no linked accounts — abandoned
    /// consent journeys and connections whose accounts were all removed.
    /// Requisitions GC knows but munni doesn't (possibly another
    /// environment sharing the GC account) are never touched — those stay
    /// a manual decision in the admin console.
    /// </summary>
    internal async Task CleanupIdleRequisitionsAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // #240 r3: attachments whose mirror the space tombstoned are dead
        // weight that keeps orphaned feeds re-syncing to devices — drop
        // them daily (provider-independent, so it runs before the GC gate)
        var removedLinks = await Accounts.FeedJanitor.RemoveDeadAttachmentsAsync(db, null, ct);
        if (removedLinks > 0 && logger.IsEnabled(LogLevel.Information))
            logger.LogInformation("feed janitor: removed {Count} dead attachment(s)", removedLinks);

        // slot cleanup is a GoCardless-specific concern (their free tier
        // counts connections) — skip entirely when GC isn't configured
        var gc = scope.ServiceProvider.GetService<IGoCardlessApi>();
        if (gc is null) return;

        // converge duplicate consents first: every linked account moves to
        // its NEWEST consent, so older duplicates become account-less and
        // age into the idle deletion below (user had nine ING consents and
        // no way to tell which one carried the account)
        var covering = await RebindToNewestConsentAsync(db, gc, ct);

        var cutoff = DateTimeOffset.UtcNow - IdleGraceDays;
        var used = (await db.GcLinkedAccounts.Select(a => a.RequisitionId).Distinct().ToListAsync(ct))
            // a consent that still covers a known account at the provider is
            // never dead weight even when the row is bound to someone else's
            // consent — deleting it would revoke a family member's own
            // access to the shared account
            .Union(covering)
            .ToList();
        var idle = await db.GcRequisitions
            // 'approved' = bank consent given, ingest pending on quota —
            // the healer owns those, cleanup must not cut them loose
            .Where(r => r.CreatedAt < cutoff && !used.Contains(r.Id) && r.Provider == GoCardlessBankApi.Id && r.Status != "approved")
            .ToListAsync(ct);
        foreach (var requisition in idle)
        {
            try
            {
                await gc.DeleteRequisitionAsync(requisition.RequisitionId, ct);
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                // already gone at GC — the slot is free, drop our record too
            }
            catch (HttpRequestException ex)
            {
                logger.LogWarning(ex, "gc cleanup: delete failed for {RequisitionId} — retrying tomorrow", requisition.RequisitionId);
                continue;
            }
            db.GcRequisitions.Remove(requisition);
            if (logger.IsEnabled(LogLevel.Information))
                logger.LogInformation("gc cleanup: removed idle {Institution} requisition from {Created}", requisition.InstitutionId, requisition.CreatedAt);
        }
        if (idle.Count > 0) await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Moves every GoCardless-linked account onto the newest LINKED
    /// consent that covers it (authoritative account list from the
    /// provider's own requisition listing — one call per day). Retried
    /// consent journeys used to leave the row bound to whichever consent
    /// completed FIRST, so deleting apparent duplicates could silently
    /// kill the sync. Rebinding stays within one user: a shared family
    /// account consented by two people keeps each person's consent alive.
    /// Returns every local requisition id that still covers a known
    /// account — those are never idle, whoever the row is bound to.
    /// </summary>
    private static async Task<HashSet<Guid>> RebindToNewestConsentAsync(AppDbContext db, IGoCardlessApi gc, CancellationToken ct)
    {
        var remote = await gc.ListRequisitionsAsync(ct);
        var locals = await db.GcRequisitions.Where(r => r.Provider == GoCardlessBankApi.Id).ToListAsync(ct);
        // several local rows can carry the same provider id (interrupted
        // journeys re-using a consent) — the newest local row represents it
        var localByRemoteId = locals
            .GroupBy(l => l.RequisitionId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(l => l.CreatedAt).First());
        var localById = locals.ToDictionary(l => l.Id);
        var accounts = await db.GcLinkedAccounts.ToListAsync(ct);
        var byAccountId = accounts.ToDictionary(a => a.GcAccountId);

        var linkedRemotes = remote.Where(r => r.Status == "LN").ToList();
        // oldest → newest: the last assignment wins, i.e. the newest consent
        foreach (var requisition in linkedRemotes.OrderBy(r => r.Created))
        {
            foreach (var (local, linked) in CoveredPairs(requisition, localByRemoteId, byAccountId))
            {
                var boundTo = localById.GetValueOrDefault(linked.RequisitionId);
                // #240: wallet bindings (no IBAN — personal by nature) always
                // move to the newest covering consent; only real IBAN
                // accounts protect a foreign (family) binding
                var wallet = linked.Iban.StartsWith("GC:", StringComparison.OrdinalIgnoreCase);
                if (boundTo is not null && boundTo.UserId != local.UserId && !wallet) continue; // someone else's binding
                linked.RequisitionId = local.Id;
                linked.SpaceId = local.SpaceId;
            }
        }
        // second pass, against the FINAL bindings: another user's consent
        // covering a known account is protected — the same user's older
        // duplicates are not (they are exactly what should age out)
        var covering = new HashSet<Guid>();
        foreach (var requisition in linkedRemotes)
        {
            foreach (var (local, linked) in CoveredPairs(requisition, localByRemoteId, byAccountId))
            {
                var boundTo = localById.GetValueOrDefault(linked.RequisitionId);
                if (boundTo is not null && boundTo.UserId != local.UserId) covering.Add(local.Id);
            }
        }
        await db.SaveChangesAsync(ct);
        return covering;
    }

    /// <summary>the (local requisition, linked account) pairs a remote consent covers</summary>
    private static IEnumerable<(GcRequisition Local, GcLinkedAccount Linked)> CoveredPairs(
        GcRequisitionListItem requisition,
        Dictionary<string, GcRequisition> localByRemoteId,
        Dictionary<string, GcLinkedAccount> byAccountId)
    {
        if (!localByRemoteId.TryGetValue(requisition.Id, out var local)) yield break;
        foreach (var accountId in requisition.Accounts)
        {
            if (byAccountId.TryGetValue(accountId, out var linked)) yield return (local, linked);
        }
    }

    /// <summary>seconds between account fetches (staggering); tests shrink it</summary>
    internal TimeSpan AccountDelay { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>#240 r2: the feed space holds not one live transaction —
    /// whatever the backfill fetched never landed.</summary>
    internal static async Task<bool> FeedHasNoRowsAsync(AppDbContext db, GcLinkedAccount linked, CancellationToken ct) =>
        !await db.EntityRows.AnyAsync(
            r => r.SpaceId == ImportIds.FeedSpaceId(linked.Iban) && r.Entity == "transaction" && !r.Deleted, ct);

    /// <summary>#240 r2: stamped as backfilled, yet the feed is empty — a
    /// backfill that ingested nothing does not count. An hour between
    /// retries keeps a genuinely empty account from hammering the bank
    /// (GC's daily budget additionally lands in the 12h rate backoff).</summary>
    internal static async Task<bool> EmptyBackfillAsync(AppDbContext db, GcLinkedAccount linked, CancellationToken ct)
    {
        if (linked.HistoryBackfilledAt is null || linked.LastFetchAt is null) return false;
        if (DateTimeOffset.UtcNow - linked.LastFetchAt.Value < TimeSpan.FromHours(1)) return false;
        return await FeedHasNoRowsAsync(db, linked, ct);
    }

    internal async Task FetchAllAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var registry = scope.ServiceProvider.GetRequiredService<BankProviderRegistry>();

        await HealPendingConsentsAsync(scope.ServiceProvider, db, registry, ct);

        var linkedAccounts = await db.GcLinkedAccounts.ToListAsync(ct);
        foreach (var linked in linkedAccounts)
        {
            // #240 r2: a "backfilled" account whose feed never received a
            // single row keeps retrying the full window every tick until
            // data actually exists (dropped rows on an old binary, an
            // ASPSP answering empty, an erased feed) — the 429 backoff
            // below still guards the provider budget
            var emptyBackfill = await EmptyBackfillAsync(db, linked, ct);
            if (!emptyBackfill && !GcSchedule.IsDue(linked, DateTimeOffset.UtcNow)) continue;
            if (_rateLimitedUntil.TryGetValue(linked.GcAccountId, out var until) && DateTimeOffset.UtcNow < until) continue;
            try
            {
                // every account keeps fetching through the provider that created it
                await FetchAccountAsync(scope.ServiceProvider, db, registry.For(linked.Provider), linked, ct);
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                // the ~4-calls-per-endpoint daily budget is spent — stand
                // down for 12h instead of hammering the remaining calls
                _rateLimitedUntil[linked.GcAccountId] = DateTimeOffset.UtcNow.AddHours(12);
                if (logger.IsEnabled(LogLevel.Information))
                    logger.LogInformation(ex, "gc rate limit for {Iban} — deferring 12h", linked.Iban);
            }
            catch (HttpRequestException ex)
            {
                // expired consent or other 4xx/5xx — wait for the next cycle
                logger.LogWarning(ex, "gc fetch failed for {Iban}", linked.Iban);
            }
        }
    }

    /// <summary>
    /// Finishes consents the user approved at the bank but whose /complete
    /// never fully ran — the redirect broke, or the daily quota 429'd it
    /// half-way. Those consents used to float (linked at the provider,
    /// attached nowhere) until the idle cleanup deleted them; now every
    /// hourly tick re-checks and ingests them once the budget allows.
    /// GC consents are re-checkable from 'created' (state lives at GC);
    /// Enable Banking only from 'approved' (a session must already exist —
    /// the auth code is single-use and gone).
    /// </summary>
    internal async Task HealPendingConsentsAsync(IServiceProvider services, AppDbContext db, BankProviderRegistry registry, CancellationToken ct)
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-30);
        // journeys younger than the grace are still in the user's hands —
        // /complete owns those; the healer picks up whatever it dropped
        var grace = DateTimeOffset.UtcNow.AddMinutes(-10);
        var pending = await db.GcRequisitions
            .Where(r => r.CreatedAt > cutoff && r.CreatedAt < grace
                && (r.Status == "approved" || (r.Status == "created" && r.Provider == GoCardlessBankApi.Id)))
            .ToListAsync(ct);
        foreach (var requisition in pending)
        {
            if (_healBackoff.TryGetValue(requisition.Id, out var until) && DateTimeOffset.UtcNow < until) continue;
            _healBackoff[requisition.Id] = DateTimeOffset.UtcNow.AddHours(6);
            try
            {
                await HealConsentAsync(services, db, registry, requisition, ct);
            }
            catch (HttpRequestException ex)
            {
                // expired/abandoned journeys answer 4xx — the idle cleanup owns those
                if (logger.IsEnabled(LogLevel.Debug))
                    logger.LogDebug(ex, "consent heal skipped for {Id}", requisition.Id);
            }
        }
    }

    private async Task HealConsentAsync(IServiceProvider services, AppDbContext db, BankProviderRegistry registry, GcRequisition requisition, CancellationToken ct)
    {
        var gc = registry.For(requisition.Provider);
        var status = await gc.CompleteAuthAsync(requisition.RequisitionId, null, ct);
        if (status.Status != "LN") return; // not (yet) approved at the bank — nothing to heal
        var space = await db.Spaces.FindAsync([requisition.SpaceId], ct);
        if (space is null) return;

        var (linkedCount, imported, deferred) = await GcEndpoints.IngestApprovedAccountsAsync(gc, db, requisition, space, status.Accounts, logger);
        if (deferred == 0) requisition.Status = "linked";
        else if (requisition.Status == "created") requisition.Status = "approved";
        await db.SaveChangesAsync(ct);
        if (linkedCount == 0) return;

        if (logger.IsEnabled(LogLevel.Information))
            logger.LogInformation("consent heal: {Institution} linked {Linked} account(s), {Imported} tx", requisition.InstitutionId, linkedCount, imported);
        services.GetRequiredService<Sync.SpaceEventBroadcaster>().Publish(requisition.SpaceId);
        if (imported > 0)
            await services.GetRequiredService<Push.PushNotifier>().NotifyNewTransactionsAsync(requisition.SpaceId, imported, ct);
    }

    internal async Task FetchAccountAsync(IServiceProvider services, AppDbContext db, IBankDataApi gc, GcLinkedAccount linked, CancellationToken ct)
    {
        var space = await db.Spaces.FindAsync([linked.SpaceId], ct);
        if (space is null) return;

        // banks budget ~4 calls per endpoint per day — the account details
        // never change after linking, so only the very first fetch spends a
        // call on them
        var details = linked.LastFetchAt is null
            ? await gc.GetAccountDetailsAsync(linked.GcAccountId, ct)
            : new GcAccountDetails(linked.Iban, null, linked.Currency);
        var balances = await gc.GetBalancesAsync(linked.GcAccountId, ct);
        // no backfill marker → fetch the full window regardless of
        // LastFetchAt: accounts linked before the feed-space migration had
        // a LastFetchAt but their FEED space only ever received deltas.
        // #240 r2: an EMPTY feed re-runs the full window too — a stamp
        // whose fetch never landed a row must not shrink to 3-day deltas.
        // The window asks for TWO YEARS (user design 2026-08-01: yearly
        // recurring detection needs the tail); the provider clamps to
        // whatever the consent actually allows
        var fullWindow = linked.HistoryBackfilledAt is null || await FeedHasNoRowsAsync(db, linked, ct);
        var from = fullWindow
            ? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-GoCardlessApi.MaxHistoryDays))
            : DateOnly.FromDateTime((linked.LastFetchAt?.UtcDateTime ?? DateTime.UtcNow.AddDays(-GoCardlessApi.MaxHistoryDays)).AddDays(-3));
        var page = await gc.GetTransactionsAsync(linked.GcAccountId, from, ct);

        var accepted = await new GcIngest(db, logger).IngestAccountAsync(space, linked, details, balances, page.Booked, page.Pending);
        linked.LastFetchAt = DateTimeOffset.UtcNow;
        linked.HistoryBackfilledAt ??= DateTimeOffset.UtcNow;
        if (page.Rate is { } rate)
        {
            // remember the announced budget — the scheduler spreads it
            linked.DailySuccessLimit = rate.Limit ?? linked.DailySuccessLimit;
            linked.SuccessRemaining = rate.Remaining;
            if (rate.ResetSeconds is { } seconds) linked.RateResetAt = DateTimeOffset.UtcNow.AddSeconds(seconds);
        }
        await db.SaveChangesAsync(ct);
        if (logger.IsEnabled(LogLevel.Information))
            logger.LogInformation("gc fetch {Iban}: {Received} received, {Accepted} new ops, {Dropped} dropped",
                linked.Iban, linked.LastFetchReceived ?? 0, accepted, linked.LastFetchDropped ?? 0);

        // wake the members' devices: SSE for open apps, push notification +
        // preload for closed ones. Raw rows land in the FEED space; the
        // overlay lands in the target space — publish both so attached
        // members react immediately.
        if (accepted > 0)
        {
            var events = services.GetRequiredService<Sync.SpaceEventBroadcaster>();
            events.Publish(ImportIds.FeedSpaceId(linked.Iban));
            events.Publish(linked.SpaceId);
            var notifier = services.GetRequiredService<Push.PushNotifier>();
            await notifier.NotifyNewTransactionsAsync(linked.SpaceId, accepted, ct);
        }
        await Task.Delay(AccountDelay, ct);
    }
}
