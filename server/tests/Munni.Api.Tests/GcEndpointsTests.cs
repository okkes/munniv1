using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Munni.Api.Data;
using Munni.Api.GoCardless;
using Munni.Api.Logos;
using Munni.Api.Social;

namespace Munni.Api.Tests;

/// <summary>Scriptable IGoCardlessApi — records calls, returns canned data.</summary>
public sealed class FakeGoCardlessApi : IGoCardlessApi
{
    public int InstitutionCalls;
    public List<string> DeletedRequisitions { get; } = [];
    public GcRequisitionStatus Status { get; set; } = new("gc-req-1", "LN", ["gc-acc-1"]);
    public GcAccountDetails Details { get; set; } = new("NL69INGB0123456789", "Betaalrekening", "EUR");

    public Task<IReadOnlyList<GcInstitution>> GetInstitutionsAsync(string country, CancellationToken ct = default)
    {
        InstitutionCalls++;
        return Task.FromResult<IReadOnlyList<GcInstitution>>([new GcInstitution("ING_NL", "ING", "INGBNL2A", "730", "https://cdn.example.test/ing.png")]);
    }

    public Task<GcRequisitionCreated> CreateRequisitionAsync(string institutionId, string redirect, string reference, CancellationToken ct = default) =>
        Task.FromResult(new GcRequisitionCreated("gc-req-1", $"https://gc.example/authorize/{reference}", "CR"));

    public Task<GcRequisitionStatus> GetRequisitionAsync(string requisitionId, CancellationToken ct = default) =>
        Task.FromResult(Status);

    public List<GcRequisitionListItem> RemoteRequisitions { get; set; } = [];

    public Task<IReadOnlyList<GcRequisitionListItem>> ListRequisitionsAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<GcRequisitionListItem>>(RemoteRequisitions);

    public Task DeleteRequisitionAsync(string requisitionId, CancellationToken ct = default)
    {
        DeletedRequisitions.Add(requisitionId);
        return Task.CompletedTask;
    }

    /// <summary>while &gt; 0, details calls throw 429 (per-account daily budget spent)</summary>
    public int Details429Remaining;

    /// <summary>while &gt; 0, balances/transactions calls throw 429</summary>
    public int Data429Remaining;

    private static HttpRequestException Quota429() =>
        new("429 Too Many Requests", null, HttpStatusCode.TooManyRequests);

    public Task<GcAccountDetails> GetAccountDetailsAsync(string gcAccountId, CancellationToken ct = default)
    {
        if (Details429Remaining > 0)
        {
            Details429Remaining--;
            throw Quota429();
        }
        return Task.FromResult(Details);
    }

    public Task<IReadOnlyList<GcBalance>> GetBalancesAsync(string gcAccountId, CancellationToken ct = default)
    {
        if (Data429Remaining > 0)
        {
            Data429Remaining--;
            throw Quota429();
        }
        return Task.FromResult<IReadOnlyList<GcBalance>>([new GcBalance(new GcAmount("1234.56", "EUR"), "closingBooked")]);
    }

    public List<DateOnly?> TransactionFroms { get; } = [];
    public List<GcTransaction> Pending { get; set; } = [];
    public GcRateInfo? Rate { get; set; }

    public Task<GcTransactionsPage> GetTransactionsAsync(string gcAccountId, DateOnly? from, CancellationToken ct = default)
    {
        TransactionFroms.Add(from);
        return Task.FromResult(new GcTransactionsPage(
            [new GcTransaction("BANKREF-1", null, "2026-07-05", null, new GcAmount("-42.10", "EUR"), "Albert Heijn", null, "AH 1350")],
            Pending,
            Rate));
    }
}

/// <summary>logo.dev search stub for the named HttpClient.</summary>
file sealed class FakeLogoHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var q = System.Web.HttpUtility.ParseQueryString(request.RequestUri!.Query)["q"];
        if (q == "boom") return Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadGateway));
        var body = """[{"name":"Netflix","domain":"netflix.com"},{"name":"NoDomain","domain":null}]""";
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        });
    }
}

/// <summary>Factory with GoCardless + logo.dev enabled and both vendors faked.</summary>
public class GcApiFactory : WebApplicationFactory<Program>
{
    public FakeGoCardlessApi Gc { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Auth:TestMode", "true");
        builder.UseSetting("Db:AutoMigrate", "false");
        builder.UseSetting("environment", "Development");
        builder.UseSetting("GoCardless:SecretId", "test-id");
        builder.UseSetting("GoCardless:SecretKey", "test-key");
        builder.UseSetting("Logos:SecretKey", "logo-secret");
        builder.UseSetting("Logos:PublicToken", "pk_test");
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
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("gc-endpoint-tests"));

            // the scheduled fetch loop must not run during tests
            foreach (var d in services.Where(d => d.ImplementationType == typeof(GcFetchService)).ToList())
            {
                services.Remove(d);
            }
            services.AddSingleton<IGoCardlessApi>(Gc);
            services.AddHttpClient(LogoEndpoints.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => new FakeLogoHandler());
        });
    }
}

public class GcEndpointsTests : IClassFixture<GcApiFactory>
{
    private readonly GcApiFactory _factory;

    public GcEndpointsTests(GcApiFactory factory) => _factory = factory;

    private HttpClient ClientFor(string sub)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Sub", sub);
        return client;
    }

    private async Task<(HttpClient client, Guid userId, string spaceId)> MemberAsync(string suffix)
    {
        var client = ClientFor($"gc-{suffix}");
        var me = await client.GetFromJsonAsync<MeResponse>("/me");
        var spaceId = $"space_gc_{suffix}";
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Spaces.Add(new Space { Id = spaceId });
        db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = me!.UserId, Role = SpaceRoles.Owner });
        await db.SaveChangesAsync();
        return (client, me.UserId, spaceId);
    }

    [Fact]
    public async Task Institutions_validate_country_and_cache_the_vendor_call()
    {
        var client = ClientFor("gc-inst");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/gocardless/institutions?country=nether")).StatusCode);

        var before = _factory.Gc.InstitutionCalls;
        var list = await client.GetFromJsonAsync<List<GcInstitution>>("/gocardless/institutions?country=nl");
        Assert.Equal("ING_NL", Assert.Single(list!).Id);
        await client.GetAsync("/gocardless/institutions?country=nl");
        Assert.Equal(before + 1, _factory.Gc.InstitutionCalls); // second hit served from cache
    }

    [Fact]
    public async Task Institution_logos_are_vendored_and_served_from_our_own_table()
    {
        var client = ClientFor("gc-logo");
        // a fresh cache entry runs the upsert that records the CDN url
        var list = await client.GetFromJsonAsync<List<GcInstitution>>("/gocardless/institutions?country=de");
        Assert.Equal("/gocardless/institutions/ING_NL/logo", Assert.Single(list!).Logo);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.GcInstitutionLogos.FindAsync("ING_NL");
            Assert.Equal("https://cdn.example.test/ing.png", row!.LogoUrl);
            row.Bytes = [1, 2, 3];
            row.ContentType = "image/png";
            await db.SaveChangesAsync();
        }

        // anonymous serve (a plain <img> carries no bearer)
        var anonymous = _factory.CreateClient();
        var res = await anonymous.GetAsync("/gocardless/institutions/ING_NL/logo");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("image/png", res.Content.Headers.ContentType!.ToString());
        Assert.Equal([1, 2, 3], await res.Content.ReadAsByteArrayAsync());

        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/gocardless/institutions/NOPE/logo")).StatusCode);
    }

    [Fact]
    public async Task Requisition_flow_is_member_gated_and_complete_ingests_into_the_feed()
    {
        var (client, _, spaceId) = await MemberAsync("flow");

        // non-members may not connect a bank to the space
        var outsider = ClientFor("gc-outsider");
        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.PostAsJsonAsync("/gocardless/requisitions",
            new CreateRequisitionRequest(spaceId, "ING_NL", "https://app/gc-callback"))).StatusCode);

        var created = await (await client.PostAsJsonAsync("/gocardless/requisitions",
            new CreateRequisitionRequest(spaceId, "ING_NL", "https://app/gc-callback"))).Content
            .ReadFromJsonAsync<CreateRequisitionResponse>();
        Assert.Contains(created!.Reference, created.Link);

        // completing an unknown reference is NotFound; the real one ingests
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/gocardless/requisitions/{Guid.NewGuid()}/complete", null)).StatusCode);
        var complete = await (await client.PostAsync($"/gocardless/requisitions/{created.Reference}/complete", null))
            .Content.ReadFromJsonAsync<CompleteResponse>();
        Assert.Equal("LN", complete!.Status);
        Assert.Equal(1, complete.LinkedAccounts);
        Assert.True(complete.ImportedTransactions > 0);

        // the account link is visible in /connections for the member
        var connections = await client.GetFromJsonAsync<List<Dictionary<string, object?>>>("/gocardless/connections");
        Assert.Contains(connections!, c => (c["iban"]?.ToString() ?? "") == "NL69INGB0123456789");
        Assert.Empty((await outsider.GetFromJsonAsync<List<Dictionary<string, object?>>>("/gocardless/connections"))!);

        // IDEMPOTENT: a re-fired callback (reload / hosted + in-app race)
        // answers from our own table without touching the provider again —
        // re-ingesting burned the daily quota and 500ed (outage 2026-07-18)
        var froms = _factory.Gc.TransactionFroms.Count;
        var again = await (await client.PostAsync($"/gocardless/requisitions/{created.Reference}/complete", null))
            .Content.ReadFromJsonAsync<CompleteResponse>();
        Assert.Equal("LN", again!.Status);
        Assert.Equal(1, again.LinkedAccounts);
        Assert.Equal(0, again.ImportedTransactions);
        Assert.Equal(froms, _factory.Gc.TransactionFroms.Count); // no new provider calls
    }

    [Fact]
    public async Task Wallet_accounts_without_iban_still_link_and_ingest()
    {
        // PayPal-style accounts return no IBAN — they used to be skipped
        // silently (user bug: consent completed, connection never appeared)
        var (client, _, spaceId) = await MemberAsync("wallet");
        _factory.Gc.Details = new GcAccountDetails(null, null, "EUR", "Okkes D");
        _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "LN", ["gc-wallet-1"]);
        try
        {
            var created = await (await client.PostAsJsonAsync("/gocardless/requisitions",
                new CreateRequisitionRequest(spaceId, "PAYPAL_PPLXLULL", "https://app/gc-callback"))).Content
                .ReadFromJsonAsync<CreateRequisitionResponse>();
            var complete = await (await client.PostAsync($"/gocardless/requisitions/{created!.Reference}/complete", null))
                .Content.ReadFromJsonAsync<CompleteResponse>();
            Assert.Equal(1, complete!.LinkedAccounts);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var linked = await db.GcLinkedAccounts.FindAsync("gc-wallet-1");
            Assert.StartsWith("GC:", linked!.Iban); // deterministic pseudo reference
            var feedId = ImportIds.FeedSpaceId(linked.Iban);
            var account = await db.EntityRows.FindAsync(feedId, "account", linked.AccountEntityId);
            Assert.NotNull(account);
            Assert.Contains("\"name\":\"Paypal\"", account!.DataJson); // institution-derived
            Assert.DoesNotContain("\"iban\"", account.DataJson); // no fake IBAN surfaces
        }
        finally
        {
            _factory.Gc.Details = new GcAccountDetails("NL69INGB0123456789", "Betaalrekening", "EUR");
            _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "LN", ["gc-acc-1"]);
        }
    }

    [Fact]
    public async Task Complete_works_without_a_session_but_a_foreign_session_is_refused()
    {
        // installed-PWA journeys can return from the bank in a plain browser
        // tab with no app session — the reference GUID is the capability
        var (client, _, spaceId) = await MemberAsync("anon");
        var created = await (await client.PostAsJsonAsync("/gocardless/requisitions",
            new CreateRequisitionRequest(spaceId, "ING_NL", "https://app/gc-callback"))).Content
            .ReadFromJsonAsync<CreateRequisitionResponse>();

        // a DIFFERENT signed-in user may not complete someone else's journey
        var stranger = ClientFor("gc-anon-stranger");
        Assert.Equal(HttpStatusCode.NotFound,
            (await stranger.PostAsync($"/gocardless/requisitions/{created!.Reference}/complete", null)).StatusCode);

        var anonymous = _factory.CreateClient(); // no X-User-Sub header
        var complete = await (await anonymous.PostAsync($"/gocardless/requisitions/{created.Reference}/complete", null))
            .Content.ReadFromJsonAsync<CompleteResponse>();
        Assert.Equal("LN", complete!.Status);
        Assert.Equal(1, complete.LinkedAccounts);
    }

    [Fact]
    public async Task Complete_reports_a_pending_bank_without_ingesting()
    {
        var (client, _, spaceId) = await MemberAsync("pending");
        var created = await (await client.PostAsJsonAsync("/gocardless/requisitions",
            new CreateRequisitionRequest(spaceId, "ING_NL", "https://app/gc-callback"))).Content
            .ReadFromJsonAsync<CreateRequisitionResponse>();

        _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "GA", []);
        try
        {
            var complete = await (await client.PostAsync($"/gocardless/requisitions/{created!.Reference}/complete", null))
                .Content.ReadFromJsonAsync<CompleteResponse>();
            Assert.Equal("GA", complete!.Status);
            Assert.Equal(0, complete.LinkedAccounts);
        }
        finally
        {
            _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "LN", ["gc-acc-1"]);
        }
    }

    [Fact]
    public async Task Quota_429_on_details_defers_the_link_and_the_healer_finishes_it()
    {
        // the floating-connection outage: a 429 mid-complete used to abort
        // with a 502, leaving the consent approved at GC but attached to
        // nothing — and the idempotency guard kept it that way forever
        var (client, _, spaceId) = await MemberAsync("heal");
        _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "LN", ["gc-heal-1"]);
        // own IBAN: feed ops are deterministic per (iban, ref) — reusing the
        // shared NL69 feed would eat Requisition_flow's first-ingest assert
        _factory.Gc.Details = new GcAccountDetails("NL10HEAL0000000001", "Heal 1", "EUR");
        _factory.Gc.Details429Remaining = 1;
        try
        {
            var created = await (await client.PostAsJsonAsync("/gocardless/requisitions",
                new CreateRequisitionRequest(spaceId, "ING_NL", "https://app/gc-callback"))).Content
                .ReadFromJsonAsync<CreateRequisitionResponse>();
            var complete = await (await client.PostAsync($"/gocardless/requisitions/{created!.Reference}/complete", null))
                .Content.ReadFromJsonAsync<CompleteResponse>();
            Assert.Equal("LN", complete!.Status); // approved — NOT a 502
            Assert.Equal(0, complete.LinkedAccounts); // identity unknown until the budget resets

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.GcRequisitions.FindAsync(Guid.Parse(created.Reference));
                Assert.Equal("approved", row!.Status);
                row.CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-30); // past the healer's fresh-journey grace
                await db.SaveChangesAsync();
            }

            var service = new GcFetchService(
                _factory.Services.GetRequiredService<IServiceScopeFactory>(),
                NullLogger<GcFetchService>.Instance)
            { AccountDelay = TimeSpan.Zero };
            await service.FetchAllAsync(CancellationToken.None);

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.GcRequisitions.FindAsync(Guid.Parse(created.Reference));
                Assert.Equal("linked", row!.Status);
                var linked = await db.GcLinkedAccounts.FindAsync("gc-heal-1");
                Assert.NotNull(linked);
                var feedId = ImportIds.FeedSpaceId(linked!.Iban);
                // attached to the target space — floating no more
                Assert.True(await db.SpaceAccountLinks.AnyAsync(l => l.SpaceId == spaceId && l.FeedSpaceId == feedId));
            }
        }
        finally
        {
            _factory.Gc.Details429Remaining = 0;
            _factory.Gc.Details = new GcAccountDetails("NL69INGB0123456789", "Betaalrekening", "EUR");
            _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "LN", ["gc-acc-1"]);
        }
    }

    [Fact]
    public async Task Healer_reuses_the_stored_identity_when_details_are_throttled_again()
    {
        // an earlier attempt already stored the account identity — a healer
        // pass that hits the details throttle again must not lose it
        var (client, userId, spaceId) = await MemberAsync("heal3");
        Guid reqId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            reqId = Guid.NewGuid();
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = reqId, UserId = userId, SpaceId = spaceId, InstitutionId = "ING_NL",
                RequisitionId = "gc-req-1", Status = "approved",
                CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-30),
            });
            db.GcLinkedAccounts.Add(new GcLinkedAccount
            {
                GcAccountId = "gc-heal-3", SpaceId = spaceId,
                AccountEntityId = ImportIds.AccountId("NL30HEAL0000000003"),
                Iban = "NL30HEAL0000000003", Currency = "EUR", RequisitionId = reqId,
            });
            await db.SaveChangesAsync();
        }
        _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "LN", ["gc-heal-3"]);
        _factory.Gc.Details429Remaining = 1;
        try
        {
            var service = new GcFetchService(
                _factory.Services.GetRequiredService<IServiceScopeFactory>(),
                NullLogger<GcFetchService>.Instance)
            { AccountDelay = TimeSpan.Zero };
            await service.FetchAllAsync(CancellationToken.None);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal("linked", (await db.GcRequisitions.FindAsync(reqId))!.Status);
            var linked = await db.GcLinkedAccounts.FindAsync("gc-heal-3");
            Assert.Equal("NL30HEAL0000000003", linked!.Iban); // identity kept, not degraded to GC:
            Assert.NotNull(linked.LastFetchAt); // balances/transactions came through
        }
        finally
        {
            _factory.Gc.Details429Remaining = 0;
            _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "LN", ["gc-acc-1"]);
        }
    }

    [Fact]
    public async Task Healer_leaves_unapproved_journeys_alone_and_backs_off_between_checks()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        Guid reqId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            reqId = Guid.NewGuid();
            db.Spaces.Add(new Space { Id = $"space_cr_{suffix}" });
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = reqId, UserId = Guid.NewGuid(), SpaceId = $"space_cr_{suffix}", InstitutionId = "ING_NL",
                RequisitionId = "gc-req-1", Status = "created",
                CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-30),
            });
            await db.SaveChangesAsync();
        }
        _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "CR", []);
        try
        {
            var service = new GcFetchService(
                _factory.Services.GetRequiredService<IServiceScopeFactory>(),
                NullLogger<GcFetchService>.Instance)
            { AccountDelay = TimeSpan.Zero };
            await service.FetchAllAsync(CancellationToken.None); // bank says CR — nothing to heal
            await service.FetchAllAsync(CancellationToken.None); // second tick: 6h backoff skips it

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal("created", (await db.GcRequisitions.FindAsync(reqId))!.Status);
        }
        finally
        {
            _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "LN", ["gc-acc-1"]);
        }
    }

    [Fact]
    public async Task Quota_429_on_data_fetch_still_links_and_attaches_the_account()
    {
        var (client, _, spaceId) = await MemberAsync("heal2");
        _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "LN", ["gc-heal-2"]);
        _factory.Gc.Details = new GcAccountDetails("NL20HEAL0000000002", "Heal 2", "EUR");
        _factory.Gc.Data429Remaining = 1;
        try
        {
            var created = await (await client.PostAsJsonAsync("/gocardless/requisitions",
                new CreateRequisitionRequest(spaceId, "ING_NL", "https://app/gc-callback"))).Content
                .ReadFromJsonAsync<CreateRequisitionResponse>();
            var complete = await (await client.PostAsync($"/gocardless/requisitions/{created!.Reference}/complete", null))
                .Content.ReadFromJsonAsync<CompleteResponse>();
            Assert.Equal(1, complete!.LinkedAccounts); // linked with empty data

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.GcRequisitions.FindAsync(Guid.Parse(created.Reference));
            Assert.Equal("linked", row!.Status);
            var linked = await db.GcLinkedAccounts.FindAsync("gc-heal-2");
            Assert.Null(linked!.LastFetchAt); // first scheduled fetch backfills the full window
            var feedId = ImportIds.FeedSpaceId(linked.Iban);
            Assert.True(await db.SpaceAccountLinks.AnyAsync(l => l.SpaceId == spaceId && l.FeedSpaceId == feedId));
        }
        finally
        {
            _factory.Gc.Data429Remaining = 0;
            _factory.Gc.Details = new GcAccountDetails("NL69INGB0123456789", "Betaalrekening", "EUR");
            _factory.Gc.Status = new GcRequisitionStatus("gc-req-1", "LN", ["gc-acc-1"]);
        }
    }

    [Fact]
    public async Task FetchService_ingests_stale_accounts_and_skips_recently_fetched_ones()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var spaceId = $"space_fetch_{suffix}";
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Spaces.Add(new Space { Id = spaceId });
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = Guid.NewGuid(), UserId = Guid.NewGuid(), SpaceId = spaceId,
                InstitutionId = "ING_NL", RequisitionId = $"req-{suffix}", Status = "linked",
            });
            db.GcLinkedAccounts.Add(new GcLinkedAccount
            {
                GcAccountId = $"gc-fetch-{suffix}", SpaceId = spaceId,
                AccountEntityId = ImportIds.AccountId("NL69INGB0123456789"),
                Iban = "NL69INGB0123456789", Currency = "EUR",
                RequisitionId = db.GcRequisitions.Local.First().Id,
            });
            await db.SaveChangesAsync();
        }

        var service = new GcFetchService(
            _factory.Services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<GcFetchService>.Instance)
        { AccountDelay = TimeSpan.Zero };
        await service.FetchAllAsync(CancellationToken.None);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var linked = await db.GcLinkedAccounts.FindAsync($"gc-fetch-{suffix}");
            Assert.NotNull(linked!.LastFetchAt); // fetched + stamped
            // raw rows landed in the account's FEED space
            var feedId = ImportIds.FeedSpaceId("NL69INGB0123456789");
            Assert.True(await db.EntityRows.AnyAsync(r => r.SpaceId == feedId && r.Entity == "transaction"));
        }

        // a second run within 5h must skip the account (LastFetchAt fresh)
        var callsBefore = _factory.Gc.InstitutionCalls; // unrelated counter guard
        await service.FetchAllAsync(CancellationToken.None);
        Assert.Equal(callsBefore, _factory.Gc.InstitutionCalls);
    }

    [Fact]
    public async Task FetchService_backfills_full_history_once_for_pre_feed_accounts()
    {
        // an account linked BEFORE the feed-space migration: LastFetchAt is
        // set (so the naive delta would be tiny) but the feed never saw the
        // 90-day window — HistoryBackfilledAt null must force it (user bug:
        // attaching such an account showed only ~a week of history)
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var spaceId = $"space_backfill_{suffix}";
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Spaces.Add(new Space { Id = spaceId });
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = Guid.NewGuid(), UserId = Guid.NewGuid(), SpaceId = spaceId,
                InstitutionId = "ING_NL", RequisitionId = $"req-bf-{suffix}", Status = "linked",
            });
            db.GcLinkedAccounts.Add(new GcLinkedAccount
            {
                GcAccountId = $"gc-bf-{suffix}", SpaceId = spaceId,
                AccountEntityId = ImportIds.AccountId("NL20INGB0001234567"),
                Iban = "NL20INGB0001234567", Currency = "EUR",
                RequisitionId = db.GcRequisitions.Local.First().Id,
                LastFetchAt = DateTimeOffset.UtcNow.AddDays(-2), // stale enough to be due
            });
            await db.SaveChangesAsync();
        }

        var service = new GcFetchService(
            _factory.Services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<GcFetchService>.Instance)
        { AccountDelay = TimeSpan.Zero };
        var callsBefore = _factory.Gc.TransactionFroms.Count;
        // FetchAccountAsync directly: FetchAllAsync's IsDue gate only opens
        // in the bank's 03:00 hour, which would make this test time-of-day
        // dependent
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var linked = await db.GcLinkedAccounts.FindAsync($"gc-bf-{suffix}");
            await service.FetchAccountAsync(scope.ServiceProvider, db, new Munni.Api.Banking.GoCardlessBankApi(_factory.Gc), linked!, CancellationToken.None);
        }

        var from = _factory.Gc.TransactionFroms[callsBefore];
        Assert.True(from <= DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-89)), $"expected full-window fetch, got {from}");
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var linked = await db.GcLinkedAccounts.FindAsync($"gc-bf-{suffix}");
            Assert.NotNull(linked!.HistoryBackfilledAt); // one-time: stamped after the backfill
        }
    }

    [Fact]
    public async Task Pending_transactions_mirror_into_the_feed_and_vanish_when_no_longer_pending()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var spaceId = $"space_pending_{suffix}";
        var iban = "NL30INGB0009876543";
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Spaces.Add(new Space { Id = spaceId });
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = Guid.NewGuid(), UserId = Guid.NewGuid(), SpaceId = spaceId,
                InstitutionId = "ING_NL", RequisitionId = $"req-p-{suffix}", Status = "linked",
            });
            db.GcLinkedAccounts.Add(new GcLinkedAccount
            {
                GcAccountId = $"gc-p-{suffix}", SpaceId = spaceId,
                AccountEntityId = ImportIds.AccountId(iban),
                Iban = iban, Currency = "EUR",
                RequisitionId = db.GcRequisitions.Local.First().Id,
            });
            await db.SaveChangesAsync();
        }

        var service = new GcFetchService(
            _factory.Services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<GcFetchService>.Instance)
        { AccountDelay = TimeSpan.Zero };
        var pendingEntityId = ImportIds.TransactionId(iban, "pending:PND-1");
        var feedId = ImportIds.FeedSpaceId(iban);

        async Task FetchOnce()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var linked = await db.GcLinkedAccounts.FindAsync($"gc-p-{suffix}");
            await service.FetchAccountAsync(scope.ServiceProvider, db, new Munni.Api.Banking.GoCardlessBankApi(_factory.Gc), linked!, CancellationToken.None);
        }

        _factory.Gc.Pending = [new GcTransaction(null, "PND-1", null, "2026-07-13", new GcAmount("-15.00", "EUR"), "Tikkie", null, "reserved")];
        try
        {
            await FetchOnce();
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.EntityRows.FindAsync(feedId, "transaction", pendingEntityId);
                Assert.NotNull(row);
                Assert.False(row!.Deleted);
                Assert.Contains("\"pending\":1", row.DataJson);
                Assert.True(await db.GcPendingTxs.AnyAsync(p => p.EntityId == pendingEntityId));
            }

            // next fetch: the charge left the pending list (it booked) — the
            // mirrored pending row gets tombstoned
            _factory.Gc.Pending = [];
            await FetchOnce();
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.EntityRows.FindAsync(feedId, "transaction", pendingEntityId);
                Assert.True(row!.Deleted);
                Assert.False(await db.GcPendingTxs.AnyAsync(p => p.EntityId == pendingEntityId));
            }
        }
        finally
        {
            _factory.Gc.Pending = [];
        }
    }

    [Fact]
    public async Task Cleanup_rebinds_accounts_to_the_newest_consent_and_frees_the_older_duplicate()
    {
        // the user's nine-ING-consents mess: the account row stays bound to
        // whichever consent completed FIRST, so "which one is safe to
        // delete" was unanswerable — cleanup now converges on the newest
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var oldId = Guid.NewGuid();
        var newId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = oldId, UserId = userId, SpaceId = $"space_rb_{suffix}",
                InstitutionId = "ING_NL", RequisitionId = $"req-old-{suffix}", Status = "linked",
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-5),
            });
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = newId, UserId = userId, SpaceId = $"space_rb_{suffix}",
                InstitutionId = "ING_NL", RequisitionId = $"req-new-{suffix}", Status = "linked",
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-3),
            });
            db.GcLinkedAccounts.Add(new GcLinkedAccount
            {
                GcAccountId = $"gc-rb-{suffix}", SpaceId = $"space_rb_{suffix}",
                AccountEntityId = ImportIds.AccountId("NL55ABNA0123456789"),
                Iban = "NL55ABNA0123456789", Currency = "EUR",
                RequisitionId = oldId, LastFetchAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }
        _factory.Gc.RemoteRequisitions =
        [
            new GcRequisitionListItem($"req-old-{suffix}", "LN", "ING_NL", DateTimeOffset.UtcNow.AddDays(-5), null, [$"gc-rb-{suffix}"]),
            new GcRequisitionListItem($"req-new-{suffix}", "LN", "ING_NL", DateTimeOffset.UtcNow.AddDays(-3), null, [$"gc-rb-{suffix}"]),
        ];
        try
        {
            var service = new GcFetchService(
                _factory.Services.GetRequiredService<IServiceScopeFactory>(),
                NullLogger<GcFetchService>.Instance);
            await service.CleanupIdleRequisitionsAsync(CancellationToken.None);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // the account now rides the newest consent …
            Assert.Equal(newId, (await db.GcLinkedAccounts.FindAsync($"gc-rb-{suffix}"))!.RequisitionId);
            // … and the account-less older duplicate was freed at the provider
            Assert.Contains($"req-old-{suffix}", _factory.Gc.DeletedRequisitions);
            Assert.Null(await db.GcRequisitions.FindAsync(oldId));
            Assert.NotNull(await db.GcRequisitions.FindAsync(newId));
        }
        finally
        {
            _factory.Gc.RemoteRequisitions = [];
        }
    }

    [Fact]
    public async Task Family_account_consented_by_two_users_keeps_both_consents_and_the_original_binding()
    {
        // shared family bank account: both partners consent separately; the
        // provider returns the SAME account id for both. Rebinding must
        // stay within one user, and the second person's consent is never
        // idle-deleted even though the row is bound to the first person's.
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var aliceReq = Guid.NewGuid();
        var bobReq = Guid.NewGuid();
        var alice = Guid.NewGuid();
        var bob = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = aliceReq, UserId = alice, SpaceId = $"space_fa_a_{suffix}",
                InstitutionId = "ING_NL", RequisitionId = $"req-alice-{suffix}", Status = "linked",
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-10),
            });
            // Bob consented later, and his requisition holds no local rows
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = bobReq, UserId = bob, SpaceId = $"space_fa_b_{suffix}",
                InstitutionId = "ING_NL", RequisitionId = $"req-bob-{suffix}", Status = "linked",
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-4),
            });
            db.GcLinkedAccounts.Add(new GcLinkedAccount
            {
                GcAccountId = $"gc-fa-{suffix}", SpaceId = $"space_fa_a_{suffix}",
                AccountEntityId = ImportIds.AccountId("NL44INGB0088888888"),
                Iban = "NL44INGB0088888888", Currency = "EUR",
                RequisitionId = aliceReq, LastFetchAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }
        _factory.Gc.RemoteRequisitions =
        [
            new GcRequisitionListItem($"req-alice-{suffix}", "LN", "ING_NL", DateTimeOffset.UtcNow.AddDays(-10), null, [$"gc-fa-{suffix}"]),
            new GcRequisitionListItem($"req-bob-{suffix}", "LN", "ING_NL", DateTimeOffset.UtcNow.AddDays(-4), null, [$"gc-fa-{suffix}"]),
        ];
        try
        {
            var service = new GcFetchService(
                _factory.Services.GetRequiredService<IServiceScopeFactory>(),
                NullLogger<GcFetchService>.Instance);
            await service.CleanupIdleRequisitionsAsync(CancellationToken.None);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Alice keeps the binding — Bob's newer consent must not steal it
            Assert.Equal(aliceReq, (await db.GcLinkedAccounts.FindAsync($"gc-fa-{suffix}"))!.RequisitionId);
            // and Bob's covering consent survives the idle sweep
            Assert.DoesNotContain($"req-bob-{suffix}", _factory.Gc.DeletedRequisitions);
            Assert.NotNull(await db.GcRequisitions.FindAsync(bobReq));
        }
        finally
        {
            _factory.Gc.RemoteRequisitions = [];
        }
    }

    [Fact]
    public async Task Cleanup_frees_idle_requisitions_but_keeps_fresh_and_linked_ones()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var abandonedId = Guid.NewGuid();
        var freshId = Guid.NewGuid();
        var linkedId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // abandoned consent journey, past the grace window → cleaned
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = abandonedId, UserId = Guid.NewGuid(), SpaceId = $"space_cl_{suffix}",
                InstitutionId = "ING_NL", RequisitionId = $"req-idle-{suffix}", Status = "created",
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-5),
            });
            // just started — the user may still be at the bank → kept
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = freshId, UserId = Guid.NewGuid(), SpaceId = $"space_cl_{suffix}",
                InstitutionId = "ING_NL", RequisitionId = $"req-fresh-{suffix}", Status = "created",
            });
            // old but feeding a linked account → kept
            db.GcRequisitions.Add(new GcRequisition
            {
                Id = linkedId, UserId = Guid.NewGuid(), SpaceId = $"space_cl_{suffix}",
                InstitutionId = "ING_NL", RequisitionId = $"req-live-{suffix}", Status = "linked",
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-40),
            });
            db.GcLinkedAccounts.Add(new GcLinkedAccount
            {
                GcAccountId = $"gc-clean-{suffix}", SpaceId = $"space_cl_{suffix}",
                AccountEntityId = ImportIds.AccountId("NL10RABO0123456789"),
                Iban = "NL10RABO0123456789", Currency = "EUR",
                RequisitionId = linkedId, LastFetchAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var service = new GcFetchService(
            _factory.Services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<GcFetchService>.Instance);
        await service.CleanupIdleRequisitionsAsync(CancellationToken.None);

        Assert.Contains($"req-idle-{suffix}", _factory.Gc.DeletedRequisitions);
        Assert.DoesNotContain($"req-fresh-{suffix}", _factory.Gc.DeletedRequisitions);
        Assert.DoesNotContain($"req-live-{suffix}", _factory.Gc.DeletedRequisitions);
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Null(await db.GcRequisitions.FindAsync(abandonedId));
            Assert.NotNull(await db.GcRequisitions.FindAsync(freshId));
            Assert.NotNull(await db.GcRequisitions.FindAsync(linkedId));
        }
    }

    [Fact]
    public async Task Logo_search_maps_results_and_survives_upstream_failure()
    {
        var client = ClientFor("gc-logos");
        var results = await client.GetFromJsonAsync<List<LogoResult>>("/logos/search?q=netflix");
        var hit = Assert.Single(results!); // the domain-less entry is dropped
        Assert.Equal("netflix.com", hit.Domain);
        Assert.Contains("img.logo.dev/netflix.com", hit.LogoUrl);
        Assert.Contains("token=pk_test", hit.LogoUrl);

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/logos/search?q=a")).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<LogoResult>>("/logos/search?q=boom"))!);
    }

    [Fact]
    public async Task Logo_health_reports_a_working_configuration()
    {
        var client = ClientFor("gc-logos-health");
        var health = await client.GetFromJsonAsync<JsonElement>("/logos/health");
        Assert.True(health.GetProperty("configured").GetBoolean());
        Assert.Equal("ok", health.GetProperty("search").GetString());
        Assert.False(health.GetProperty("secretLooksSwapped").GetBoolean());
    }
}
