using Microsoft.EntityFrameworkCore;
using Munni.Api.Data;
using Munni.Api.GoCardless;
using Munni.Api.Validation;

namespace Munni.Api.Admin;

public sealed record ControlConsentDto(
    string RequisitionId,
    string Status,
    string InstitutionId,
    DateTimeOffset? Created,
    int AccountCount,
    /// <summary>origin of the requisition's redirect url — the environment
    /// that created the consent (null when no usable redirect survives)</summary>
    string? EnvironmentOrigin,
    /// <summary>true when THIS environment's database records the consent</summary>
    bool OwnedHere);

/// <summary>
/// Control area (admin split LS5/LS6): the shared-services cockpit behind
/// the same admin gate as /admin. Where the portal shows one environment's
/// slice, /control shows the whole shared GoCardless account — every
/// consent attributed to its environment by redirect origin, plus the
/// account-wide quota. Deliberately NO delete endpoint: deletion stays
/// per-environment (each portal deletes only its own consents), so the
/// cockpit can never revoke another environment's live bank connection.
/// </summary>
public static class ControlEndpoints
{
    public static void MapControl(this IEndpointRouteBuilder app, bool goCardlessEnabled, bool bankingEnabled)
    {
        var group = app.MapGroup("/control").RequireAuthorization().WithSafeRouteParams();

        group.MapGet("/ping", async (HttpContext http, AppDbContext db, IConfiguration config) =>
            await AdminEndpoints.IsAdminAsync(http, db, config)
                ? Results.Ok(new { admin = true, gocardless = goCardlessEnabled, banking = bankingEnabled })
                : Results.Forbid());

        group.MapGet("/quota", AdminEndpoints.GetQuota);

        if (!goCardlessEnabled) return;
        group.MapGet("/consents", ListConsents);
    }

    /// <summary>EVERY requisition on the shared GoCardless account — the
    /// cross-environment view the per-env portal deliberately hides</summary>
    private static async Task<IResult> ListConsents(HttpContext http, AppDbContext db, IConfiguration config, IGoCardlessApi gc)
    {
        if (!await AdminEndpoints.IsAdminAsync(http, db, config)) return Results.Forbid();
        var remote = await gc.ListRequisitionsAsync();
        var localIds = (await db.GcRequisitions.Select(r => r.RequisitionId).ToListAsync()).ToHashSet();
        var consents = remote
            .Select(r => new ControlConsentDto(
                r.Id,
                r.Status,
                r.InstitutionId,
                r.Created,
                r.Accounts.Count,
                EnvironmentOrigin: Uri.TryCreate(r.Redirect, UriKind.Absolute, out var redirect)
                    ? redirect.GetLeftPart(UriPartial.Authority)
                    : null,
                OwnedHere: localIds.Contains(r.Id)))
            .OrderByDescending(c => c.Created)
            .ToList();
        return Results.Ok(consents);
    }
}
