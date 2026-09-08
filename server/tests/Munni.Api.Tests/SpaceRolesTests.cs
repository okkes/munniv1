using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Munni.Api.Social;
using Munni.Api.Sync;

namespace Munni.Api.Tests;

public class SpaceRolesTests : IClassFixture<SyncApiFactory>
{
    private readonly SyncApiFactory _factory;

    public SpaceRolesTests(SyncApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    private static async Task<Guid> UserIdOf(HttpClient client) =>
        (await client.GetFromJsonAsync<MeResponse>("/me"))!.UserId;

    private static PushRequest Push(string spaceId, string device) => new(device,
        [new SyncOpDto(Guid.NewGuid().ToString(), spaceId, "space", spaceId,
            new() { ["name"] = JsonSerializer.SerializeToElement("S") }, $"000000100-0000-{device}")]);

    private static async Task Befriend(HttpClient a, HttpClient b, Guid bId)
    {
        await a.PostAsJsonAsync("/friends/requests", new SendFriendRequest(bId));
        var pending = (await b.GetFromJsonAsync<FriendsResponse>("/friends"))!.ReceivedPending.Single();
        await b.PostAsync($"/friends/requests/{pending.Id}/accept", null);
    }

    private static async Task<string> InviteAndAccept(HttpClient owner, HttpClient invitee, string spaceId, Guid inviteeId, string role)
    {
        await owner.PostAsJsonAsync($"/spaces/{spaceId}/invites", new SendSpaceInvite(inviteeId, role, "S"));
        var invite = (await invitee.GetFromJsonAsync<List<SpaceInviteDto>>("/me/invites"))!.Single(i => i.SpaceId == spaceId);
        await invitee.PostAsync($"/spaces/invites/{invite.Id}/accept", null);
        return invite.Role;
    }

    [Fact]
    public async Task Readers_can_pull_but_never_push()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var owner = ClientFor($"owner-{suffix}");
        var reader = ClientFor($"reader-{suffix}");
        var readerId = await UserIdOf(reader);
        var spaceId = $"space_r_{suffix}";

        await owner.PostAsJsonAsync($"/sync/{spaceId}/push", Push(spaceId, "devO"));
        await Befriend(owner, reader, readerId);
        Assert.Equal("reader", await InviteAndAccept(owner, reader, spaceId, readerId, "reader"));

        var pull = await reader.GetAsync($"/sync/{spaceId}/pull?since=0");
        Assert.Equal(HttpStatusCode.OK, pull.StatusCode);
        var push = await reader.PostAsJsonAsync($"/sync/{spaceId}/push", Push(spaceId, "devR"));
        Assert.Equal(HttpStatusCode.Forbidden, push.StatusCode);
    }

    [Fact]
    public async Task Legacy_member_invites_become_contributors_and_can_push()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var owner = ClientFor($"owner2-{suffix}");
        var friend = ClientFor($"friend2-{suffix}");
        var friendId = await UserIdOf(friend);
        var spaceId = $"space_m_{suffix}";

        await owner.PostAsJsonAsync($"/sync/{spaceId}/push", Push(spaceId, "devO"));
        await Befriend(owner, friend, friendId);
        await InviteAndAccept(owner, friend, spaceId, friendId, "member");

        var members = await owner.GetFromJsonAsync<List<MemberDto>>($"/spaces/{spaceId}/members");
        Assert.Equal("contributor", members!.Single(m => m.UserId == friendId).Role);
        Assert.True((await friend.PostAsJsonAsync($"/sync/{spaceId}/push", Push(spaceId, "devF"))).IsSuccessStatusCode);
    }

    [Fact]
    public async Task Ownership_transfer_and_last_owner_guard()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var owner = ClientFor($"owner3-{suffix}");
        var friend = ClientFor($"friend3-{suffix}");
        var ownerId = await UserIdOf(owner);
        var friendId = await UserIdOf(friend);
        var spaceId = $"space_t_{suffix}";

        await owner.PostAsJsonAsync($"/sync/{spaceId}/push", Push(spaceId, "devO"));
        await Befriend(owner, friend, friendId);
        await InviteAndAccept(owner, friend, spaceId, friendId, "contributor");

        // sole owner cannot demote themself
        var selfDemote = await owner.PutAsJsonAsync($"/spaces/{spaceId}/members/{ownerId}/role", new ChangeRoleRequest("reader"));
        Assert.Equal(HttpStatusCode.BadRequest, selfDemote.StatusCode);

        // non-owner cannot change roles
        Assert.Equal(HttpStatusCode.Forbidden,
            (await friend.PutAsJsonAsync($"/spaces/{spaceId}/members/{friendId}/role", new ChangeRoleRequest("owner"))).StatusCode);

        // transfer: promote friend to owner, then the original owner may step down
        Assert.True((await owner.PutAsJsonAsync($"/spaces/{spaceId}/members/{friendId}/role", new ChangeRoleRequest("owner"))).IsSuccessStatusCode);
        Assert.True((await owner.PutAsJsonAsync($"/spaces/{spaceId}/members/{ownerId}/role", new ChangeRoleRequest("reader"))).IsSuccessStatusCode);

        var roles = (await friend.GetFromJsonAsync<List<MemberDto>>($"/spaces/{spaceId}/members"))!
            .ToDictionary(m => m.UserId, m => m.Role);
        Assert.Equal("owner", roles[friendId]);
        Assert.Equal("reader", roles[ownerId]);

        // invalid role rejected by validation
        Assert.Equal(HttpStatusCode.BadRequest,
            (await friend.PutAsJsonAsync($"/spaces/{spaceId}/members/{ownerId}/role", new ChangeRoleRequest("admin"))).StatusCode);
    }

    [Fact]
    public async Task Last_owner_leaving_promotes_a_successor()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var owner = ClientFor($"owner4-{suffix}");
        var friend = ClientFor($"friend4-{suffix}");
        var ownerId = await UserIdOf(owner);
        var friendId = await UserIdOf(friend);
        var spaceId = $"space_l_{suffix}";

        await owner.PostAsJsonAsync($"/sync/{spaceId}/push", Push(spaceId, "devO"));
        await Befriend(owner, friend, friendId);
        await InviteAndAccept(owner, friend, spaceId, friendId, "contributor");

        // owner leaves -> the remaining contributor becomes owner
        Assert.True((await owner.DeleteAsync($"/spaces/{spaceId}/members/{ownerId}")).IsSuccessStatusCode);
        var members = await friend.GetFromJsonAsync<List<MemberDto>>($"/spaces/{spaceId}/members");
        var only = Assert.Single(members!);
        Assert.Equal(friendId, only.UserId);
        Assert.Equal("owner", only.Role);
    }
}
