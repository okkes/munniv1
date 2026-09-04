using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json.Serialization;
using Microsoft.IdentityModel.Tokens;
using Munni.Api.GoCardless;

namespace Munni.Api.Banking;

/// <summary>
/// Enable Banking (enablebanking.com) — the free-for-personal-use PSD2
/// aggregator that maps cleanly onto munni's provider surface. Auth is a
/// short-lived RS256 JWT signed with the application's private key
/// (EnableBanking:ApplicationId + EnableBanking:PrivateKeyPem). Consent
/// is session-based: /auth starts the journey, the bank redirect brings
/// a `code`, POST /sessions exchanges it and lists the account uids.
/// </summary>
public sealed class EnableBankingApi(HttpClient http, IConfiguration config) : IBankDataApi
{
    public const string Id = "enablebanking";
    public string ProviderId => Id;

    // PROCESS-WIDE signing state, never disposed. The instance is a
    // transient typed client, and IdentityModel's global signature-
    // provider cache keys RsaSecurityKey(RSA) instances by an EMPTY
    // InternalId — so the FIRST instance's provider was cached forever
    // and, once that instance's Dispose() killed its RSA, every later
    // request signed with a dead key ("Cannot access a disposed object:
    // RSAOpenSsl", user outage 2026-07-18). One static key ends both
    // the disposal race and the per-request PEM re-import.
    private static readonly object JwtGate = new();
    private static RsaSecurityKey? _key;
    private static string? _cachedJwt;
    private static DateTimeOffset _jwtExpires = DateTimeOffset.MinValue;

    // ── auth ────────────────────────────────────────────────────────────
    private string GetJwt() =>
        GetOrMintJwt(
            config["EnableBanking:PrivateKeyPem"] ?? throw new InvalidOperationException("EnableBanking:PrivateKeyPem missing"),
            config["EnableBanking:ApplicationId"]);

    private static string GetOrMintJwt(string pem, string? applicationId)
    {
        lock (JwtGate)
        {
            if (_cachedJwt is not null && DateTimeOffset.UtcNow < _jwtExpires) return _cachedJwt;
            if (_key is null)
            {
                var rsa = RSA.Create();
                // env files carry the PEM as one line with \n escapes
                rsa.ImportFromPem(pem.Replace("\\n", "\n"));
                _key = new RsaSecurityKey(rsa) { KeyId = applicationId };
            }
            var now = DateTimeOffset.UtcNow;
            var token = new JwtSecurityToken(
                issuer: "enablebanking.com",
                audience: "api.enablebanking.com",
                claims: [new Claim(JwtRegisteredClaimNames.Iat, now.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)],
                expires: now.AddHours(1).UtcDateTime,
                signingCredentials: new SigningCredentials(_key, SecurityAlgorithms.RsaSha256));
            _cachedJwt = new JwtSecurityTokenHandler().WriteToken(token);
            _jwtExpires = now.AddMinutes(55);
            return _cachedJwt;
        }
    }

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new("Bearer", GetJwt());
        if (body is not null) request.Content = JsonContent.Create(body);
        var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            // surface Enable Banking's OWN error text (they explain 403s:
            // inactive application, unregistered redirect, IP allowlist…)
            var detail = await response.Content.ReadAsStringAsync(ct);
            if (detail.Length > 200) detail = detail[..200];
            throw new HttpRequestException(
                $"{(int)response.StatusCode} {response.StatusCode} from {path}: {detail}", null, response.StatusCode);
        }
        return (await response.Content.ReadFromJsonAsync<T>(ct))!;
    }

    // ── institutions ────────────────────────────────────────────────────
    private sealed record Aspsp(
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("country")] string Country,
        [property: JsonPropertyName("bic")] string? Bic,
        [property: JsonPropertyName("logo")] string? Logo,
        [property: JsonPropertyName("transaction_total_days")] int? TransactionTotalDays);
    private sealed record AspspList([property: JsonPropertyName("aspsps")] List<Aspsp> Aspsps);

    /// <summary>institution id encoding: "{name}|{country}" (EB banks are keyed by that pair)</summary>
    public async Task<IReadOnlyList<GcInstitution>> GetInstitutionsAsync(string country, CancellationToken ct = default)
    {
        var list = await SendAsync<AspspList>(HttpMethod.Get, $"aspsps?country={Uri.EscapeDataString(country.ToUpperInvariant())}", null, ct);
        return list.Aspsps
            .Select(a => new GcInstitution($"{a.Name}|{a.Country}", a.Name, a.Bic, a.TransactionTotalDays?.ToString(), a.Logo))
            .ToList();
    }

    // ── consent ─────────────────────────────────────────────────────────
    private sealed record AuthResponse([property: JsonPropertyName("url")] string Url);

    public async Task<GcRequisitionCreated> CreateRequisitionAsync(string institutionId, string redirect, string reference, CancellationToken ct = default)
    {
        var separator = institutionId.LastIndexOf('|');
        if (separator < 0) throw new ArgumentException($"not an Enable Banking institution id: {institutionId}");
        var auth = await SendAsync<AuthResponse>(HttpMethod.Post, "auth", new
        {
            access = new { valid_until = DateTimeOffset.UtcNow.AddDays(90).ToString("o") },
            aspsp = new { name = institutionId[..separator], country = institutionId[(separator + 1)..] },
            state = reference,
            redirect_url = redirect,
            psu_type = "personal",
        }, ct);
        // no provider-side id yet: the session is born at complete time
        return new GcRequisitionCreated(reference, auth.Url, "CR");
    }

    private sealed record SessionAccount([property: JsonPropertyName("uid")] string? Uid);
    private sealed record SessionResponse(
        [property: JsonPropertyName("session_id")] string? SessionId,
        [property: JsonPropertyName("accounts")] List<SessionAccount>? Accounts);
    private sealed record SessionStatus(
        [property: JsonPropertyName("status")] string? Status,
        [property: JsonPropertyName("accounts")] List<string>? Accounts);

    public async Task<GcRequisitionStatus> CompleteAuthAsync(string requisitionId, string? authCode, CancellationToken ct = default)
    {
        if (!string.IsNullOrEmpty(authCode))
        {
            var session = await SendAsync<SessionResponse>(HttpMethod.Post, "sessions", new { code = authCode }, ct);
            var uids = session.Accounts?.Where(a => a.Uid is not null).Select(a => a.Uid!).ToList() ?? [];
            return new GcRequisitionStatus(session.SessionId ?? requisitionId, "LN", uids);
        }
        // no code = a retry after the session already exists
        var existing = await SendAsync<SessionStatus>(HttpMethod.Get, $"sessions/{Uri.EscapeDataString(requisitionId)}", null, ct);
        var status = existing.Status?.ToUpperInvariant() == "AUTHORIZED" ? "LN" : existing.Status ?? "CR";
        return new GcRequisitionStatus(requisitionId, status, existing.Accounts ?? []);
    }

    // ── account data ────────────────────────────────────────────────────
    private sealed record EbAccountId([property: JsonPropertyName("iban")] string? Iban);
    private sealed record EbDetails(
        [property: JsonPropertyName("account_id")] EbAccountId? AccountId,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("currency")] string? Currency,
        [property: JsonPropertyName("owner_name")] string? OwnerName);

    public async Task<GcAccountDetails> GetAccountDetailsAsync(string accountId, CancellationToken ct = default)
    {
        var details = await SendAsync<EbDetails>(HttpMethod.Get, $"accounts/{Uri.EscapeDataString(accountId)}/details", null, ct);
        return new GcAccountDetails(details.AccountId?.Iban, details.Name, details.Currency, details.OwnerName);
    }

    private sealed record EbAmount(
        [property: JsonPropertyName("amount")] string Amount,
        [property: JsonPropertyName("currency")] string Currency);
    private sealed record EbBalance(
        [property: JsonPropertyName("balance_amount")] EbAmount BalanceAmount,
        [property: JsonPropertyName("balance_type")] string? BalanceType);
    private sealed record EbBalances([property: JsonPropertyName("balances")] List<EbBalance> Balances);

    private static string MapBalanceType(string? type) => type?.ToUpperInvariant() switch
    {
        "CLBD" => "closingBooked",
        "ITBD" => "interimBooked",
        var other => other ?? "",
    };

    public async Task<IReadOnlyList<GcBalance>> GetBalancesAsync(string accountId, CancellationToken ct = default)
    {
        var result = await SendAsync<EbBalances>(HttpMethod.Get, $"accounts/{Uri.EscapeDataString(accountId)}/balances", null, ct);
        return result.Balances
            .Select(b => new GcBalance(new GcAmount(b.BalanceAmount.Amount, b.BalanceAmount.Currency), MapBalanceType(b.BalanceType)))
            .ToList();
    }

    private sealed record EbParty([property: JsonPropertyName("name")] string? Name);
    private sealed record EbTransaction(
        [property: JsonPropertyName("entry_reference")] string? EntryReference,
        [property: JsonPropertyName("transaction_amount")] EbAmount TransactionAmount,
        [property: JsonPropertyName("credit_debit_indicator")] string? CreditDebitIndicator,
        [property: JsonPropertyName("status")] string? Status,
        [property: JsonPropertyName("booking_date")] string? BookingDate,
        [property: JsonPropertyName("value_date")] string? ValueDate,
        [property: JsonPropertyName("remittance_information")] List<string>? RemittanceInformation,
        [property: JsonPropertyName("creditor")] EbParty? Creditor,
        [property: JsonPropertyName("debtor")] EbParty? Debtor,
        [property: JsonPropertyName("creditor_account")] EbAccountId? CreditorAccount,
        [property: JsonPropertyName("debtor_account")] EbAccountId? DebtorAccount);
    private sealed record EbTransactions(
        [property: JsonPropertyName("transactions")] List<EbTransaction> Transactions,
        [property: JsonPropertyName("continuation_key")] string? ContinuationKey);

    public async Task<GcTransactionsPage> GetTransactionsAsync(string accountId, DateOnly? from, CancellationToken ct = default)
    {
        var booked = new List<GcTransaction>();
        var pending = new List<GcTransaction>();
        string? continuation = null;
        // continuation-key pagination, capped defensively
        for (var page = 0; page < 10; page++)
        {
            var query = $"accounts/{Uri.EscapeDataString(accountId)}/transactions";
            var parameters = new List<string>();
            if (from is { } f) parameters.Add($"date_from={f:yyyy-MM-dd}");
            if (continuation is not null) parameters.Add($"continuation_key={Uri.EscapeDataString(continuation)}");
            if (parameters.Count > 0) query += "?" + string.Join('&', parameters);

            var result = await SendAsync<EbTransactions>(HttpMethod.Get, query, null, ct);
            foreach (var tx in result.Transactions)
            {
                var mapped = MapTransaction(tx);
                if (tx.Status?.ToUpperInvariant() == "PDNG") pending.Add(mapped);
                else booked.Add(mapped);
            }
            continuation = result.ContinuationKey;
            if (continuation is null) break;
        }
        return new GcTransactionsPage(booked, pending, null); // EB publishes no per-account budget headers
    }

    private static GcTransaction MapTransaction(EbTransaction tx)
    {
        // EB amounts are positive with a separate direction — the ingest
        // expects GC's signed convention
        var debit = tx.CreditDebitIndicator?.ToUpperInvariant() == "DBIT";
        var amount = debit && !tx.TransactionAmount.Amount.StartsWith('-')
            ? "-" + tx.TransactionAmount.Amount
            : tx.TransactionAmount.Amount;
        return new GcTransaction(
            tx.EntryReference,
            null,
            tx.BookingDate,
            tx.ValueDate,
            new GcAmount(amount, tx.TransactionAmount.Currency),
            tx.Creditor?.Name,
            tx.Debtor?.Name,
            tx.RemittanceInformation is { Count: > 0 } remittance ? string.Join(' ', remittance) : null,
            new GcAccountReference(tx.CreditorAccount?.Iban),
            new GcAccountReference(tx.DebtorAccount?.Iban));
    }

}
