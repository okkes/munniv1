using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Data;
using Munni.Api.Sync;

namespace Munni.Api.Tests;

/// <summary>
/// Split sessions (SP1): membership is the ONLY authorization boundary —
/// non-members get 404 (existence itself is private), shares freeze at
/// entry creation. Reuses the admin factory (test auth + in-memory db).
/// </summary>
public class SplitsEndpointsTests : IClassFixture<AdminApiFactory>
{
    private readonly AdminApiFactory _factory;

    public SplitsEndpointsTests(AdminApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    /// <summary>any authed request materializes the user row (test auth)</summary>
    private async Task<HttpClient> TouchAsync(string sub)
    {
        var client = ClientFor(sub);
        await client.GetAsync("/me");
        return client;
    }

    private async Task<Guid> UserIdOf(string sub)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return (await db.Users.SingleAsync(u => u.Sub == sub)).Id;
    }

    private async Task JoinAsync(string splitId, string sub)
    {
        var userId = await UserIdOf(sub);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.SplitMembers.Add(new SplitMember { SplitId = splitId, UserId = userId, Role = "member" });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task InviteLinks_JoinAnyone_ButGuestsNeverTouchSpaceScopes()
    {
        var host = await TouchAsync("sp3-host");
        var guest = await TouchAsync("sp3-guest");

        // the host's split is attached to their space, which also has data
        Assert.True((await host.PostAsJsonAsync("/splits",
            new { id = "split-inv", name = "Ski trip", currency = "EUR", spaceId = "s-host" })).IsSuccessStatusCode);
        Assert.True((await host.PostAsJsonAsync("/sync/s-host/push", new PushRequest("dev1",
            [new SyncOpDto(Guid.NewGuid().ToString(), "s-host", "space", "s-host",
                new() { ["name"] = System.Text.Json.JsonSerializer.SerializeToElement("Host home") }, "000000100-0000-dev")]))).IsSuccessStatusCode);

        // outsider can't mint; the member can
        Assert.Equal(HttpStatusCode.NotFound, (await guest.PostAsync("/splits/split-inv/invites", null)).StatusCode);
        var mint = await host.PostAsync("/splits/split-inv/invites", null);
        Assert.True(mint.IsSuccessStatusCode);
        var token = (await mint.Content.ReadFromJsonAsync<InviteMinted>())!.Token;

        // the peek reveals ONLY name + inviter; garbage tokens 404
        var peek = await guest.GetFromJsonAsync<InvitePeek>($"/splits/invites/{token}");
        Assert.Equal("Ski trip", peek!.SplitName);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync("/splits/invites/not-a-token")).StatusCode);

        // accepting joins with the guest's OWN attachment
        var accept = await guest.PostAsJsonAsync($"/splits/invites/{token}/accept", new { spaceId = "s-guest" });
        Assert.True(accept.IsSuccessStatusCode);
        var detail = await guest.GetFromJsonAsync<SplitDetailProbe>("/splits/split-inv");
        Assert.Equal(2, detail!.Members.Count);
        Assert.Equal("s-guest", detail.AttachedSpaceId); // mine, not the host's

        // THE hardening rule: split membership grants ZERO space access
        Assert.Equal(HttpStatusCode.Forbidden, (await guest.GetAsync("/sync/s-host/pull?since=0")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await guest.PostAsJsonAsync("/sync/s-host/push", new PushRequest("dev2",
            [new SyncOpDto(Guid.NewGuid().ToString(), "s-host", "space", "s-host",
                new() { ["name"] = System.Text.Json.JsonSerializer.SerializeToElement("pwned") }, "000000200-0000-dev")]))).StatusCode);

        // minting again retires the old link
        var remint = await host.PostAsync("/splits/split-inv/invites", null);
        var token2 = (await remint.Content.ReadFromJsonAsync<InviteMinted>())!.Token;
        Assert.NotEqual(token, token2);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync($"/splits/invites/{token}")).StatusCode);
    }

    [Fact]
    public async Task SettlementsAreEntries_AndOnlyTheOwnerCloses()
    {
        var owner = await TouchAsync("sp4-owner");
        var member = await TouchAsync("sp4-member");
        Assert.True((await owner.PostAsJsonAsync("/splits",
            new { id = "split-close", name = "Dinner", currency = "EUR", spaceId = (string?)null })).IsSuccessStatusCode);
        await JoinAsync("split-close", "sp4-member");
        var memberId = await UserIdOf("sp4-member");
        var ownerId = await UserIdOf("sp4-owner");

        // owner paid €20, split equally → member owes 10; the member settles
        Assert.True((await owner.PostAsJsonAsync("/splits/split-close/entries",
            new { id = "e-dinner", kind = "expense", description = "Dinner", amountCents = 2000, date = "2026-07-16" })).IsSuccessStatusCode);
        var settle = await member.PostAsJsonAsync("/splits/split-close/entries", new
        {
            id = "e-settle",
            kind = "settlement",
            paidByUserId = memberId,
            description = "Settlement",
            amountCents = 1000,
            date = "2026-07-16",
            shares = new[] { new { userId = ownerId, cents = 1000 } },
        });
        Assert.True(settle.IsSuccessStatusCode);

        // a member cannot close; the owner can — twice is fine (idempotent)
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsync("/splits/split-close/close", null)).StatusCode);
        Assert.True((await owner.PostAsync("/splits/split-close/close", null)).IsSuccessStatusCode);
        Assert.True((await owner.PostAsync("/splits/split-close/close", null)).IsSuccessStatusCode);

        // closed = locked: no entries, no invite links
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/splits/split-close/entries",
            new { id = "e-late", kind = "expense", description = "late", amountCents = 100, date = "2026-07-16" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsync("/splits/split-close/invites", null)).StatusCode);

        var detail = await member.GetFromJsonAsync<SplitDetailProbe>("/splits/split-close");
        Assert.Equal(2, detail!.Members.Count);
    }

    [Fact]
    public async Task EventAttachment_IsPerMember_AndInvisibleToOthers()
    {
        var one = await TouchAsync("sp5-one");
        var two = await TouchAsync("sp5-two");
        Assert.True((await one.PostAsJsonAsync("/splits",
            new { id = "split-ev", name = "Wedding", currency = "EUR", spaceId = "s-one" })).IsSuccessStatusCode);
        await JoinAsync("split-ev", "sp5-two");

        // each member wires their OWN event; re-picking the space also works
        Assert.True((await one.PostAsJsonAsync("/splits/split-ev/attach", new { eventId = "ev-one" })).IsSuccessStatusCode);
        Assert.True((await two.PostAsJsonAsync("/splits/split-ev/attach", new { spaceId = "s-two", eventId = "ev-two" })).IsSuccessStatusCode);

        var mine = await one.GetFromJsonAsync<SplitDetailProbe>("/splits/split-ev");
        var theirs = await two.GetFromJsonAsync<SplitDetailProbe>("/splits/split-ev");
        Assert.Equal("ev-one", mine!.AttachedEventId);
        Assert.Equal("s-one", mine.AttachedSpaceId); // untouched by my event-only call
        Assert.Equal("ev-two", theirs!.AttachedEventId);
        Assert.Equal("s-two", theirs.AttachedSpaceId);

        // clearing is explicit (null eventId), and outsiders still 404
        Assert.True((await one.PostAsJsonAsync("/splits/split-ev/attach", new { eventId = (string?)null })).IsSuccessStatusCode);
        Assert.Null((await one.GetFromJsonAsync<SplitDetailProbe>("/splits/split-ev"))!.AttachedEventId);
        var outsider = await TouchAsync("sp5-outsider");
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.PostAsJsonAsync("/splits/split-ev/attach", new { eventId = "ev-x" })).StatusCode);
    }

    private sealed record InviteMinted(string Token);
    private sealed record InvitePeek(string SplitName, string Currency, string? InviterName);
    private sealed record SplitDetailProbe(string Id, string? AttachedSpaceId, string? AttachedEventId, List<MemberProbe> Members);
    private sealed record MemberProbe(Guid UserId, string Role);

    [Fact]
    public async Task MembershipGatesEverything_SharesFreezeAtCreation()
    {
        var anna = await TouchAsync("sp-anna");
        var ben = await TouchAsync("sp-ben");
        var carol = await TouchAsync("sp-carol");

        Assert.True((await anna.PostAsJsonAsync("/splits",
            new { id = "split-1", name = "Barcelona", currency = "EUR", spaceId = "s-anna" })).IsSuccessStatusCode);

        // outsiders learn nothing — not even that the split exists
        Assert.Equal(HttpStatusCode.NotFound, (await ben.GetAsync("/splits/split-1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await ben.PostAsJsonAsync("/splits/split-1/entries",
                new { id = "e-intruder", kind = "expense", description = "nope", amountCents = 100, date = "2026-07-16" })).StatusCode);

        await JoinAsync("split-1", "sp-ben");

        // equal split of €10.01 over two members: 501/500, remainder deterministic
        Assert.True((await anna.PostAsJsonAsync("/splits/split-1/entries",
            new { id = "e-tapas", kind = "expense", description = "Tapas", amountCents = 1001, date = "2026-07-12" })).IsSuccessStatusCode);

        var detail = await ben.GetFromJsonAsync<System.Text.Json.JsonElement>("/splits/split-1");
        var entry = detail.GetProperty("entries").EnumerateArray().Single();
        var shares = entry.GetProperty("shares").EnumerateArray().Select(s => s.GetProperty("cents").GetInt64()).OrderBy(c => c).ToList();
        Assert.Equal([500L, 501L], shares);

        // Carol joins later: history must not drift — the old entry keeps 2 holders
        await JoinAsync("split-1", "sp-carol");
        var after = await carol.GetFromJsonAsync<System.Text.Json.JsonElement>("/splits/split-1");
        Assert.Equal(2, after.GetProperty("entries").EnumerateArray().Single().GetProperty("shares").GetArrayLength());
        Assert.Equal(3, after.GetProperty("members").GetArrayLength());

        // …but a NEW equal entry spans all three members
        Assert.True((await carol.PostAsJsonAsync("/splits/split-1/entries",
            new { id = "e-metro", kind = "expense", description = "Metro", amountCents = 900, date = "2026-07-13" })).IsSuccessStatusCode);
        var withMetro = await anna.GetFromJsonAsync<System.Text.Json.JsonElement>("/splits/split-1");
        var metro = withMetro.GetProperty("entries").EnumerateArray().Single(e => e.GetProperty("id").GetString() == "e-metro");
        Assert.Equal(3, metro.GetProperty("shares").GetArrayLength());

        // the list shows the split with counts
        var list = await ben.GetFromJsonAsync<System.Text.Json.JsonElement>("/splits");
        var summary = list.EnumerateArray().Single(s => s.GetProperty("id").GetString() == "split-1");
        Assert.Equal(3, summary.GetProperty("memberCount").GetInt32());
        Assert.Equal(2, summary.GetProperty("entryCount").GetInt32());
    }

    [Fact]
    public async Task EntryGuards_CustomSharesAndDeletion()
    {
        var owner = await TouchAsync("sp-owner");
        var member = await TouchAsync("sp-member");
        Assert.True((await owner.PostAsJsonAsync("/splits",
            new { id = "split-2", name = "Weekend", currency = "EUR" })).IsSuccessStatusCode);
        await JoinAsync("split-2", "sp-member");
        var ownerId = await UserIdOf("sp-owner");
        var memberId = await UserIdOf("sp-member");

        // custom shares must balance and belong to members
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/splits/split-2/entries",
            new { id = "e-bad", kind = "expense", description = "x", amountCents = 100, date = "2026-07-16",
                  shares = new[] { new { userId = ownerId, cents = 30L }, new { userId = memberId, cents = 30L } } })).StatusCode);
        Assert.True((await owner.PostAsJsonAsync("/splits/split-2/entries",
            new { id = "e-good", kind = "expense", description = "Dinner", amountCents = 100, date = "2026-07-16",
                  shares = new[] { new { userId = ownerId, cents = 25L }, new { userId = memberId, cents = 75L } } })).IsSuccessStatusCode);

        // the member cannot delete the owner's entry; the owner can delete any
        Assert.True((await member.PostAsJsonAsync("/splits/split-2/entries",
            new { id = "e-mine", kind = "expense", description = "Snacks", amountCents = 300, date = "2026-07-16" })).IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.DeleteAsync("/splits/split-2/entries/e-good")).StatusCode);
        Assert.True((await member.DeleteAsync("/splits/split-2/entries/e-mine")).IsSuccessStatusCode);
        Assert.True((await owner.DeleteAsync("/splits/split-2/entries/e-good")).IsSuccessStatusCode);

        var detail = await owner.GetFromJsonAsync<System.Text.Json.JsonElement>("/splits/split-2");
        Assert.Equal(0, detail.GetProperty("entries").GetArrayLength());
    }
}
