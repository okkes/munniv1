using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Munni.Api.Banking;

namespace Munni.Api.Tests;

/// <summary>
/// The Enable Banking client against a scripted handler: JWT bearer,
/// aspsp mapping, session exchange, sign-flipping and booked/pending
/// splitting, continuation-key pagination.
/// </summary>
public class EnableBankingApiTests
{
    private sealed class ScriptedHandler : HttpMessageHandler
    {
        public List<string> Paths { get; } = [];
        /// <summary>when set, every request answers 403 with this body</summary>
        public string? ForbidWith { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri!.PathAndQuery;
            Paths.Add(path);
            if (ForbidWith is not null)
            {
                return new HttpResponseMessage(System.Net.HttpStatusCode.Forbidden)
                {
                    Content = new StringContent(ForbidWith),
                };
            }
            // every call must carry the signed application JWT
            Assert.Equal(3, request.Headers.Authorization?.Parameter?.Split('.').Length);

            string body;
            if (path.StartsWith("/aspsps"))
            {
                body = """{"aspsps":[{"name":"ING","country":"NL","bic":"INGBNL2A","logo":null,"transaction_total_days":730}]}""";
            }
            else if (path == "/auth")
            {
                var payload = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
                Assert.Equal("ING", payload.RootElement.GetProperty("aspsp").GetProperty("name").GetString());
                Assert.Equal("NL", payload.RootElement.GetProperty("aspsp").GetProperty("country").GetString());
                Assert.Equal("ref-1", payload.RootElement.GetProperty("state").GetString());
                body = """{"url":"https://auth.enablebanking.example/x"}""";
            }
            else if (path == "/sessions")
            {
                var payload = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
                Assert.Equal("code-1", payload.RootElement.GetProperty("code").GetString());
                body = """{"session_id":"sess-1","accounts":[{"uid":"acc-uid-1"}]}""";
            }
            else if (path.EndsWith("/details"))
            {
                body = """{"account_id":{"iban":"NL69INGB0123456789"},"name":"Betaal","currency":"EUR"}""";
            }
            else if (path.EndsWith("/balances"))
            {
                body = """{"balances":[{"balance_amount":{"amount":"12.34","currency":"EUR"},"balance_type":"CLBD"}]}""";
            }
            else if (path.Contains("acc-uid-clamp/transactions") && path.Contains("date_from"))
            {
                // #240 r2: PayPal answers an out-of-range date_from with an
                // EMPTY 200 rather than an error
                body = """{"transactions":[],"continuation_key":null}""";
            }
            else if (path.Contains("acc-uid-clamp/transactions"))
            {
                body = """
                {"transactions":[
                  {"entry_reference":"C1","transaction_amount":{"amount":"3.50","currency":"EUR"},"credit_debit_indicator":"DBIT","status":"BOOK","booking_date":"2026-08-01","creditor":{"name":"Coffee"}}
                ],"continuation_key":null}
                """;
            }
            else if (path.Contains("acc-uid-pp/transactions"))
            {
                // the PayPal shape (#240): no entry_reference, no booking_date
                // — only a value date and the remittance text
                body = """
                {"transactions":[
                  {"transaction_amount":{"amount":"7.99","currency":"EUR"},"credit_debit_indicator":"DBIT","status":"BOOK","value_date":"2026-07-14","remittance_information":["1051635911097/PAYPAL"],"creditor":{"name":"PayPal Europe S.a.r.l. et Cie S.C.A"}}
                ],"continuation_key":null}
                """;
            }
            else if (path.Contains("acc-uid-txdate/transactions"))
            {
                // #240 r3: the deepest wallet shape — no entry_reference,
                // no booking_date, no value_date; only transaction_date
                body = """
                {"transactions":[
                  {"transaction_amount":{"amount":"25.99","currency":"EUR"},"credit_debit_indicator":"DBIT","status":"BOOK","transaction_date":"2026-08-11","creditor":{"name":"Google"}}
                ],"continuation_key":null}
                """;
            }
            else if (path.Contains("/transactions") && !path.Contains("continuation_key"))
            {
                Assert.Contains("date_from=2026-01-15", path);
                body = """
                {"transactions":[
                  {"entry_reference":"E1","transaction_amount":{"amount":"42.10","currency":"EUR"},"credit_debit_indicator":"DBIT","status":"BOOK","booking_date":"2026-07-05","remittance_information":["AH 1350"],"creditor":{"name":"Albert Heijn"},"creditor_account":{"iban":"NL00AHOL0000000001"}}
                ],"continuation_key":"page2"}
                """;
            }
            else if (path.Contains("continuation_key=page2"))
            {
                body = """
                {"transactions":[
                  {"entry_reference":"E2","transaction_amount":{"amount":"15.00","currency":"EUR"},"credit_debit_indicator":"DBIT","status":"PDNG","value_date":"2026-07-06","creditor":{"name":"Tikkie"}}
                ],"continuation_key":null}
                """;
            }
            else
            {
                return new HttpResponseMessage(HttpStatusCode.NotFound);
            }
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
        }
    }

    private static (EnableBankingApi api, ScriptedHandler handler) Create()
    {
        using var rsa = RSA.Create(2048);
        var pem = rsa.ExportPkcs8PrivateKeyPem();
        var handler = new ScriptedHandler();
        var http = new HttpClient(handler) { BaseAddress = new Uri("https://api.enablebanking.example/") };
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["EnableBanking:ApplicationId"] = "app-1",
                ["EnableBanking:PrivateKeyPem"] = pem,
            })
            .Build();
        return (new EnableBankingApi(http, config), handler);
    }

    [Fact]
    public async Task Provider_errors_carry_enable_bankings_own_words()
    {
        // a 403 means the JWT VERIFIED but the application is refused —
        // Enable Banking explains why in the body; the app must relay it
        var (api, handler) = Create();
        handler.ForbidWith = "{\"message\":\"Application is not active\"}";
        var thrown = await Assert.ThrowsAsync<HttpRequestException>(() => api.GetInstitutionsAsync("nl"));
        Assert.Contains("403", thrown.Message);
        Assert.Contains("Application is not active", thrown.Message);
    }

    [Fact]
    public async Task Signing_survives_earlier_instances_going_away()
    {
        // REGRESSION (outage 2026-07-18): the transient typed client used
        // to be IDisposable and killed its RSA at request end - but
        // IdentityModel's global provider cache kept serving that first,
        // now-dead key ("Cannot access a disposed object: RSAOpenSsl").
        // The signing state is process-wide now and nothing may dispose it.
        Assert.False(typeof(IDisposable).IsAssignableFrom(typeof(EnableBankingApi)));

        // two instances (fresh DI scopes) sign back to back; the handler
        // itself asserts every call carries a well-formed signed JWT
        var (first, _) = Create();
        await first.GetInstitutionsAsync("nl");
        var (second, secondHandler) = Create();
        await second.GetInstitutionsAsync("nl");
        Assert.Single(secondHandler.Paths);
    }

    [Fact]
    public async Task Institutions_consent_and_session_map_to_the_shared_shapes()
    {
        var (api, _) = Create();

        var institutions = await api.GetInstitutionsAsync("nl");
        var ing = Assert.Single(institutions);
        Assert.Equal("ING|NL", ing.Id); // name+country is EB's institution key
        Assert.Equal("730", ing.TransactionTotalDays);

        var created = await api.CreateRequisitionAsync("ING|NL", "https://app/gc-callback", "ref-1");
        Assert.Equal("https://auth.enablebanking.example/x", created.Link);
        Assert.Equal("ref-1", created.Id); // EB has no consent id until the session exists

        var completed = await api.CompleteAuthAsync("ref-1", "code-1");
        Assert.Equal("LN", completed.Status);
        Assert.Equal("sess-1", completed.Id); // the caller persists the session id
        Assert.Equal(["acc-uid-1"], completed.Accounts);

        Assert.Equal("NL69INGB0123456789", (await api.GetAccountDetailsAsync("acc-uid-1")).Iban);
        Assert.Equal("closingBooked", (await api.GetBalancesAsync("acc-uid-1"))[0].BalanceType); // CLBD mapped
    }

    [Fact]
    public async Task Transactions_flip_debit_signs_split_pending_and_follow_pagination()
    {
        var (api, handler) = Create();
        var page = await api.GetTransactionsAsync("acc-uid-1", new DateOnly(2026, 1, 15));

        var booked = Assert.Single(page.Booked);
        Assert.Equal("-42.10", booked.TransactionAmount.Amount); // DBIT → signed, GC-style
        Assert.Equal("Albert Heijn", booked.CreditorName);
        Assert.Equal("NL00AHOL0000000001", booked.CreditorAccount?.Iban);

        var pending = Assert.Single(page.Pending);
        Assert.Equal("E2", pending.TransactionId);
        Assert.Equal("2026-07-06", pending.BookingDate); // #240: the mapper backfills from the value date

        Assert.Equal(2, handler.Paths.Count(p => p.Contains("/transactions")));
    }

    [Fact]
    public async Task Paypal_style_rows_without_reference_or_booking_date_map_deterministically()
    {
        // #240: the ingest keys rows on the reference and drops date-less
        // ones — an ASPSP omitting both silently lost its whole history.
        // The mapper now falls back to the value date and derives a
        // deterministic synthetic identity from the stable facts.
        var (api, _) = Create();
        var page = await api.GetTransactionsAsync("acc-uid-pp", null);

        var row = Assert.Single(page.Booked); // BOOK status — not dropped
        Assert.Equal("2026-07-14", row.BookingDate); // value-date fallback
        Assert.Equal("-7.99", row.TransactionAmount.Amount);
        Assert.StartsWith("eb:", row.TransactionId);

        // a re-fetch maps to the SAME row identity — no duplicates
        var again = await api.GetTransactionsAsync("acc-uid-pp", null);
        Assert.Equal(row.TransactionId, Assert.Single(again.Booked).TransactionId);
    }

    [Fact]
    public async Task An_empty_windowed_answer_retries_on_the_aspsps_default_window()
    {
        // #240 r2: the two-year ask came back 200-with-nothing — one retry
        // without date_from picks up whatever window the ASPSP does serve
        var (api, handler) = Create();
        var page = await api.GetTransactionsAsync("acc-uid-clamp", new DateOnly(2024, 8, 14));

        var row = Assert.Single(page.Booked);
        Assert.Equal("C1", row.TransactionId);
        Assert.Equal(2, handler.Paths.Count(p => p.Contains("acc-uid-clamp/transactions")));
        Assert.Equal(1, handler.Paths.Count(p => p.Contains("acc-uid-clamp/transactions") && p.Contains("date_from")));
    }

    [Fact]
    public async Task A_row_dated_only_by_transaction_date_still_lands()
    {
        // #240 r3: wallet rows can omit booking AND value dates — the last
        // date EB publishes must carry them, or the whole account reads as
        // empty forever (every row silently dropped at ingest)
        var (api, _) = Create();
        var page = await api.GetTransactionsAsync("acc-uid-txdate", null);

        var row = Assert.Single(page.Booked);
        Assert.Equal("2026-08-11", row.BookingDate); // transaction_date fallback
        Assert.Equal("-25.99", row.TransactionAmount.Amount);
        Assert.StartsWith("eb:", row.TransactionId); // synthetic identity holds
    }
}
