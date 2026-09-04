using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Munni.Api.Data;

namespace Munni.Api.Sync;

/// <summary>
/// The single write path into a space: merge + materialize + record ops.
/// Used by the push endpoint and by server-side producers (GoCardless
/// ingest) — the server is just another device emitting ops.
/// </summary>
public sealed class SyncWriter(AppDbContext db)
{
    /// <summary>
    /// Two writers pushing the same brand-new row (or a push racing the
    /// bank ingest) both pass the FindAsync miss and collide on a primary
    /// key at save (Postgres 23505). The LWW merge makes a clean re-read
    /// converge, so callers retry on exactly this signal.
    /// </summary>
    public static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation };

    /// <summary>Applies ops (idempotent by opId). Caller saves changes.</summary>
    public async Task<(long LastSeq, int Accepted)> ApplyAsync(Space space, Guid? userId, IReadOnlyList<SyncOpDto> ops)
    {
        var incomingIds = ops.Select(o => o.OpId).ToList();
        var known = await db.SyncOps
            .Where(o => o.SpaceId == space.Id && incomingIds.Contains(o.OpId))
            .Select(o => o.OpId)
            .ToListAsync();
        var knownSet = known.ToHashSet();

        var accepted = 0;
        foreach (var op in ops)
        {
            if (!knownSet.Add(op.OpId)) continue; // idempotent retry

            var row = await db.EntityRows.FindAsync(space.Id, op.Entity, op.EntityId);
            var local = row is null
                ? null
                : new EntityState
                {
                    Data = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(row.DataJson) ?? new(),
                    FieldVersions = JsonSerializer.Deserialize<Dictionary<string, string>>(row.FieldVersionsJson) ?? new(),
                    Deleted = row.Deleted,
                };
            var (state, _) = LwwMerge.Apply(local, op with { SpaceId = space.Id });

            if (row is null)
            {
                db.EntityRows.Add(new EntityRow
                {
                    SpaceId = space.Id,
                    Entity = op.Entity,
                    EntityId = op.EntityId,
                    Deleted = state.Deleted,
                    DataJson = JsonSerializer.Serialize(state.Data),
                    FieldVersionsJson = JsonSerializer.Serialize(state.FieldVersions),
                });
            }
            else
            {
                row.Deleted = state.Deleted;
                row.DataJson = JsonSerializer.Serialize(state.Data);
                row.FieldVersionsJson = JsonSerializer.Serialize(state.FieldVersions);
            }

            space.LastSeq++;
            db.SyncOps.Add(new SyncOpRow
            {
                SpaceId = space.Id,
                Seq = space.LastSeq,
                OpId = op.OpId,
                UserId = userId,
                Entity = op.Entity,
                EntityId = op.EntityId,
                Hlc = op.Hlc,
                PayloadJson = JsonSerializer.Serialize(op.Fields),
                Deleted = op.Deleted,
            });
            accepted++;
        }

        return (space.LastSeq, accepted);
    }
}

/// <summary>Server-side HLC stamps, same encoding as the clients (sortable base36).</summary>
public static class ServerHlc
{
    public const string DeviceId = "server";

    public static string Now(int counter = 0) => Encode(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), counter);

    public static string Encode(long wallMs, int counter) =>
        $"{ToBase36(wallMs).PadLeft(9, '0')}-{ToBase36(counter).PadLeft(4, '0')}-{DeviceId}";

    private static string ToBase36(long value)
    {
        const string chars = "0123456789abcdefghijklmnopqrstuvwxyz";
        if (value == 0) return "0";
        var buffer = new System.Text.StringBuilder(13); // enough for long.MaxValue
        while (value > 0)
        {
            buffer.Insert(0, chars[(int)(value % 36)]);
            value /= 36;
        }
        return buffer.ToString();
    }
}
