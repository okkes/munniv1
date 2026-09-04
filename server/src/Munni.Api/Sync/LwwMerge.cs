using System.Text.Json;

namespace Munni.Api.Sync;

/// <summary>
/// One sync operation, as produced by a client's outbox (or by the server
/// itself for bank imports). Mirrors apps/web/src/sync/merge.ts.
/// </summary>
public sealed record SyncOpDto(
    string OpId,
    string SpaceId,
    string Entity,
    string EntityId,
    Dictionary<string, JsonElement> Fields,
    string Hlc,
    bool Deleted = false);

/// <summary>Materialized server-side state of one entity row.</summary>
public sealed class EntityState
{
    public Dictionary<string, JsonElement> Data { get; init; } = new();
    public Dictionary<string, string> FieldVersions { get; init; } = new();
    public bool Deleted { get; set; }
}

/// <summary>
/// Per-field last-writer-wins merge — the exact same rule as the client
/// (apps/web/src/sync/merge.ts), so any order of applying the same ops
/// converges to the same state. HLC stamps are fixed-width sortable
/// strings, so ordinal string comparison is HLC comparison.
///
/// Deletion is the pseudo-field "$deleted"; a row counts as deleted only
/// while the tombstone is newer than every field edit (edits made after a
/// delete revive the row). Keeping `deleted` derived is what makes the
/// merge commutative.
/// </summary>
public static class LwwMerge
{
    public const string DeletedField = "$deleted";

    public static (EntityState State, bool Changed) Apply(EntityState? local, SyncOpDto op)
    {
        var data = new Dictionary<string, JsonElement>(local?.Data ?? new());
        var versions = new Dictionary<string, string>(local?.FieldVersions ?? new());
        var applied = 0;

        foreach (var (field, value) in op.Fields)
        {
            if (!versions.TryGetValue(field, out var current) || string.CompareOrdinal(op.Hlc, current) > 0)
            {
                versions[field] = op.Hlc;
                data[field] = value;
                applied++;
            }
        }

        if (op.Deleted && (!versions.TryGetValue(DeletedField, out var tombstone) || string.CompareOrdinal(op.Hlc, tombstone) > 0))
        {
            versions[DeletedField] = op.Hlc;
            applied++;
        }

        if (local is not null && applied == 0) return (local, false);

        var state = new EntityState { Data = data, FieldVersions = versions, Deleted = DeriveDeleted(versions) };
        return (state, true);
    }

    private static bool DeriveDeleted(Dictionary<string, string> versions)
    {
        if (!versions.TryGetValue(DeletedField, out var tombstone)) return false;
        foreach (var (field, version) in versions)
        {
            if (field != DeletedField && string.CompareOrdinal(version, tombstone) > 0) return false;
        }
        return true;
    }
}
