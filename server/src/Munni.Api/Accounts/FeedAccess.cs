using Microsoft.EntityFrameworkCore;
using Munni.Api.Data;

namespace Munni.Api.Accounts;

/// <summary>
/// Feed-space access rules. Feeds are never members' spaces directly:
/// the owner registered them, and everyone else derives READ access
/// through an attachment in a space they belong to. Writes to a feed
/// stay owner-only (raw bank truth has one author; every space's
/// opinion lives in its own overlay rows).
/// </summary>
public static class FeedAccess
{
    /// <summary>uuid version 5 = deterministic feed-shaped id (normal spaces are v7 or free-form).</summary>
    public static bool IsFeedShaped(string spaceId)
    {
        if (!Guid.TryParseExact(spaceId, "D", out _)) return false;
        // canonical form: version nibble is the 15th hex character
        return spaceId.Length == 36 && spaceId[14] == '5';
    }

    /// <summary>#240: ownership is the recorded first owner OR any
    /// co-owner (their own consent covered the account) — both edit,
    /// attach and delete like the account is theirs, because it is.</summary>
    public static async Task<bool> IsFeedOwner(AppDbContext db, Guid userId, string feedSpaceId) =>
        await db.FeedSpaces.AnyAsync(f => f.Id == feedSpaceId && f.OwnerUserId == userId)
        || await db.FeedOwners.AnyAsync(o => o.FeedSpaceId == feedSpaceId && o.UserId == userId);

    /// <summary>
    /// Read access + cursor cap. Returns null when the user may not read;
    /// long.MaxValue for unlimited; otherwise the archived-at cap (only
    /// archived attachments reach the user — history stays, new data stops).
    /// </summary>
    public static async Task<long?> ReadCapAsync(AppDbContext db, Guid userId, string feedSpaceId)
    {
        if (await IsFeedOwner(db, userId, feedSpaceId)) return long.MaxValue;

        var mySpaceIds = db.SpaceMembers.Where(m => m.UserId == userId).Select(m => m.SpaceId);
        var links = await db.SpaceAccountLinks
            .Where(l => l.FeedSpaceId == feedSpaceId && mySpaceIds.Contains(l.SpaceId))
            .ToListAsync();
        if (links.Count == 0) return null;
        if (links.Any(l => !l.Archived)) return long.MaxValue;
        return links.Max(l => l.ArchivedAtSeq ?? 0);
    }

    /// <summary>Feed spaces the user can currently read via attachments or ownership (for discovery/SSE).</summary>
    public static async Task<List<string>> ReachableFeedsAsync(AppDbContext db, Guid userId)
    {
        var owned = await db.FeedSpaces.Where(f => f.OwnerUserId == userId).Select(f => f.Id).ToListAsync();
        var coOwned = await db.FeedOwners.Where(o => o.UserId == userId).Select(o => o.FeedSpaceId).ToListAsync();
        var mySpaceIds = db.SpaceMembers.Where(m => m.UserId == userId).Select(m => m.SpaceId);
        var attached = await db.SpaceAccountLinks
            .Where(l => mySpaceIds.Contains(l.SpaceId))
            .Select(l => l.FeedSpaceId)
            .Distinct()
            .ToListAsync();
        return owned.Union(coOwned).Union(attached).ToList();
    }
}
