using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Munni.Api.Data;
using Munni.Api.Push;
using Munni.Api.Social;
using Xunit;

namespace Munni.Api.Tests;

public class PushTests : IClassFixture<SyncApiFactory>
{
    private readonly SyncApiFactory _factory;

    public PushTests(SyncApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    [Fact]
    public async Task Subscribe_upserts_by_endpoint_and_unsubscribe_removes()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var client = ClientFor($"push-{suffix}");
        var endpoint = $"https://push.example/{suffix}";

        var create = await client.PostAsJsonAsync("/me/push-subscriptions", new SubscribeRequest(endpoint, "p256", "auth1"));
        Assert.True(create.IsSuccessStatusCode);
        // same endpoint again with rotated keys -> updated, not duplicated
        await client.PostAsJsonAsync("/me/push-subscriptions", new SubscribeRequest(endpoint, "p256-rotated", "auth2"));

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = Assert.Single(await db.PushSubscriptions.Where(s => s.Endpoint == endpoint).ToListAsync());
            Assert.Equal("p256-rotated", row.P256dh);
        }

        Assert.True((await client.DeleteAsync($"/me/push-subscriptions?endpoint={Uri.EscapeDataString(endpoint)}")).IsSuccessStatusCode);
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Empty(await db.PushSubscriptions.Where(s => s.Endpoint == endpoint).ToListAsync());
        }
    }

    [Fact]
    public async Task Subscribe_rejects_non_https_endpoints()
    {
        var client = ClientFor($"push-bad-{Guid.NewGuid():N}");
        var response = await client.PostAsJsonAsync("/me/push-subscriptions",
            new SubscribeRequest("http://insecure.example/x", "p", "a"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Native_fcm_subscriptions_store_the_device_token_without_keys()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var client = ClientFor($"push-fcm-{suffix}");
        var token = $"fcm-device-token-{suffix}"; // raw token, not a URL

        var create = await client.PostAsJsonAsync("/me/push-subscriptions",
            new SubscribeRequest(token, Kind: "fcm"));
        Assert.True(create.IsSuccessStatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = Assert.Single(await db.PushSubscriptions.Where(s => s.Endpoint == token).ToListAsync());
        Assert.Equal("fcm", row.Kind);
        Assert.Null(row.P256dh);

        // webpush rows still demand their key pair; unknown kinds bounce
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/me/push-subscriptions",
            new SubscribeRequest("https://push.example/nokeys"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/me/push-subscriptions",
            new SubscribeRequest(token, Kind: "carrier-pigeon"))).StatusCode);
    }

    [Fact]
    public async Task Routing_sender_picks_the_transport_by_kind_and_tolerates_missing_ones()
    {
        var web = new FakeSender();
        var fcm = new FakeSender();
        var router = new RoutingPushSender(web, fcm);
        var webRow = new PushSubscriptionRow { Id = Guid.NewGuid(), UserId = Guid.NewGuid(), Endpoint = "https://p/w", P256dh = "k", Auth = "a" };
        var fcmRow = new PushSubscriptionRow { Id = Guid.NewGuid(), UserId = Guid.NewGuid(), Kind = "fcm", Endpoint = "tok-1" };

        Assert.True(await router.SendAsync(webRow, "{}", CancellationToken.None));
        Assert.True(await router.SendAsync(fcmRow, "{}", CancellationToken.None));
        Assert.Equal(webRow.UserId, Assert.Single(web.Sent).UserId);
        Assert.Equal(fcmRow.UserId, Assert.Single(fcm.Sent).UserId);

        // no FCM transport configured: the row survives (send "succeeds")
        var partial = new RoutingPushSender(web, null);
        Assert.True(await partial.SendAsync(fcmRow, "{}", CancellationToken.None));
        Assert.Single(fcm.Sent); // untouched
    }

    private sealed class FakeSender : IPushSender
    {
        public List<(Guid UserId, string Payload)> Sent { get; } = [];
        public HashSet<string> DeadEndpoints { get; } = [];

        public Task<bool> SendAsync(PushSubscriptionRow subscription, string payload, CancellationToken ct)
        {
            if (DeadEndpoints.Contains(subscription.Endpoint)) return Task.FromResult(false);
            Sent.Add((subscription.UserId, payload));
            return Task.FromResult(true);
        }
    }

    [Fact]
    public async Task Social_events_notify_the_affected_user()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var sender = new FakeSender();
        using var factory = _factory.WithWebHostBuilder(b =>
            b.ConfigureServices(s => s.AddSingleton<IPushSender>(sender)));

        HttpClient ClientOf(string sub)
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-User-Sub", sub);
            return client;
        }
        var alice = ClientOf($"soc-a-{suffix}");
        var bob = ClientOf($"soc-b-{suffix}");
        await alice.PutAsJsonAsync("/me", new UpdateMeRequest("Alice"));
        await bob.PutAsJsonAsync("/me", new UpdateMeRequest("Bob"));
        var aliceId = (await alice.GetFromJsonAsync<MeResponse>("/me"))!.UserId;
        var bobId = (await bob.GetFromJsonAsync<MeResponse>("/me"))!.UserId;
        await alice.PostAsJsonAsync("/me/push-subscriptions", new SubscribeRequest($"https://p/{suffix}/alice", "p", "a"));
        await bob.PostAsJsonAsync("/me/push-subscriptions", new SubscribeRequest($"https://p/{suffix}/bob", "p", "a"));

        // friend request -> Bob is notified
        Assert.True((await alice.PostAsJsonAsync("/friends/requests", new SendFriendRequest(bobId))).IsSuccessStatusCode);
        var sent = Assert.Single(sender.Sent);
        Assert.Equal(bobId, sent.UserId);
        Assert.Contains("\"type\":\"friend-request\"", sent.Payload);
        Assert.Contains("Alice", sent.Payload);

        // acceptance -> the requester (Alice) is notified
        var friends = await bob.GetFromJsonAsync<FriendsResponse>("/friends");
        var requestId = Assert.Single(friends!.ReceivedPending).Id;
        Assert.True((await bob.PostAsync($"/friends/requests/{requestId}/accept", null)).IsSuccessStatusCode);
        Assert.Contains(sender.Sent, s => s.UserId == aliceId && s.Payload.Contains("\"type\":\"friend-accept\"") && s.Payload.Contains("Bob"));

        // space invite -> Bob is notified, and the owner sees it pending
        var spaceId = $"space_soc_{suffix}";
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Spaces.Add(new Space { Id = spaceId });
            db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = aliceId, Role = SpaceRoles.Owner });
            await db.SaveChangesAsync();
        }
        Assert.True((await alice.PostAsJsonAsync($"/spaces/{spaceId}/invites",
            new SendSpaceInvite(bobId, "contributor", "Push Space"))).IsSuccessStatusCode);
        Assert.Contains(sender.Sent, s => s.UserId == bobId && s.Payload.Contains("\"type\":\"space-invite\"") && s.Payload.Contains("Push Space"));
        var outgoing = await alice.GetFromJsonAsync<List<OutgoingInviteDto>>($"/spaces/{spaceId}/invites");
        Assert.Equal(bobId, Assert.Single(outgoing!).ToUserId);

        // joining -> the inviter (Alice) is notified
        var invites = await bob.GetFromJsonAsync<List<SpaceInviteDto>>("/me/invites");
        var inviteId = Assert.Single(invites!).Id;
        Assert.True((await bob.PostAsync($"/spaces/invites/{inviteId}/accept", null)).IsSuccessStatusCode);
        Assert.Contains(sender.Sent, s => s.UserId == aliceId && s.Payload.Contains("\"type\":\"space-join\"") && s.Payload.Contains("Bob"));
        Assert.Empty((await alice.GetFromJsonAsync<List<OutgoingInviteDto>>($"/spaces/{spaceId}/invites"))!);
    }

    [Fact]
    public async Task Member_removal_and_role_change_notify_the_affected_member()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var sender = new FakeSender();
        using var factory = _factory.WithWebHostBuilder(b =>
            b.ConfigureServices(s => s.AddSingleton<IPushSender>(sender)));

        HttpClient ClientOf(string sub)
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-User-Sub", sub);
            return client;
        }
        var alice = ClientOf($"mem-a-{suffix}");
        var bob = ClientOf($"mem-b-{suffix}");
        await alice.PutAsJsonAsync("/me", new UpdateMeRequest("Alice"));
        await bob.PutAsJsonAsync("/me", new UpdateMeRequest("Bob"));
        var aliceId = (await alice.GetFromJsonAsync<MeResponse>("/me"))!.UserId;
        var bobId = (await bob.GetFromJsonAsync<MeResponse>("/me"))!.UserId;
        await bob.PostAsJsonAsync("/me/push-subscriptions", new SubscribeRequest($"https://p/{suffix}/bobm", "p", "a"));

        var spaceId = $"space_mem_{suffix}";
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Spaces.Add(new Space { Id = spaceId });
            db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = aliceId, Role = SpaceRoles.Owner });
            db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = bobId, Role = SpaceRoles.Contributor });
            await db.SaveChangesAsync();
        }

        // #172: a role change reaches the AFFECTED member with the new role
        Assert.True((await alice.PutAsJsonAsync($"/spaces/{spaceId}/members/{bobId}/role",
            new ChangeRoleRequest("reader", "Mem Space"))).IsSuccessStatusCode);
        Assert.Contains(sender.Sent, s => s.UserId == bobId
            && s.Payload.Contains("\"type\":\"member-role\"")
            && s.Payload.Contains("\"role\":\"reader\"")
            && s.Payload.Contains("Mem Space"));

        // #172/#173: a kick reaches the victim, naming the actor
        Assert.True((await alice.DeleteAsync($"/spaces/{spaceId}/members/{bobId}?spaceName=Mem%20Space")).IsSuccessStatusCode);
        Assert.Contains(sender.Sent, s => s.UserId == bobId
            && s.Payload.Contains("\"type\":\"member-removed\"")
            && s.Payload.Contains("Alice")
            && s.Payload.Contains("Mem Space"));

        // a self-leave stays silent (leaveSpace goes through the same endpoint)
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = bobId, Role = SpaceRoles.Contributor });
            await db.SaveChangesAsync();
        }
        var removedBefore = sender.Sent.Count(s => s.Payload.Contains("\"type\":\"member-removed\""));
        Assert.True((await bob.DeleteAsync($"/spaces/{spaceId}/members/{bobId}")).IsSuccessStatusCode);
        Assert.Equal(removedBefore, sender.Sent.Count(s => s.Payload.Contains("\"type\":\"member-removed\"")));
    }

    [Fact]
    public async Task Remove_friend_declines_pending_requests_and_is_idempotent()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var alice = ClientFor($"rm-a-{suffix}");
        var bob = ClientFor($"rm-b-{suffix}");
        var aliceId = (await alice.GetFromJsonAsync<MeResponse>("/me"))!.UserId;
        var bobId = (await bob.GetFromJsonAsync<MeResponse>("/me"))!.UserId;

        Assert.True((await alice.PostAsJsonAsync("/friends/requests", new SendFriendRequest(bobId))).IsSuccessStatusCode);
        // the recipient "removes" the requester -> the pending edge is gone
        Assert.True((await bob.DeleteAsync($"/friends/{aliceId}")).IsSuccessStatusCode);
        var friends = await alice.GetFromJsonAsync<FriendsResponse>("/friends");
        Assert.Empty(friends!.SentPending);
        Assert.Empty(friends.Friends);
        // removing a non-existent edge stays a harmless 200
        Assert.True((await bob.DeleteAsync($"/friends/{aliceId}")).IsSuccessStatusCode);
    }

    [Fact]
    public async Task Declined_space_invites_disappear_without_membership()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var alice = ClientFor($"dec-a-{suffix}");
        var bob = ClientFor($"dec-b-{suffix}");
        var aliceId = (await alice.GetFromJsonAsync<MeResponse>("/me"))!.UserId;
        var bobId = (await bob.GetFromJsonAsync<MeResponse>("/me"))!.UserId;

        var spaceId = $"space_dec_{suffix}";
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var (a, b) = aliceId < bobId ? (aliceId, bobId) : (bobId, aliceId);
            db.Friendships.Add(new Friendship { Id = Guid.NewGuid(), UserAId = a, UserBId = b, RequestedBy = aliceId, Status = "accepted" });
            db.Spaces.Add(new Space { Id = spaceId });
            db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = aliceId, Role = SpaceRoles.Owner });
            await db.SaveChangesAsync();
        }
        Assert.True((await alice.PostAsJsonAsync($"/spaces/{spaceId}/invites",
            new SendSpaceInvite(bobId, "contributor", "Dec Space"))).IsSuccessStatusCode);
        var invite = Assert.Single((await bob.GetFromJsonAsync<List<SpaceInviteDto>>("/me/invites"))!);

        Assert.True((await bob.PostAsync($"/spaces/invites/{invite.Id}/decline", null)).IsSuccessStatusCode);
        Assert.Empty((await bob.GetFromJsonAsync<List<SpaceInviteDto>>("/me/invites"))!);
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.SpaceMembers.AnyAsync(m => m.SpaceId == spaceId && m.UserId == bobId));
        }
    }

    [Fact]
    public async Task Pending_invite_can_be_revoked_by_an_owner_only()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var alice = ClientFor($"rev-a-{suffix}");
        var bob = ClientFor($"rev-b-{suffix}");
        var aliceId = (await alice.GetFromJsonAsync<MeResponse>("/me"))!.UserId;
        var bobId = (await bob.GetFromJsonAsync<MeResponse>("/me"))!.UserId;

        var spaceId = $"space_rev_{suffix}";
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var (a, b) = aliceId < bobId ? (aliceId, bobId) : (bobId, aliceId);
            db.Friendships.Add(new Friendship { Id = Guid.NewGuid(), UserAId = a, UserBId = b, RequestedBy = aliceId, Status = "accepted" });
            db.Spaces.Add(new Space { Id = spaceId });
            db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = aliceId, Role = SpaceRoles.Owner });
            await db.SaveChangesAsync();
        }
        Assert.True((await alice.PostAsJsonAsync($"/spaces/{spaceId}/invites",
            new SendSpaceInvite(bobId, "contributor", "Rev Space"))).IsSuccessStatusCode);
        var inviteId = Assert.Single((await alice.GetFromJsonAsync<List<OutgoingInviteDto>>($"/spaces/{spaceId}/invites"))!).Id;

        // the invited user is not an owner of the space -> may not revoke
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.DeleteAsync($"/spaces/invites/{inviteId}")).StatusCode);
        Assert.True((await alice.DeleteAsync($"/spaces/invites/{inviteId}")).IsSuccessStatusCode);
        Assert.Empty((await alice.GetFromJsonAsync<List<OutgoingInviteDto>>($"/spaces/{spaceId}/invites"))!);
        Assert.Empty((await bob.GetFromJsonAsync<List<SpaceInviteDto>>("/me/invites"))!);
    }

    [Fact]
    public async Task Notifier_sends_to_all_members_and_prunes_dead_subscriptions()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var spaceId = $"space_push_{suffix}";
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var userA = new User { Id = Guid.NewGuid(), Sub = $"pa-{suffix}" };
        var userB = new User { Id = Guid.NewGuid(), Sub = $"pb-{suffix}" };
        db.Users.AddRange(userA, userB);
        db.Spaces.Add(new Space { Id = spaceId });
        db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = userA.Id, Role = SpaceRoles.Owner });
        db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = userB.Id, Role = SpaceRoles.Reader });
        db.PushSubscriptions.Add(new PushSubscriptionRow { Id = Guid.NewGuid(), UserId = userA.Id, Endpoint = $"https://p/{suffix}/a", P256dh = "k", Auth = "a" });
        db.PushSubscriptions.Add(new PushSubscriptionRow { Id = Guid.NewGuid(), UserId = userB.Id, Endpoint = $"https://p/{suffix}/b-dead", P256dh = "k", Auth = "a" });
        await db.SaveChangesAsync();

        var sender = new FakeSender();
        sender.DeadEndpoints.Add($"https://p/{suffix}/b-dead");
        await new PushNotifier(db, sender, NullLogger<PushNotifier>.Instance)
            .NotifyNewTransactionsAsync(spaceId, 3, CancellationToken.None);

        var sent = Assert.Single(sender.Sent);
        Assert.Equal(userA.Id, sent.UserId);
        Assert.Contains("\"count\":3", sent.Payload);
        Assert.Contains(spaceId, sent.Payload);
        // dead subscription pruned
        Assert.Empty(await db.PushSubscriptions.Where(s => s.UserId == userB.Id).ToListAsync());
    }
}
