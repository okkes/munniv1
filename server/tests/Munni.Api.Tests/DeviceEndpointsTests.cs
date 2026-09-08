using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Munni.Api.Auth;
using Munni.Api.Data;
using Xunit;

namespace Munni.Api.Tests;

public class DevicesApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
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
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("device-tests"));
        });
    }
}

/// <summary>
/// Logged-in devices: stamping on authenticated requests, list/rename,
/// and the remote-disconnect contract (revoked device → 410, so the
/// client wipes itself — 403 would read as a lost space membership).
/// </summary>
public class DeviceEndpointsTests : IClassFixture<DevicesApiFactory>
{
    private readonly DevicesApiFactory _factory;

    public DeviceEndpointsTests(DevicesApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub, string? deviceId = null, string? platform = null)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        if (deviceId is not null) client.DefaultRequestHeaders.Add("X-Munni-Device", deviceId);
        if (platform is not null) client.DefaultRequestHeaders.Add("X-Munni-Platform", platform);
        return client;
    }

    [Fact]
    public async Task Requests_stamp_the_calling_device_and_the_list_shows_it()
    {
        var sub = $"dev_{Guid.NewGuid():N}";
        var phone = ClientFor(sub, "phone-1", "android");
        var devices = await phone.GetFromJsonAsync<List<DeviceDto>>("/me/devices");
        Assert.Contains(devices!, d => d.Id == "phone-1" && d.Platform == "android" && !d.Revoked);
    }

    [Fact]
    public async Task Renaming_persists_and_legacy_clients_without_the_header_still_work()
    {
        var sub = $"dev_{Guid.NewGuid():N}";
        var phone = ClientFor(sub, "phone-2", "ios");
        await phone.GetAsync("/me/devices"); // stamps the row

        var rename = await phone.PatchAsJsonAsync("/me/devices/phone-2", new RenameDeviceRequest("Okkes' iPhone"));
        Assert.Equal(HttpStatusCode.OK, rename.StatusCode);
        var devices = await phone.GetFromJsonAsync<List<DeviceDto>>("/me/devices");
        Assert.Contains(devices!, d => d.Id == "phone-2" && d.Name == "Okkes' iPhone");

        // a client that never sends the header is simply not enforced
        var legacy = ClientFor(sub);
        Assert.Equal(HttpStatusCode.OK, (await legacy.GetAsync("/me/devices")).StatusCode);
    }

    [Fact]
    public async Task A_revoked_device_gets_410_on_its_next_request_and_others_keep_working()
    {
        var sub = $"dev_{Guid.NewGuid():N}";
        var phone = ClientFor(sub, "phone-3", "android");
        var laptop = ClientFor(sub, "laptop-3", "web");
        await phone.GetAsync("/me/devices");
        await laptop.GetAsync("/me/devices");

        // the laptop disconnects the phone
        Assert.Equal(HttpStatusCode.OK, (await laptop.PostAsync("/me/devices/phone-3/revoke", null)).StatusCode);

        var refused = await phone.GetAsync("/me/devices");
        Assert.Equal(HttpStatusCode.Gone, refused.StatusCode);
        Assert.Contains("device-revoked", await refused.Content.ReadAsStringAsync());

        // the laptop is untouched and sees the phone marked revoked
        var devices = await laptop.GetFromJsonAsync<List<DeviceDto>>("/me/devices");
        Assert.Contains(devices!, d => d.Id == "phone-3" && d.Revoked);
        // revoking an unknown device 404s
        Assert.Equal(HttpStatusCode.NotFound, (await laptop.PostAsync("/me/devices/ghost/revoke", null)).StatusCode);
    }
}
