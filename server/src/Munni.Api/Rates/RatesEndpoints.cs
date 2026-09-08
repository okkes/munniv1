using System.Globalization;
using System.Xml.Linq;
using Microsoft.Extensions.Caching.Memory;

namespace Munni.Api.Rates;

/// <summary>
/// FX reference rates for display-currency conversion (currency plan
/// CD1): the ECB daily reference XML — free, no key, ~30 currencies,
/// EUR-based. Never used for bookkeeping: raw amounts keep their own
/// currency, the client converts at render time and marks results ≈.
/// Three vendor files, coarsest first: the daily file for "latest", the
/// 90-day history for recent transaction dates, the full history as the
/// fallback for anything older. Each parse is cached server-side so a
/// fleet of clients costs the ECB one download per window.
/// </summary>
public static class RatesEndpoints
{
    public const string EcbClientName = "ecb";
    private static readonly TimeSpan DailyCacheFor = TimeSpan.FromHours(1);
    private static readonly TimeSpan HistoryCacheFor = TimeSpan.FromHours(6);
    private static readonly TimeSpan FullHistoryCacheFor = TimeSpan.FromHours(24);

    public sealed record DayRates(string Date, string Base, IReadOnlyDictionary<string, decimal> Rates);

    public static void MapRates(this IEndpointRouteBuilder app)
    {
        app.MapGet("/rates", async (string? date, IHttpClientFactory http, IMemoryCache cache, CancellationToken ct) =>
        {
            if (date is null)
            {
                var latest = await LatestAsync(http, cache, ct);
                return latest is null ? Results.StatusCode(StatusCodes.Status502BadGateway) : Results.Ok(latest);
            }

            if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
                return Results.BadRequest();

            // rates for a day = the last ECB fixing ON OR BEFORE it
            // (weekends/holidays have no fixing; future dates get the
            // newest known — a skewed client clock must not 404)
            var recent = await HistoryAsync(http, cache, "rates:hist90", "/stats/eurofxref/eurofxref-hist-90d.xml", HistoryCacheFor, ct);
            var hit = Lookup(recent, day);
            if (hit is null && recent is { Count: > 0 } && day < recent[^1].DayOnly)
            {
                var full = await HistoryAsync(http, cache, "rates:histfull", "/stats/eurofxref/eurofxref-hist.xml", FullHistoryCacheFor, ct);
                hit = Lookup(full, day);
            }
            if (hit is not null) return Results.Ok(hit.ToDayRates());
            return recent is null ? Results.StatusCode(StatusCodes.Status502BadGateway) : Results.NotFound();
        }).RequireAuthorization();
    }

    private sealed record ParsedDay(string Date, DateOnly DayOnly, Dictionary<string, decimal> Rates)
    {
        public DayRates ToDayRates() => new(Date, "EUR", Rates);
    }

    /// <summary>newest fixing on or before the requested day (list is newest-first)</summary>
    private static ParsedDay? Lookup(List<ParsedDay>? days, DateOnly day) =>
        days?.FirstOrDefault(d => d.DayOnly <= day);

    private static async Task<DayRates?> LatestAsync(IHttpClientFactory http, IMemoryCache cache, CancellationToken ct)
    {
        if (cache.TryGetValue("rates:daily", out DayRates? cached)) return cached;
        var days = await FetchAsync(http, "/stats/eurofxref/eurofxref-daily.xml", ct);
        var latest = days?.FirstOrDefault()?.ToDayRates();
        if (latest is not null) cache.Set("rates:daily", latest, DailyCacheFor);
        return latest;
    }

    private static async Task<List<ParsedDay>?> HistoryAsync(
        IHttpClientFactory http, IMemoryCache cache, string key, string path, TimeSpan cacheFor, CancellationToken ct)
    {
        if (cache.TryGetValue(key, out List<ParsedDay>? cached)) return cached;
        var days = await FetchAsync(http, path, ct);
        if (days is not null) cache.Set(key, days, cacheFor);
        return days;
    }

    private static async Task<List<ParsedDay>?> FetchAsync(IHttpClientFactory http, string path, CancellationToken ct)
    {
        try
        {
            using var client = http.CreateClient(EcbClientName);
            using var response = await client.GetAsync(path, ct);
            if (!response.IsSuccessStatusCode) return null;
            var doc = XDocument.Load(await response.Content.ReadAsStreamAsync(ct));
            // namespace-agnostic: <Cube time="…"><Cube currency="…" rate="…"/></Cube>
            var days = doc.Descendants()
                .Where(e => e.Name.LocalName == "Cube" && e.Attribute("time") is not null)
                .Select(ParseDayCube)
                .OfType<ParsedDay>()
                .ToList();
            days.Sort((a, b) => b.DayOnly.CompareTo(a.DayOnly)); // newest first
            return days.Count > 0 ? days : null;
        }
        catch (Exception e) when (e is HttpRequestException or System.Xml.XmlException or TaskCanceledException)
        {
            return null; // vendor down → 502/404 upstream, client keeps its cache
        }
    }

    private static ParsedDay? ParseDayCube(XElement dayCube)
    {
        var time = dayCube.Attribute("time")!.Value;
        if (!DateOnly.TryParseExact(time, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dayOnly)) return null;
        // EUR itself rides along at 1.0 so clients convert any pair
        var rates = new Dictionary<string, decimal> { ["EUR"] = 1m };
        foreach (var rateCube in dayCube.Elements().Where(e => e.Name.LocalName == "Cube"))
        {
            var currency = rateCube.Attribute("currency")?.Value;
            var rate = rateCube.Attribute("rate")?.Value;
            if (currency is null || rate is null) continue;
            if (decimal.TryParse(rate, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) && parsed > 0)
                rates[currency] = parsed;
        }
        return rates.Count > 1 ? new ParsedDay(time, dayOnly, rates) : null;
    }
}
