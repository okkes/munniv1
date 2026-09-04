using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Data;
using Munni.Api.Shopping;

namespace Munni.Api.Tests;

/// <summary>Records the forwarded request; scripts upstream responses per path.</summary>
internal sealed class FakeStoreHandler : HttpMessageHandler
{
    public HttpRequestMessage? Last;
    public string? LastBody;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Last = request;
        LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
        if (request.RequestUri!.AbsolutePath == "/tarpit")
            throw new TaskCanceledException("simulated bot-protection hang");
        if (request.RequestUri!.AbsolutePath == "/fail401")
            return new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("""{"error":"expired"}""", Encoding.UTF8, "application/json") };
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"receipts":[{"transactionId":"t1"}]}""", Encoding.UTF8, "application/json"),
        };
    }
}

file sealed class FakeTesseractHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
        Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"data":{"exit":{"code":0},"stdout":"AH BANANEN 1,89\nTOTAAL 1,89"}}""", Encoding.UTF8, "application/json"),
        });
}

public class ShoppingApiFactory : WebApplicationFactory<Program>
{
    internal FakeStoreHandler Store { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Auth:TestMode", "true");
        builder.UseSetting("Db:AutoMigrate", "false");
        builder.UseSetting("Ocr:BaseUrl", "http://ocr:8884");
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
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("shopping-endpoint-tests"));
            services.AddHttpClient(StoreProxyEndpoints.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => Store);
            services.AddHttpClient(OcrEndpoints.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => new FakeTesseractHandler());
        });
    }
}

public class ShoppingEndpointsTests : IClassFixture<ShoppingApiFactory>
{
    private readonly ShoppingApiFactory _factory;

    public ShoppingEndpointsTests(ShoppingApiFactory factory) => _factory = factory;

    private HttpClient Client()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", "shopper");
        return client;
    }

    [Fact]
    public async Task Proxy_requires_auth_and_an_allowlisted_store()
    {
        var anonymous = _factory.CreateClient();
        var denied = await anonymous.PostAsJsonAsync("/shop/proxy/ah-api", new { path = "/x" });
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);

        var client = Client();
        var unknown = await client.PostAsJsonAsync("/shop/proxy/evil-relay", new { path = "/x" });
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
    }

    [Fact]
    public async Task Proxy_rejects_bad_paths_and_methods()
    {
        var client = Client();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/shop/proxy/ah-api", new { path = "no-slash" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/shop/proxy/ah-api", new { path = "/a/../b" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/shop/proxy/ah-api", new { path = "/x", method = "DELETE" })).StatusCode);
    }

    [Fact]
    public async Task Proxy_forwards_token_and_body_and_passes_the_answer_through()
    {
        var client = Client();
        var response = await client.PostAsJsonAsync("/shop/proxy/ah-api", new
        {
            path = "/mobile-services/v2/receipts",
            method = "POST",
            authorization = "Bearer store-token",
            body = new { clientId = "appie" },
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("t1", await response.Content.ReadAsStringAsync());

        var forwarded = _factory.Store.Last!;
        Assert.Equal("api.ah.nl", forwarded.RequestUri!.Host);
        Assert.Equal("/mobile-services/v2/receipts", forwarded.RequestUri.AbsolutePath);
        Assert.Equal("Bearer store-token", forwarded.Headers.GetValues("Authorization").Single());
        Assert.Contains("appie", _factory.Store.LastBody);
    }

    [Fact]
    public async Task Proxy_passes_upstream_errors_through_untouched()
    {
        var client = Client();
        var response = await client.PostAsJsonAsync("/shop/proxy/ah-api", new { path = "/fail401" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("expired", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Proxy_surfaces_an_upstream_hang_as_gateway_timeout()
    {
        // Jumbo's edge tarpits non-app clients: the request never answers
        // and the HttpClient timeout cancels it — 504, never a raw 500
        var client = Client();
        var response = await client.PostAsJsonAsync("/shop/proxy/jumbo", new { path = "/tarpit", method = "POST", body = new { username = "x" } });
        Assert.Equal(HttpStatusCode.GatewayTimeout, response.StatusCode);
    }

    [Fact]
    public async Task Ocr_validates_the_image_and_returns_the_text()
    {
        var client = Client();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/ocr/receipt", new { image = "not-a-data-url" })).StatusCode);

        var fake = "data:image/jpeg;base64," + Convert.ToBase64String(Encoding.UTF8.GetBytes("jpg"));
        var response = await client.PostAsJsonAsync("/ocr/receipt", new { image = fake });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("BANANEN", payload.GetProperty("text").GetString());
    }

    [Fact]
    public async Task Health_advertises_the_shopping_capabilities()
    {
        var health = await _factory.CreateClient().GetFromJsonAsync<JsonElement>("/health");
        var capabilities = health.GetProperty("capabilities");
        Assert.True(capabilities.GetProperty("shopProxy").GetBoolean());
        Assert.True(capabilities.GetProperty("ocr").GetBoolean());
    }
}
