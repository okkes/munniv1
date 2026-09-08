using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Munni.Api.Tests;

/// <summary>
/// Admin catalog (AC1): a versioned content document — public read with
/// ETag caching, admin-gated publish, server-owned version counter.
/// </summary>
public class CatalogEndpointsTests : IClassFixture<AdminApiFactory>
{
    private readonly AdminApiFactory _factory;

    public CatalogEndpointsTests(AdminApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string? sub)
    {
        var client = _factory.CreateClient();
        if (sub is not null) client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    private static object Payload(string keyword = "padel") => new
    {
        categories = new[] { new { id = "groceries", en = "Groceries", nl = "Boodschappen", tr = "Market" } },
        keywords = new[] { new { keyword, catId = "hobby" } },
    };

    [Fact]
    public async Task NoDocumentYet_ReadIsNoContent()
    {
        var response = await ClientFor(null).GetAsync("/catalog");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task NonAdmin_CannotPublish()
    {
        var client = ClientFor("plain-user");
        await client.GetAsync("/me"); // materialize the user row
        var response = await client.PutAsJsonAsync("/admin/catalog", Payload());
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Publish_BumpsVersion_AndServesWithEtag()
    {
        var admin = ClientFor("the-admin");
        await admin.GetAsync("/me");
        var first = await admin.PutAsJsonAsync("/admin/catalog", Payload());
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var second = await admin.PutAsJsonAsync("/admin/catalog", Payload("tennis"));
        var v2 = JsonDocument.Parse(await second.Content.ReadAsStringAsync()).RootElement.GetProperty("version").GetInt32();

        var read = await ClientFor(null).GetAsync("/catalog");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        var etag = read.Headers.ETag!.Tag;
        Assert.Contains($"catalog-v{v2}", etag);
        var doc = JsonDocument.Parse(await read.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(v2, doc.GetProperty("version").GetInt32());
        Assert.Equal("tennis", doc.GetProperty("keywords")[0].GetProperty("keyword").GetString());

        // a fresh device revalidates for free
        var cached = ClientFor(null);
        cached.DefaultRequestHeaders.TryAddWithoutValidation("If-None-Match", etag);
        var revalidated = await cached.GetAsync("/catalog");
        Assert.Equal(HttpStatusCode.NotModified, revalidated.StatusCode);
    }

    [Fact]
    public async Task Publish_RejectsNonArrays()
    {
        var admin = ClientFor("the-admin");
        await admin.GetAsync("/me");
        var response = await admin.PutAsJsonAsync("/admin/catalog", new { categories = "nope", keywords = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static readonly string[] AhPatterns = ["albert heijn", "AH to go"];

    [Fact]
    public async Task Publish_RoundTrips_StorePatterns_AndDefaultsThemEmpty()
    {
        var admin = ClientFor("the-admin");
        await admin.GetAsync("/me");
        // an older console publishing WITHOUT stores keeps working
        var legacy = await admin.PutAsJsonAsync("/admin/catalog", new { categories = Array.Empty<object>(), keywords = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
        var read1 = JsonDocument.Parse(await (await ClientFor(null).GetAsync("/catalog")).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(0, read1.GetProperty("stores").GetArrayLength());

        // receipts v3 R9: patterns publish and serve verbatim
        var withStores = await admin.PutAsJsonAsync("/admin/catalog", new
        {
            categories = Array.Empty<object>(),
            keywords = Array.Empty<object>(),
            stores = new[] { new { id = "ah", patterns = AhPatterns } },
        });
        Assert.Equal(HttpStatusCode.OK, withStores.StatusCode);
        var read2 = JsonDocument.Parse(await (await ClientFor(null).GetAsync("/catalog")).Content.ReadAsStringAsync()).RootElement;
        var store = read2.GetProperty("stores")[0];
        Assert.Equal("ah", store.GetProperty("id").GetString());
        Assert.Equal(2, store.GetProperty("patterns").GetArrayLength());
    }
}
