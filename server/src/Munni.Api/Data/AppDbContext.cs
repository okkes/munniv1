using Microsoft.EntityFrameworkCore;
using Munni.Api.Accounts;
using Munni.Api.GoCardless;
using Munni.Api.Push;
using Munni.Api.Social;

namespace Munni.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Space> Spaces => Set<Space>();
    public DbSet<SpaceMember> SpaceMembers => Set<SpaceMember>();
    public DbSet<SyncOpRow> SyncOps => Set<SyncOpRow>();
    public DbSet<EntityRow> EntityRows => Set<EntityRow>();
    public DbSet<GcRequisition> GcRequisitions => Set<GcRequisition>();
    public DbSet<GcLinkedAccount> GcLinkedAccounts => Set<GcLinkedAccount>();
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<SpaceInvite> SpaceInvites => Set<SpaceInvite>();
    public DbSet<PushSubscriptionRow> PushSubscriptions => Set<PushSubscriptionRow>();
    public DbSet<FeedSpace> FeedSpaces => Set<FeedSpace>();
    public DbSet<SpaceAccountLink> SpaceAccountLinks => Set<SpaceAccountLink>();
    public DbSet<GcPendingTx> GcPendingTxs => Set<GcPendingTx>();
    public DbSet<GcInstitutionLogo> GcInstitutionLogos => Set<GcInstitutionLogo>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<StoreSyncDevice> StoreSyncDevices => Set<StoreSyncDevice>();
    public DbSet<UserDevice> UserDevices => Set<UserDevice>();
    public DbSet<StoreConnCipher> StoreConnCiphers => Set<StoreConnCipher>();
    public DbSet<AdminGrant> AdminGrants => Set<AdminGrant>();
    public DbSet<ProviderQuota> ProviderQuotas => Set<ProviderQuota>();
    public DbSet<Split> Splits => Set<Split>();
    public DbSet<SplitMember> SplitMembers => Set<SplitMember>();
    public DbSet<SplitEntry> SplitEntries => Set<SplitEntry>();
    public DbSet<SplitInvite> SplitInvites => Set<SplitInvite>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Sub).IsUnique();
        });
        modelBuilder.Entity<Space>(e => e.HasKey(x => x.Id));
        modelBuilder.Entity<SpaceMember>(e =>
        {
            e.HasKey(x => new { x.SpaceId, x.UserId });
            e.HasIndex(x => x.UserId);
        });
        modelBuilder.Entity<SyncOpRow>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.SpaceId, x.Seq }).IsUnique();
            e.HasIndex(x => new { x.SpaceId, x.OpId }).IsUnique();
        });
        modelBuilder.Entity<EntityRow>(e => e.HasKey(x => new { x.SpaceId, x.Entity, x.EntityId }));
        modelBuilder.Entity<UserDevice>(e =>
        {
            // the same physical device can serve several accounts
            e.HasKey(x => new { x.UserId, x.Id });
        });
        modelBuilder.Entity<GcRequisition>(e => e.HasKey(x => x.Id));
        modelBuilder.Entity<GcInstitutionLogo>(e => e.HasKey(x => x.InstitutionId));
        modelBuilder.Entity<GcLinkedAccount>(e =>
        {
            e.HasKey(x => x.GcAccountId);
            e.HasIndex(x => x.SpaceId);
        });
        modelBuilder.Entity<Friendship>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.UserAId, x.UserBId }).IsUnique();
        });
        modelBuilder.Entity<SpaceInvite>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.ToUserId);
        });
        modelBuilder.Entity<PushSubscriptionRow>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Endpoint).IsUnique();
            e.HasIndex(x => x.UserId);
        });
        modelBuilder.Entity<FeedSpace>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.OwnerUserId);
        });
        modelBuilder.Entity<SpaceAccountLink>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.SpaceId, x.FeedSpaceId, x.AccountId }).IsUnique();
            e.HasIndex(x => x.FeedSpaceId);
        });
        modelBuilder.Entity<GcPendingTx>(e => e.HasKey(x => new { x.GcAccountId, x.EntityId }));
        modelBuilder.Entity<AppSetting>(e => e.HasKey(x => x.Key));
        modelBuilder.Entity<StoreSyncDevice>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.UserId, x.DeviceId }).IsUnique();
        });
        modelBuilder.Entity<StoreConnCipher>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.UserId, x.Store }).IsUnique();
        });
        modelBuilder.Entity<AdminGrant>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Sub).IsUnique();
        });
        modelBuilder.Entity<ProviderQuota>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.Provider, x.Scope }).IsUnique();
        });
        modelBuilder.Entity<Split>(e => e.HasKey(x => x.Id));
        modelBuilder.Entity<SplitMember>(e =>
        {
            e.HasKey(x => new { x.SplitId, x.UserId });
            e.HasIndex(x => x.UserId);
        });
        modelBuilder.Entity<SplitEntry>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.SplitId);
        });
        modelBuilder.Entity<SplitInvite>(e =>
        {
            e.HasKey(x => x.Token);
            e.HasIndex(x => x.SplitId);
        });
    }
}

/// <summary>
/// A split session (settleup-splits design): Splitwise-style group
/// ledger with membership INDEPENDENT of spaces. Server-resident and
/// online-only by design — guests must never touch space scopes.
/// </summary>
public class Split
{
    /// <summary>client-generated id (uuidv7)</summary>
    public required string Id { get; set; }
    public required string Name { get; set; }
    /// <summary>fixed at creation (user decision Q2)</summary>
    public required string Currency { get; set; }
    public string Status { get; set; } = "open"; // open | settled
    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class SplitMember
{
    public required string SplitId { get; set; }
    public Guid UserId { get; set; }
    public required string Role { get; set; } // owner | member
    /// <summary>the member's OWN space this split is wired to (per-member
    /// attachment, user clarification) — personal, only ever shown to them</summary>
    public string? AttachedSpaceId { get; set; }
    /// <summary>the member's OWN event (in their attached space) — SP5;
    /// personal wiring like the space, never shown to other members</summary>
    public string? AttachedEventId { get; set; }
    public DateTimeOffset JoinedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class SplitEntry
{
    /// <summary>client-generated id (uuidv7)</summary>
    public required string Id { get; set; }
    public required string SplitId { get; set; }
    public string Kind { get; set; } = "expense"; // expense | settlement
    public Guid PaidByUserId { get; set; }
    public required string Description { get; set; }
    /// <summary>positive cents in the split's currency</summary>
    public long AmountCents { get; set; }
    /// <summary>yyyy-mm-dd</summary>
    public required string Date { get; set; }
    /// <summary>JSON [{userId,cents}] — ALWAYS materialized at entry
    /// creation (an equal split is computed over the member set of that
    /// moment and stored), so later joins never rewrite history</summary>
    public required string SharesJson { get; set; }
    /// <summary>backlink to the adder's space transaction (SP2) — only ever shown to the adder</summary>
    public string? SourceTxId { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Share-link invite (SP3): any member can mint one; the link joins
/// ANYONE — no friendship required, no space access granted. Multi-use
/// while valid; minting a new link retires the split's previous one.
/// The token is the whole secret, so it's long and random.
/// </summary>
public class SplitInvite
{
    public required string Token { get; set; }
    public required string SplitId { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset ExpiresAt { get; set; }
}

/// <summary>
/// DB-stored admin promotion (admin-redesign AD2): effective admins are
/// the Admin:Subs env list (bootstrap/emergency, immutable from the UI)
/// UNION these grants, managed from the admin console.
/// </summary>
public class AdminGrant
{
    public Guid Id { get; set; }
    public required string Sub { get; set; }
    public required string GrantedBySub { get; set; }
    public DateTimeOffset GrantedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Latest rate-limit headers seen per provider endpoint scope
/// (admin-redesign AD3) — captured by piggybacking on normal sync
/// traffic, never by extra calls. One row per (provider, scope).
/// </summary>
public class ProviderQuota
{
    public Guid Id { get; set; }
    public required string Provider { get; set; }
    /// <summary>endpoint family, e.g. "accounts:transactions" or "requisitions"</summary>
    public required string Scope { get; set; }
    public int? Limit { get; set; }
    public int? Remaining { get; set; }
    public DateTimeOffset? ResetAtUtc { get; set; }
    public DateTimeOffset CapturedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>admin-editable server-wide settings (active bank provider, …)</summary>
public class AppSetting
{
    public required string Key { get; set; }
    public required string Value { get; set; }
}

/// <summary>a device's public key for E2EE store-connection sync (SC1);
/// WrappedCsk is the sync key encrypted TO this device by another one —
/// the server can store it but never open it</summary>
/// <summary>
/// One signed-in device per user (logged-in-devices plan): stamped on
/// every authenticated request (throttled), revocable — a revoked
/// device's next request answers 410 and the client wipes itself.
/// </summary>
public class UserDevice
{
    /// <summary>the client's stable device id (the HLC node id)</summary>
    public required string Id { get; set; }
    public Guid UserId { get; set; }
    /// <summary>web | android | ios (client-declared)</summary>
    public string? Platform { get; set; }
    /// <summary>auto-derived, user-editable (user ruling)</summary>
    public string? Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}

public class StoreSyncDevice
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string DeviceId { get; set; }
    public required string PublicJwk { get; set; }
    public required string Name { get; set; }
    public string? WrappedCsk { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>AES-GCM ciphertext of one store connection's tokens (SC1) —
/// opaque to the server by design</summary>
public class StoreConnCipher
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string Store { get; set; }
    public required string Cipher { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class User
{
    public Guid Id { get; set; }
    /// <summary>OIDC subject (Logto) or test-mode identifier.</summary>
    public required string Sub { get; set; }
    public string? Email { get; set; }
    /// <summary>shown to friends/space members; set by the client after login</summary>
    public string? DisplayName { get; set; }
    /// <summary>avatar preset id ("icon|color"), chosen on the profile screen</summary>
    public string? Picture { get; set; }
    /// <summary>ISO 3166-1 alpha-2 country of use — feeds category prediction</summary>
    public string? Country { get; set; }
    /// <summary>ISO 4217 display currency (currency plan CD3) — null = "as recorded", no conversion</summary>
    public string? DisplayCurrency { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Space
{
    /// <summary>Client-generated id (uuidv7); the unit of sharing and sync.</summary>
    public required string Id { get; set; }
    /// <summary>Monotonic per-space sequence used purely as a pull cursor.</summary>
    public long LastSeq { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class SpaceMember
{
    public required string SpaceId { get; set; }
    public Guid UserId { get; set; }
    public required string Role { get; set; } // owner | member
}

public class SyncOpRow
{
    public long Id { get; set; }
    public required string SpaceId { get; set; }
    public long Seq { get; set; }
    public required string OpId { get; set; }
    public Guid? UserId { get; set; }
    public required string Entity { get; set; }
    public required string EntityId { get; set; }
    public required string Hlc { get; set; }
    /// <summary>JSON-serialized fields dictionary.</summary>
    public required string PayloadJson { get; set; }
    public bool Deleted { get; set; }
    public DateTimeOffset ReceivedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Domain-agnostic materialized state — the server never interprets the
/// app's entities, it only merges and relays them.
/// </summary>
public class EntityRow
{
    public required string SpaceId { get; set; }
    public required string Entity { get; set; }
    public required string EntityId { get; set; }
    public bool Deleted { get; set; }
    public required string DataJson { get; set; }
    public required string FieldVersionsJson { get; set; }
}
