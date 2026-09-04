using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Munni.Api.Auth;

/// <summary>
/// Client-credentials session against the Logto Management API (M2M app).
/// Config: Logto:M2mAppId + Logto:M2mAppSecret; the endpoint derives from
/// Auth:Authority (…/oidc). Null when M2M is not configured — callers
/// degrade gracefully, exactly like account deletion does.
/// </summary>
public sealed record LogtoSession(HttpClient Http, string Endpoint, string AccessToken)
{
    public HttpRequestMessage Request(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, $"{Endpoint}{path}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken);
        return request;
    }
}

public static class LogtoManagement
{
    public static async Task<LogtoSession?> ConnectAsync(IHttpClientFactory httpFactory, IConfiguration config)
    {
        var appId = config["Logto:M2mAppId"];
        var appSecret = config["Logto:M2mAppSecret"];
        var authority = config["Auth:Authority"]; // https://logto.…/oidc
        if (string.IsNullOrEmpty(appId) || string.IsNullOrEmpty(appSecret) || string.IsNullOrEmpty(authority))
            return null;

        var endpoint = authority.TrimEnd('/');
        if (endpoint.EndsWith("/oidc")) endpoint = endpoint[..^"/oidc".Length];
        var http = httpFactory.CreateClient("logto-m2m");

        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, $"{endpoint}/oidc/token");
        tokenRequest.Headers.Authorization = new AuthenticationHeaderValue(
            "Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{appId}:{appSecret}")));
        tokenRequest.Content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "client_credentials",
            ["resource"] = "https://default.logto.app/api",
            ["scope"] = "all",
        });
        var tokenResponse = await http.SendAsync(tokenRequest);
        tokenResponse.EnsureSuccessStatusCode();
        using var tokenJson = JsonDocument.Parse(await tokenResponse.Content.ReadAsStringAsync());
        var accessToken = tokenJson.RootElement.GetProperty("access_token").GetString()
            ?? throw new InvalidOperationException("Logto token response without access_token");
        return new LogtoSession(http, endpoint, accessToken);
    }
}
