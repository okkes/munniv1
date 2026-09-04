using Microsoft.EntityFrameworkCore;
using Sentry;
using Microsoft.Extensions.Caching.Memory;
using Munni.Api.Auth;
using Munni.Api.Banking;
using Munni.Api.Data;
using Munni.Api.Validation;

namespace Munni.Api.GoCardless;

public sealed record CreateRequisitionRequest(string SpaceId, string InstitutionId, string RedirectUrl, string? AppScheme = null);
public sealed record CreateRequisitionResponse(string Reference, string Link);
public sealed record CompleteResponse(string Status, int LinkedAccounts, int ImportedTransactions, string? AppScheme = null);

public static partial class GcEndpoints
{
    [System.Text.RegularExpressions.GeneratedRegex("^[A-Za-z]{2}$")]
    private static partial System.Text.RegularExpressions.Regex CountryCode();

    private static async Task<IResult> ListInstitutionsAsync(string country, BankProviderRegistry registry, AppDbContext db, IMemoryCache cache)
    {
        if (!CountryCode().IsMatch(country))
            return Results.BadRequest(new { error = "country must be a 2-letter code" });
        var api = await registry.ActiveAsync(db);
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

    public static void MapGoCardless(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/gocardless").RequireAuthorization().WithSafeRouteParams();

        // institution list, cached per active provider: it changes rarely
        // and the vendors rate-limit
        group.MapGet("/institutions", ListInstitutionsAsync);

        // the vendored logo bytes — anonymous (public artwork) so a plain
        // <img> tag can load it; fetched from the recorded URL exactly once
        app.MapGet("/gocardless/institutions/{institutionId}/logo", ServeLogoAsync).AllowAnonymous();

        group.MapPost("/requisitions", async (CreateRequisitionRequest request, BankProviderRegistry registry, AppDbContext db, HttpContext http) =>
        {
            var userId = http.GetUserId();
            if (!await db.SpaceMembers.AnyAsync(m => m.SpaceId == request.SpaceId && m.UserId == userId))
                return Results.Forbid();

            var api = await registry.ActiveAsync(db); // the admin's pick decides NEW consents
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
                .Select(a => new { a.GcAccountId, a.SpaceId, a.AccountEntityId, a.Iban, a.LastFetchAt })
                .ToListAsync();
            return Results.Ok(connections);
        });
    }

    private static async Task<IResult> CompleteRequisition(Guid reference, string? code, BankProviderRegistry registry, AppDbContext db, HttpContext http)
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

            var (linkedCount, imported, deferred) = await IngestApprovedAccountsAsync(gc, db, requisition, space, status.Accounts);
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
        IBankDataApi gc, AppDbContext db, GcRequisition requisition, Space space, IReadOnlyList<string> accounts)
    {
        var ingest = new GcIngest(db);
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
                    AccountEntityId = ImportIds.AccountId(accountRef),
                    Iban = ImportIds.Normalize(accountRef),
                    Currency = details.Currency ?? "EUR",
                    RequisitionId = requisition.Id,
                    Provider = requisition.Provider,
                };
                db.GcLinkedAccounts.Add(linked);
            }
            else
            {
                // a retried journey re-consented the same bank account, so
                // the row moves to this newest consent with the freshest
                // 90-day window — the older requisition ends up account-less
                // and the idle cleanup frees its provider slot (user had
                // NINE ING consents, unclear which one carried the account).
                // Only within the SAME user: a shared family account linked
                // by a second person keeps the first one's binding — each
                // person's consent lives its own life (family-account case)
                var boundTo = await db.GcRequisitions.FindAsync(linked.RequisitionId);
                if (boundTo is null || boundTo.UserId == requisition.UserId)
                {
                    linked.RequisitionId = requisition.Id;
                    linked.SpaceId = requisition.SpaceId;
                }
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
            imported += await ingest.IngestAccountAsync(space, linked, details, balances, page?.Booked ?? [], page?.Pending);
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
