using Microsoft.EntityFrameworkCore;
using Munni.Api.Data;
using Munni.Api.Validation;

namespace Munni.Api.Auth;

public sealed record DeviceDto(
    string Id,
    string? Platform,
    string? Name,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastSeenAt,
    bool Revoked);
public sealed record RenameDeviceRequest(string Name);

/// <summary>
/// Logged-in devices (docs/logged-in-devices-plan.md, approved): see
/// every device this account is signed in on, rename it, and remotely
/// disconnect one — enforcement + last-seen stamping live in
/// UserResolution.TouchDeviceAsync; the revoked device wipes itself on
/// its next request (user ruling: disconnect = wipe).
/// </summary>
public static class DeviceEndpoints
{
    public static void MapDevices(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/me/devices").RequireAuthorization().WithSafeRouteParams();
        group.MapGet("", List);
        group.MapPatch("/{deviceId}", Rename).WithValidation<RenameDeviceRequest>();
        group.MapPost("/{deviceId}/revoke", Revoke);
    }

    private static async Task<IResult> List(AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var devices = await db.UserDevices.Where(d => d.UserId == me)
            .OrderByDescending(d => d.LastSeenAt)
            .Select(d => new DeviceDto(d.Id, d.Platform, d.Name, d.CreatedAt, d.LastSeenAt, d.RevokedAt != null))
            .ToListAsync();
        return Results.Ok(devices);
    }

    private static async Task<IResult> Rename(string deviceId, RenameDeviceRequest request, AppDbContext db, HttpContext http)
    {
        var device = await db.UserDevices.FindAsync(http.GetUserId(), deviceId);
        if (device is null) return Results.NotFound();
        device.Name = request.Name.Trim();
        await db.SaveChangesAsync();
        return Results.Ok();
    }

    private static async Task<IResult> Revoke(string deviceId, AppDbContext db, HttpContext http)
    {
        var device = await db.UserDevices.FindAsync(http.GetUserId(), deviceId);
        if (device is null) return Results.NotFound();
        device.RevokedAt ??= DateTimeOffset.UtcNow; // idempotent
        await db.SaveChangesAsync();
        return Results.Ok();
    }
}
