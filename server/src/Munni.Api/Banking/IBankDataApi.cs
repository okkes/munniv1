using Munni.Api.GoCardless;

namespace Munni.Api.Banking;

/// <summary>
/// Provider-agnostic bank-data operations. The GoCardless record shapes
/// are the lingua franca — every provider maps into them, so the ingest
/// pipeline, the scheduler and the clients never care who fetched.
/// </summary>
public interface IBankDataApi
{
    /// <summary>stable id stored on requisitions/linked accounts ("gocardless", "enablebanking")</summary>
    string ProviderId { get; }

    Task<IReadOnlyList<GcInstitution>> GetInstitutionsAsync(string country, CancellationToken ct = default);

    /// <summary>starts a consent journey; the returned link sends the user to the bank</summary>
    Task<GcRequisitionCreated> CreateRequisitionAsync(string institutionId, string redirect, string reference, CancellationToken ct = default);

    /// <summary>
    /// resolves a consent after the bank redirect. `authCode` is the
    /// provider's redirect code when it uses one (Enable Banking); the
    /// returned status Id may DIFFER from the input (EB: auth → session id)
    /// and must be persisted by the caller.
    /// </summary>
    Task<GcRequisitionStatus> CompleteAuthAsync(string requisitionId, string? authCode, CancellationToken ct = default);

    Task<GcAccountDetails> GetAccountDetailsAsync(string accountId, CancellationToken ct = default);
    Task<IReadOnlyList<GcBalance>> GetBalancesAsync(string accountId, CancellationToken ct = default);
    Task<GcTransactionsPage> GetTransactionsAsync(string accountId, DateOnly? from, CancellationToken ct = default);
}

/// <summary>GoCardless behind the provider-agnostic surface.</summary>
public sealed class GoCardlessBankApi(IGoCardlessApi gc) : IBankDataApi
{
    public const string Id = "gocardless";
    public string ProviderId => Id;

    public Task<IReadOnlyList<GcInstitution>> GetInstitutionsAsync(string country, CancellationToken ct = default) =>
        gc.GetInstitutionsAsync(country, ct);

    public Task<GcRequisitionCreated> CreateRequisitionAsync(string institutionId, string redirect, string reference, CancellationToken ct = default) =>
        gc.CreateRequisitionAsync(institutionId, redirect, reference, ct);

    public Task<GcRequisitionStatus> CompleteAuthAsync(string requisitionId, string? authCode, CancellationToken ct = default) =>
        gc.GetRequisitionAsync(requisitionId, ct); // GC needs no code — consent state lives server-side

    public Task<GcAccountDetails> GetAccountDetailsAsync(string accountId, CancellationToken ct = default) =>
        gc.GetAccountDetailsAsync(accountId, ct);

    public Task<IReadOnlyList<GcBalance>> GetBalancesAsync(string accountId, CancellationToken ct = default) =>
        gc.GetBalancesAsync(accountId, ct);

    public Task<GcTransactionsPage> GetTransactionsAsync(string accountId, DateOnly? from, CancellationToken ct = default) =>
        gc.GetTransactionsAsync(accountId, from, ct);
}
