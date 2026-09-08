using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Data;
using Munni.Api.Rates;

namespace Munni.Api.Tests;

/// <summary>ECB stand-in: daily file, 90-day window, full history —
/// weekend gaps included so the ≤-lookup is actually exercised.</summary>
internal sealed class FakeEcbHandler : HttpMessageHandler
{
    public int DailyCalls;
    public int Hist90Calls;
    public int FullCalls;

    private static string Envelope(string cubes) =>
        $"""
        <gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
          <gesmes:subject>Reference rates</gesmes:subject>
          <Cube>{cubes}</Cube>
        </gesmes:Envelope>
        """;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var path = request.RequestUri!.AbsolutePath;
        string? body = null;
        if (path.EndsWith("eurofxref-daily.xml"))
        {
            DailyCalls++;
            body = Envelope("""
                <Cube time="2026-07-22"><Cube currency="USD" rate="1.0850"/><Cube currency="TRY" rate="37.500"/></Cube>
                """);
        }
        else if (path.EndsWith("eurofxref-hist-90d.xml"))
        {
            Hist90Calls++;
            // Fri 17th + Wed 22nd — the weekend (18th/19th) has no fixing
            body = Envelope("""
                <Cube time="2026-07-22"><Cube currency="USD" rate="1.0850"/><Cube currency="TRY" rate="37.500"/></Cube>
                <Cube time="2026-07-17"><Cube currency="USD" rate="1.0800"/><Cube currency="TRY" rate="37.100"/></Cube>
                """);
        }
        else if (path.EndsWith("eurofxref-hist.xml"))
        {
            FullCalls++;
            body = Envelope("""
                <Cube time="2026-07-22"><Cube currency="USD" rate="1.0850"/></Cube>
                <Cube time="2024-03-01"><Cube currency="USD" rate="1.0500"/><Cube currency="TRY" rate="32.000"/></Cube>
                """);
        }
        if (body is null) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/xml"),
        });
    }
}

public class RatesApiFactory : WebApplicationFactory<Program>
{
    internal FakeEcbHandler Ecb { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
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
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("rates-endpoint-tests"));
            services.AddHttpClient(RatesEndpoints.EcbClientName).ConfigurePrimaryHttpMessageHandler(() => Ecb);
        });
    }
}

public class RatesEndpointsTests : IClassFixture<RatesApiFactory>
{
    private readonly RatesApiFactory _factory;

    public RatesEndpointsTests(RatesApiFactory factory) => _factory = factory;

    private HttpClient Client()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", "converter");
        return client;
    }

    [Fact]
    public async Task Rates_require_auth_and_a_wellformed_date()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().GetAsync("/rates")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client().GetAsync("/rates?date=22-07-2026")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client().GetAsync("/rates?date=not-a-date")).StatusCode);
    }

    [Fact]
    public async Task Latest_rates_parse_the_daily_file_and_include_the_eur_identity()
    {
        var payload = await Client().GetFromJsonAsync<JsonElement>("/rates");
        Assert.Equal("2026-07-22", payload.GetProperty("date").GetString());
        Assert.Equal("EUR", payload.GetProperty("base").GetString());
        var rates = payload.GetProperty("rates");
        Assert.Equal(1.0850m, rates.GetProperty("USD").GetDecimal());
        Assert.Equal(37.500m, rates.GetProperty("TRY").GetDecimal());
        // EUR rides along at 1.0 so the client converts any pair EUR-based
        Assert.Equal(1m, rates.GetProperty("EUR").GetDecimal());
    }

    [Fact]
    public async Task Weekend_dates_resolve_to_the_previous_fixing()
    {
        // Saturday the 18th → Friday the 17th's rates, date says so honestly
        var payload = await Client().GetFromJsonAsync<JsonElement>("/rates?date=2026-07-18");
        Assert.Equal("2026-07-17", payload.GetProperty("date").GetString());
        Assert.Equal(1.0800m, payload.GetProperty("rates").GetProperty("USD").GetDecimal());
    }

    [Fact]
    public async Task Dates_older_than_the_window_fall_back_to_the_full_history()
    {
        var payload = await Client().GetFromJsonAsync<JsonElement>("/rates?date=2024-03-15");
        Assert.Equal("2024-03-01", payload.GetProperty("date").GetString());
        Assert.Equal(32.000m, payload.GetProperty("rates").GetProperty("TRY").GetDecimal());
        Assert.True(_factory.Ecb.FullCalls >= 1);
    }

    [Fact]
    public async Task Prehistoric_dates_return_not_found()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Client().GetAsync("/rates?date=1998-01-01")).StatusCode);
    }

    [Fact]
    public async Task History_is_cached_across_requests()
    {
        await Client().GetFromJsonAsync<JsonElement>("/rates?date=2026-07-20");
        var before = _factory.Ecb.Hist90Calls;
        await Client().GetFromJsonAsync<JsonElement>("/rates?date=2026-07-21");
        Assert.Equal(before, _factory.Ecb.Hist90Calls); // second day served from cache
        Assert.True(before >= 1);
    }
}

/// <summary>the ECB being down must surface as 502, never a crash or an empty 200</summary>
internal sealed class DeadEcbHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
        Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
}

public class DeadRatesApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
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
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("rates-down-tests"));
            services.AddHttpClient(RatesEndpoints.EcbClientName).ConfigurePrimaryHttpMessageHandler(() => new DeadEcbHandler());
        });
    }
}

public class RatesVendorDownTests : IClassFixture<DeadRatesApiFactory>
{
    private readonly DeadRatesApiFactory _factory;

    public RatesVendorDownTests(DeadRatesApiFactory factory) => _factory = factory;

    [Fact]
    public async Task A_dead_vendor_answers_502_for_latest_and_dated_requests()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", "converter-down");
        Assert.Equal(HttpStatusCode.BadGateway, (await client.GetAsync("/rates")).StatusCode);
        Assert.Equal(HttpStatusCode.BadGateway, (await client.GetAsync("/rates?date=2026-07-20")).StatusCode);
    }
}
