using System.Net.Http.Json;
using System.Text.Json;
using Munni.Api.Sync;
using Xunit;

namespace Munni.Api.Tests;

public class SyncEventsTests : IClassFixture<SyncApiFactory>
{
    private readonly SyncApiFactory _factory;

    public SyncEventsTests(SyncApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    private static PushRequest Push(string spaceId, string device, string hlc) => new(device,
        [new SyncOpDto(Guid.NewGuid().ToString(), spaceId, "space", spaceId,
            new() { ["name"] = JsonSerializer.SerializeToElement("S") }, hlc)]);

    [Fact]
    public async Task Events_stream_announces_pushes_to_members_only()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var device = ClientFor($"sse-{suffix}");
        var stranger = ClientFor($"sse-stranger-{suffix}");
        var mySpace = $"space_sse_{suffix}";
        var strangerSpace = $"space_sse_other_{suffix}";

        // membership exists before the stream connects
        await device.PostAsJsonAsync($"/sync/{mySpace}/push", Push(mySpace, "devA", "000000100-0000-devA"));
        await stranger.PostAsJsonAsync($"/sync/{strangerSpace}/push", Push(strangerSpace, "devS", "000000100-0000-devS"));

        using var stream = await device.GetStreamAsync("/sync/events");
        using var reader = new StreamReader(stream);
        Assert.Equal(": connected", await reader.ReadLineAsync());

        // a change in someone else's space must NOT surface, ours must
        await stranger.PostAsJsonAsync($"/sync/{strangerSpace}/push", Push(strangerSpace, "devS", "000000200-0000-devS"));
        await device.PostAsJsonAsync($"/sync/{mySpace}/push", Push(mySpace, "devB", "000000200-0000-devB"));

        var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        string? dataLine = null;
        while (!cts.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(cts.Token);
            if (line is null) break;
            if (line.StartsWith("data:"))
            {
                dataLine = line;
                break;
            }
        }

        Assert.NotNull(dataLine);
        Assert.Contains(mySpace, dataLine);
        Assert.DoesNotContain(strangerSpace, dataLine);
    }
}
