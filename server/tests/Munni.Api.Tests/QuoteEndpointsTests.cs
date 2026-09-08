using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Data;
using Munni.Api.Investments;

namespace Munni.Api.Tests;

internal sealed class FakeYahooHandler : HttpMessageHandler
{
    public int ChartCalls;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var path = request.RequestUri!.AbsolutePath;
        if (path.StartsWith("/v8/finance/chart/"))
        {
            ChartCalls++;
            if (path.Contains("DEAD")) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            var body = """{"chart":{"result":[{"meta":{"regularMarketPrice":650.5,"chartPreviousClose":640.0,"currency":"EUR"}}]}}""";
            return Task.FromResult(Ok(body));
        }
        if (path.StartsWith("/v1/finance/search"))
        {
            var body = """{"quotes":[{"symbol":"ASML.AS","shortname":"ASML Holding","quoteType":"EQUITY","exchDisp":"Amsterdam"},{"symbol":"XXX-OPT","quoteType":"OPTION"}]}""";
            return Task.FromResult(Ok(body));
        }
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }

    private static HttpResponseMessage Ok(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
}

internal sealed class FakeCoinGeckoHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var path = request.RequestUri!.AbsolutePath;
        string body = path.StartsWith("/api/v3/simple/price")
            ? """{"bitcoin":{"eur":61000.5,"eur_24h_change":1.25}}"""
            : """{"coins":[{"id":"bitcoin","name":"Bitcoin","symbol":"btc"}]}""";
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        });
    }
}

public class QuotesApiFactory : WebApplicationFactory<Program>
{
    internal FakeYahooHandler Yahoo { get; } = new();

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
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("quotes-endpoint-tests"));
            services.AddHttpClient(QuoteEndpoints.YahooClientName).ConfigurePrimaryHttpMessageHandler(() => Yahoo);
            services.AddHttpClient(QuoteEndpoints.CoinGeckoClientName).ConfigurePrimaryHttpMessageHandler(() => new FakeCoinGeckoHandler());
        });
    }
}

public class QuoteEndpointsTests : IClassFixture<QuotesApiFactory>
{
    private readonly QuotesApiFactory _factory;

    public QuoteEndpointsTests(QuotesApiFactory factory) => _factory = factory;

    private HttpClient Client()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", "investor");
        return client;
    }

    [Fact]
    public async Task Search_maps_stock_and_coin_hits_and_rejects_short_queries()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Client().GetAsync("/quotes/search?q=a")).StatusCode);
        var payload = await Client().GetFromJsonAsync<JsonElement>("/quotes/search?q=asml");
        var stock = Assert.Single(payload.GetProperty("stocks").EnumerateArray()); // the OPTION hit is filtered out
        Assert.Equal("ASML.AS", stock.GetProperty("symbol").GetString());
        Assert.Equal("Amsterdam", stock.GetProperty("exchange").GetString());
        var coin = Assert.Single(payload.GetProperty("coins").EnumerateArray());
        Assert.Equal("bitcoin", coin.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Quotes_require_auth_and_at_least_one_key()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().GetAsync("/quotes?symbols=ASML.AS")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client().GetAsync("/quotes")).StatusCode);
    }

    [Fact]
    public async Task Quotes_map_both_vendors_and_skip_dead_symbols()
    {
        var payload = await Client().GetFromJsonAsync<JsonElement>("/quotes?symbols=ASML.AS,DEAD&coins=bitcoin");
        var quotes = payload.GetProperty("quotes").EnumerateArray().ToList();
        Assert.Equal(2, quotes.Count);

        var asml = quotes.Single(q => q.GetProperty("key").GetString() == "yahoo:ASML.AS");
        Assert.Equal(650.5m, asml.GetProperty("price").GetDecimal());
        Assert.Equal("EUR", asml.GetProperty("currency").GetString());
        Assert.Equal(1.64m, asml.GetProperty("dayChangePct").GetDecimal());

        var btc = quotes.Single(q => q.GetProperty("key").GetString() == "coingecko:bitcoin");
        Assert.Equal(61000.5m, btc.GetProperty("price").GetDecimal());
        Assert.Equal(1.25m, btc.GetProperty("dayChangePct").GetDecimal());
    }

    [Fact]
    public async Task Quotes_are_cached_for_a_minute()
    {
        var client = Client();
        var before = _factory.Yahoo.ChartCalls;
        await client.GetAsync("/quotes?symbols=CACHE.AS");
        await client.GetAsync("/quotes?symbols=CACHE.AS");
        Assert.Equal(before + 1, _factory.Yahoo.ChartCalls);
    }

    [Fact]
    public async Task Search_merges_stocks_and_coins_and_drops_noise()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Client().GetAsync("/quotes/search?q=a")).StatusCode);
        var payload = await Client().GetFromJsonAsync<JsonElement>("/quotes/search?q=asml");
        var stocks = payload.GetProperty("stocks").EnumerateArray().ToList();
        Assert.Single(stocks); // the OPTION hit is dropped
        Assert.Equal("ASML.AS", stocks[0].GetProperty("symbol").GetString());
        Assert.Single(payload.GetProperty("coins").EnumerateArray());
    }
}
