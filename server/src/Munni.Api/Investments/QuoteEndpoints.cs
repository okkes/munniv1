using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Munni.Api.Investments;

/// <summary>
/// Delayed-quote pass-through (approved investments design): Yahoo's
/// chart endpoint for stocks/ETFs, CoinGecko for crypto — both free,
/// both unofficial-but-stable, cached 60s server-side to stay a polite
/// citizen. Prices are a convenience, never stored: the client keeps
/// its own device cache and demo/offline identities never call this.
/// </summary>
public static class QuoteEndpoints
{
    public const string YahooClientName = "yahoo";
    public const string CoinGeckoClientName = "coingecko";
    private const int MaxKeys = 20;
    private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);

    public sealed record Quote(string Key, decimal Price, string Currency, decimal? DayChangePct);
    public sealed record StockHit(string Symbol, string Name, string? Exchange);
    public sealed record CoinHit(string Id, string Name, string Symbol);
    public sealed record SearchResult(IReadOnlyList<StockHit> Stocks, IReadOnlyList<CoinHit> Coins);

    public static void MapQuotes(this IEndpointRouteBuilder app)
    {
        app.MapGet("/quotes", async (string? symbols, string? coins, IHttpClientFactory http, IMemoryCache cache, CancellationToken ct) =>
        {
            var symbolList = Split(symbols);
            var coinList = Split(coins);
            if (symbolList.Count == 0 && coinList.Count == 0) return Results.BadRequest();

            var quotes = new List<Quote>();
            var yahooTasks = symbolList.Select(s => YahooQuoteAsync(http, cache, s, ct));
            quotes.AddRange((await Task.WhenAll(yahooTasks)).OfType<Quote>());
            quotes.AddRange(await CoinGeckoQuotesAsync(http, cache, coinList, ct));
            return Results.Ok(new { quotes });
        }).RequireAuthorization();

        app.MapGet("/quotes/search", async (string q, IHttpClientFactory http, CancellationToken ct) =>
        {
            var query = q.Trim();
            if (query.Length < 2 || query.Length > 50) return Results.BadRequest();
            var stocks = YahooSearchAsync(http, query, ct);
            var coinHits = CoinGeckoSearchAsync(http, query, ct);
            return Results.Ok(new SearchResult(await stocks, await coinHits));
        }).RequireAuthorization();
    }

    private static List<string> Split(string? csv) =>
        (csv ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(s => s.Length is > 0 and <= 30)
            .Distinct()
            .Take(MaxKeys)
            .ToList();

    private static async Task<Quote?> YahooQuoteAsync(IHttpClientFactory http, IMemoryCache cache, string symbol, CancellationToken ct)
    {
        var cacheKey = $"quote:yahoo:{symbol}";
        if (cache.TryGetValue(cacheKey, out Quote? cached)) return cached;
        try
        {
            using var client = http.CreateClient(YahooClientName);
            using var response = await client.GetAsync($"/v8/finance/chart/{Uri.EscapeDataString(symbol)}?interval=1d&range=1d", ct);
            if (!response.IsSuccessStatusCode) return null;
            using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            var meta = doc.RootElement.GetProperty("chart").GetProperty("result")[0].GetProperty("meta");
            var price = meta.GetProperty("regularMarketPrice").GetDecimal();
            var currency = meta.GetProperty("currency").GetString() ?? "USD";
            decimal? dayChange = null;
            if (meta.TryGetProperty("chartPreviousClose", out var prev) && prev.GetDecimal() > 0)
                dayChange = Math.Round((price / prev.GetDecimal() - 1m) * 100m, 2);
            var quote = new Quote($"yahoo:{symbol}", price, currency, dayChange);
            cache.Set(cacheKey, quote, CacheFor);
            return quote;
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or KeyNotFoundException or InvalidOperationException or IndexOutOfRangeException)
        {
            return null; // a dead symbol must not sink the batch
        }
    }

    private static async Task<List<Quote>> CoinGeckoQuotesAsync(IHttpClientFactory http, IMemoryCache cache, List<string> coins, CancellationToken ct)
    {
        var quotes = new List<Quote>();
        if (coins.Count == 0) return quotes;
        var missing = new List<string>();
        foreach (var coin in coins)
        {
            if (cache.TryGetValue($"quote:gecko:{coin}", out Quote? cached) && cached is not null) quotes.Add(cached);
            else missing.Add(coin);
        }
        if (missing.Count == 0) return quotes;
        try
        {
            using var client = http.CreateClient(CoinGeckoClientName);
            var ids = string.Join(',', missing.Select(Uri.EscapeDataString));
            using var response = await client.GetAsync($"/api/v3/simple/price?ids={ids}&vs_currencies=eur&include_24hr_change=true", ct);
            if (!response.IsSuccessStatusCode) return quotes;
            using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            CollectGeckoQuotes(doc, missing, cache, quotes);
        }
        catch (Exception e) when (e is HttpRequestException or JsonException)
        {
            // partial results beat none
        }
        return quotes;
    }

    private static void CollectGeckoQuotes(JsonDocument doc, List<string> missing, IMemoryCache cache, List<Quote> quotes)
    {
        foreach (var coin in missing)
        {
            if (!doc.RootElement.TryGetProperty(coin, out var entry) || !entry.TryGetProperty("eur", out var eur)) continue;
            decimal? change = entry.TryGetProperty("eur_24h_change", out var c) ? Math.Round(c.GetDecimal(), 2) : null;
            var quote = new Quote($"coingecko:{coin}", eur.GetDecimal(), "EUR", change);
            cache.Set($"quote:gecko:{coin}", quote, CacheFor);
            quotes.Add(quote);
        }
    }

    private static async Task<IReadOnlyList<StockHit>> YahooSearchAsync(IHttpClientFactory http, string query, CancellationToken ct)
    {
        try
        {
            using var client = http.CreateClient(YahooClientName);
            using var response = await client.GetAsync($"/v1/finance/search?q={Uri.EscapeDataString(query)}&quotesCount=8&newsCount=0", ct);
            if (!response.IsSuccessStatusCode) return [];
            using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            return MapYahooHits(doc);
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or KeyNotFoundException)
        {
            return [];
        }
    }

    private static List<StockHit> MapYahooHits(JsonDocument doc)
    {
        var hits = new List<StockHit>();
        foreach (var item in doc.RootElement.GetProperty("quotes").EnumerateArray())
        {
            var symbol = item.TryGetProperty("symbol", out var s) ? s.GetString() : null;
            var type = item.TryGetProperty("quoteType", out var qt) ? qt.GetString() : null;
            if (symbol is null || type is not ("EQUITY" or "ETF")) continue;
            var name = item.TryGetProperty("shortname", out var n) ? n.GetString() : null;
            var exchange = item.TryGetProperty("exchDisp", out var e) ? e.GetString() : null;
            hits.Add(new StockHit(symbol, name ?? symbol, exchange));
        }
        return hits;
    }

    private static async Task<IReadOnlyList<CoinHit>> CoinGeckoSearchAsync(IHttpClientFactory http, string query, CancellationToken ct)
    {
        try
        {
            using var client = http.CreateClient(CoinGeckoClientName);
            using var response = await client.GetAsync($"/api/v3/search?query={Uri.EscapeDataString(query)}", ct);
            if (!response.IsSuccessStatusCode) return [];
            using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            var hits = new List<CoinHit>();
            foreach (var coin in doc.RootElement.GetProperty("coins").EnumerateArray().Take(6))
            {
                var id = coin.TryGetProperty("id", out var i) ? i.GetString() : null;
                if (id is null) continue;
                hits.Add(new CoinHit(
                    id,
                    coin.TryGetProperty("name", out var n) ? n.GetString() ?? id : id,
                    coin.TryGetProperty("symbol", out var s) ? s.GetString() ?? "" : ""));
            }
            return hits;
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or KeyNotFoundException)
        {
            return [];
        }
    }
}
