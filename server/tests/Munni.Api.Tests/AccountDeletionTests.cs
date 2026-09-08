using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Accounts;
using Munni.Api.Data;
using Munni.Api.GoCardless;
using Munni.Api.Push;
using Munni.Api.Social;

namespace Munni.Api.Tests;

/// <summary>
/// The full account-deletion pipeline (approved decisions: shared
/// spaces leave-and-archive, immediate, Logto optional). Uses the admin
/// factory: test auth + FakeGoCardless + in-memory database.
/// </summary>
public class AccountDeletionTests : IClassFixture<AdminApiFactory>
{
    private readonly AdminApiFactory _factory;

    public AccountDeletionTests(AdminApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    private sealed class CountingHttpFactory : IHttpClientFactory
    {
        public int Created;
        public HttpClient CreateClient(string name)
        {
            Created++;
            return new HttpClient();
        }
    }

    [Fact]
    public async Task Identity_deletion_can_be_disabled_per_environment()
    {
        // staging shares Logto with production — with the knob off, the
        // Logto Management API must never even be contacted
        var factory = new CountingHttpFactory();
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Logto:DeleteIdentityOnAccountDeletion"] = "false",
                ["Logto:M2mAppId"] = "m2m-app",
                ["Logto:M2mAppSecret"] = "m2m-secret",
                ["Auth:Authority"] = "https://logto.test/oidc",
            })
            .Build();
        await AccountDeletion.DeleteLogtoUserAsync(
            factory, config, Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance, "sub-shared");
        Assert.Equal(0, factory.Created);
    }

    private async Task<(Guid LeaverId, Guid FriendId)> SeedWorldAsync(string leaverSub, string friendSub, string prefix)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var leaver = new User { Id = Guid.NewGuid(), Sub = leaverSub };
        var friend = new User { Id = Guid.NewGuid(), Sub = friendSub };
        db.Users.AddRange(leaver, friend);

        // solo space (dies) + shared space where the leaver is the only owner
        db.Spaces.AddRange(new Space { Id = $"{prefix}-solo" }, new Space { Id = $"{prefix}-shared" });
        db.SpaceMembers.AddRange(
            new SpaceMember { SpaceId = $"{prefix}-solo", UserId = leaver.Id, Role = SpaceRoles.Owner },
            new SpaceMember { SpaceId = $"{prefix}-shared", UserId = leaver.Id, Role = SpaceRoles.Owner },
            new SpaceMember { SpaceId = $"{prefix}-shared", UserId = friend.Id, Role = "contributor" });
        db.EntityRows.Add(new EntityRow { SpaceId = $"{prefix}-solo", Entity = "transaction", EntityId = "t1", DataJson = "{}", FieldVersionsJson = "{}" });
        db.SyncOps.Add(new SyncOpRow { SpaceId = $"{prefix}-solo", Seq = 1, OpId = $"{prefix}-op1", Entity = "transaction", EntityId = "t1", Hlc = "1", PayloadJson = "{}" });

        // two owned feeds: one attached to the shared space (survives),
        // one only to the solo space (dies)
        db.FeedSpaces.AddRange(
            new FeedSpace { Id = $"{prefix}-feed-shared", OwnerUserId = leaver.Id, AccountRef = "NL01" },
            new FeedSpace { Id = $"{prefix}-feed-solo", OwnerUserId = leaver.Id, AccountRef = "NL02" });
        db.Spaces.AddRange(new Space { Id = $"{prefix}-feed-shared" }, new Space { Id = $"{prefix}-feed-solo" });
        db.EntityRows.Add(new EntityRow { SpaceId = $"{prefix}-feed-shared", Entity = "transaction", EntityId = "f1", DataJson = "{}", FieldVersionsJson = "{}" });
        db.SpaceAccountLinks.AddRange(
            new SpaceAccountLink { Id = Guid.NewGuid(), SpaceId = $"{prefix}-shared", FeedSpaceId = $"{prefix}-feed-shared", AccountId = "a1", AttachedBy = leaver.Id },
            new SpaceAccountLink { Id = Guid.NewGuid(), SpaceId = $"{prefix}-solo", FeedSpaceId = $"{prefix}-feed-solo", AccountId = "a2", AttachedBy = leaver.Id });

        // consent + push + friendship
        db.GcRequisitions.Add(new GcRequisition
        {
            Id = Guid.NewGuid(), UserId = leaver.Id, SpaceId = $"{prefix}-solo",
            InstitutionId = "ING", RequisitionId = $"{prefix}-req", Status = "linked",
        });
        _factory.Gc.Requisitions.Add(new(
            $"{prefix}-req", "LN", "ING", DateTimeOffset.UtcNow, null, ["acc"]));
        db.PushSubscriptions.Add(new PushSubscriptionRow
        {
            Id = Guid.NewGuid(), UserId = leaver.Id, Endpoint = $"https://push/{prefix}",
            P256dh = "k", Auth = "a", Kind = "webpush",
        });
        db.Friendships.Add(new Friendship { Id = Guid.NewGuid(), UserAId = leaver.Id, UserBId = friend.Id, Status = "accepted" });
        await db.SaveChangesAsync();
        return (leaver.Id, friend.Id);
    }

    [Fact]
    public async Task DeleteMe_ErasesSoloData_LeavesSharedBehindForOthers()
    {
        var (leaverId, friendId) = await SeedWorldAsync("del-user", "del-friend", "d1");
        var client = ClientFor("del-user");

        var response = await client.DeleteAsync("/me");
        Assert.True(response.IsSuccessStatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // the user and their solo world are gone
        Assert.False(await db.Users.AnyAsync(u => u.Id == leaverId));
        Assert.False(await db.Spaces.AnyAsync(s => s.Id == "d1-solo"));
        Assert.False(await db.EntityRows.AnyAsync(r => r.SpaceId == "d1-solo"));
        Assert.False(await db.SyncOps.AnyAsync(o => o.SpaceId == "d1-solo"));
        Assert.False(await db.FeedSpaces.AnyAsync(f => f.Id == "d1-feed-solo"));

        // the shared space survives for the friend, ownership transferred
        var friendMembership = await db.SpaceMembers.SingleAsync(m => m.SpaceId == "d1-shared");
        Assert.Equal(friendId, friendMembership.UserId);
        Assert.Equal(SpaceRoles.Owner, friendMembership.Role);
        // decision ①: the shared feed stays readable (archived link)
        Assert.True(await db.FeedSpaces.AnyAsync(f => f.Id == "d1-feed-shared"));
        Assert.True(await db.EntityRows.AnyAsync(r => r.SpaceId == "d1-feed-shared"));
        var sharedLink = await db.SpaceAccountLinks.SingleAsync(l => l.FeedSpaceId == "d1-feed-shared");
        Assert.True(sharedLink.Archived);

        // consent revoked at the provider; push + friendship erased
        Assert.Contains("d1-req", _factory.Gc.Deleted);
        Assert.False(await db.GcRequisitions.AnyAsync(r => r.RequisitionId == "d1-req"));
        Assert.False(await db.PushSubscriptions.AnyAsync(p => p.UserId == leaverId));
        Assert.False(await db.Friendships.AnyAsync(f => f.UserAId == leaverId || f.UserBId == leaverId));
    }

    [Fact]
    public async Task AdminDeletesAUser_ButNeverThemselves()
    {
        await SeedWorldAsync("del-target", "del-witness", "d2");
        var admin = ClientFor("the-admin");

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.DeleteAsync("/admin/users/the-admin")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("/admin/users/no-such-sub")).StatusCode);
        Assert.True((await admin.DeleteAsync("/admin/users/del-target")).IsSuccessStatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.Sub == "del-target"));
        Assert.True(await db.Users.AnyAsync(u => u.Sub == "del-witness"));

        // non-admins cannot use the operator path
        var user = ClientFor("del-witness");
        Assert.Equal(HttpStatusCode.Forbidden, (await user.DeleteAsync("/admin/users/del-witness")).StatusCode);
    }
}
