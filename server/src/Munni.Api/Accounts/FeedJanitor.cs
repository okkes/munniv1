using Microsoft.EntityFrameworkCore;
using Munni.Api.Data;
using Munni.Api.GoCardless;

namespace Munni.Api.Accounts;

/// <summary>
/// #240 r3: server-side attachments whose accountLink MIRROR the space
/// tombstoned are dead — the space said no, but the server row survived
/// (historically because GC ingest stamped AttachedBy with the feed
/// owner instead of the acting user) and kept the feed "reachable": it
/// re-synced to devices as an unremovable shared-with-me orphan living
/// in no space at all (user screenshot 2026-08-15). Dropping the dead
/// rows lets /me/spaces stop listing the feed, so clients purge their
/// local copy on the next sync.
/// </summary>
public static class FeedJanitor
{
    public static async Task<int> RemoveDeadAttachmentsAsync(AppDbContext db, string? feedSpaceId = null, CancellationToken ct = default)
    {
        var links = await db.SpaceAccountLinks
            .Where(l => feedSpaceId == null || l.FeedSpaceId == feedSpaceId)
            .ToListAsync(ct);
        if (links.Count == 0) return 0;
        var mirrorIds = links.Select(l => ImportIds.AccountLinkId(l.SpaceId, l.FeedSpaceId)).Distinct().ToList();
        var dead = await db.EntityRows
            .Where(r => r.Entity == "accountLink" && r.Deleted && mirrorIds.Contains(r.EntityId))
            .Select(r => new { r.SpaceId, r.EntityId })
            .ToListAsync(ct);
        if (dead.Count == 0) return 0;
        var deadKeys = dead.Select(d => (d.SpaceId, d.EntityId)).ToHashSet();
        var doomed = links.Where(l => deadKeys.Contains((l.SpaceId, ImportIds.AccountLinkId(l.SpaceId, l.FeedSpaceId)))).ToList();
        if (doomed.Count == 0) return 0;
        db.SpaceAccountLinks.RemoveRange(doomed);
        await db.SaveChangesAsync(ct);
        return doomed.Count;
    }
}
