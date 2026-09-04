using Munni.Api.Admin;
using Munni.Api.GoCardless;

namespace Munni.Api.Banking;

/// <summary>
/// DI wiring for the bank-data providers: the admin picks which one
/// serves NEW consents; existing accounts keep fetching through the
/// provider that created them.
/// </summary>
public static class BankingSetup
{
    public static (bool GcConfigured, bool AnyConfigured) Register(IServiceCollection services, IConfiguration config)
    {
        var gcConfigured = !string.IsNullOrEmpty(config["GoCardless:SecretId"]);
        if (gcConfigured)
        {
            // fixed vendor endpoint, overridable for tests/self-hosted proxies
            var gcBaseUrl = config["GoCardless:BaseUrl"] ?? "https://bankaccountdata.gocardless.com/api/v2/"; // NOSONAR(S1075) vendor API base
            services.AddHttpClient<IGoCardlessApi, GoCardlessApi>(client => client.BaseAddress = new Uri(gcBaseUrl))
                // the admin console reads quota from these captured headers (AD3)
                .AddHttpMessageHandler(sp => new QuotaCaptureHandler(sp.GetRequiredService<IServiceScopeFactory>(), "gocardless"));
            services.AddScoped<IBankDataApi>(sp => new GoCardlessBankApi(sp.GetRequiredService<IGoCardlessApi>()));
        }
        var ebConfigured = !string.IsNullOrEmpty(config["EnableBanking:ApplicationId"]) &&
                           !string.IsNullOrEmpty(config["EnableBanking:PrivateKeyPem"]);
        if (ebConfigured)
        {
            var ebBaseUrl = config["EnableBanking:BaseUrl"] ?? "https://api.enablebanking.com/"; // NOSONAR(S1075) vendor API base
            services.AddHttpClient<EnableBankingApi>(client => client.BaseAddress = new Uri(ebBaseUrl));
            services.AddScoped<IBankDataApi>(sp => sp.GetRequiredService<EnableBankingApi>());
        }
        var anyConfigured = gcConfigured || ebConfigured;
        if (anyConfigured)
        {
            services.AddScoped<BankProviderRegistry>();
            services.AddHostedService<GcFetchService>();
        }
        return (gcConfigured, anyConfigured);
    }
}

/// <summary>
/// The configured bank-data providers. #175 (user): BOTH providers are
/// offered to the end user at connect time, so the admin's "active
/// provider" toggle retired — the DEFAULT (registration order, i.e.
/// GoCardless when configured) only serves clients that don't name one.
/// Existing linked accounts always keep fetching through the provider
/// that created them.
/// </summary>
public sealed class BankProviderRegistry
{
    private readonly Dictionary<string, IBankDataApi> _byId;

    public BankProviderRegistry(IEnumerable<IBankDataApi> providers)
    {
        _byId = providers.ToDictionary(p => p.ProviderId);
    }

    public bool Any => _byId.Count > 0;
    public IReadOnlyCollection<string> ConfiguredIds => _byId.Keys;

    /// <summary>the provider that created a row — unknown/legacy falls back to the default (first configured)</summary>
    public IBankDataApi For(string? providerId) =>
        providerId is not null && _byId.TryGetValue(providerId, out var api) ? api : _byId.Values.First();
}
