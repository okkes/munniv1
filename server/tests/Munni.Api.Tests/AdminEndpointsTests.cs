using System.Text.Json;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Admin;
using Munni.Api.Data;
using Munni.Api.GoCardless;

namespace Munni.Api.Tests;

/// <summary>Fake GoCardless with two requisitions, one unknown locally (stale).</summary>
public sealed class FakeGoCardless : IGoCardlessApi
{
    public List<string> Deleted { get; } = [];
    public List<GcRequisitionListItem> Requisitions { get; } =
    [
        new("req-known", "LN", "ING_INGBNL2A", DateTimeOffset.UtcNow.AddDays(-2), null, ["acc-1"]),
        new("req-stale", "CR", "ING_INGBNL2A", DateTimeOffset.UtcNow.AddDays(-9), null, []),
    ];

    public Task<IReadOnlyList<GcRequisitionListItem>> ListRequisitionsAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<GcRequisitionListItem>>(Requisitions);

    public Task DeleteRequisitionAsync(string requisitionId, CancellationToken ct = default)
    {
        Deleted.Add(requisitionId);
        Requisitions.RemoveAll(r => r.Id == requisitionId);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<GcInstitution>> GetInstitutionsAsync(string country, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<GcInstitution>>([]);
    public Task<GcRequisitionCreated> CreateRequisitionAsync(string institutionId, string redirect, string reference, CancellationToken ct = default) =>
        throw new NotImplementedException();
    public Task<GcRequisitionStatus> GetRequisitionAsync(string requisitionId, CancellationToken ct = default) =>
        throw new NotImplementedException();
    public Task<GcAccountDetails> GetAccountDetailsAsync(string gcAccountId, CancellationToken ct = default) =>
        throw new NotImplementedException();
    public Task<IReadOnlyList<GcBalance>> GetBalancesAsync(string gcAccountId, CancellationToken ct = default) =>
        throw new NotImplementedException();
    public Task<GcTransactionsPage> GetTransactionsAsync(string gcAccountId, DateOnly? from, CancellationToken ct = default) =>
        throw new NotImplementedException();
}

public class AdminApiFactory : WebApplicationFactory<Program>
{
    public FakeGoCardless Gc { get; } = new();

    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        builder.UseSetting("Auth:TestMode", "true");
        builder.UseSetting("Db:AutoMigrate", "false");
        builder.UseSetting("GoCardless:SecretId", "test"); // enables admin GC routes
        builder.UseSetting("Admin:Subs", "the-admin, another-admin");
        builder.ConfigureServices(services =>
        {
            foreach (var d in services
                         .Where(d =>
                             d.ServiceType == typeof(DbContextOptions<AppDbContext>) ||
                             d.ServiceType == typeof(DbContextOptions) ||
                             d.ServiceType == typeof(AppDbContext) ||
                             d.ServiceType == typeof(IGoCardlessApi) ||
                             d.ServiceType == typeof(Microsoft.Extensions.Hosting.IHostedService) && d.ImplementationType == typeof(GcFetchService) ||
                             d.ServiceType.Name.Contains("IDbContextOptionsConfiguration"))
                         .ToList())
            {
                services.Remove(d);
            }
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("admin-tests"));
            services.AddSingleton<IGoCardlessApi>(Gc);
        });
    }
}

public class AdminEndpointsTests : IClassFixture<AdminApiFactory>
{
    private readonly AdminApiFactory _factory;

    public AdminEndpointsTests(AdminApiFactory factory) => _factory = factory;

    [Fact]
    public async Task User_diagnosis_exposes_the_whole_sync_chain()
    {
        var admin = ClientFor("the-admin");
        var user = ClientFor("diag-user");
        await user.GetAsync("/me"); // materialize

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var userId = (await db.Users.FirstAsync(u => u.Sub == "diag-user")).Id;
            db.Spaces.Add(new Space { Id = "space-diag" });
            db.SpaceMembers.Add(new SpaceMember { SpaceId = "space-diag", UserId = userId, Role = Social.SpaceRoles.Owner });
            db.FeedSpaces.Add(new Accounts.FeedSpace { Id = "feed-diag", OwnerUserId = userId, AccountRef = "NL01TEST" });
            db.SpaceAccountLinks.Add(new Accounts.SpaceAccountLink
            {
                Id = Guid.NewGuid(), SpaceId = "space-diag", FeedSpaceId = "feed-diag", AccountId = "acct-1", AttachedBy = userId,
            });
            await db.SaveChangesAsync();
        }

        var res = await admin.GetAsync("/admin/users/diag-user/diagnosis");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Contains("space-diag", body.GetProperty("memberSpaces").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal("feed-diag", body.GetProperty("ownedFeeds")[0].GetProperty("feedSpaceId").GetString());
        Assert.Equal("feed-diag", body.GetProperty("attachments")[0].GetProperty("feedSpaceId").GetString());

        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/admin/users/nobody/diagnosis")).StatusCode);
    }

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    [Fact]
    public async Task NonAdminIsForbiddenEverywhere()
    {
        var user = ClientFor("regular-user");
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/admin/ping")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/admin/gocardless/requisitions")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.DeleteAsync("/admin/gocardless/requisitions/req-x")).StatusCode);
    }

    [Fact]
    public async Task BankProviderToggleIsGone()
    {
        // #175: the END USER picks the provider at connect time — the
        // admin's "active provider" endpoints retired outright
        var admin = ClientFor("the-admin");
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/admin/bank-provider")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await admin.PutAsJsonAsync("/admin/bank-provider", new { provider = "gocardless" })).StatusCode);
    }

    [Fact]
    public async Task AdminSeesOnlyThisEnvironmentsRequisitions_ForeignOnesAreCountedAndUndeletable()
    {
        var admin = ClientFor("the-admin");
        Assert.True((await admin.GetAsync("/admin/ping")).IsSuccessStatusCode);

        // seed local records: one matching req-known (also present at GC)
        // and one the provider no longer knows (dead consent → stale)
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var owner = new User { Id = Guid.NewGuid(), Sub = "the-owner" };
            db.Users.Add(owner);
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = Guid.NewGuid(),
                UserId = owner.Id,
                SpaceId = "s1",
                InstitutionId = "ING_INGBNL2A",
                RequisitionId = "req-known",
                Status = "linked",
            });
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = Guid.NewGuid(),
                UserId = owner.Id,
                SpaceId = "s1",
                InstitutionId = "ASN_BANK_ASNBNL21",
                RequisitionId = "req-dead-at-gc",
                Status = "created",
            });
            await db.SaveChangesAsync();
        }

        var users = await admin.GetFromJsonAsync<List<AdminUserDto>>("/admin/users");
        Assert.Contains(users!, u => u.Sub == "the-owner");

        // the shared GC account also carries req-stale (another
        // environment's consent) — counted, never listed
        var list = await admin.GetFromJsonAsync<AdminRequisitionListDto>("/admin/gocardless/requisitions");
        Assert.Equal(2, list!.Requisitions.Count);
        Assert.Equal(1, list.ForeignCount);
        Assert.DoesNotContain(list.Requisitions, r => r.RequisitionId == "req-stale");
        var known = list.Requisitions.Single(r => r.RequisitionId == "req-known");
        Assert.False(known.Stale);
        Assert.Equal("the-owner", known.OwnerSub);
        var dead = list.Requisitions.Single(r => r.RequisitionId == "req-dead-at-gc");
        Assert.True(dead.Stale);
        Assert.Equal("gone", dead.Status);

        // deleting a FOREIGN consent is refused and GC is never called —
        // a staging admin must not be able to revoke prod's bank access
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("/admin/gocardless/requisitions/req-stale")).StatusCode);
        Assert.DoesNotContain("req-stale", _factory.Gc.Deleted);

        // deleting an OWN consent works: GC called, list shrinks
        Assert.True((await admin.DeleteAsync("/admin/gocardless/requisitions/req-known")).IsSuccessStatusCode);
        Assert.Contains("req-known", _factory.Gc.Deleted);
        var after = await admin.GetFromJsonAsync<AdminRequisitionListDto>("/admin/gocardless/requisitions");
        Assert.Single(after!.Requisitions);
    }
}

public class AdminGrantsTests : IClassFixture<AdminApiFactory>
{
    private readonly AdminApiFactory _factory;

    public AdminGrantsTests(AdminApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    private async Task SeedUserAsync(string sub)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        if (!await db.Users.AnyAsync(u => u.Sub == sub))
        {
            db.Users.Add(new User { Id = Guid.NewGuid(), Sub = sub });
            await db.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task PromoteGrantsAccess_RevokeTakesItAway()
    {
        await SeedUserAsync("promoted-user");
        var admin = ClientFor("the-admin");
        var promoted = ClientFor("promoted-user");

        Assert.Equal(HttpStatusCode.Forbidden, (await promoted.GetAsync("/admin/ping")).StatusCode);
        Assert.True((await admin.PostAsync("/admin/admins/promoted-user", null)).IsSuccessStatusCode);
        Assert.True((await promoted.GetAsync("/admin/ping")).IsSuccessStatusCode);

        // the grants list carries both bootstrap and DB admins, flagged
        var admins = await admin.GetFromJsonAsync<List<AdminGrantDto>>("/admin/admins");
        Assert.Contains(admins!, a => a.Sub == "the-admin" && a.Bootstrap);
        Assert.Contains(admins!, a => a.Sub == "promoted-user" && !a.Bootstrap && a.GrantedBySub == "the-admin");

        // a granted admin can grant others (same power) but the revoke path works too
        Assert.True((await admin.DeleteAsync("/admin/admins/promoted-user")).IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await promoted.GetAsync("/admin/ping")).StatusCode);
    }

    [Fact]
    public async Task GuardsHold_BootstrapAndSelfAndUnknownUsers()
    {
        var admin = ClientFor("the-admin");
        // bootstrap admins cannot be demoted from the console
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.DeleteAsync("/admin/admins/another-admin")).StatusCode);
        // you cannot demote yourself
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.DeleteAsync("/admin/admins/the-admin")).StatusCode);
        // promoting a sub that has never signed in is refused
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/admin/admins/ghost-user", null)).StatusCode);
        // non-admins cannot touch the grants API
        var user = ClientFor("regular-user-2");
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/admin/admins")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.PostAsync("/admin/admins/regular-user-2", null)).StatusCode);
    }

    [Fact]
    public async Task QuotaEndpointReturnsCapturedSnapshots()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.ProviderQuotas.Add(new ProviderQuota
            {
                Id = Guid.NewGuid(),
                Provider = "gocardless",
                Scope = "accounts:transactions",
                Limit = 4,
                Remaining = 3,
                ResetAtUtc = DateTimeOffset.UtcNow.AddHours(20),
            });
            await db.SaveChangesAsync();
        }
        var admin = ClientFor("the-admin");
        var quota = await admin.GetFromJsonAsync<List<ProviderQuotaDto>>("/admin/quota");
        var row = quota!.Single(q => q.Scope == "accounts:transactions");
        Assert.Equal(4, row.Limit);
        Assert.Equal(3, row.Remaining);
    }
}

public class QuotaCaptureHandlerTests
{
    [Theory]
    [InlineData("https://x/api/v2/requisitions/", "requisitions")]
    [InlineData("https://x/api/v2/accounts/abc-123/transactions/", "accounts:transactions")]
    [InlineData("https://x/api/v2/accounts/abc-123/details/", "accounts:details")]
    [InlineData("https://x/api/v2/token/new/", "token:new")]
    public void ScopeCollapsesIdsIntoEndpointFamilies(string url, string expected) =>
        Assert.Equal(expected, QuotaCaptureHandler.ScopeOf(new Uri(url)));
}

/// <summary>stubbed Logto Management API for the username migration</summary>
public sealed class FakeLogtoHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri!.AbsolutePath;
        if (path.EndsWith("/oidc/token"))
            return Json("""{"access_token":"tok"}""");
        if (request.Method == HttpMethod.Get && path.EndsWith("/api/users"))
        {
            var firstPage = request.RequestUri.Query.Contains("page=1");
            return Json(firstPage
                ? """[{"id":"u1","username":"Okkes"},{"id":"u2","username":"already"},{"id":"u3","username":null},{"id":"u4","username":"Taken"}]"""
                : "[]");
        }
        if (request.Method == HttpMethod.Patch && path.Contains("/api/users/"))
        {
            // u4's lowercase twin already exists -> Logto rejects the rename
            return path.EndsWith("/u4")
                ? Task.FromResult(new HttpResponseMessage(HttpStatusCode.UnprocessableEntity))
                : Json("{}");
        }
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }

    private static Task<HttpResponseMessage> Json(string body) =>
        Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
        });
}

public class AdminLogtoFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        builder.UseSetting("Auth:TestMode", "true");
        builder.UseSetting("Db:AutoMigrate", "false");
        builder.UseSetting("Admin:Subs", "the-admin");
        builder.UseSetting("Logto:M2mAppId", "m2m-app");
        builder.UseSetting("Logto:M2mAppSecret", "m2m-secret");
        builder.UseSetting("Auth:Authority", "http://logto.local/oidc");
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
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("admin-logto-tests"));
            services.AddHttpClient("logto-m2m").ConfigurePrimaryHttpMessageHandler(() => new FakeLogtoHandler());
        });
    }
}

public class LogtoUsernameMigrationTests : IClassFixture<AdminLogtoFactory>
{
    private readonly AdminLogtoFactory _factory;

    public LogtoUsernameMigrationTests(AdminLogtoFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    [Fact]
    public async Task Lowercases_mixed_case_usernames_and_reports_collisions()
    {
        var response = await ClientFor("the-admin").PostAsync("/admin/logto/lowercase-usernames", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var changed = body.RootElement.GetProperty("changed").EnumerateArray().Select(e => e.GetString()).ToList();
        var skipped = body.RootElement.GetProperty("skipped").EnumerateArray().Select(e => e.GetString()).ToList();
        // already-lowercase and username-less users are untouched
        Assert.Equal(["Okkes"], changed);
        Assert.Equal(["Taken (422)"], skipped);
    }

    [Fact]
    public async Task Only_admins_may_run_the_migration()
    {
        var response = await ClientFor("random-user").PostAsync("/admin/logto/lowercase-usernames", null);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
