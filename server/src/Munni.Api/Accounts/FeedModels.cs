namespace Munni.Api.Accounts;

/// <summary>
/// Registry of feed spaces (shared-accounts design): a feed holds ONE
/// bank account's raw data and its id is deterministic —
/// uuidv5("feed:" + account ref). Deterministic ids are guessable, so
/// feeds are NEVER created by the generic first-push rule (security
/// review S1); they exist only through this registry, written by the
/// owning flows (bank connect / statement import).
/// </summary>
public class FeedSpace
{
    /// <summary>The feed space id (uuidv5, version-5 shaped).</summary>
    public required string Id { get; set; }

    /// <summary>Who connected/imported this account first.</summary>
    public Guid OwnerUserId { get; set; }

    /// <summary>Normalized account reference (IBAN / savings ref / card ref).</summary>
    public required string AccountRef { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Server-authoritative attachment of a feed's account to a space.
/// Members of the space derive read access to the feed through this
/// row; the client mirrors it into the space as a synced accountLink
/// row for offline rendering.
/// </summary>
public class SpaceAccountLink
{
    public Guid Id { get; set; }
    public required string SpaceId { get; set; }
    public required string FeedSpaceId { get; set; }

    /// <summary>Account row id inside the feed space.</summary>
    public required string AccountId { get; set; }

    public Guid AttachedBy { get; set; }

    /// <summary>Only transactions from this date onward are visible in the space (yyyy-mm-dd).</summary>
    public string? HistoryFrom { get; set; }

    /// <summary>Set when the attaching member left the space: history stays, new data stops.</summary>
    public bool Archived { get; set; }

    /// <summary>Feed-space cursor frozen at archive time — pulls are capped here while archived.</summary>
    public long? ArchivedAtSeq { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// #240 (user ruling 2026-08-15): CO-ownership. Anyone who completes
/// their OWN bank consent covering an account owns it exactly like the
/// first connector — the IBAN proves it is the same account. "Shared
/// with me" is only for accounts reached through someone else's
/// attachment. The row remembers WHICH consent proved it, so a leaving
/// owner's fetch binding can hand over to a survivor's consent.
/// </summary>
public class FeedOwner
{
    public required string FeedSpaceId { get; set; }
    public Guid UserId { get; set; }

    /// <summary>the consent that proved ownership (fetch hand-off)</summary>
    public Guid? RequisitionId { get; set; }

    /// <summary>the provider's account id under THAT consent (EB ids are per-session)</summary>
    public string? GcAccountId { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
