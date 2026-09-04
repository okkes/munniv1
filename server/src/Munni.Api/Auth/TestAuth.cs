using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Munni.Api.Data;

namespace Munni.Api.Auth;

/// <summary>
/// Header-based auth for CI/e2e (Auth:TestMode=true): the caller supplies
/// X-User-Sub and is treated as that subject. Never enabled in production;
/// Logto JWT bearer takes its place there.
/// </summary>
public sealed class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "TestAuth";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var sub = Request.Headers["X-User-Sub"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(sub))
            return Task.FromResult(AuthenticateResult.Fail("missing X-User-Sub"));

        var identity = new ClaimsIdentity([new Claim("sub", sub)], SchemeName);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}

public static class UserResolution
{
    private const string ItemKey = "munni.userId";

    /// <summary>JIT-provisions a user row for the authenticated subject.</summary>
    public static async Task ResolveUser(HttpContext http, AppDbContext db, Func<Task> next)
    {
        // "sub" with MapInboundClaims=false; NameIdentifier as a safety net
        var sub = http.User.FindFirstValue("sub") ?? http.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!string.IsNullOrEmpty(sub))
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Sub == sub);
            if (user is null)
            {
                user = new User { Id = Guid.NewGuid(), Sub = sub };
                db.Users.Add(user);
                try
                {
                    await db.SaveChangesAsync();
                }
                catch (DbUpdateException)
                {
                    // a fresh app launch fires several requests at once and
                    // they all JIT-provision the same sub — the unique index
                    // (IX_Users_Sub) lets exactly one insert win; the losers
                    // adopt that row instead of answering 500
                    db.Entry(user).State = EntityState.Detached;
                    user = await db.Users.FirstAsync(u => u.Sub == sub);
                }
            }
            http.Items[ItemKey] = user.Id;
            if (!await TouchDeviceAsync(http, db, user.Id)) return; // revoked → 410, request ends here
        }
        await next();
    }

    /// <summary>
    /// Logged-in devices: every authenticated request stamps the calling
    /// device (X-Munni-Device, the client's HLC node id) and enforces
    /// remote disconnect — a revoked device answers 410 {device-revoked}
    /// and the client wipes itself (user ruling: disconnect = wipe).
    /// 410, not 403: the sync engine treats a 403 as "membership lost"
    /// and would purge the space instead of the device.
    /// </summary>
    private static async Task<bool> TouchDeviceAsync(HttpContext http, AppDbContext db, Guid userId)
    {
        var deviceId = http.Request.Headers["X-Munni-Device"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(deviceId) || deviceId.Length > 64) return true; // legacy client — nothing to enforce

        var device = await db.UserDevices.FindAsync(userId, deviceId);
        if (device?.RevokedAt is not null)
        {
            http.Response.StatusCode = StatusCodes.Status410Gone;
            await http.Response.WriteAsJsonAsync(new { error = "device-revoked" });
            return false;
        }
        var now = DateTimeOffset.UtcNow;
        if (device is null)
        {
            var platform = http.Request.Headers["X-Munni-Platform"].FirstOrDefault();
            db.UserDevices.Add(new UserDevice
            {
                Id = deviceId,
                UserId = userId,
                Platform = platform is "android" or "ios" or "web" ? platform : null,
                CreatedAt = now,
                LastSeenAt = now,
            });
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException) { db.ChangeTracker.Clear(); } // concurrent first requests — one wins
        }
        else if (now - device.LastSeenAt > TimeSpan.FromMinutes(15))
        {
            device.LastSeenAt = now; // throttled: one write per quarter hour
            await db.SaveChangesAsync();
        }
        return true;
    }

    public static Guid GetUserId(this HttpContext http) =>
        http.Items[ItemKey] as Guid? ?? throw new InvalidOperationException("no resolved user");

    /// <summary>null on anonymous requests (endpoints that allow them)</summary>
    public static Guid? TryGetUserId(this HttpContext http) => http.Items[ItemKey] as Guid?;
}
