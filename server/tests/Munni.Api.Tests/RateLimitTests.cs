using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Data;
using Munni.Api.Social;
using Xunit;

namespace Munni.Api.Tests;

/// <summary>
/// Rate limiting (security review S2) and route-param shape validation
/// (S4). Uses its own factory with LOW explicit limits — the other test
/// factories run TestMode-unlimited so functional suites never throttle.
/// </summary>
public class RateLimitTests : IClassFixture<RateLimitedApiFactory>
{
    private readonly RateLimitedApiFactory _factory;

    public RateLimitTests(RateLimitedApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    [Fact]
    public async Task SocialMutations_throttle_after_the_per_minute_budget()
    {
        var client = ClientFor($"limited_{Guid.NewGuid():N}");

        // budget is 2/min in this factory; the first two may fail
        // functionally (unknown target user) but must pass the limiter
        for (var i = 0; i < 2; i++)
        {
            var ok = await client.PostAsJsonAsync("/friends/requests", new SendFriendRequest(Guid.NewGuid()));
            Assert.NotEqual(HttpStatusCode.TooManyRequests, ok.StatusCode);
        }

        var throttled = await client.PostAsJsonAsync("/friends/requests", new SendFriendRequest(Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.TooManyRequests, throttled.StatusCode);
        Assert.True(throttled.Headers.Contains("Retry-After"));
    }

    [Fact]
    public async Task GlobalBucket_throttles_a_hammering_user_without_affecting_others()
    {
        var noisy = ClientFor($"noisy_{Guid.NewGuid():N}");
        var quiet = ClientFor($"quiet_{Guid.NewGuid():N}");

        // bucket = 8 tokens, slow refill: the 9th rapid request must 429
        var sawTooMany = false;
        for (var i = 0; i < 9 && !sawTooMany; i++)
            sawTooMany = (await noisy.GetAsync("/me")).StatusCode == HttpStatusCode.TooManyRequests;
        Assert.True(sawTooMany);

        // partitioning is per sub — another user is unaffected
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await quiet.GetAsync("/me")).StatusCode);
    }

    [Theory]
    [InlineData("/sync/%20/pull?since=0")]
    [InlineData("/sync/sp%3Cscript%3E/pull?since=0")]
    [InlineData("/sync/sp.ace/pull?since=0")]
    public async Task Malformed_spaceIds_are_rejected_with_400(string path)
    {
        var client = ClientFor($"shape_{Guid.NewGuid():N}");
        var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Overlong_spaceIds_are_rejected_with_400()
    {
        var client = ClientFor($"shape_{Guid.NewGuid():N}");
        var response = await client.GetAsync($"/sync/{new string('a', 65)}/pull?since=0");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Wellformed_spaceIds_pass_the_shape_filter()
    {
        var client = ClientFor($"shape_{Guid.NewGuid():N}");
        var response = await client.GetAsync($"/sync/space_{Guid.NewGuid():N}/pull?since=0");
        // whatever the membership outcome, the shape filter must not trip
        Assert.NotEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }
}

public class RateLimitedApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        builder.UseSetting("Auth:TestMode", "true");
        builder.UseSetting("Db:AutoMigrate", "false");
        builder.UseSetting("RateLimits:GlobalTokens", "8");
        builder.UseSetting("RateLimits:GlobalRefillPer10s", "1");
        builder.UseSetting("RateLimits:SocialPerMinute", "2");
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
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("ratelimit-tests"));
        });
    }
}
