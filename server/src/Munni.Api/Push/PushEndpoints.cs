using Microsoft.EntityFrameworkCore;
using Munni.Api.Auth;
using Munni.Api.Data;
using Munni.Api.Validation;

namespace Munni.Api.Push;

/// <summary>Kind "webpush" (default): endpoint+keys. Kind "fcm": the device token rides Endpoint, keys stay null.</summary>
public sealed record SubscribeRequest(string Endpoint, string? P256dh = null, string? Auth = null, string Kind = "webpush", string? Lang = null);

public static class PushEndpoints
{
    public static void MapPush(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/me/push-subscriptions").RequireAuthorization();

        group.MapPost("", async (SubscribeRequest request, AppDbContext db, HttpContext http) =>
        {
            var me = http.GetUserId();
            var existing = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == request.Endpoint);
            if (existing is null)
            {
                db.PushSubscriptions.Add(new PushSubscriptionRow
                {
                    Id = Guid.NewGuid(),
                    UserId = me,
                    Kind = request.Kind,
                    Endpoint = request.Endpoint,
                    P256dh = request.P256dh,
                    Auth = request.Auth,
                    Lang = request.Lang ?? "en",
                });
            }
            else
            {
                // browser rotated keys for the same endpoint, or device changed hands
                existing.UserId = me;
                existing.Kind = request.Kind;
                existing.P256dh = request.P256dh;
                existing.Auth = request.Auth;
                existing.Lang = request.Lang ?? existing.Lang;
            }
            await db.SaveChangesAsync();
            return Results.Ok();
        }).WithValidation<SubscribeRequest>();

        // endpoint passed as query param: DELETE bodies are unreliable across proxies
        group.MapDelete("", async (string endpoint, AppDbContext db, HttpContext http) =>
        {
            if (string.IsNullOrEmpty(endpoint) || endpoint.Length > 2048) return Results.BadRequest();
            var me = http.GetUserId();
            var subscription = await db.PushSubscriptions
                .FirstOrDefaultAsync(s => s.Endpoint == endpoint && s.UserId == me);
            if (subscription is not null)
            {
                db.PushSubscriptions.Remove(subscription);
                await db.SaveChangesAsync();
            }
            return Results.Ok();
        });
    }
}
