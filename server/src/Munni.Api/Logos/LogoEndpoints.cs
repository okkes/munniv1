using System.Text.Json;
using System.Text.Json.Serialization;

namespace Munni.Api.Logos;

public sealed record LogoResult(string Name, string Domain, string LogoUrl);

/// <summary>
/// Brand-logo search for recurring costs, proxied through the API so the
/// logo.dev secret key never reaches a client. Images are served straight
/// from img.logo.dev with the publishable token baked into the returned
/// URLs. Only mapped when both keys are configured; the vendored
/// simpleicons set remains the offline fallback either way.
/// </summary>
public static class LogoEndpoints
{
    public const string HttpClientName = "logodev";

    private sealed record SearchHit(
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("domain")] string? Domain);

    public static void MapLogos(this IEndpointRouteBuilder app, IConfiguration config)
    {
        var publicToken = config["Logos:PublicToken"];
        var secretKey = config["Logos:SecretKey"];

        // diagnosis endpoint (user request: "is my logo config right?") —
        // mapped even when unconfigured so the verdict is always reachable
        app.MapGet("/logos/health", (IHttpClientFactory http, CancellationToken ct) =>
            LogoHealthAsync(http, secretKey, publicToken, ct)).RequireAuthorization();

        if (string.IsNullOrEmpty(secretKey) || string.IsNullOrEmpty(publicToken)) return;

        // the two keys are easy to swap: search auth needs the SECRET key
        // (sk_…); image URLs carry the PUBLISHABLE key (pk_…). A swap
        // fails silently upstream (401 → empty results), so refuse loudly.
        var log = app.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Logos");
        if (secretKey.StartsWith("pk_", StringComparison.Ordinal))
            log.LogError("LOGODEV_SECRET_KEY looks like a publishable key (pk_…) — use the SECRET key (sk_…) from logo.dev's Manage Keys; searches will return nothing");
        if (publicToken.StartsWith("sk_", StringComparison.Ordinal))
            log.LogError("LOGODEV_PUBLIC_TOKEN looks like a secret key (sk_…) — use the publishable key (pk_…); it is embedded in image URLs sent to clients");

        app.MapGet("/logos/search", async (string q, IHttpClientFactory http, CancellationToken ct) =>
        {
            var query = q.Trim();
            if (query.Length < 2 || query.Length > 50) return Results.BadRequest();

            using var client = http.CreateClient(HttpClientName);
            using var response = await client.GetAsync($"search?q={Uri.EscapeDataString(query)}", ct);
            if (!response.IsSuccessStatusCode) return Results.Ok(Array.Empty<LogoResult>());

            var hits = await JsonSerializer.DeserializeAsync<List<SearchHit>>(
                await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct) ?? [];
            var results = hits
                .Where(h => !string.IsNullOrEmpty(h.Domain))
                .Take(12)
                .Select(h => new LogoResult(
                    h.Name ?? h.Domain!,
                    h.Domain!,
                    $"https://img.logo.dev/{h.Domain}?token={publicToken}&size=64&format=png&retina=true"))
                .ToList();
            return Results.Ok(results);
        }).RequireAuthorization();
    }

    /// <summary>One live canary search + a pk_/sk_ swap check.</summary>
    private static async Task<IResult> LogoHealthAsync(
        IHttpClientFactory http, string? secretKey, string? publicToken, CancellationToken ct)
    {
        var configured = !string.IsNullOrEmpty(secretKey) && !string.IsNullOrEmpty(publicToken);
        var secretLooksSwapped = secretKey?.StartsWith("pk_", StringComparison.Ordinal) == true;
        var publicLooksSwapped = publicToken?.StartsWith("sk_", StringComparison.Ordinal) == true;
        var search = configured
            ? await CanarySearchAsync(http, ct)
            : "unconfigured — set LOGODEV_SECRET_KEY (sk_…) and LOGODEV_PUBLIC_TOKEN (pk_…)";
        return Results.Ok(new { configured, search, secretLooksSwapped, publicLooksSwapped });
    }

    private static async Task<string> CanarySearchAsync(IHttpClientFactory http, CancellationToken ct)
    {
        using var client = http.CreateClient(HttpClientName);
        using var response = await client.GetAsync("search?q=netflix", ct);
        if (response.IsSuccessStatusCode) return "ok";
        if (response.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
            return "unauthorized — the SECRET key is wrong (or the pk_/sk_ keys are swapped)";
        return $"upstream error {(int)response.StatusCode}";
    }
}
