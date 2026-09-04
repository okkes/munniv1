using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Data;
using Munni.Api.Sync;

namespace Munni.Api.Tests;

public class SyncEndpointsTests : IClassFixture<SyncApiFactory>
{
    private readonly SyncApiFactory _factory;

    public SyncEndpointsTests(SyncApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    private static SyncOpDto Op(string spaceId, string entityId, string field, string value, string hlc) =>
        new(Guid.NewGuid().ToString(), spaceId, "category", entityId,
            new() { [field] = JsonSerializer.SerializeToElement(value) }, hlc);

    [Fact]
    public async Task PushCreatesSpace_PullReturnsOps_RetryIsIdempotent()
    {
        var spaceId = $"space_{Guid.NewGuid():N}";
        var alice = ClientFor("alice");

        var op = Op(spaceId, "c1", "name", "Food", "000000100-0000-devA");
        var push = await alice.PostAsJsonAsync($"/sync/{spaceId}/push", new PushRequest("dev1", [op]));
        Assert.True(push.IsSuccessStatusCode, await push.Content.ReadAsStringAsync());
        var result = await push.Content.ReadFromJsonAsync<PushResponse>();
        Assert.Equal(1, result!.Accepted);

        // retrying the same op is a no-op
        var retry = await alice.PostAsJsonAsync($"/sync/{spaceId}/push", new PushRequest("dev1", [op]));
        var retryResult = await retry.Content.ReadFromJsonAsync<PushResponse>();
        Assert.Equal(0, retryResult!.Accepted);
        Assert.Equal(1, retryResult.Duplicates);
        Assert.Equal(result.LastSeq, retryResult.LastSeq);

        var pull = await alice.GetFromJsonAsync<PullResponse>($"/sync/{spaceId}/pull?since=0");
        Assert.Single(pull!.Ops);
        Assert.Equal("c1", pull.Ops[0].EntityId);
    }

    [Fact]
    public async Task NonMemberIsForbidden()
    {
        var spaceId = $"space_{Guid.NewGuid():N}";
        var alice = ClientFor("alice");
        var mallory = ClientFor("mallory");

        await alice.PostAsJsonAsync($"/sync/{spaceId}/push",
            new PushRequest("dev1", [Op(spaceId, "c1", "name", "Food", "000000100-0000-devA")]));

        Assert.Equal(HttpStatusCode.Forbidden, (await mallory.GetAsync($"/sync/{spaceId}/pull?since=0")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await mallory.GetAsync($"/sync/{spaceId}/bootstrap")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await mallory.PostAsJsonAsync($"/sync/{spaceId}/push",
            new PushRequest("dev2", [Op(spaceId, "c1", "name", "Hijack", "000000999-0000-devM")]))).StatusCode);
    }

    [Fact]
    public async Task TwoDevicesConvergeThroughServer_StaleFieldRejected()
    {
        var spaceId = $"space_{Guid.NewGuid():N}";
        var alice = ClientFor("alice");

        // device A: create with name+color at t=100
        await alice.PostAsJsonAsync($"/sync/{spaceId}/push", new PushRequest("devA",
            [new SyncOpDto(Guid.NewGuid().ToString(), spaceId, "category", "c1",
                new() { ["name"] = JsonSerializer.SerializeToElement("A"), ["color"] = JsonSerializer.SerializeToElement("red") },
                "000000100-0000-devA")]));
        // device B (later clock): rename at t=200
        await alice.PostAsJsonAsync($"/sync/{spaceId}/push",
            new PushRequest("devB", [Op(spaceId, "c1", "name", "B", "000000200-0000-devB")]));
        // device A: stale rename at t=150 arrives last
        await alice.PostAsJsonAsync($"/sync/{spaceId}/push",
            new PushRequest("devA", [Op(spaceId, "c1", "name", "stale", "000000150-0000-devA")]));

        var bootstrap = await alice.GetFromJsonAsync<BootstrapResponse>($"/sync/{spaceId}/bootstrap");
        var row = Assert.Single(bootstrap!.Rows);
        var data = row.Data.Deserialize<Dictionary<string, string>>()!;
        Assert.Equal("B", data["name"]);      // t=200 wins over stale t=150
        Assert.Equal("red", data["color"]);   // untouched field survives
        Assert.Equal(3, bootstrap.LatestSeq); // all ops recorded for pull replay
    }

    [Fact]
    public async Task NoAuthHeaderIsUnauthorized()
    {
        var anon = _factory.CreateClient();
        var response = await anon.GetAsync($"/sync/space_x/pull?since=0");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public void UniqueViolationPredicate_MatchesOnlyPostgresDuplicateKey()
    {
        // #281: the push retry keys on exactly the concurrent-insert
        // signal — anything else must keep surfacing
        var dup = new DbUpdateException("save failed",
            new Npgsql.PostgresException("duplicate key", "ERROR", "ERROR", "23505"));
        Assert.True(SyncWriter.IsUniqueViolation(dup));
        Assert.False(SyncWriter.IsUniqueViolation(new DbUpdateException("save failed",
            new Npgsql.PostgresException("deadlock", "ERROR", "ERROR", "40P01"))));
        Assert.False(SyncWriter.IsUniqueViolation(new DbUpdateException("save failed", new InvalidOperationException())));
    }

}

public class SyncApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        builder.UseSetting("Auth:TestMode", "true");
        builder.UseSetting("Db:AutoMigrate", "false");
        builder.UseSetting("environment", "Development");
        builder.ConfigureServices(services =>
        {
            // strip the Npgsql registration entirely (EF 10 also registers
            // IDbContextOptionsConfiguration) before adding InMemory
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
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("sync-tests"));
            // /geo must never reach the real ip-api.com from tests
            services.AddHttpClient("geo").ConfigurePrimaryHttpMessageHandler(() => new FakeGeoLookupHandler());
        });
    }
}

/// <summary>ipwho.is stand-in: every public IP resolves to NL</summary>
internal sealed class FakeGeoLookupHandler : HttpMessageHandler
{
    public static int Calls;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Interlocked.Increment(ref Calls);
        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
        {
            Content = new StringContent("""{"success":true,"country_code":"NL"}""", System.Text.Encoding.UTF8, "application/json"),
        });
    }
}
