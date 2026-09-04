using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Munni.Api.Data;
using WebPush;

namespace Munni.Api.Push;

/// <summary>
/// One stored push subscription of a user (a device). Web Push rows
/// carry endpoint+keys; native (fcm) rows keep the device token in
/// Endpoint and leave the keys null.
/// </summary>
public class PushSubscriptionRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    /// <summary>"webpush" (browser) or "fcm" (native shell device token)</summary>
    public string Kind { get; set; } = "webpush";
    public required string Endpoint { get; set; }
    public string? P256dh { get; set; }
    public string? Auth { get; set; }
    /// <summary>the device's UI language at registration — native pushes
    /// carry a visible notification block (iOS shows nothing for
    /// data-only messages when the app is closed), and its text is
    /// localized server-side per device</summary>
    public string Lang { get; set; } = "en";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Transport abstraction so tests can fake the push service.</summary>
public interface IPushSender
{
    /// <returns>false when the subscription is gone (410/404) and should be deleted</returns>
    Task<bool> SendAsync(PushSubscriptionRow subscription, string payload, CancellationToken ct);
}

/// <summary>Used when no VAPID keys are configured — notifications silently off.</summary>
public sealed class NoopPushSender : IPushSender
{
    public Task<bool> SendAsync(PushSubscriptionRow subscription, string payload, CancellationToken ct) =>
        Task.FromResult(true);
}

public sealed class WebPushSender(IConfiguration config) : IPushSender
{
    private readonly VapidDetails _vapid = new(
        config["Push:Subject"] ?? "mailto:admin@localhost",
        config["Push:VapidPublicKey"],
        config["Push:VapidPrivateKey"]);

    public async Task<bool> SendAsync(PushSubscriptionRow subscription, string payload, CancellationToken ct)
    {
        using var client = new WebPushClient();
        try
        {
            await client.SendNotificationAsync(
                new PushSubscription(subscription.Endpoint, subscription.P256dh!, subscription.Auth!),
                payload, _vapid, ct);
            return true;
        }
        catch (WebPushException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Gone or System.Net.HttpStatusCode.NotFound)
        {
            return false; // expired/unsubscribed — caller removes the row
        }
    }
}

/// <summary>
/// Sends Web Push notifications: sync announcements (new transactions
/// arrived — the app preloads them the moment it opens) and social
/// events (friend requests, space invites). Payloads carry raw facts;
/// the service worker localizes the visible text.
/// </summary>
public sealed class PushNotifier(AppDbContext db, IPushSender sender, ILogger<PushNotifier> logger)
{
    public async Task NotifyNewTransactionsAsync(string spaceId, int count, CancellationToken ct)
    {
        var userIds = await db.SpaceMembers.Where(m => m.SpaceId == spaceId).Select(m => m.UserId).ToListAsync(ct);
        await SendToUsersAsync(userIds, new { type = "new-transactions", spaceId, count }, ct);
    }

    /// <summary>"{fromName} sent you a friend request"</summary>
    public Task NotifyFriendRequestAsync(Guid toUserId, string? fromName, CancellationToken ct) =>
        SendToUsersAsync([toUserId], new { type = "friend-request", fromName }, ct);

    /// <summary>"{fromName} accepted your friend request"</summary>
    public Task NotifyFriendAcceptedAsync(Guid toUserId, string? fromName, CancellationToken ct) =>
        SendToUsersAsync([toUserId], new { type = "friend-accept", fromName }, ct);

    /// <summary>"{fromName} invited you to {spaceName}"</summary>
    public Task NotifySpaceInviteAsync(Guid toUserId, string? fromName, string? spaceName, CancellationToken ct) =>
        SendToUsersAsync([toUserId], new { type = "space-invite", fromName, spaceName }, ct);

    /// <summary>"{fromName} joined {spaceName}" — closes the inviter's loop</summary>
    public Task NotifySpaceJoinAsync(Guid toUserId, string? fromName, string? spaceName, CancellationToken ct) =>
        SendToUsersAsync([toUserId], new { type = "space-join", fromName, spaceName }, ct);

    private async Task SendToUsersAsync(IReadOnlyCollection<Guid> userIds, object payload, CancellationToken ct)
    {
        var subscriptions = await db.PushSubscriptions.Where(s => userIds.Contains(s.UserId)).ToListAsync(ct);
        if (subscriptions.Count == 0) return;

        var json = JsonSerializer.Serialize(payload);
        foreach (var subscription in subscriptions)
        {
            try
            {
                if (!await sender.SendAsync(subscription, json, ct))
                {
                    db.PushSubscriptions.Remove(subscription);
                }
            }
            catch (Exception ex)
            {
                // one broken push service must not block the caller
                logger.LogWarning(ex, "push send failed for user {UserId}", subscription.UserId);
            }
        }
        await db.SaveChangesAsync(ct);
    }
}
