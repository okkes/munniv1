using System.Threading.RateLimiting;
using Sentry.AspNetCore;
using FluentValidation;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;
using Munni.Api;
using Munni.Api.Accounts;
using Munni.Api.Auth;
using Munni.Api.Banking;
using Munni.Api.Data;
using Munni.Api.Admin;
using Munni.Api.GoCardless;
using Munni.Api.ImportWatch;
using Munni.Api.Investments;
using Munni.Api.Logos;
using Munni.Api.Rates;
using Munni.Api.Push;
using Munni.Api.Shopping;
using Munni.Api.Social;
using Munni.Api.Splits;
using Munni.Api.Sync;

var builder = WebApplication.CreateBuilder(args);

// GlitchTip: every unhandled exception + explicit CaptureException calls.
// Sentry__Dsn env feeds Sentry:Dsn; an empty DSN (local/dev) disables the
// SDK entirely — the compose file was already passing the DSN, but the
// SDK was never wired, so the API was invisible while prod broke.
builder.WebHost.UseSentry((SentryAspNetCoreOptions options) =>
{
    // explicit empty string = SDK disabled (unset would throw at boot)
    options.Dsn = builder.Configuration["Sentry:Dsn"] ?? string.Empty;
    options.TracesSampleRate = 0; // errors only, no performance tracing
    options.SendDefaultPii = false;
    // handled races are not incidents: parallel first requests DELIBERATELY
    // race their inserts (Users / UserDevices JIT-provision, attach links)
    // and the losers adopt the winner. EF still logs the failed command at
    // Error level and the SDK forwarded every one as an event — pure noise
    // that buried real failures (GlitchTip issues 66–74).
    options.SetBeforeSend((sentryEvent, _) => SentryNoise.IsHandledRace(sentryEvent) ? null : sentryEvent);
    // the SDK's failed-HTTP-request handler shipped every upstream 5xx
    // (GoCardless had a 502 hour → four events, GlitchTip 75–78) even
    // though the fetch loop handles them and retries next cycle. Real
    // failures still surface: unhandled exceptions and LogError paths.
    options.CaptureFailedRequests = false;
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Db")));

builder.Services.AddMemoryCache();
// request-body validators (Validation/Validators.cs) — UI input is never trusted
builder.Services.AddValidatorsFromAssemblyContaining<Program>(ServiceLifetime.Singleton);
// SSE fan-out for near-real-time sync
builder.Services.AddSingleton<SpaceEventBroadcaster>();

// OpenAPI document + Scalar reference UI at /scalar
builder.Services.AddOpenApi();

// push transports (VAPID browsers + FCM native shells), routed per kind
var pushCaps = PushSetup.Register(builder.Services, builder.Configuration);

// bank-data providers (admin-selectable for new consents)
var (gcConfigured, bankingEnabled) = BankingSetup.Register(builder.Services, builder.Configuration);

// watch-folder importer (user request): CAMT exports dropped into the
// mounted folder ingest as raw feed rows for the configured owner —
// the service exits immediately when ImportWatch:* is unconfigured
builder.Services.AddHostedService<WatchFolderService>();

// store pass-through proxy (receipts design): no secrets, always on —
// the client brings its own token; the allowlist lives in the endpoint
builder.Services.AddHttpClient(StoreProxyEndpoints.HttpClientName,
    client => client.Timeout = TimeSpan.FromSeconds(15));

// Logto Management API (account deletion): activates with Logto:M2m* config
builder.Services.AddHttpClient("logto-m2m", client => client.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddHttpClient("geo", client => client.Timeout = TimeSpan.FromSeconds(4));

// receipt OCR via the Tesseract sidecar — enabled when the container is configured
var ocrEnabled = !string.IsNullOrEmpty(builder.Configuration["Ocr:BaseUrl"]);
if (ocrEnabled)
{
    builder.Services.AddHttpClient(OcrEndpoints.HttpClientName, client =>
    {
        client.BaseAddress = new Uri(builder.Configuration["Ocr:BaseUrl"]!);
        client.Timeout = TimeSpan.FromSeconds(30);
    });
}

// delayed quotes for the portfolio: free vendors, no secrets, always on
builder.Services.AddHttpClient(QuoteEndpoints.YahooClientName, client =>
{
    client.BaseAddress = new Uri("https://query1.finance.yahoo.com"); // NOSONAR(S1075) vendor API base
    // Yahoo throttles default HttpClient agents
    client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) munni/1.0");
    client.Timeout = TimeSpan.FromSeconds(8);
});
builder.Services.AddHttpClient(QuoteEndpoints.CoinGeckoClientName, client =>
{
    client.BaseAddress = new Uri("https://api.coingecko.com"); // NOSONAR(S1075) vendor API base
    client.Timeout = TimeSpan.FromSeconds(8);
});

// ECB reference rates for display-currency conversion — free, no key
builder.Services.AddHttpClient(RatesEndpoints.EcbClientName, client =>
{
    client.BaseAddress = new Uri("https://www.ecb.europa.eu"); // NOSONAR(S1075) vendor API base
    // the full-history file is a few MB — allow it time on slow links
    client.Timeout = TimeSpan.FromSeconds(30);
});

// brand-logo search (logo.dev) — enabled when both keys are configured
var logosEnabled = !string.IsNullOrEmpty(builder.Configuration["Logos:SecretKey"])
                   && !string.IsNullOrEmpty(builder.Configuration["Logos:PublicToken"]);
if (logosEnabled)
{
    builder.Services.AddHttpClient(LogoEndpoints.HttpClientName, client =>
    {
        client.BaseAddress = new Uri("https://api.logo.dev/"); // NOSONAR(S1075) vendor API base
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", builder.Configuration["Logos:SecretKey"]);
        client.Timeout = TimeSpan.FromSeconds(5);
    });
}

if (builder.Configuration.GetValue<bool>("Auth:TestMode"))
{
    builder.Services
        .AddAuthentication(TestAuthHandler.SchemeName)
        .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, null);
}
else
{
    // Logto OIDC bearer (production: https://logto.<domain>/oidc)
    builder.Services
        .AddAuthentication("Bearer")
        .AddJwtBearer("Bearer", options =>
        {
            // keep original OIDC claim names — otherwise "sub" is renamed to
            // the legacy ClaimTypes.NameIdentifier and user resolution fails
            options.MapInboundClaims = false;
            options.Authority = builder.Configuration["Auth:Authority"];
            options.TokenValidationParameters.ValidAudience = builder.Configuration["Auth:Audience"];
            // local docker: browser sees localhost:3001 (issuer) but this
            // container must fetch metadata via the compose network
            var metadata = builder.Configuration["Auth:MetadataAddress"];
            if (!string.IsNullOrEmpty(metadata)) options.MetadataAddress = metadata;
            options.RequireHttpsMetadata = builder.Configuration.GetValue("Auth:RequireHttps", true);
        });
}
builder.Services.AddAuthorization();

var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    // x-jumbo-token: Jumbo hands its session token back in a response
    // header, which the store proxy relays and the browser must see
    p.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("x-jumbo-token")));

// abuse guard, partitioned per user (per IP before auth). The global
// bucket is sized for the sync engine polling every ten seconds across
// many spaces; the social-mutations policy throttles writes that reach
// OTHER people (invites, friend requests, role changes) much harder.
// Functional tests run with TestMode and get effectively-unlimited
// defaults unless a test sets RateLimits keys explicitly (RateLimitTests).
static string RateLimitKey(HttpContext http) =>
    http.User.FindFirst("sub")?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "anon";
var unlimitedForTests = builder.Configuration.GetValue<bool>("Auth:TestMode") ? int.MaxValue : (int?)null;
var globalTokens = builder.Configuration.GetValue<int?>("RateLimits:GlobalTokens") ?? unlimitedForTests ?? 600;
var globalRefillPer10S = builder.Configuration.GetValue<int?>("RateLimits:GlobalRefillPer10s") ?? unlimitedForTests ?? 60;
var socialPerMinute = builder.Configuration.GetValue<int?>("RateLimits:SocialPerMinute") ?? unlimitedForTests ?? 30;
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = (ctx, _) =>
    {
        ctx.HttpContext.Response.Headers.RetryAfter = "10";
        return ValueTask.CompletedTask;
    };
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
        RateLimitPartition.GetTokenBucketLimiter(RateLimitKey(http), _ => new TokenBucketRateLimiterOptions
        {
            TokenLimit = globalTokens, // burst headroom (bootstrap pulls, imports)
            TokensPerPeriod = globalRefillPer10S,
            ReplenishmentPeriod = TimeSpan.FromSeconds(10), // 60/10s = 360 requests/min sustained
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy(Munni.Api.Social.SocialEndpoints.MutationsPolicy, http =>
        RateLimitPartition.GetFixedWindowLimiter(RateLimitKey(http), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = socialPerMinute,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));
});

var app = builder.Build();

if (app.Configuration.GetValue<bool>("Db:AutoMigrate"))
{
    using var scope = app.Services.CreateScope();
    // real migrations: schema evolves in place across releases
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

// handled errors keep their CORS headers — unhandled exceptions wipe the
// response and the browser misreports them as CORS failures
app.UseExceptionHandler(errorApp => errorApp.Run(async http =>
{
    http.Response.StatusCode = 500;
    await http.Response.WriteAsJsonAsync(new { error = "internal error" });
}));

app.UseCors();
app.UseAuthentication();
// after authentication so the partition key is the OIDC sub, not the IP
app.UseRateLimiter();
app.UseAuthorization();
app.Use(async (http, next) =>
{
    var db = http.RequestServices.GetRequiredService<AppDbContext>();
    await UserResolution.ResolveUser(http, db, () => next(http));
});

// interactive API reference (Scalar) backed by the generated OpenAPI doc
app.MapOpenApi();
app.MapScalarApiReference(options => options.WithTitle("munni API"));

// capabilities.gocardless stays the client's "bank connect available"
// signal, whichever provider actually serves it
var gcEnabled = bankingEnabled;
app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    build = Environment.GetEnvironmentVariable("BUILD_NUMBER") ?? "dev",
    // version handshake (apps/web/src/lib/protocol.ts owns the bump
    // discipline): native apps deploy on their own cadence — clients
    // compare BOTH directions before syncing and refuse a mismatch
    protocol = ApiProtocol.Version,
    minClientProtocol = ApiProtocol.MinClient,
    capabilities = new
    {
        gocardless = gcEnabled,
        testAuth = app.Configuration.GetValue<bool>("Auth:TestMode"),
        push = pushCaps.WebPush,
        fcm = pushCaps.Fcm,
        vapidPublicKey = app.Configuration["Push:VapidPublicKey"] ?? "",
        logos = logosEnabled,
        shopProxy = true,
        ocr = ocrEnabled,
        quotes = true,
    },
}));
app.MapSync();
app.MapDevices();
app.MapSocial();
app.MapSplits();
app.MapPush();
app.MapLogos(app.Configuration);
app.MapStoreProxy();
if (ocrEnabled) app.MapOcr();
app.MapQuotes();
app.MapRates();
app.MapAccounts();
app.MapAdmin(gcConfigured, bankingEnabled);
app.MapControl(gcConfigured, bankingEnabled);
app.MapCatalog();
app.MapStoreSync();
if (bankingEnabled) app.MapGoCardless();

await app.RunAsync();
