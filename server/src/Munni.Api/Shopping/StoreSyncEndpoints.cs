using Microsoft.EntityFrameworkCore;
using Munni.Api.Auth;
using Munni.Api.Data;
using Munni.Api.Validation;

namespace Munni.Api.Shopping;

/// <summary>
/// Opt-in E2EE sync of store connections (store-connection-sync design,
/// SC1). The server is DUMB STORAGE plus a tiny approval handshake: it
/// keeps device public keys, per-device wrapped copies of the user's
/// Connection Sync Key, and AES-GCM ciphertext of the connection tokens.
/// No plaintext, no server-side crypto — the server cannot read any of
/// it, which is the whole point.
/// </summary>
public sealed record RegisterDeviceRequest(string DeviceId, string PublicJwk, string Name);
public sealed record WrapRequest(string WrappedCsk);
public sealed record ConnectionCipherRequest(string Cipher);
public sealed record StoreSyncDeviceDto(string DeviceId, string PublicJwk, string Name, bool HasWrap, DateTimeOffset CreatedAt);

public static class StoreSyncEndpoints
{
    public static void MapStoreSync(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/me/store-sync").RequireAuthorization();
        MapDevices(group);
        MapConnections(group);
    }

    private static void MapDevices(RouteGroupBuilder group)
    {
        // announce this device (idempotent — reinstall reuses the id)
        group.MapPost("/devices", RegisterDevice).WithValidation<RegisterDeviceRequest>();

        // every device of mine + whether it can already decrypt
        group.MapGet("/devices", async (AppDbContext db, HttpContext http) =>
        {
            var me = http.GetUserId();
            var devices = await db.StoreSyncDevices.Where(d => d.UserId == me).OrderBy(d => d.CreatedAt).ToListAsync();
            return Results.Ok(devices.Select(d => new StoreSyncDeviceDto(d.DeviceId, d.PublicJwk, d.Name, d.WrappedCsk != null, d.CreatedAt)));
        });

        // approval: an enrolled device publishes the CSK wrapped to another
        group.MapPost("/devices/{deviceId}/wrap", async (string deviceId, WrapRequest request, AppDbContext db, HttpContext http) =>
        {
            if (request.WrappedCsk.Length is 0 or > 4096) return Results.BadRequest();
            var me = http.GetUserId();
            var device = await db.StoreSyncDevices.FirstOrDefaultAsync(d => d.UserId == me && d.DeviceId == deviceId);
            if (device is null) return Results.NotFound();
            device.WrappedCsk = request.WrappedCsk;
            await db.SaveChangesAsync();
            return Results.Ok();
        }).WithValidation<WrapRequest>();

        // my wrap (the new device polls this after asking for approval)
        group.MapGet("/devices/{deviceId}/wrap", async (string deviceId, AppDbContext db, HttpContext http) =>
        {
            var me = http.GetUserId();
            var device = await db.StoreSyncDevices.FirstOrDefaultAsync(d => d.UserId == me && d.DeviceId == deviceId);
            return device?.WrappedCsk is null ? Results.NoContent() : Results.Ok(new { wrappedCsk = device.WrappedCsk });
        });

        // revocation: the device loses its wrap AND its key row
        group.MapDelete("/devices/{deviceId}", async (string deviceId, AppDbContext db, HttpContext http) =>
        {
            var me = http.GetUserId();
            db.StoreSyncDevices.RemoveRange(db.StoreSyncDevices.Where(d => d.UserId == me && d.DeviceId == deviceId));
            await db.SaveChangesAsync();
            return Results.Ok();
        });

    }

    private static async Task<IResult> RegisterDevice(RegisterDeviceRequest request, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var existing = await db.StoreSyncDevices.FirstOrDefaultAsync(d => d.UserId == me && d.DeviceId == request.DeviceId);
        if (existing is null)
        {
            db.StoreSyncDevices.Add(new StoreSyncDevice
            {
                Id = Guid.NewGuid(),
                UserId = me,
                DeviceId = request.DeviceId,
                PublicJwk = request.PublicJwk,
                Name = request.Name,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }
        else if (existing.PublicJwk != request.PublicJwk)
        {
            // fresh install minted a new keypair: the old wrap is dead
            existing.PublicJwk = request.PublicJwk;
            existing.Name = request.Name;
            existing.WrappedCsk = null;
        }
        await db.SaveChangesAsync();
        return Results.Ok();
    }

    private static void MapConnections(RouteGroupBuilder group)
    {
        // connection ciphertext, one blob per connection INSTANCE (v3 keys
        // are uuids, 36 chars — the old 32 cap would 400 them; legacy blobs
        // keyed by store name keep working)
        group.MapPut("/connections/{store}", async (string store, ConnectionCipherRequest request, AppDbContext db, HttpContext http) =>
        {
            if (store.Length > 64 || request.Cipher.Length is 0 or > 16384) return Results.BadRequest();
            var me = http.GetUserId();
            var row = await db.StoreConnCiphers.FirstOrDefaultAsync(c => c.UserId == me && c.Store == store);
            if (row is null)
            {
                db.StoreConnCiphers.Add(new StoreConnCipher
                {
                    Id = Guid.NewGuid(),
                    UserId = me,
                    Store = store,
                    Cipher = request.Cipher,
                    UpdatedAt = DateTimeOffset.UtcNow,
                });
            }
            else
            {
                row.Cipher = request.Cipher;
                row.UpdatedAt = DateTimeOffset.UtcNow;
            }
            await db.SaveChangesAsync();
            return Results.Ok();
        }).WithValidation<ConnectionCipherRequest>();

        group.MapGet("/connections", async (AppDbContext db, HttpContext http) =>
        {
            var me = http.GetUserId();
            var rows = await db.StoreConnCiphers.Where(c => c.UserId == me).ToListAsync();
            return Results.Ok(rows.Select(r => new { store = r.Store, cipher = r.Cipher, updatedAt = r.UpdatedAt }));
        });

        group.MapDelete("/connections/{store}", async (string store, AppDbContext db, HttpContext http) =>
        {
            var me = http.GetUserId();
            db.StoreConnCiphers.RemoveRange(db.StoreConnCiphers.Where(c => c.UserId == me && c.Store == store));
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        // the global OFF switch: every ciphertext, wrap and key is erased
        group.MapDelete("", async (AppDbContext db, HttpContext http) =>
        {
            var me = http.GetUserId();
            db.StoreConnCiphers.RemoveRange(db.StoreConnCiphers.Where(c => c.UserId == me));
            db.StoreSyncDevices.RemoveRange(db.StoreSyncDevices.Where(d => d.UserId == me));
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }
}
