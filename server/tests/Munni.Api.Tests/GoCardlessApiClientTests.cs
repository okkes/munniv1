using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Munni.Api.GoCardless;

namespace Munni.Api.Tests;

/// <summary>
/// The vendor HTTP client against a scripted handler: token caching,
/// bearer propagation, envelope unwrapping, error surfacing.
/// </summary>
public class GoCardlessApiClientTests
{
    private sealed class ScriptedHandler : HttpMessageHandler
    {
        public int TokenCalls;
        public string? LastRequisitionBody;
        public List<(string Method, string Path, string? Auth)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri!.PathAndQuery;
            Requests.Add((request.Method.Method, path, request.Headers.Authorization?.Parameter));

            string body;
            if (path.EndsWith("token/new/"))
            {
                TokenCalls++;
                var payload = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
                Assert.Equal("sid", payload.RootElement.GetProperty("secret_id").GetString());
                body = """{"access":"tok-1","access_expires":86400}""";
            }
            else if (path.Contains("institutions/ING_NL"))
            {
                // the single-institution detail powering the history ask
                body = """{"id":"ING_NL","transaction_total_days":"730"}""";
            }
            else if (path.Contains("institutions"))
            {
                body = """[{"id":"ING_NL","name":"ING","bic":"INGBNL2A","transaction_total_days":"730","logo":null}]""";
            }
            else if (path.EndsWith("agreements/enduser/"))
            {
                // the deep-history consent: capped at the institution max
                var agreementPayload = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
                Assert.Equal(730, agreementPayload.RootElement.GetProperty("max_historical_days").GetInt32());
                body = """{"id":"agr-1"}""";
            }
            else if (path.EndsWith("/details/"))
            {
                body = """{"account":{"iban":"NL69INGB0123456789","name":"Betaal","currency":"EUR"}}""";
            }
            else if (path.EndsWith("/balances/"))
            {
                body = """{"balances":[{"balanceAmount":{"amount":"12.34","currency":"EUR"},"balanceType":"closingBooked"}]}""";
            }
            else if (path.Contains("/transactions/"))
            {
                Assert.Contains("date_from=2026-01-15", path);
                var txBody = """{"transactions":{"booked":[{"transactionId":"T1","transactionAmount":{"amount":"-1.00","currency":"EUR"}}],"pending":[{"internalTransactionId":"P1","valueDate":"2026-01-16","transactionAmount":{"amount":"-2.00","currency":"EUR"}}]}}""";
                var txResponse = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(txBody, Encoding.UTF8, "application/json"),
                };
                // the per-account budget headers the scheduler feeds on
                txResponse.Headers.Add("x-ratelimit-account-success-limit", "4");
                txResponse.Headers.Add("x-ratelimit-account-success-remaining", "3");
                txResponse.Headers.Add("x-ratelimit-account-success-reset", "3600");
                return txResponse;
            }
            else if (request.Method == HttpMethod.Delete)
            {
                return new HttpResponseMessage(HttpStatusCode.NoContent);
            }
            else if (path.EndsWith("requisitions/") && request.Method == HttpMethod.Post)
            {
                LastRequisitionBody = await request.Content!.ReadAsStringAsync(ct);
                body = """{"id":"req-1","link":"https://gc/auth","status":"CR"}""";
            }
            else if (path.Contains("requisitions/?limit"))
            {
                body = """{"results":[{"id":"req-1","status":"LN","institution_id":"ING_NL","created":null,"reference":"r","accounts":[]}]}""";
            }
            else if (path.Contains("requisitions/broken"))
            {
                return new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            }
            else
            {
                body = """{"id":"req-1","status":"LN","accounts":["a1"]}""";
            }
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
        }
    }

    private static (GoCardlessApi api, ScriptedHandler handler) Create()
    {
        var handler = new ScriptedHandler();
        var http = new HttpClient(handler) { BaseAddress = new Uri("https://gc.example/api/v2/") };
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["GoCardless:SecretId"] = "sid",
                ["GoCardless:SecretKey"] = "skey",
            })
            .Build();
        return (new GoCardlessApi(http, config), handler);
    }

    [Fact]
    public async Task Token_is_fetched_once_and_reused_as_bearer()
    {
        var (api, handler) = Create();
        await api.GetInstitutionsAsync("nl");
        await api.GetRequisitionAsync("req-1");
        Assert.Equal(1, handler.TokenCalls); // cached until expiry
        // every vendor call after the token carries it
        Assert.All(handler.Requests.Where(r => !r.Path.EndsWith("token/new/")), r => Assert.Equal("tok-1", r.Auth));
    }

    [Fact]
    public async Task Envelopes_unwrap_and_query_parameters_are_shaped_correctly()
    {
        var (api, handler) = Create();
        Assert.Equal("NL69INGB0123456789", (await api.GetAccountDetailsAsync("a1")).Iban);
        Assert.Equal("closingBooked", (await api.GetBalancesAsync("a1"))[0].BalanceType);
        var page = await api.GetTransactionsAsync("a1", new DateOnly(2026, 1, 15));
        Assert.Equal("T1", page.Booked[0].TransactionId);
        Assert.Equal("P1", page.Pending[0].InternalTransactionId); // reserved charges surface too
        Assert.Equal(new GcRateInfo(4, 3, 3600), page.Rate); // budget headers parsed
        Assert.Equal("LN", (await api.ListRequisitionsAsync())[0].Status);
        Assert.Equal("https://gc/auth", (await api.CreateRequisitionAsync("ING_NL", "https://app", "ref-1")).Link);
        // the deep-history agreement rode along on the consent (2y ask)
        Assert.Contains("agr-1", handler.LastRequisitionBody);
        await api.DeleteRequisitionAsync("req-9"); // 204 is success
    }

    [Fact]
    public async Task Vendor_errors_surface_as_HttpRequestException()
    {
        var (api, _) = Create();
        await Assert.ThrowsAsync<HttpRequestException>(() => api.GetRequisitionAsync("broken"));
    }
}
