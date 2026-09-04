using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Accounts;
using Munni.Api.Data;
using Munni.Api.Social;
using Munni.Api.Sync;
using Xunit;

namespace Munni.Api.Tests;

/// <summary>
/// Shared-accounts P2: feed registration (S1 squatting fix), derived
/// read access via attachments, archive-on-leave and revive-on-rejoin.
/// </summary>
public class FeedEndpointsTests : IClassFixture<FeedsApiFactory>
{
    private readonly FeedsApiFactory _factory;

    public FeedEndpointsTests(FeedsApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    /// <summary>valid uuid with version nibble 5 — feed-shaped, unique per call</summary>
    private static string FeedId()
    {
        var g = Guid.NewGuid().ToString();
        return g[..14] + '5' + g[15..];
    }

    private static SyncOpDto Op(string spaceId, string entityId = "acct1") =>
        new(Guid.NewGuid().ToString(), spaceId, "account", entityId,
            new() { ["name"] = JsonSerializer.SerializeToElement("ING") }, "000000100-0000-dev");

    [Fact]
    public void Feed_shape_detection_is_version_based()
    {
        Assert.True(FeedAccess.IsFeedShaped(FeedId()));
        Assert.False(FeedAccess.IsFeedShaped(Guid.NewGuid().ToString())); // v4
        Assert.False(FeedAccess.IsFeedShaped("space_abc123")); // free-form client ids
        Assert.False(FeedAccess.IsFeedShaped(""));
    }

    [Fact]
    public async Task Pushing_into_an_unregistered_feed_shaped_space_is_forbidden()
    {
        var alice = ClientFor($"alice_{Guid.NewGuid():N}");
        var push = await alice.PostAsJsonAsync($"/sync/{FeedId()}/push", new PushRequest("dev1", [Op(FeedId())]));
        Assert.Equal(HttpStatusCode.Forbidden, push.StatusCode);
    }

    [Fact]
    public async Task Registration_makes_the_caller_owner_and_is_idempotent_but_conflicts_for_others()
    {
        var feed = FeedId();
        var alice = ClientFor($"alice_{Guid.NewGuid():N}");
        var mallory = ClientFor($"mallory_{Guid.NewGuid():N}");

        var register = await alice.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, "NL69INGB0123456789"));
        Assert.Equal(HttpStatusCode.OK, register.StatusCode);

        // owner can now push raw data into the feed
        var push = await alice.PostAsJsonAsync($"/sync/{feed}/push", new PushRequest("dev1", [Op(feed)]));
        Assert.True(push.IsSuccessStatusCode, await push.Content.ReadAsStringAsync());

        // re-register (reconnect) stays fine
        Assert.Equal(HttpStatusCode.OK,
            (await alice.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, "NL69INGB0123456789"))).StatusCode);

        // someone else claiming the same deterministic id gets a conflict —
        // and never any access to alice's data
        Assert.Equal(HttpStatusCode.Conflict,
            (await mallory.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, "NL69INGB0123456789"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await mallory.GetAsync($"/sync/{feed}/pull?since=0")).StatusCode);

        // the feed shows up in the owner's feed list and space discovery
        var feeds = await alice.GetFromJsonAsync<List<MyFeedDto>>("/me/feeds");
        Assert.Contains(feeds!, f => f.FeedSpaceId == feed);
    }

    [Fact]
    public async Task An_orphaned_feed_is_reclaimable_but_a_living_owner_still_conflicts()
    {
        var feed = FeedId();
        var aliceSub = $"alice_{Guid.NewGuid():N}";
        var alice = ClientFor(aliceSub);
        var bob = ClientFor($"bob_{Guid.NewGuid():N}");

        Assert.Equal(HttpStatusCode.OK,
            (await alice.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, "NL69INGB0123456789"))).StatusCode);

        // living owner: someone else stays conflicted
        Assert.Equal(HttpStatusCode.Conflict,
            (await bob.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, "NL69INGB0123456789"))).StatusCode);

        // the owner's user row disappears (account deletion / go-offline
        // left the feed behind) — the feed becomes claimable instead of
        // 409ing the next importer forever (staging 2026-07-24)
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var owner = await db.Users.FirstAsync(u => u.Sub == aliceSub);
            db.Users.Remove(owner);
            await db.SaveChangesAsync();
        }

        Assert.Equal(HttpStatusCode.OK,
            (await bob.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, "NL69INGB0123456789"))).StatusCode);
        var feeds = await bob.GetFromJsonAsync<List<MyFeedDto>>("/me/feeds");
        Assert.Contains(feeds!, f => f.FeedSpaceId == feed);
        // and the new owner can push raw data
        var push = await bob.PostAsJsonAsync($"/sync/{feed}/push", new PushRequest("dev1", [Op(feed)]));
        Assert.True(push.IsSuccessStatusCode, await push.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Attachment_derives_member_read_access_and_discovery()
    {
        var feed = FeedId();
        var spaceId = $"space_{Guid.NewGuid():N}";
        var owner = $"owner_{Guid.NewGuid():N}";
        var member = $"member_{Guid.NewGuid():N}";
        var alice = ClientFor(owner);
        var bob = ClientFor(member);

        await alice.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, "NL69INGB0123456789"));
        await alice.PostAsJsonAsync($"/sync/{feed}/push", new PushRequest("dev1", [Op(feed)]));
        await alice.PostAsJsonAsync($"/sync/{spaceId}/push", new PushRequest("dev1", [Op(spaceId, "spacerow")]));
        await AddMemberAsync(spaceId, member);

        // before attachment bob cannot read the feed
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.GetAsync($"/sync/{feed}/pull?since=0")).StatusCode);

        // non-owner of the feed cannot attach it, even as a space member
        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PostAsJsonAsync($"/spaces/{spaceId}/accounts", new AttachAccountRequest(feed, "acct1"))).StatusCode);

        var attach = await alice.PostAsJsonAsync($"/spaces/{spaceId}/accounts",
            new AttachAccountRequest(feed, "acct1", "2026-01-01"));
        Assert.True(attach.IsSuccessStatusCode, await attach.Content.ReadAsStringAsync());

        // bob now pulls the feed and discovers it via /me/spaces
        var pull = await bob.GetFromJsonAsync<PullResponse>($"/sync/{feed}/pull?since=0");
        Assert.Single(pull!.Ops);
        var spaces = await bob.GetFromJsonAsync<List<string>>("/me/spaces");
        Assert.Contains(feed, spaces!);

        // …and the feed snapshot too (uncapped access)
        Assert.True((await bob.GetAsync($"/sync/{feed}/bootstrap")).IsSuccessStatusCode);

        // but nobody except the owner writes raw data
        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PostAsJsonAsync($"/sync/{feed}/push", new PushRequest("dev2", [Op(feed, "x")]))).StatusCode);

        // detach revokes access
        var links = await alice.GetFromJsonAsync<List<AccountLinkDto>>($"/spaces/{spaceId}/accounts");
        await alice.DeleteAsync($"/spaces/{spaceId}/accounts/{links![0].Id}");
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.GetAsync($"/sync/{feed}/pull?since=0")).StatusCode);
    }

    [Fact]
    public async Task Leaving_archives_the_link_history_stays_new_data_stops_rejoin_revives()
    {
        var feed = FeedId();
        var spaceId = $"space_{Guid.NewGuid():N}";
        var ownerSub = $"owner_{Guid.NewGuid():N}";
        var memberSub = $"member_{Guid.NewGuid():N}";
        var alice = ClientFor(ownerSub);
        var bob = ClientFor(memberSub);

        await alice.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, "NL69INGB0123456789"));
        await alice.PostAsJsonAsync($"/sync/{feed}/push", new PushRequest("dev1", [Op(feed, "tx-before")]));
        await alice.PostAsJsonAsync($"/sync/{spaceId}/push", new PushRequest("dev1", [Op(spaceId, "spacerow")]));
        await AddMemberAsync(spaceId, memberSub);
        await alice.PostAsJsonAsync($"/spaces/{spaceId}/accounts", new AttachAccountRequest(feed, "acct1"));

        // alice (the attacher) leaves the space
        var aliceId = await UserIdAsync(ownerSub);
        var leave = await alice.DeleteAsync($"/spaces/{spaceId}/members/{aliceId}");
        Assert.True(leave.IsSuccessStatusCode);

        // link is archived; bob keeps the shared history…
        var links = await bob.GetFromJsonAsync<List<AccountLinkDto>>($"/spaces/{spaceId}/accounts");
        Assert.True(links![0].Archived);

        // …and the SYNCED mirror row carries the archived flag, so bob's
        // devices render the badge without asking the server
        var mirror = await bob.GetFromJsonAsync<PullResponse>($"/sync/{spaceId}/pull?since=0");
        var linkOps = mirror!.Ops.Where(o => o.Entity == "accountLink").ToList();
        Assert.Contains(linkOps, o => o.Fields.TryGetValue("archived", out var v) && v.GetInt32() == 1);
        var history = await bob.GetFromJsonAsync<PullResponse>($"/sync/{feed}/pull?since=0");
        Assert.Single(history!.Ops);

        // …but data pushed AFTER the archive stays invisible to him
        await alice.PostAsJsonAsync($"/sync/{feed}/push", new PushRequest("dev1", [Op(feed, "tx-after")]));
        var capped = await bob.GetFromJsonAsync<PullResponse>($"/sync/{feed}/pull?since=0");
        Assert.Single(capped!.Ops);
        Assert.Equal("tx-before", capped.Ops[0].EntityId);
        // archived readers get no full snapshot either
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.GetAsync($"/sync/{feed}/bootstrap")).StatusCode);

        // bob (owner after auto-promotion) invites alice back; accepting
        // revives her attachment automatically — new data flows again
        await bob.PostAsJsonAsync("/friends/requests", new SendFriendRequest(aliceId));
        var requests = await alice.GetFromJsonAsync<FriendsResponse>("/friends");
        await alice.PostAsync($"/friends/requests/{requests!.ReceivedPending[0].Id}/accept", null);
        await bob.PostAsJsonAsync($"/spaces/{spaceId}/invites", new SendSpaceInvite(aliceId, "contributor", "Shared"));
        var invites = await alice.GetFromJsonAsync<List<JsonElement>>("/me/invites");
        var inviteId = invites![0].GetProperty("id").GetString();
        await alice.PostAsync($"/spaces/invites/{inviteId}/accept", null);

        var revived = await bob.GetFromJsonAsync<List<AccountLinkDto>>($"/spaces/{spaceId}/accounts");
        Assert.False(revived![0].Archived);
        var full = await bob.GetFromJsonAsync<PullResponse>($"/sync/{feed}/pull?since=0");
        Assert.Equal(2, full!.Ops.Count);
    }

    private async Task AddMemberAsync(string spaceId, string sub)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Sub == sub);
        if (user is null)
        {
            user = new User { Id = Guid.NewGuid(), Sub = sub };
            db.Users.Add(user);
        }
        db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = user.Id, Role = SpaceRoles.Contributor });
        await db.SaveChangesAsync();
    }

    private async Task<Guid> UserIdAsync(string sub)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return (await db.Users.FirstAsync(u => u.Sub == sub)).Id;
    }
}

public class FeedsApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        builder.UseSetting("Auth:TestMode", "true");
        builder.UseSetting("Db:AutoMigrate", "false");
        builder.ConfigureServices(services =>
        {
            foreach (var d in services
                         .Where(d =>
                             d.ServiceType == typeof(DbContextOptions<AppDbContext>) ||
                             d.ServiceType == typeof(DbContextOptions) ||
                             d.ServiceType == typeof(AppDbContext) ||
                             d.ServiceType.Name.Contains("IDbContextOptionsConfiguration"))
                         .ToList())
            {
                services.Remove(d);
            }
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("feeds-tests"));
        });
    }
}
