using System.Text;
using System.Text.Json;

namespace Munni.Api.Shopping;

/// <summary>
/// Pass-through proxy for the on-device store integrations (receipts
/// design): browsers can't call the store APIs directly (no CORS), so
/// the client sends its OWN token along and the request is forwarded
/// verbatim to an allowlisted host. The server stores nothing and logs
/// nothing; demo/offline identities never reach this endpoint at all.
/// </summary>
public static class StoreProxyEndpoints
{
    public const string HttpClientName = "storeproxy";

    // strict allowlist — a proxy without one is an open relay
    private static readonly Dictionary<string, Uri> Upstreams = new()
    {
        ["ah-api"] = new Uri("https://api.ah.nl"),      // NOSONAR(S1075) vendor API base
        ["ah-login"] = new Uri("https://login.ah.nl"),  // NOSONAR(S1075) vendor API base
        ["jumbo"] = new Uri("https://mobileapi.jumbo.com"), // NOSONAR(S1075) vendor API base
    };

    public sealed record ProxyRequest(string Path, string? Method, JsonElement? Body, string? Authorization, string? UserAgent);

    public static void MapStoreProxy(this IEndpointRouteBuilder app)
    {
        app.MapPost("/shop/proxy/{store}", async (string store, ProxyRequest request, HttpContext httpContext, IHttpClientFactory http, CancellationToken ct) =>
        {
            if (!Upstreams.TryGetValue(store, out var upstream)) return Results.NotFound();
            if (string.IsNullOrEmpty(request.Path) || !request.Path.StartsWith('/') || request.Path.Contains("..", StringComparison.Ordinal))
                return Results.BadRequest();
            var method = (request.Method ?? "GET").ToUpperInvariant();
            if (method is not ("GET" or "POST")) return Results.BadRequest();

            using var client = http.CreateClient(HttpClientName);
            using var upstreamRequest = BuildUpstreamRequest(request, method, upstream, store);
            try
            {
                using var response = await client.SendAsync(upstreamRequest, ct);
                var payload = await response.Content.ReadAsStringAsync(ct);
                // Jumbo's login answers with the session token in a header —
                // relay it (the CORS policy exposes it to the browser)
                if (response.Headers.TryGetValues("x-jumbo-token", out var jumboTokens))
                    httpContext.Response.Headers["x-jumbo-token"] = jumboTokens.First();
                return Results.Text(payload, "application/json", statusCode: (int)response.StatusCode);
            }
            catch (HttpRequestException)
            {
                return Results.StatusCode(StatusCodes.Status502BadGateway);
            }
            // Akamai-style bot protection (Jumbo) tarpits foreign clients:
            // the connection hangs until our client timeout. Surface it as
            // a gateway timeout instead of an unhandled 500.
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                return Results.StatusCode(StatusCodes.Status504GatewayTimeout);
            }
        }).RequireAuthorization();
    }

    private static HttpRequestMessage BuildUpstreamRequest(ProxyRequest request, string method, Uri upstream, string store)
    {
        var upstreamRequest = new HttpRequestMessage(new HttpMethod(method), new Uri(upstream, request.Path));
        if (!string.IsNullOrEmpty(request.Authorization))
        {
            upstreamRequest.Headers.TryAddWithoutValidation("Authorization", request.Authorization);
            // Jumbo's mobile API authenticates via its own header
            if (store == "jumbo")
                upstreamRequest.Headers.TryAddWithoutValidation("x-jumbo-token",
                    request.Authorization.Replace("Bearer ", "", StringComparison.Ordinal));
        }
        // store APIs gate on their mobile app's user agent
        upstreamRequest.Headers.TryAddWithoutValidation("User-Agent", string.IsNullOrEmpty(request.UserAgent) ? "Appie/8.22.3" : request.UserAgent);
        if (request.Body is { } body && method == "POST")
            upstreamRequest.Content = new StringContent(body.GetRawText(), Encoding.UTF8, "application/json");
        return upstreamRequest;
    }
}
