using Munni.Api.Data;

namespace Munni.Api.Push;

/// <summary>
/// Push transport registration, each enabled by its own config: VAPID
/// keys for the browsers, a Firebase service account for the native
/// shells (native-apps design N4). The routing sender delivers every
/// subscription through whichever transport its kind has.
/// </summary>
public static class PushSetup
{
    /// <summary>which push transports the running config enables (the /health flags).</summary>
    public readonly record struct PushCapabilities(bool WebPush, bool Fcm);

    public static PushCapabilities Register(IServiceCollection services, IConfiguration config)
    {
        var webPushEnabled = !string.IsNullOrEmpty(config["Push:VapidPublicKey"])
                             && !string.IsNullOrEmpty(config["Push:VapidPrivateKey"]);
        var fcmEnabled = IsValidFcmConfig(config["Fcm:ServiceAccountJson"]);

        if (fcmEnabled)
            services.AddHttpClient("fcm", client => client.BaseAddress = new Uri("https://fcm.googleapis.com/")); // NOSONAR(S1075) vendor API base
        if (webPushEnabled || fcmEnabled)
        {
            services.AddSingleton<IPushSender>(sp => new RoutingPushSender(
                webPushEnabled ? new WebPushSender(sp.GetRequiredService<IConfiguration>()) : null,
                fcmEnabled
                    ? new FcmPushSender(sp.GetRequiredService<IHttpClientFactory>().CreateClient("fcm"), sp.GetRequiredService<IConfiguration>())
                    : null));
        }
        services.AddScoped(sp => new PushNotifier(
            sp.GetRequiredService<AppDbContext>(),
            sp.GetService<IPushSender>() ?? new NoopPushSender(),
            sp.GetRequiredService<ILogger<PushNotifier>>()));
        return new PushCapabilities(webPushEnabled, fcmEnabled);
    }

    /// <summary>
    /// A truthy env value isn't enough — a malformed paste (missing the
    /// private_key/client_email/project_id) would crash the first send.
    /// /health only advertises FCM when the key would actually work.
    /// </summary>
    public static bool IsValidFcmConfig(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return false;
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            var root = doc.RootElement;
            return !string.IsNullOrEmpty(root.TryGetProperty("project_id", out var p) ? p.GetString() : null)
                && !string.IsNullOrEmpty(root.TryGetProperty("client_email", out var e) ? e.GetString() : null)
                && !string.IsNullOrEmpty(root.TryGetProperty("private_key", out var k) ? k.GetString() : null);
        }
        catch (System.Text.Json.JsonException)
        {
            return false;
        }
    }
}
