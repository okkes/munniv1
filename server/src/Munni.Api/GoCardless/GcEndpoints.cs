using Microsoft.EntityFrameworkCore;
using Sentry;
using Microsoft.Extensions.Caching.Memory;
using Munni.Api.Auth;
using Munni.Api.Banking;
using Munni.Api.Data;
using Munni.Api.Validation;

namespace Munni.Api.GoCardless;

public sealed record CreateRequisitionRequest(string SpaceId, string InstitutionId, string RedirectUrl, string? AppScheme = null, string? Provider = null);
public sealed record CreateRequisitionResponse(string Reference, string Link);
public sealed record CompleteResponse(string Status, int LinkedAccounts, int ImportedTransactions, string? AppScheme = null);
/// <summary>#175: a configured provider the END USER may pick. KnownAccounts
/// carries masked IBAN tails for Enable Banking — its restricted mode only
/// serves portal-linked accounts, and every account munni ever fetched
/// through EB is proof of such a link (the EB API itself cannot list them).</summary>
public sealed record ProviderInfo(string Id, IReadOnlyList<string>? KnownAccounts);

public static partial class GcEndpoints
{
    [System.Text.RegularExpressions.GeneratedRegex("^[A-Za-z]{2}$")]
    private static partial System.Text.RegularExpressions.Regex CountryCode();

    /// <summary>#175: the caller's explicit provider pick, the registry
    /// default (first configured — GoCardless) when absent; an unknown
    /// id is a 400, never a silent fallback</summary>
    private static IBankDataApi? ResolveProvider(string? provider, BankProviderRegistry registry)
    {
        if (provider is null) return registry.For(null);
        return registry.ConfiguredIds.Contains(provider) ? registry.For(provider) : null;
    }

    private static async Task<IResult> ListInstitutionsAsync(string country, string? provider, BankProviderRegistry registry, AppDbContext db, IMemoryCache cache)
    {
        if (!CountryCode().IsMatch(country))
            return Results.BadRequest(new { error = "country must be a 2-letter code" });
        var api = ResolveProvider(provider, registry);
        if (api is null) return Results.BadRequest(new { error = $"unknown provider '{provider}'" });
        IReadOnlyList<GcInstitution>? list;
        try
        {
            list = await cache.GetOrCreateAsync($"institutions-{api.ProviderId}-{country}", async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(24);
                var fetched = await api.GetInstitutionsAsync(country);
                await RecordLogoUrlsAsync(db, fetched);
                return fetched;
            });
        }
        catch (Exception ex)
        {
            // bare 500s left the app guessing (GlitchTip issue 14) —
            // name the provider and its reason, like create/complete
            SentrySdk.CaptureException(ex);
            var detail = ex.Message.Length > 300 ? ex.Message[..300] : ex.Message;
            return Results.Problem(title: $"{api.ProviderId} institutions failed", detail: detail, statusCode: 502);
        }
        // relative logo path: the client prefixes its API origin
        return Results.Ok(list!.Select(i => i with
        {
            Logo = string.IsNullOrEmpty(i.Logo) ? i.Logo : $"/gocardless/institutions/{Uri.EscapeDataString(i.Id)}/logo",
        }));
    }

    /// <summary>remember every logo URL so the logo endpoint can vendor
    /// the bytes — the app never hotlinks the provider CDN</summary>
    private static async Task RecordLogoUrlsAsync(AppDbContext db, IReadOnlyList<GcInstitution> fetched)
    {
        var withLogo = fetched.Where(i => !string.IsNullOrEmpty(i.Logo)).ToList();
        var known = await db.GcInstitutionLogos
            .Where(l => withLogo.Select(i => i.Id).Contains(l.InstitutionId))
            .ToDictionaryAsync(l => l.InstitutionId);
        foreach (var institution in withLogo)
        {
            if (known.TryGetValue(institution.Id, out var row))
            {
                if (row.LogoUrl != institution.Logo)
                {
                    row.LogoUrl = institution.Logo!;
                    row.Bytes = null; // stale artwork refetches on next serve
                }
            }
            else
            {
                db.GcInstitutionLogos.Add(new GcInstitutionLogo { InstitutionId = institution.Id, LogoUrl = institution.Logo! });
            }
        }
        await db.SaveChangesAsync();
    }

    private static async Task<IResult> ServeLogoAsync(string institutionId, AppDbContext db, IHttpClientFactory httpFactory, HttpContext http)
    {
        var row = await db.GcInstitutionLogos.FindAsync(institutionId);
        if (row is null) return Results.NotFound();
        if (row.Bytes is null)
        {
            try
            {
                using var client = httpFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(10);
                var res = await client.GetAsync(row.LogoUrl);
                if (!res.IsSuccessStatusCode) return Results.NotFound();
                var bytes = await res.Content.ReadAsByteArrayAsync();
                if (bytes.Length is 0 or > 1024 * 1024) return Results.NotFound();
                row.Bytes = bytes;
                row.ContentType = res.Content.Headers.ContentType?.ToString() ?? "image/png";
                row.FetchedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
            }
            catch (Exception)
            {
                return Results.NotFound(); // CDN down: the app shows its icon fallback
            }
        }
        http.Response.Headers.CacheControl = "public, max-age=2592000, immutable";
        return Results.File(row.Bytes, row.ContentType ?? "image/png");
    }

    /// <summary>#175: the configured providers, for the user-facing choice
    /// (both are first-class — the admin toggle retired; registration
    /// order puts GoCardless first as the default). Enable Banking rides
    /// its masked account tails so a user can tell whether THEIR account
    /// was linked upfront on the EB portal (restricted mode serves only
    /// portal-linked accounts — the EB API cannot list them, but every
    /// account munni ever fetched through EB proves its link).</summary>
    private static async Task<IResult> ListProvidersAsync(BankProviderRegistry registry, AppDbContext db)
    {
        List<string>? ebTails = null;
        if (registry.ConfiguredIds.Contains(EnableBankingApi.Id))
        {
            var ibans = await db.GcLinkedAccounts
                .Where(a => a.Provider == EnableBankingApi.Id && !a.Iban.StartsWith("GC:"))
                .Select(a => a.Iban)
                .Distinct()
                .ToListAsync();
            ebTails = ibans
                .Where(i => i.Length >= 4)
                .Select(i => i[^4..])
                .Distinct()
                .OrderBy(t => t)
                .Take(12)
                .ToList();
        }
        var providers = registry.ConfiguredIds
            .Select(id => new ProviderInfo(id, id == EnableBankingApi.Id ? ebTails : null))
            .ToList();
        return Results.Ok(new { providers });
    }

    public static void MapGoCardless(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/gocardless").RequireAuthorization().WithSafeRouteParams();

        // institution list, cached per provider: it changes rarely and the
        // vendors rate-limit. #175: an explicit provider query parameter
        // lets the END USER pick; absent keeps the admin's active one.
        group.MapGet("/institutions", ListInstitutionsAsync);

        // #175: the provider choice the connect sheet renders
        group.MapGet("/providers", ListProvidersAsync);

        // the vendored logo bytes — anonymous (public artwork) so a plain
        // <img> tag can load it; fetched from the recorded URL exactly once
        app.MapGet("/gocardless/institutions/{institutionId}/logo", ServeLogoAsync).AllowAnonymous();

        group.MapPost("/requisitions", async (CreateRequisitionRequest request, BankProviderRegistry registry, AppDbContext db, HttpContext http) =>
        {
            var userId = http.GetUserId();
            if (!await db.SpaceMembers.AnyAsync(m => m.SpaceId == request.SpaceId && m.UserId == userId))
                return Results.Forbid();

            // #175: the user's explicit pick wins; absent, the registry
            // default (older clients without the chooser)
            var api = ResolveProvider(request.Provider, registry);
            if (api is null) return Results.BadRequest(new { error = $"unknown provider '{request.Provider}'" });
            var reference = Guid.NewGuid();
            GcRequisitionCreated created;
            try
            {
                created = await api.CreateRequisitionAsync(request.InstitutionId, request.RedirectUrl, reference.ToString());
            }
            catch (Exception ex)
            {
                // surface WHICH provider failed and why (sans secrets): the
                // admin switched providers and the app only said "failed"
                var detail = ex.Message.Length > 300 ? ex.Message[..300] : ex.Message;
                return Results.Problem(title: $"{api.ProviderId} requisition failed", detail: detail, statusCode: 502);
            }
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = reference,
                UserId = userId,
                SpaceId = request.SpaceId,
                InstitutionId = request.InstitutionId,
                RequisitionId = created.Id,
                Status = "created",
                Provider = api.ProviderId,
                AppScheme = request.AppScheme,
                RedirectOrigin = Uri.TryCreate(request.RedirectUrl, UriKind.Absolute, out var redirect)
                    ? redirect.GetLeftPart(UriPartial.Authority)
                    : null,
            });
            await db.SaveChangesAsync();
            return Results.Ok(new CreateRequisitionResponse(reference.ToString(), created.Link));
        }).WithValidation<CreateRequisitionRequest>();

        // called after the bank redirects back. Installed-PWA journeys can
        // detour through the bank's NATIVE app, whose return link opens in
        // a plain browser tab with no app session (user bug report) — so
        // completion is anonymous-capable: the requisition reference is a
        // GUID we minted for exactly this journey, i.e. a capability token.
        // A present session still has to match the requisition's owner.
        group.MapPost("/requisitions/{reference:guid}/complete", CompleteRequisition).AllowAnonymous();

        // connection status for the UI (next scheduled fetch, expiry handling)
        group.MapGet("/connections", async (AppDbContext db, HttpContext http) =>
        {
            var userId = http.GetUserId();
            var spaceIds = await db.SpaceMembers.Where(m => m.UserId == userId).Select(m => m.SpaceId).ToListAsync();
            var connections = await db.GcLinkedAccounts
                .Where(a => spaceIds.Contains(a.SpaceId))
                .Select(a => new { a.GcAccountId, a.SpaceId, a.AccountEntityId, a.Iban, a.LastFetchAt, a.Provider })
                .ToListAsync();
            return Results.Ok(connections);
        });
    }

    private static async Task<IResult> CompleteRequisition(Guid reference, string? code, BankProviderRegistry registry, AppDbContext db, HttpContext http, ILogger<GcIngest> logger)
    {
            var userId = http.TryGetUserId();
            var requisition = await db.GcRequisitions.FindAsync(reference);
            if (requisition is null || (userId is not null && requisition.UserId != userId)) return Results.NotFound();

            // IDEMPOTENT: callbacks re-fire (page reload, hosted page AND
            // in-app, retries) — a second complete must not re-run the
            // ingest: it burns the provider's per-account daily quota and
            // the resulting 429 surfaced as a bare 500 (outage 2026-07-18)
            if (requisition.Status == "linked")
            {
                var alreadyLinked = await db.GcLinkedAccounts.CountAsync(a => a.RequisitionId == requisition.Id);
                return Results.Ok(new CompleteResponse("LN", alreadyLinked, 0, requisition.AppScheme));
            }

            var gc = registry.For(requisition.Provider);
            try
            {
            var status = await gc.CompleteAuthAsync(requisition.RequisitionId, code);
            // Enable Banking mints its session id at complete time — persist
            // it BEFORE ingesting: the auth code is single-use, so if the
            // ingest dies below the retry must still find the session
            if (status.Id != requisition.RequisitionId)
            {
                requisition.RequisitionId = status.Id;
                await db.SaveChangesAsync();
            }
            if (status.Status != "LN")
                return Results.Ok(new CompleteResponse(status.Status, 0, 0, requisition.AppScheme));

            var space = await db.Spaces.FindAsync(requisition.SpaceId);
            if (space is null) return Results.NotFound();

            var (linkedCount, imported, deferred) = await IngestApprovedAccountsAsync(gc, db, requisition, space, status.Accounts, logger);
            // 'approved' = consented at the bank but not fully ingested —
            // the scheduled healer finishes it when the quota resets
            requisition.Status = deferred == 0 ? "linked" : "approved";
            await db.SaveChangesAsync();
            return Results.Ok(new CompleteResponse(status.Status, linkedCount, imported, requisition.AppScheme));
            }
            catch (Exception ex)
            {
                // name the provider and its reason — the app relays this
                // (self-diagnosing rule); SentrySdk sees it via the logger
                SentrySdk.CaptureException(ex);
                var detail = ex.Message.Length > 300 ? ex.Message[..300] : ex.Message;
                return Results.Problem(title: $"{requisition.Provider} completion failed", detail: detail, statusCode: 502);
            }
    }

    /// <summary>
    /// Links the consented accounts while tolerating the bank's ~4-calls-
    /// per-endpoint-per-day budget. Retried consent journeys used to burn
    /// it and the resulting 429 aborted completion half-way: the consent
    /// stayed approved at the provider but attached to nothing — the
    /// "floating connection" outage (2026-07-18). Now a 429 degrades
    /// instead of aborting: on details the account is deferred to the
    /// scheduled healer (identity unknown until the budget resets), on
    /// balances/transactions the account still links with empty data and
    /// LastFetchAt stays null so the first scheduled fetch backfills the
    /// full window.
    /// </summary>
    internal static async Task<(int Linked, int Imported, int Deferred)> IngestApprovedAccountsAsync(
        IBankDataApi gc, AppDbContext db, GcRequisition requisition, Space space, IReadOnlyList<string> accounts, ILogger? logger = null)
    {
        var ingest = new GcIngest(db, logger);
        var linkedCount = 0;
        var imported = 0;
        var deferred = 0;
        foreach (var gcAccountId in accounts)
        {
            var linked = await db.GcLinkedAccounts.FindAsync(gcAccountId);
            var details = await ResolveDetailsAsync(gc, gcAccountId, linked);
            if (details is null)
            {
                deferred++; // identity unknown until the budget resets
                continue;
            }
            // wallet-style accounts (PayPal…) carry no IBAN — a
            // deterministic per-account reference keeps the whole feed
            // machinery working (user bug: the consent completed fine
            // but the connection never appeared)
            var accountRef = details.Iban ?? $"GC:{gcAccountId}";

            if (linked is null)
            {
                linked = new GcLinkedAccount
                {
                    GcAccountId = gcAccountId,
                    SpaceId = requisition.SpaceId,
                    // #311 r4 (user): the bank never silently consumes a
                    // statement-imported account — when the canonical id
                    // is already an import's, the bank binds its OWN row
                    // and the user merges the two explicitly in the app
                    AccountEntityId = await BankAccountEntityIdAsync(db, accountRef),
                    Iban = ImportIds.Normalize(accountRef),
                    Currency = details.Currency ?? "EUR",
                    RequisitionId = requisition.Id,
                    Provider = requisition.Provider,
                };
                db.GcLinkedAccounts.Add(linked);
            }
            else
            {
                await RebindToNewestConsentAsync(db, linked, requisition);
            }

            IReadOnlyList<GcBalance> balances = [];
            GcTransactionsPage? page = null;
            try
            {
                balances = await gc.GetBalancesAsync(gcAccountId);
                // two-year ask (user design 2026-08-01) — the provider
                // clamps to what the consent allows
                page = await gc.GetTransactionsAsync(gcAccountId, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-GoCardlessApi.MaxHistoryDays)));
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                // budget spent — the feed still gets created/attached so the
                // link shows up everywhere; data follows on the next fetch
            }
            // #240: the completion acts AS this requisition's user — the
            // attachment and (co-)ownership must land on THEM, not on
            // whoever's consent the row happens to be bound to
            var accepted = await ingest.IngestAccountAsync(space, linked, details, balances, page?.Booked ?? [], page?.Pending, requisition);
            imported += accepted;
            // #240 r2: completions must leave a trace — "linked fine, zero
            // rows" was invisible everywhere
            if (logger?.IsEnabled(LogLevel.Information) == true)
                logger.LogInformation("gc complete {Ref}: fetched {Booked} booked + {Pending} pending, accepted {Accepted}",
                    linked.Iban, page?.Booked.Count ?? 0, page?.Pending?.Count ?? 0, accepted);
            if (page is not null)
            {
                linked.LastFetchAt = DateTimeOffset.UtcNow;
                linked.HistoryBackfilledAt = DateTimeOffset.UtcNow; // this fetch was the full window
            }
            linkedCount++;
        }
        return (linkedCount, imported, deferred);
    }

    /// <summary>
    /// A retried journey re-consented the same bank account: the row moves
    /// to the newest consent with the freshest 90-day window — the older
    /// requisition ends up account-less and the idle cleanup frees its
    /// provider slot (user had NINE ING consents, unclear which carried
    /// the account). Only within the SAME user: a shared family account
    /// linked by a second person keeps the first one's binding. #240:
    /// WALLETS (no IBAN) are the exception — personal by nature, so the
    /// newest consent always claims the binding (a stale foreign binding
    /// stranded PayPal as "shared with me" for its real owner).
    /// </summary>
    /// <summary>#311 r4 (user): the id the bank binds its account row to —
    /// the canonical acct id, UNLESS a statement import already owns that
    /// row on the feed (its source is not a provider's). Then the bank
    /// forks to its own row and the app offers an explicit merge.</summary>
    private static async Task<string> BankAccountEntityIdAsync(AppDbContext db, string accountRef)
    {
        var canonical = ImportIds.AccountId(accountRef);
        var feedId = ImportIds.FeedSpaceId(accountRef);
        var row = await db.EntityRows.FirstOrDefaultAsync(r =>
            r.SpaceId == feedId && r.Entity == "account" && r.EntityId == canonical && !r.Deleted);
        if (row is null) return canonical;
        using var data = System.Text.Json.JsonDocument.Parse(row.DataJson);
        var importOwned = !data.RootElement.TryGetProperty("source", out var source)
            || source.GetString() != "gocardless";
        return importOwned ? ImportIds.BankAccountId(accountRef) : canonical;
    }

    private static async Task RebindToNewestConsentAsync(AppDbContext db, GcLinkedAccount linked, GcRequisition requisition)
    {
        var wallet = linked.Iban.StartsWith("GC:", StringComparison.OrdinalIgnoreCase);
        var boundTo = await db.GcRequisitions.FindAsync(linked.RequisitionId);
        if (boundTo is null || boundTo.UserId == requisition.UserId || wallet)
        {
            linked.RequisitionId = requisition.Id;
            linked.SpaceId = requisition.SpaceId;
        }
    }

    /// <summary>
    /// The account's identity from the provider, or the previously stored
    /// row when the daily details budget is spent — null means neither is
    /// available and the account defers to the scheduled healer.
    /// </summary>
    private static async Task<GcAccountDetails?> ResolveDetailsAsync(IBankDataApi gc, string gcAccountId, GcLinkedAccount? linked)
    {
        try
        {
            return await gc.GetAccountDetailsAsync(gcAccountId);
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            if (linked is null) return null;
            var isRealIban = !linked.Iban.StartsWith("GC:", StringComparison.OrdinalIgnoreCase);
            return new GcAccountDetails(isRealIban ? linked.Iban : null, null, linked.Currency);
        }
    }
}
