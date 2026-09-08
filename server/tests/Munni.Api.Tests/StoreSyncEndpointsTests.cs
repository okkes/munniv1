using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Munni.Api.Tests;

/// <summary>
/// E2EE store-connection sync (SC1): the server stores public keys,
/// wraps and ciphertext it cannot open — and never leaks them across
/// users. The crypto itself is client-side and tested in the web suite.
/// </summary>
public class StoreSyncEndpointsTests : IClassFixture<AdminApiFactory>
{
    private readonly AdminApiFactory _factory;

    public StoreSyncEndpointsTests(AdminApiFactory factory) => _factory = factory;

    private async Task<HttpClient> ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        await client.GetAsync("/me"); // materialize the user
        return client;
    }

    private static async Task<JsonElement> Json(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    [Fact]
    public async Task EnrollmentHandshake_RegisterWrapPoll()
    {
        var client = await ClientFor("sync-alice");
        // two devices register; the first one gets approved out-of-band
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/me/store-sync/devices", new { deviceId = "dev-a", publicJwk = "{jwk-a}", name = "iPhone" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/me/store-sync/devices", new { deviceId = "dev-b", publicJwk = "{jwk-b}", name = "Desktop" })).StatusCode);

        // the new device polls: nothing wrapped for it yet
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/me/store-sync/devices/dev-b/wrap")).StatusCode);

        // an enrolled device wraps the CSK to dev-b
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/me/store-sync/devices/dev-b/wrap", new { wrappedCsk = "wrapped-for-b" })).StatusCode);
        var wrap = await Json(await client.GetAsync("/me/store-sync/devices/dev-b/wrap"));
        Assert.Equal("wrapped-for-b", wrap.GetProperty("wrappedCsk").GetString());

        // the device list reports approval state
        var devices = await Json(await client.GetAsync("/me/store-sync/devices"));
        Assert.Equal(2, devices.GetArrayLength());
        Assert.Contains(devices.EnumerateArray(), d => d.GetProperty("deviceId").GetString() == "dev-b" && d.GetProperty("hasWrap").GetBoolean());
    }

    [Fact]
    public async Task ReinstallWithNewKey_InvalidatesTheOldWrap()
    {
        var client = await ClientFor("sync-bob");
        await client.PostAsJsonAsync("/me/store-sync/devices", new { deviceId = "dev-x", publicJwk = "{jwk-1}", name = "Phone" });
        await client.PostAsJsonAsync("/me/store-sync/devices/dev-x/wrap", new { wrappedCsk = "old-wrap" });
        // fresh install, fresh keypair — the stale wrap must die with it
        await client.PostAsJsonAsync("/me/store-sync/devices", new { deviceId = "dev-x", publicJwk = "{jwk-2}", name = "Phone" });
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/me/store-sync/devices/dev-x/wrap")).StatusCode);
    }

    [Fact]
    public async Task Ciphertext_RoundTrips_AndStaysPerUser()
    {
        var alice = await ClientFor("sync-carol");
        var mallory = await ClientFor("sync-mallory");
        await alice.PutAsJsonAsync("/me/store-sync/connections/ah", new { cipher = "opaque-blob" });

        var mine = await Json(await alice.GetAsync("/me/store-sync/connections"));
        Assert.Equal(1, mine.GetArrayLength());
        Assert.Equal("opaque-blob", mine[0].GetProperty("cipher").GetString());

        var theirs = await Json(await mallory.GetAsync("/me/store-sync/connections"));
        Assert.Equal(0, theirs.GetArrayLength());
    }

    [Fact]
    public async Task GlobalOff_ErasesEverything()
    {
        var client = await ClientFor("sync-dave");
        await client.PostAsJsonAsync("/me/store-sync/devices", new { deviceId = "dev-1", publicJwk = "{jwk}", name = "Phone" });
        await client.PutAsJsonAsync("/me/store-sync/connections/jumbo", new { cipher = "blob" });

        Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync("/me/store-sync")).StatusCode);
        Assert.Equal(0, (await Json(await client.GetAsync("/me/store-sync/devices"))).GetArrayLength());
        Assert.Equal(0, (await Json(await client.GetAsync("/me/store-sync/connections"))).GetArrayLength());
    }
}
