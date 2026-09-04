using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Munni.Api.Auth;
using Munni.Api.Data;
using Munni.Api.GoCardless;
using Munni.Api.Validation;

namespace Munni.Api.Admin;

public sealed record AdminUserDto(Guid Id, string Sub, string? DisplayName, string? Email, DateTimeOffset CreatedAt, int SpaceCount, bool IsAdmin, bool Bootstrap);
public sealed record AdminFeedDto(string FeedSpaceId, long MaxSeq);
public sealed record AdminAttachmentDto(string SpaceId, string FeedSpaceId, string AccountId);
public sealed record AdminGcLinkDto(string GcAccountId, string SpaceId, string AccountEntityId, string Iban, string Provider, DateTimeOffset? LastFetchAt, string RequisitionId);
public sealed record AdminUserDiagnosisDto(
    Guid UserId,
    List<string> MemberSpaces,
    List<AdminFeedDto> OwnedFeeds,
    List<AdminAttachmentDto> Attachments,
    List<AdminGcLinkDto> GcLinks);
public sealed record AdminGrantDto(string Sub, string GrantedBySub, DateTimeOffset GrantedAtUtc, bool Bootstrap);
public sealed record ProviderQuotaDto(string Provider, string Scope, int? Limit, int? Remaining, DateTimeOffset? ResetAtUtc, DateTimeOffset CapturedAtUtc);
public sealed record AdminRequisitionDto(
    string RequisitionId,
    string Status,
    string InstitutionId,
    DateTimeOffset? Created,
    int AccountCount,
    /// <summary>true when the consent is dead at GoCardless (gone or expired) while THIS environment still records it</summary>
    bool Stale,
    string? OwnerSub);

/// <summary>
/// THIS environment's connections only. The GoCardless account is shared
/// by every munni environment (prod/staging/twins), so the remote listing
/// contains foreign consents — they are counted, never listed and never
/// deletable from here (a staging admin once saw prod's healthy consents
/// flagged "stale" with a working delete button — a cross-environment
/// foot-gun, 2026-08-27).
/// </summary>
public sealed record AdminRequisitionListDto(List<AdminRequisitionDto> Requisitions, int ForeignCount);

/// <summary>
/// Admin area: user overview + GoCardless requisition management (list
/// everything GC knows about, delete selected ones to free the free-tier
/// connection quota). Gated on Admin:Subs (comma-separated OIDC subs).
/// </summary>
public static class AdminEndpoints
{
    public static void MapAdmin(this IEndpointRouteBuilder app, bool goCardlessEnabled, bool bankingEnabled)
    {
        var group = app.MapGroup("/admin").RequireAuthorization().WithSafeRouteParams();

        group.MapGet("/ping", async (HttpContext http, AppDbContext db, IConfiguration config) =>
            await IsAdminAsync(http, db, config)
                ? Results.Ok(new { admin = true, gocardless = goCardlessEnabled, banking = bankingEnabled })
                : Results.Forbid());

        group.MapGet("/users", ListUsers);
        // operator-initiated removal, same pipeline as the user's own
        // DELETE /me (account-deletion design)
        group.MapDelete("/users/{sub}", DeleteUser);
        group.MapGet("/users/{sub}/diagnosis", UserDiagnosis);
        // Logto username casing (docs/logto-username-casing.md option 1):
        // one-shot lowercase migration via the Management API — mobile
        // keyboards capitalize the first letter and Logto matches
        // usernames case-sensitively, locking people out of their own
        // account. Collisions are skipped and reported, never merged.
        group.MapPost("/logto/lowercase-usernames", LowercaseUsernames);

        MapAdminGrants(group);
        MapQuota(group);

        if (!goCardlessEnabled) return;
        group.MapGet("/gocardless/requisitions", ListRequisitions);
        group.MapDelete("/gocardless/requisitions/{requisitionId}", DeleteRequisition);
    }

    /// <summary>one-shot migration: every Logto username becomes lowercase;
    /// collisions (Okkes vs okkes both existing) are skipped and reported</summary>
    private static async Task<IResult> LowercaseUsernames(
        HttpContext http, AppDbContext db, IConfiguration config, IHttpClientFactory httpFactory)
    {
        if (!await IsAdminAsync(http, db, config)) return Results.Forbid();
        var session = await LogtoManagement.ConnectAsync(httpFactory, config);
        if (session is null) return Results.Problem("Logto M2M not configured", statusCode: 503);

        var changed = new List<string>();
        var skipped = new List<string>();
        for (var page = 1; page <= 50; page++)
        {
            if (await LowercasePageAsync(session, page, changed, skipped) < 100) break;
        }
        return Results.Ok(new { changed, skipped });
    }

    /// <summary>lowercases one Logto user page; returns the page's size</summary>
    private static async Task<int> LowercasePageAsync(LogtoSession session, int page, List<string> changed, List<string> skipped)
    {
        using var listRequest = session.Request(HttpMethod.Get, $"/api/users?page={page}&page_size=100");
        var listResponse = await session.Http.SendAsync(listRequest);
        listResponse.EnsureSuccessStatusCode();
        using var users = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var batch = users.RootElement.EnumerateArray().ToList();
        foreach (var user in batch)
        {
            var id = user.GetProperty("id").GetString()!;
            var username = user.TryGetProperty("username", out var name) && name.ValueKind == JsonValueKind.String
                ? name.GetString()
                : null;
            if (username is null) continue;
            var lower = username.ToLowerInvariant();
            // exact-ordinal check: "is it ALREADY lowercase", not a
            // case-insensitive comparison (CA1862 wants this explicit)
            if (string.Equals(lower, username, StringComparison.Ordinal)) continue;
            using var patch = session.Request(HttpMethod.Patch, $"/api/users/{Uri.EscapeDataString(id)}");
            patch.Content = new StringContent(
                JsonSerializer.Serialize(new { username = lower }), Encoding.UTF8, "application/json");
            var patchResponse = await session.Http.SendAsync(patch);
            if (patchResponse.IsSuccessStatusCode) changed.Add(username);
            else skipped.Add($"{username} ({(int)patchResponse.StatusCode})");
        }
        return batch.Count;
    }

    private static async Task<IResult> ListUsers(HttpContext http, AppDbContext db, IConfiguration config)
    {
        if (!await IsAdminAsync(http, db, config)) return Results.Forbid();
        var users = await db.Users.ToListAsync();
        var counts = await db.SpaceMembers.GroupBy(m => m.UserId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        var bootstrap = BootstrapSubs(config);
        var granted = (await db.AdminGrants.Select(g => g.Sub).ToListAsync()).ToHashSet();
        return Results.Ok(users
            .OrderBy(u => u.CreatedAt)
            .Select(u => new AdminUserDto(
                u.Id, u.Sub, u.DisplayName, u.Email, u.CreatedAt, counts.GetValueOrDefault(u.Id),
                IsAdmin: bootstrap.Contains(u.Sub) || granted.Contains(u.Sub),
                Bootstrap: bootstrap.Contains(u.Sub)))
            .ToList());
    }

    /// <summary>the whole account→app chain for one user: memberships,
    /// owned feeds (+ op high-water mark), attachments, gc links —
    /// diagnosing "the consent linked but the app shows nothing"</summary>
    private static async Task<IResult> UserDiagnosis(string sub, AppDbContext db)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Sub == sub);
        if (user is null) return Results.NotFound();
        var memberSpaces = await db.SpaceMembers.Where(m => m.UserId == user.Id).Select(m => m.SpaceId).ToListAsync();
        var ownedFeedIds = await db.FeedSpaces.Where(f => f.OwnerUserId == user.Id).Select(f => f.Id).ToListAsync();
        var maxSeqs = await db.SyncOps
            .Where(o => ownedFeedIds.Contains(o.SpaceId))
            .GroupBy(o => o.SpaceId)
            .Select(g => new { g.Key, Max = g.Max(o => o.Seq) })
            .ToDictionaryAsync(g => g.Key, g => g.Max);
        var attachments = await db.SpaceAccountLinks
            .Where(l => memberSpaces.Contains(l.SpaceId))
            .Select(l => new AdminAttachmentDto(l.SpaceId, l.FeedSpaceId, l.AccountId))
            .ToListAsync();
        var gcLinks = await db.GcRequisitions
            .Where(r => r.UserId == user.Id)
            .Join(db.GcLinkedAccounts, r => r.Id, a => a.RequisitionId,
                // RequisitionId = the PROVIDER's consent id, matching what
                // the Bank connections panel lists — names the consent that
                // actually carries this account (safe-to-delete question)
                (r, a) => new AdminGcLinkDto(a.GcAccountId, a.SpaceId, a.AccountEntityId, a.Iban, a.Provider, a.LastFetchAt, r.RequisitionId))
            .ToListAsync();
        return Results.Ok(new AdminUserDiagnosisDto(
            user.Id,
            memberSpaces,
            ownedFeedIds.Select(id => new AdminFeedDto(id, maxSeqs.GetValueOrDefault(id))).ToList(),
            attachments,
            gcLinks));
    }

    private static async Task<IResult> DeleteUser(
        string sub,
        HttpContext http,
        AppDbContext db,
        IConfiguration config,
        IHttpClientFactory httpFactory,
        ILoggerFactory loggerFactory)
    {
        if (!await IsAdminAsync(http, db, config)) return Results.Forbid();
        var target = await db.Users.FirstOrDefaultAsync(u => u.Sub == sub);
        if (target is null) return Results.NotFound();
        var self = await db.Users.FindAsync(http.GetUserId());
        if (self?.Sub == sub) return Results.BadRequest(new { error = "cannot delete yourself here" });
        var gc = http.RequestServices.GetService<IGoCardlessApi>();
        await Social.AccountDeletion.DeleteUserAsync(db, gc, httpFactory, config, loggerFactory.CreateLogger("AccountDeletion"), target);
        return Results.Ok(new { deleted = sub });
    }

    private static async Task<IResult> ListRequisitions(HttpContext http, AppDbContext db, IConfiguration config, IGoCardlessApi gc)
    {
        if (!await IsAdminAsync(http, db, config)) return Results.Forbid();
        var remote = await gc.ListRequisitionsAsync();
        var local = await db.GcRequisitions.ToListAsync();
        var owners = await db.Users.ToDictionaryAsync(u => u.Id, u => u.Sub);
        var remoteById = remote.ToDictionary(r => r.Id);
        var localIds = local.Select(l => l.RequisitionId).ToHashSet();
        var requisitions = local
            // interrupted journeys can re-use a consent — one row per consent
            .GroupBy(l => l.RequisitionId)
            .Select(g => g.OrderByDescending(l => l.CreatedAt).First())
            .Select(l =>
            {
                var r = remoteById.GetValueOrDefault(l.RequisitionId);
                return new AdminRequisitionDto(
                    l.RequisitionId,
                    r?.Status ?? "gone",
                    l.InstitutionId,
                    r?.Created ?? l.CreatedAt,
                    r?.Accounts.Count ?? 0,
                    // dead at the provider while we still track it
                    Stale: r is null || r.Status == "EX",
                    OwnerSub: owners.GetValueOrDefault(l.UserId));
            })
            .OrderByDescending(d => d.Created)
            .ToList();
        return Results.Ok(new AdminRequisitionListDto(requisitions, ForeignCount: remote.Count(r => !localIds.Contains(r.Id))));
    }

    private static async Task<IResult> DeleteRequisition(string requisitionId, HttpContext http, AppDbContext db, IConfiguration config, IGoCardlessApi gc)
    {
        if (!await IsAdminAsync(http, db, config)) return Results.Forbid();
        var local = await db.GcRequisitions.FirstOrDefaultAsync(r => r.RequisitionId == requisitionId);
        // NEVER touch a consent this environment doesn't own — the GC
        // account is shared, and deleting here would revoke another
        // environment's live bank connection
        if (local is null) return Results.NotFound(new { error = "not this environment's connection — manage it from its own admin" });
        await gc.DeleteRequisitionAsync(requisitionId); // frees the GC connection slot
        var linked = await db.GcLinkedAccounts.Where(a => a.RequisitionId == local.Id).ToListAsync();
        db.GcLinkedAccounts.RemoveRange(linked); // stops scheduled fetching
        db.GcRequisitions.RemoveRange(await db.GcRequisitions.Where(r => r.RequisitionId == requisitionId).ToListAsync());
        await db.SaveChangesAsync();
        return Results.Ok();
    }

    // /admin/bank-provider retired (#175): the END USER picks the
    // provider at connect time, so there is no admin-selected "active"
    // provider anymore — existing accounts keep the one that created them.

    /// <summary>grant/revoke admin from the console (AD2): the env list
    /// stays as un-demotable bootstrap; grants live in the database</summary>
    private static void MapAdminGrants(IEndpointRouteBuilder group)
    {
        group.MapGet("/admins", ListAdmins);
        group.MapPost("/admins/{sub}", GrantAdmin);
        group.MapDelete("/admins/{sub}", RevokeAdmin);
    }

    private static async Task<IResult> ListAdmins(HttpContext http, AppDbContext db, IConfiguration config)
    {
        if (!await IsAdminAsync(http, db, config)) return Results.Forbid();
        var grants = await db.AdminGrants.OrderBy(g => g.GrantedAtUtc).ToListAsync();
        var list = BootstrapSubs(config)
            .Select(sub => new AdminGrantDto(sub, "env", DateTimeOffset.MinValue, Bootstrap: true))
            .Concat(grants.Select(g => new AdminGrantDto(g.Sub, g.GrantedBySub, g.GrantedAtUtc, Bootstrap: false)))
            .ToList();
        return Results.Ok(list);
    }

    private static async Task<IResult> GrantAdmin(string sub, HttpContext http, AppDbContext db, IConfiguration config)
    {
        if (!await IsAdminAsync(http, db, config)) return Results.Forbid();
        if (!await db.Users.AnyAsync(u => u.Sub == sub)) return Results.NotFound(new { error = "no such user" });
        if (BootstrapSubs(config).Contains(sub) || await db.AdminGrants.AnyAsync(g => g.Sub == sub))
            return Results.Ok(new { granted = sub }); // idempotent
        var granter = await db.Users.FindAsync(http.GetUserId());
        db.AdminGrants.Add(new AdminGrant { Id = Guid.NewGuid(), Sub = sub, GrantedBySub = granter?.Sub ?? "unknown" });
        await db.SaveChangesAsync();
        return Results.Ok(new { granted = sub });
    }

    private static async Task<IResult> RevokeAdmin(string sub, HttpContext http, AppDbContext db, IConfiguration config)
    {
        if (!await IsAdminAsync(http, db, config)) return Results.Forbid();
        // env-bootstrap admins are the emergency access — not demotable here
        if (BootstrapSubs(config).Contains(sub)) return Results.BadRequest(new { error = "bootstrap admin" });
        var self = await db.Users.FindAsync(http.GetUserId());
        // you cannot demote yourself: guards against locking the last admin out
        if (self?.Sub == sub) return Results.BadRequest(new { error = "cannot demote yourself" });
        var grant = await db.AdminGrants.FirstOrDefaultAsync(g => g.Sub == sub);
        if (grant is not null)
        {
            db.AdminGrants.Remove(grant);
            await db.SaveChangesAsync();
        }
        return Results.Ok(new { revoked = sub });
    }

    /// <summary>latest provider rate-limit snapshots (AD3), captured from
    /// normal sync traffic — the console shows remaining/reset per scope</summary>
    private static void MapQuota(IEndpointRouteBuilder group)
    {
        group.MapGet("/quota", GetQuota);
    }

    /// <summary>shared with /control/quota: the snapshots describe the SHARED
    /// provider account, so both consoles serve the identical payload</summary>
    internal static async Task<IResult> GetQuota(HttpContext http, AppDbContext db, IConfiguration config)
    {
        if (!await IsAdminAsync(http, db, config)) return Results.Forbid();
        var rows = await db.ProviderQuotas.OrderBy(q => q.Provider).ThenBy(q => q.Scope).ToListAsync();
        return Results.Ok(rows
            .Select(q => new ProviderQuotaDto(q.Provider, q.Scope, q.Limit, q.Remaining, q.ResetAtUtc, q.CapturedAtUtc))
            .ToList());
    }

    private static HashSet<string> BootstrapSubs(IConfiguration config) =>
        (config["Admin:Subs"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet();

    /// <summary>catalog endpoints live in their own file but share this gate</summary>
    internal static Task<bool> IsAdminForCatalogAsync(HttpContext http, AppDbContext db, IConfiguration config)
        => IsAdminAsync(http, db, config);

    // internal: the /control group (ControlEndpoints) shares this exact gate
    internal static async Task<bool> IsAdminAsync(HttpContext http, AppDbContext db, IConfiguration config)
    {
        var user = await db.Users.FindAsync(http.GetUserId());
        if (user is null) return false;
        if (BootstrapSubs(config).Contains(user.Sub)) return true;
        return await db.AdminGrants.AnyAsync(g => g.Sub == user.Sub);
    }
}
