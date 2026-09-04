using System.Security.Cryptography;
using System.Text;

namespace Munni.Api.GoCardless;

/// <summary>A bank-consent journey (one user connecting one institution).</summary>
public class GcRequisition
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string SpaceId { get; set; }
    public required string InstitutionId { get; set; }
    /// <summary>the provider's consent id (GC requisition / EB session).</summary>
    public required string RequisitionId { get; set; }
    public required string Status { get; set; } // created | approved (consented, ingest pending) | linked | expired
    /// <summary>which bank-data provider owns this consent</summary>
    public string Provider { get; set; } = "gocardless";
    /// <summary>deep-link scheme when the consent started in a native
    /// shell — the hosted callback page reads it from the complete
    /// response to hand the user back into the app</summary>
    public string? AppScheme { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>A linked bank account being fetched on schedule.</summary>
public class GcLinkedAccount
{
    /// <summary>GoCardless account id.</summary>
    public required string GcAccountId { get; set; }
    public required string SpaceId { get; set; }
    /// <summary>entity id of the account row in the space (uuidv5 of the IBAN).</summary>
    public required string AccountEntityId { get; set; }
    public required string Iban { get; set; }
    public required string Currency { get; set; }
    public Guid RequisitionId { get; set; }
    /// <summary>which bank-data provider fetches this account</summary>
    public string Provider { get; set; } = "gocardless";
    public DateTimeOffset? LastFetchAt { get; set; }
    /// <summary>
    /// when the full 90-day history landed in the account's FEED space —
    /// null forces a one-time backfill on the next fetch (accounts linked
    /// before the feed-space migration only ever got deltas there).
    /// </summary>
    public DateTimeOffset? HistoryBackfilledAt { get; set; }
    /// <summary>per-endpoint daily success budget GoCardless reported (rate headers)</summary>
    public int? DailySuccessLimit { get; set; }
    public int? SuccessRemaining { get; set; }
    public DateTimeOffset? RateResetAt { get; set; }
}

/// <summary>
/// Pending (reserved) transactions currently mirrored into the feed —
/// tracked per account so ones that leave the bank's pending list
/// (booked or dropped) get tombstoned on the next fetch.
/// </summary>
public class GcPendingTx
{
    public required string GcAccountId { get; set; }
    public required string EntityId { get; set; }
}

/// <summary>
/// Vendored copy of a bank's logo (user rule: the app must not hotlink
/// the provider CDN). The institutions list records each logo URL; the
/// bytes are fetched once on first serve and kept forever.
/// </summary>
public class GcInstitutionLogo
{
    public required string InstitutionId { get; set; }
    public required string LogoUrl { get; set; }
    public string? ContentType { get; set; }
    public byte[]? Bytes { get; set; }
    public DateTimeOffset? FetchedAt { get; set; }
}

/// <summary>
/// RFC 4122 v5 (SHA-1, name-based) UUIDs with the same namespace as the
/// client importer (apps/web/src/features/accounts/importCamt.ts), so a
/// GoCardless account/transaction and a CAMT import of the same bank data
/// produce identical entity ids — cross-source dedupe by construction.
/// </summary>
public static class ImportIds
{
    private static readonly Guid Namespace = Guid.Parse("5f3c9a70-0d3e-4e0f-9a57-6d2b3a1c8e42");

    public static string AccountId(string iban) => V5($"acct:{Normalize(iban)}").ToString();
    public static string TransactionId(string iban, string reference) => V5($"tx:{Normalize(iban)}:{reference}").ToString();
    /// <summary>sync-space id of a bank account's feed (matches client feedIds.ts)</summary>
    public static string FeedSpaceId(string iban) => V5($"feed:{Normalize(iban)}").ToString();
    /// <summary>per-space overlay row id for a raw transaction (matches client feedIds.ts)</summary>
    public static string TxMetaId(string spaceId, string txId) => V5($"meta:{spaceId}:{txId}").ToString();
    /// <summary>attachment mirror row id, one per account per space (matches client feedIds.ts)</summary>
    public static string AccountLinkId(string spaceId, string feedId) => V5($"link:{spaceId}:{feedId}").ToString();
    /// <summary>deterministic op ids so server-side ingests are idempotent</summary>
    public static string OpId(string seed) => V5($"op:{seed}").ToString();

    public static string Normalize(string iban) => iban.Replace(" ", "").ToUpperInvariant();

    private static Guid V5(string name)
    {
        var namespaceBytes = Namespace.ToByteArray();
        SwapByteOrder(namespaceBytes); // RFC byte order
        var nameBytes = Encoding.UTF8.GetBytes(name);
        // SHA-1 is what RFC 4122 mandates for name-based v5 UUIDs — this is
        // deterministic id derivation, not a security hash (sonar S4790: safe)
        var hash = SHA1.HashData([.. namespaceBytes, .. nameBytes]);

        var guid = new byte[16];
        Array.Copy(hash, guid, 16);
        guid[6] = (byte)((guid[6] & 0x0F) | 0x50); // version 5
        guid[8] = (byte)((guid[8] & 0x3F) | 0x80); // variant
        SwapByteOrder(guid);
        return new Guid(guid);
    }

    private static void SwapByteOrder(byte[] guid)
    {
        void Swap(int a, int b) => (guid[a], guid[b]) = (guid[b], guid[a]);
        Swap(0, 3);
        Swap(1, 2);
        Swap(4, 5);
        Swap(6, 7);
    }
}
