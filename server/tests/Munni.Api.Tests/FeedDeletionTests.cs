using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Accounts;
using Munni.Api.Data;
using Munni.Api.GoCardless;
using Munni.Api.Sync;
using Xunit;

namespace Munni.Api.Tests;

/// <summary>
/// Deleting one financial account (its feed), ruling revoke-mine-only:
/// consent always goes; raw feed + per-space overlays are erased only
/// when no other user still covers the account.
/// </summary>
public class FeedDeletionTests : IClassFixture<FeedsApiFactory>
{
    private readonly FeedsApiFactory _factory;

    public FeedDeletionTests(FeedsApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    private static SyncOpDto Op(string spaceId, string entity, string entityId, string field = "name") =>
        new(Guid.NewGuid().ToString(), spaceId, entity, entityId,
            new() { [field] = JsonSerializer.SerializeToElement("x") }, "000000100-0000-dev");

    private async Task<Guid> UserIdAsync(string sub)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return (await db.Users.FirstAsync(u => u.Sub == sub)).Id;
    }

    [Fact]
    public async Task Sole_coverer_deletion_erases_feed_and_tombstones_overlays()
    {
        var iban = $"NL{Random.Shared.Next(10, 99)}TEST{Random.Shared.Next(1000000, 9999999)}0";
        var feed = ImportIds.FeedSpaceId(iban);
        var accountId = ImportIds.AccountId(iban);
        var txId = ImportIds.TransactionId(iban, "REF-1");
        var spaceId = $"space_{Guid.NewGuid():N}";
        var sub = $"alice_{Guid.NewGuid():N}";
        var alice = ClientFor(sub);

        await alice.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, iban));
        await alice.PostAsJsonAsync($"/sync/{feed}/push", new PushRequest("dev1",
            [Op(feed, "account", accountId), Op(feed, "transaction", txId)]));
        await alice.PostAsJsonAsync($"/sync/{spaceId}/push", new PushRequest("dev1",
            [Op(spaceId, "space", spaceId), Op(spaceId, "txMeta", ImportIds.TxMetaId(spaceId, txId), "catId")]));
        await alice.PostAsJsonAsync($"/spaces/{spaceId}/accounts", new AttachAccountRequest(feed, accountId));

        // my consent rows exist and must go with the account
        var aliceId = await UserIdAsync(sub);
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var requisitionId = Guid.NewGuid();
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = requisitionId,
                UserId = aliceId,
                SpaceId = spaceId,
                InstitutionId = "ING",
                RequisitionId = "gc-req-del-1",
                Status = "linked",
            });
            db.GcLinkedAccounts.Add(new GcLinkedAccount
            {
                GcAccountId = $"gc-{Guid.NewGuid():N}",
                SpaceId = spaceId,
                AccountEntityId = accountId,
                Iban = iban,
                Currency = "EUR",
                RequisitionId = requisitionId,
            });
            await db.SaveChangesAsync();
        }

        var response = await alice.DeleteAsync($"/me/feeds/{feed}");
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var result = await response.Content.ReadFromJsonAsync<FeedDeletionResult>();
        Assert.True(result!.Erased);

        // the feed is gone entirely; the viewing space received tombstones
        Assert.Equal(HttpStatusCode.Forbidden, (await alice.GetAsync($"/sync/{feed}/pull?since=0")).StatusCode);
        var pull = await alice.GetFromJsonAsync<PullResponse>($"/sync/{spaceId}/pull?since=0");
        Assert.Contains(pull!.Ops, o => o.Entity == "txMeta" && o.EntityId == ImportIds.TxMetaId(spaceId, txId) && o.Deleted);
        Assert.Contains(pull.Ops, o => o.Entity == "accountLink" && o.EntityId == ImportIds.AccountLinkId(spaceId, feed) && o.Deleted);

        using var verify = _factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await verifyDb.FeedSpaces.AnyAsync(f => f.Id == feed));
        Assert.False(await verifyDb.EntityRows.AnyAsync(r => r.SpaceId == feed));
        Assert.False(await verifyDb.SyncOps.AnyAsync(o => o.SpaceId == feed));
        Assert.False(await verifyDb.SpaceAccountLinks.AnyAsync(l => l.FeedSpaceId == feed));
        Assert.False(await verifyDb.GcLinkedAccounts.AnyAsync(a => a.AccountEntityId == accountId));
        Assert.False(await verifyDb.GcRequisitions.AnyAsync(r => r.RequisitionId == "gc-req-del-1"));
    }

    [Fact]
    public async Task Family_covered_deletion_keeps_the_feed_and_hands_over_ownership()
    {
        var iban = $"NL{Random.Shared.Next(10, 99)}FAM{Random.Shared.Next(1000000, 9999999)}00";
        var feed = ImportIds.FeedSpaceId(iban);
        var accountId = ImportIds.AccountId(iban);
        var spaceId = $"space_{Guid.NewGuid():N}";
        var aliceSub = $"alice_{Guid.NewGuid():N}";
        var bobSub = $"bob_{Guid.NewGuid():N}";
        var alice = ClientFor(aliceSub);
        var bob = ClientFor(bobSub);

        await alice.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, iban));
        await alice.PostAsJsonAsync($"/sync/{feed}/push", new PushRequest("dev1", [Op(feed, "account", accountId)]));
        await alice.PostAsJsonAsync($"/sync/{spaceId}/push", new PushRequest("dev1", [Op(spaceId, "space", spaceId)]));
        await alice.PostAsJsonAsync($"/spaces/{spaceId}/accounts", new AttachAccountRequest(feed, accountId));
        // bob's own consent covers the same IBAN (family shared account)
        await bob.GetAsync("/me/spaces"); // ensures bob's user row exists
        var aliceId = await UserIdAsync(aliceSub);
        var bobId = await UserIdAsync(bobSub);
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var bobReq = Guid.NewGuid();
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = bobReq,
                UserId = bobId,
                SpaceId = spaceId,
                InstitutionId = "ING",
                RequisitionId = "gc-req-bob-1",
                Status = "linked",
            });
            db.GcLinkedAccounts.Add(new GcLinkedAccount
            {
                GcAccountId = $"gc-{Guid.NewGuid():N}",
                SpaceId = spaceId,
                AccountEntityId = accountId,
                Iban = iban,
                Currency = "EUR",
                RequisitionId = bobReq,
            });
            await db.SaveChangesAsync();
        }

        var response = await alice.DeleteAsync($"/me/feeds/{feed}");
        var result = await response.Content.ReadFromJsonAsync<FeedDeletionResult>();
        Assert.False(result!.Erased);

        using var verify = _factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<AppDbContext>();
        // the feed survives for bob, who also inherits ownership
        var feedRow = await verifyDb.FeedSpaces.FirstAsync(f => f.Id == feed);
        Assert.Equal(bobId, feedRow.OwnerUserId);
        Assert.True(await verifyDb.EntityRows.AnyAsync(r => r.SpaceId == feed));
        // alice's attachment is gone; bob's consent is untouched
        Assert.False(await verifyDb.SpaceAccountLinks.AnyAsync(l => l.FeedSpaceId == feed && l.AttachedBy == aliceId));
        Assert.True(await verifyDb.GcRequisitions.AnyAsync(r => r.RequisitionId == "gc-req-bob-1"));
    }

    [Fact]
    public async Task A_stranger_cannot_delete_someone_elses_account()
    {
        var iban = $"NL{Random.Shared.Next(10, 99)}STRG{Random.Shared.Next(1000000, 9999999)}0";
        var feed = ImportIds.FeedSpaceId(iban);
        var alice = ClientFor($"alice_{Guid.NewGuid():N}");
        var mallory = ClientFor($"mallory_{Guid.NewGuid():N}");

        await alice.PostAsJsonAsync("/feeds", new RegisterFeedRequest(feed, iban));
        Assert.Equal(HttpStatusCode.Forbidden, (await mallory.DeleteAsync($"/me/feeds/{feed}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await mallory.DeleteAsync($"/me/feeds/{ImportIds.FeedSpaceId("NL00NOPE0000000000")}")).StatusCode);
    }
}
