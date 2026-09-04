using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Data;
using Munni.Api.Social;
using Munni.Api.Sync;

namespace Munni.Api.Tests;

public class SocialEndpointsTests : IClassFixture<SyncApiFactory>
{
    private readonly SyncApiFactory _factory;

    public SocialEndpointsTests(SyncApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    private static async Task<Guid> UserIdOf(HttpClient client)
    {
        var me = await client.GetFromJsonAsync<MeResponse>("/me");
        return me!.UserId;
    }

    [Fact]
    public async Task Geo_answers_null_country_for_local_or_unknown_addresses()
    {
        // TestServer has no remote IP → the lookup must fail OPEN to null
        var client = ClientFor($"geo-{Guid.NewGuid():N}");
        var res = await client.GetFromJsonAsync<JsonElement>("/geo");
        Assert.Equal(JsonValueKind.Null, res.GetProperty("country").ValueKind);
    }

    [Fact]
    public async Task Geo_resolves_public_addresses_and_caches_per_ip()
    {
        var client = ClientFor($"geo2-{Guid.NewGuid():N}");
        var ip = $"83.84.{Random.Shared.Next(1, 250)}.{Random.Shared.Next(1, 250)}";
        client.DefaultRequestHeaders.Add("X-Forwarded-For", ip);

        var res = await client.GetFromJsonAsync<JsonElement>("/geo");
        Assert.Equal("NL", res.GetProperty("country").GetString());

        // second request for the SAME ip is served from the per-IP cache
        var before = FakeGeoLookupHandler.Calls;
        var cached = await client.GetFromJsonAsync<JsonElement>("/geo");
        Assert.Equal("NL", cached.GetProperty("country").GetString());
        Assert.Equal(before, FakeGeoLookupHandler.Calls);
    }

    [Fact]
    public async Task DisplayCurrency_sets_uppercases_and_clears_with_the_empty_sentinel()
    {
        var client = ClientFor($"fx-{Guid.NewGuid():N}");

        // set (lowercase input normalizes), null leaves it alone, '' clears
        await client.PutAsJsonAsync("/me", new UpdateMeRequest("Fx", DisplayCurrency: "try"));
        Assert.Equal("TRY", (await client.GetFromJsonAsync<MeResponse>("/me"))!.DisplayCurrency);

        await client.PutAsJsonAsync("/me", new UpdateMeRequest("Fx"));
        Assert.Equal("TRY", (await client.GetFromJsonAsync<MeResponse>("/me"))!.DisplayCurrency);

        await client.PutAsJsonAsync("/me", new UpdateMeRequest("Fx", DisplayCurrency: ""));
        Assert.Null((await client.GetFromJsonAsync<MeResponse>("/me"))!.DisplayCurrency);

        // not a currency code → validation rejects
        var bad = await client.PutAsJsonAsync("/me", new UpdateMeRequest("Fx", DisplayCurrency: "EURO"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task FullFlow_FriendRequest_SpaceInvite_MembershipAndSync()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var alice = ClientFor($"alice-{suffix}");
        var bob = ClientFor($"bob-{suffix}");

        // display names
        await alice.PutAsJsonAsync("/me", new UpdateMeRequest("Alice"));
        await bob.PutAsJsonAsync("/me", new UpdateMeRequest("Bob"));
        var aliceId = await UserIdOf(alice);
        var bobId = await UserIdOf(bob);

        // alice invites bob; bob sees a received pending request with Alice's name
        Assert.True((await alice.PostAsJsonAsync("/friends/requests", new SendFriendRequest(bobId))).IsSuccessStatusCode);
        var bobFriends = await bob.GetFromJsonAsync<FriendsResponse>("/friends");
        var request = Assert.Single(bobFriends!.ReceivedPending);
        Assert.Equal("Alice", request.FromName);

        // bob accepts -> both are friends
        await bob.PostAsync($"/friends/requests/{request.Id}/accept", null);
        var aliceFriends = await alice.GetFromJsonAsync<FriendsResponse>("/friends");
        Assert.Equal("Bob", Assert.Single(aliceFriends!.Friends).DisplayName);

        // alice creates a shared space by pushing to it, then invites bob
        var spaceId = $"space_{suffix}";
        await alice.PostAsJsonAsync($"/sync/{spaceId}/push", new PushRequest("devA",
            [new SyncOpDto(Guid.NewGuid().ToString(), spaceId, "space", spaceId,
                new() { ["name"] = JsonSerializer.SerializeToElement("Household") }, "000000100-0000-devA")]));
        Assert.True((await alice.PostAsJsonAsync($"/spaces/{spaceId}/invites",
            new SendSpaceInvite(bobId, "member", "Household"))).IsSuccessStatusCode);

        // bob sees + accepts the invite -> space appears in his discovery + pull works
        var invites = await bob.GetFromJsonAsync<List<SpaceInviteDto>>("/me/invites");
        var invite = Assert.Single(invites!);
        Assert.Equal("Household", invite.SpaceName);
        await bob.PostAsync($"/spaces/invites/{invite.Id}/accept", null);

        var bobSpaces = await bob.GetFromJsonAsync<List<string>>("/me/spaces");
        Assert.Contains(spaceId, bobSpaces!);
        var pull = await bob.GetFromJsonAsync<PullResponse>($"/sync/{spaceId}/pull?since=0");
        Assert.Single(pull!.Ops);

        // members list shows both with roles; owner can kick, member cannot
        var members = await alice.GetFromJsonAsync<List<MemberDto>>($"/spaces/{spaceId}/members");
        Assert.Equal(2, members!.Count);
        Assert.Equal("owner", members.Single(m => m.UserId == aliceId).Role);

        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.DeleteAsync($"/spaces/{spaceId}/members/{aliceId}")).StatusCode);
        Assert.True((await alice.DeleteAsync($"/spaces/{spaceId}/members/{bobId}")).IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.GetAsync($"/sync/{spaceId}/pull?since=0")).StatusCode);
    }

    // ── #169: a friend request may piggyback a space ────────────────────

    private async Task SeedSpaceWithOwnerAsync(string spaceId, Guid ownerId, params (Guid UserId, string Role)[] others)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Spaces.Add(new Space { Id = spaceId });
        db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = ownerId, Role = SpaceRoles.Owner });
        foreach (var (userId, role) in others)
            db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = userId, Role = role });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task FriendRequest_with_space_requires_space_ownership()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var alice = ClientFor($"fro-a-{suffix}");
        var bob = ClientFor($"fro-b-{suffix}");
        var aliceId = await UserIdOf(alice);
        var bobId = await UserIdOf(bob);

        // not a member of the space at all -> 403, nothing stored
        var spaceId = $"space_fro_{suffix}";
        var res = await alice.PostAsJsonAsync("/friends/requests",
            new SendFriendRequest(bobId, SpaceId: spaceId, Role: "contributor", SpaceName: "Nope"));
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);

        // a mere contributor may not piggyback the space either
        await SeedSpaceWithOwnerAsync(spaceId, bobId, (aliceId, SpaceRoles.Contributor));
        res = await alice.PostAsJsonAsync("/friends/requests",
            new SendFriendRequest(bobId, SpaceId: spaceId, Role: "contributor", SpaceName: "Nope"));
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);

        var friends = await bob.GetFromJsonAsync<FriendsResponse>("/friends");
        Assert.Empty(friends!.ReceivedPending);
    }

    [Fact]
    public async Task Space_carrying_friend_request_joins_on_accept_with_the_stored_role()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var alice = ClientFor($"pig-a-{suffix}");
        var bob = ClientFor($"pig-b-{suffix}");
        await alice.PutAsJsonAsync("/me", new UpdateMeRequest("Alice"));
        await bob.PutAsJsonAsync("/me", new UpdateMeRequest("Bob"));
        var aliceId = await UserIdOf(alice);
        var bobId = await UserIdOf(bob);
        var spaceId = $"space_pig_{suffix}";
        await SeedSpaceWithOwnerAsync(spaceId, aliceId);

        Assert.True((await alice.PostAsJsonAsync("/friends/requests",
            new SendFriendRequest(bobId, SpaceId: spaceId, Role: "reader", SpaceName: "Piggy"))).IsSuccessStatusCode);

        // the receiver sees where accepting will land them (#169 DTO field)
        var bobFriends = await bob.GetFromJsonAsync<FriendsResponse>("/friends");
        var request = Assert.Single(bobFriends!.ReceivedPending);
        Assert.Equal("Piggy", request.SpaceName);

        Assert.True((await bob.PostAsync($"/friends/requests/{request.Id}/accept", null)).IsSuccessStatusCode);

        // one shot: friendship AND membership, with the stored role
        var members = await alice.GetFromJsonAsync<List<MemberDto>>($"/spaces/{spaceId}/members");
        var bobRow = Assert.Single(members!, m => m.UserId == bobId);
        Assert.Equal("reader", bobRow.Role);
        Assert.NotNull(bobRow.JoinedAt); // #172: member-since stamped at creation
    }

    [Fact]
    public async Task Plain_friend_request_accept_creates_no_membership()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var alice = ClientFor($"pln-a-{suffix}");
        var bob = ClientFor($"pln-b-{suffix}");
        var aliceId = await UserIdOf(alice);
        var bobId = await UserIdOf(bob);
        await SeedSpaceWithOwnerAsync($"space_pln_{suffix}", aliceId);

        Assert.True((await alice.PostAsJsonAsync("/friends/requests", new SendFriendRequest(bobId))).IsSuccessStatusCode);
        var request = Assert.Single((await bob.GetFromJsonAsync<FriendsResponse>("/friends"))!.ReceivedPending);
        Assert.Null(request.SpaceName);
        Assert.True((await bob.PostAsync($"/friends/requests/{request.Id}/accept", null)).IsSuccessStatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.SpaceMembers.AnyAsync(m => m.UserId == bobId));
    }

    [Fact]
    public async Task InviteRequiresFriendshipAndOwnership()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var alice = ClientFor($"alice2-{suffix}");
        var mallory = ClientFor($"mallory2-{suffix}");
        var malloryId = await UserIdOf(mallory);

        var spaceId = $"space2_{suffix}";
        await alice.PostAsJsonAsync($"/sync/{spaceId}/push", new PushRequest("devA",
            [new SyncOpDto(Guid.NewGuid().ToString(), spaceId, "space", spaceId, new(), "000000100-0000-devA")]));

        // not friends -> 400
        var response = await alice.PostAsJsonAsync($"/spaces/{spaceId}/invites", new SendSpaceInvite(malloryId, "member", null));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // non-owner cannot invite at all
        Assert.Equal(HttpStatusCode.Forbidden,
            (await mallory.PostAsJsonAsync($"/spaces/{spaceId}/invites", new SendSpaceInvite(malloryId, "member", null))).StatusCode);
    }
}
