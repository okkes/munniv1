using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Admin;
using Munni.Api.Data;
using Munni.Api.GoCardless;

namespace Munni.Api.Tests;

/// <summary>Fake shared GoCardless account: consents from two environments
/// (distinguished by redirect origin) plus one with no redirect at all.</summary>
public sealed class ControlFakeGoCardless : IGoCardlessApi
{
    public List<GcRequisitionListItem> Requisitions { get; } =
    [
        new("req-prod", "LN", "ING_INGBNL2A", DateTimeOffset.UtcNow.AddDays(-3), null, ["acc-p1", "acc-p2"],
            "https://munni.example.com/connect/callback"),
        new("req-here", "LN", "RABOBANK_RABONL2U", DateTimeOffset.UtcNow.AddDays(-2), null, ["acc-h1"],
            "http://localhost:8480/connect/callback"),
        new("req-lost", "CR", "ASN_BANK_ASNBNL21", DateTimeOffset.UtcNow.AddDays(-9), null, []),
    ];

    public Task<IReadOnlyList<GcRequisitionListItem>> ListRequisitionsAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<GcRequisitionListItem>>(Requisitions);

    public Task DeleteRequisitionAsync(string requisitionId, CancellationToken ct = default) =>
        throw new NotImplementedException(); // control must never delete

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

public class ControlApiFactory : WebApplicationFactory<Program>
{
    public ControlFakeGoCardless Gc { get; } = new();

    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        builder.UseSetting("Auth:TestMode", "true");
        builder.UseSetting("Db:AutoMigrate", "false");
        builder.UseSetting("GoCardless:SecretId", "test"); // enables the /control GC routes
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
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("control-tests"));
            services.AddSingleton<IGoCardlessApi>(Gc);
        });
    }
}

public class ControlEndpointsTests : IClassFixture<ControlApiFactory>
{
    private readonly ControlApiFactory _factory;

    public ControlEndpointsTests(ControlApiFactory factory) => _factory = factory;

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
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/control/ping")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/control/consents")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/control/quota")).StatusCode);
    }

    [Fact]
    public async Task ConsentsAttributeOriginsAndMarkOwnedHere_DeletionDoesNotExist()
    {
        var admin = ClientFor("the-admin");
        Assert.True((await admin.GetAsync("/control/ping")).IsSuccessStatusCode);

        // req-here is the only consent THIS environment's database knows
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
                InstitutionId = "RABOBANK_RABONL2U",
                RequisitionId = "req-here",
                Status = "linked",
                RedirectOrigin = "http://localhost:8480",
            });
            await db.SaveChangesAsync();
        }

        // EVERY consent on the shared account appears — foreign ones included
        var consents = await admin.GetFromJsonAsync<List<ControlConsentDto>>("/control/consents");
        Assert.Equal(3, consents!.Count);

        var prod = consents.Single(c => c.RequisitionId == "req-prod");
        Assert.Equal("https://munni.example.com", prod.EnvironmentOrigin);
        Assert.False(prod.OwnedHere);
        Assert.Equal(2, prod.AccountCount);

        var here = consents.Single(c => c.RequisitionId == "req-here");
        Assert.Equal("http://localhost:8480", here.EnvironmentOrigin);
        Assert.True(here.OwnedHere);

        // no redirect at the provider -> unattributed, not misattributed
        var lost = consents.Single(c => c.RequisitionId == "req-lost");
        Assert.Null(lost.EnvironmentOrigin);
        Assert.False(lost.OwnedHere);

        // deletion stays per-environment by design: /control maps no delete
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("/control/consents/req-prod")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("/control/consents/req-here")).StatusCode);
    }

    [Fact]
    public async Task QuotaMirrorsTheAdminPayload()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.ProviderQuotas.Add(new ProviderQuota
            {
                Id = Guid.NewGuid(),
                Provider = "gocardless",
                Scope = "requisitions",
                Limit = 50,
                Remaining = 47,
                ResetAtUtc = DateTimeOffset.UtcNow.AddHours(12),
            });
            await db.SaveChangesAsync();
        }
        var admin = ClientFor("the-admin");
        var control = await admin.GetFromJsonAsync<List<ProviderQuotaDto>>("/control/quota");
        var row = control!.Single(q => q.Scope == "requisitions");
        Assert.Equal(50, row.Limit);
        Assert.Equal(47, row.Remaining);
        // the same shared-account snapshot the per-env portal serves
        var viaAdmin = await admin.GetFromJsonAsync<List<ProviderQuotaDto>>("/admin/quota");
        Assert.Equal(viaAdmin, control);
    }
}
