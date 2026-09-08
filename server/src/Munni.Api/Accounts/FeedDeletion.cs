using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Munni.Api.Auth;
using Munni.Api.Data;
using Munni.Api.GoCardless;
using Munni.Api.Sync;

namespace Munni.Api.Accounts;

public sealed record FeedDeletionResult(bool Erased);

/// <summary>
/// User-initiated deletion of one financial account (= its feed).
/// Ruling (2026-07-20): revoke MINE only — the caller's bank consent
/// always goes, but the raw feed and every space's overlay data are
/// erased ONLY when no other user still covers the account (family
/// accounts share one feed; the healer rebinds the survivors' consent).
/// Order mirrors Social.AccountDeletion: provider consent first, so a
/// scheduled fetch can never resurrect the rows mid-delete.
/// </summary>
public static class FeedDeletion
{
    private sealed record ConsentLink(GcLinkedAccount Account, GcRequisition Requisition);

    public static async Task<IResult> DeleteFeedAccount(
        string feedSpaceId, AppDbContext db, HttpContext http, ILoggerFactory loggerFactory)
    {
        var me = http.GetUserId();
        var feed = await db.FeedSpaces.FindAsync(feedSpaceId);
        if (feed is null) return Results.NotFound();

        // #240 r3: attachments whose mirror the space already tombstoned
        // are dead weight — drop them BEFORE judging "who else uses it",
        // or a mis-stamped AttachedBy keeps an orphan undeletable forever
        await FeedJanitor.RemoveDeadAttachmentsAsync(db, feedSpaceId);

        // every provider link pointing at this feed, with its consent owner
        var allLinks = await (
            from a in db.GcLinkedAccounts
            join r in db.GcRequisitions on a.RequisitionId equals r.Id
            select new { a, r }).ToListAsync();
        var links = allLinks.Select(x => new ConsentLink(x.a, x.r)).ToList();
        var feedLinks = links.Where(x => ImportIds.FeedSpaceId(x.Account.Iban) == feedSpaceId).ToList();
        var mine = feedLinks.Where(x => x.Requisition.UserId == me).ToList();
        var coOwner = await db.FeedOwners.AnyAsync(o => o.FeedSpaceId == feedSpaceId && o.UserId == me);

        // deleting is for accounts you brought in: your feed, your
        // co-ownership (#240: your own consent proved the account) or
        // your consent
        if (feed.OwnerUserId != me && !coOwner && mine.Count == 0) return Results.Forbid();

        // 1 · my consent goes first (fetches stop; nothing resurrects)
        await RevokeMyConsentsAsync(db, http, loggerFactory, links, mine, feedSpaceId, me);

        // 2 · anyone ELSE still covering this account keeps the feed alive
        var otherConsent = feedLinks.Any(x => x.Requisition.UserId != me);
        var otherCoOwner = await db.FeedOwners.AnyAsync(o => o.FeedSpaceId == feedSpaceId && o.UserId != me);
        var otherAttachment = await db.SpaceAccountLinks.AnyAsync(l => l.FeedSpaceId == feedSpaceId && l.AttachedBy != me);
        var otherOwner = feed.OwnerUserId != me && await db.SpaceMembers.AnyAsync(m => m.UserId == feed.OwnerUserId);
        if (otherConsent || otherCoOwner || otherAttachment || otherOwner)
        {
            await RemoveMyViewAsync(db, feed, me, feedLinks);
            await db.SaveChangesAsync();
            return Results.Ok(new FeedDeletionResult(false));
        }

        // 3 · full erasure — nobody living is left behind this feed
        // (#240 r3: a recorded owner with no living presence, e.g. a
        // deleted test identity, no longer blocks the erase)
        await EraseFeedAsync(db, feed);
        await db.SaveChangesAsync();
        return Results.Ok(new FeedDeletionResult(true));
    }

    /// <summary>Remove the caller's links; revoke each of their consents
    /// that no longer covers any account (GC has no partial revocation).
    /// #240: when a CO-owner's own consent still covers the account, the
    /// fetch binding hands over to it instead of dying with mine.</summary>
    private static async Task RevokeMyConsentsAsync(
        AppDbContext db, HttpContext http, ILoggerFactory loggerFactory,
        List<ConsentLink> allLinks, List<ConsentLink> mine, string feedSpaceId, Guid me)
    {
        var logger = loggerFactory.CreateLogger("FeedDeletion");
        var gc = http.RequestServices.GetService<IGoCardlessApi>();
        var myAccountIds = mine.Select(x => x.Account.GcAccountId).ToHashSet();
        db.GcPendingTxs.RemoveRange(await db.GcPendingTxs.Where(p => myAccountIds.Contains(p.GcAccountId)).ToListAsync());

        await HandOverOrDropMyRowsAsync(db, allLinks, mine, feedSpaceId, me);

        foreach (var requisition in mine.Select(x => x.Requisition).DistinctBy(r => r.Id).ToList())
        {
            var stillHasAccounts = allLinks.Any(x =>
                x.Requisition.Id == requisition.Id && !myAccountIds.Contains(x.Account.GcAccountId));
            if (stillHasAccounts) continue;
            if (requisition.Provider == "gocardless" && gc is not null)
            {
                try
                {
                    await gc.DeleteRequisitionAsync(requisition.RequisitionId);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "feed deletion: could not revoke requisition {Id}", requisition.RequisitionId);
                }
            }
            db.GcRequisitions.Remove(requisition);
        }
    }

    /// <summary>
    /// #240: my fetch rows leave — unless a surviving CO-owner's recorded
    /// consent can take the binding over. Same provider id (GoCardless):
    /// the row survives, re-bound in place with null stamps so the next
    /// tick backfills the full window. Per-session ids (Enable Banking):
    /// a fresh row carries the survivor's own pair into the same
    /// IBAN-keyed feed (deterministic entity ids dedupe the overlap).
    /// Another user's own consent already fetching means nothing to do.
    /// </summary>
    private static async Task HandOverOrDropMyRowsAsync(
        AppDbContext db, List<ConsentLink> allLinks, List<ConsentLink> mine, string feedSpaceId, Guid me)
    {
        var otherConsentFetches = allLinks.Any(x =>
            ImportIds.FeedSpaceId(x.Account.Iban) == feedSpaceId && x.Requisition.UserId != me);
        var survivor = otherConsentFetches
            ? null
            : await db.FeedOwners
                .Where(o => o.FeedSpaceId == feedSpaceId && o.UserId != me && o.RequisitionId != null && o.GcAccountId != null)
                .OrderByDescending(o => o.CreatedAt)
                .FirstOrDefaultAsync();
        var survivorRequisition = survivor is null ? null : await db.GcRequisitions.FindAsync(survivor.RequisitionId);

        var kept = survivorRequisition is null
            ? null
            : mine.Select(x => x.Account).FirstOrDefault(a => a.GcAccountId == survivor!.GcAccountId);
        if (kept is not null)
        {
            kept.RequisitionId = survivorRequisition!.Id;
            kept.SpaceId = survivorRequisition.SpaceId;
            kept.Provider = survivorRequisition.Provider;
            kept.LastFetchAt = null;
            kept.HistoryBackfilledAt = null;
        }
        else if (survivorRequisition is not null && mine.Count > 0)
        {
            var taken = mine[0].Account;
            db.GcLinkedAccounts.Add(new GcLinkedAccount
            {
                GcAccountId = survivor!.GcAccountId!,
                SpaceId = survivorRequisition.SpaceId,
                AccountEntityId = taken.AccountEntityId,
                Iban = taken.Iban,
                Currency = taken.Currency,
                RequisitionId = survivorRequisition.Id,
                Provider = survivorRequisition.Provider,
            });
        }
        db.GcLinkedAccounts.RemoveRange(mine.Select(x => x.Account).Where(a => !ReferenceEquals(a, kept)));
    }

    /// <summary>Partial path: my attachments disappear, the others keep
    /// theirs; ownership follows a remaining coverer so they can attach.</summary>
    private static async Task RemoveMyViewAsync(AppDbContext db, FeedSpace feed, Guid me, List<ConsentLink> feedLinks)
    {
        var myLinks = await db.SpaceAccountLinks
            .Where(l => l.FeedSpaceId == feed.Id && l.AttachedBy == me)
            .ToListAsync();
        db.SpaceAccountLinks.RemoveRange(myLinks);
        // #240: my co-ownership goes with my view
        db.FeedOwners.RemoveRange(await db.FeedOwners.Where(o => o.FeedSpaceId == feed.Id && o.UserId == me).ToListAsync());
        await WriteDeletionOpsAsync(db, myLinks.Select(l => l.SpaceId).Distinct().ToList(), feed.Id, txIds: null);
        if (feed.OwnerUserId == me)
        {
            // a co-owner is the natural successor; consent holders and
            // attachers keep their old place in line
            var successor = (await db.FeedOwners.FirstOrDefaultAsync(o => o.FeedSpaceId == feed.Id && o.UserId != me))?.UserId
                ?? feedLinks.FirstOrDefault(x => x.Requisition.UserId != me)?.Requisition.UserId
                ?? (await db.SpaceAccountLinks.FirstOrDefaultAsync(l => l.FeedSpaceId == feed.Id && l.AttachedBy != me))?.AttachedBy;
            if (successor is Guid next)
            {
                feed.OwnerUserId = next;
                // the promoted co-owner's row collapses into the primary slot
                db.FeedOwners.RemoveRange(await db.FeedOwners.Where(o => o.FeedSpaceId == feed.Id && o.UserId == next).ToListAsync());
            }
        }
    }

    /// <summary>Full path: per-space overlays first (they are NOT in the
    /// feed space and no other path ever cleans them), then the feed.</summary>
    private static async Task EraseFeedAsync(AppDbContext db, FeedSpace feed)
    {
        var feedSpaceId = feed.Id;
        var txIds = await db.EntityRows
            .Where(r => r.SpaceId == feedSpaceId && r.Entity == "transaction")
            .Select(r => r.EntityId)
            .ToListAsync();
        var viewingSpaceIds = await db.SpaceAccountLinks
            .Where(l => l.FeedSpaceId == feedSpaceId)
            .Select(l => l.SpaceId)
            .Distinct()
            .ToListAsync();
        await WriteDeletionOpsAsync(db, viewingSpaceIds, feedSpaceId, txIds);
        db.SpaceAccountLinks.RemoveRange(await db.SpaceAccountLinks.Where(l => l.FeedSpaceId == feedSpaceId).ToListAsync());
        db.FeedOwners.RemoveRange(await db.FeedOwners.Where(o => o.FeedSpaceId == feedSpaceId).ToListAsync());

        db.EntityRows.RemoveRange(await db.EntityRows.Where(r => r.SpaceId == feedSpaceId).ToListAsync());
        db.SyncOps.RemoveRange(await db.SyncOps.Where(o => o.SpaceId == feedSpaceId).ToListAsync());
        db.SpaceMembers.RemoveRange(await db.SpaceMembers.Where(m => m.SpaceId == feedSpaceId).ToListAsync());
        var space = await db.Spaces.FindAsync(feedSpaceId);
        if (space is not null) db.Spaces.Remove(space);
        db.FeedSpaces.Remove(feed);
    }

    /// <summary>
    /// Tombstone ops into each viewing space: the accountLink mirror always,
    /// plus every txMeta overlay when the raw transactions are going away.
    /// Deletes must travel the oplog or other devices revive the rows.
    /// </summary>
    private static async Task WriteDeletionOpsAsync(AppDbContext db, List<string> spaceIds, string feedSpaceId, List<string>? txIds)
    {
        var writer = new SyncWriter(db);
        foreach (var spaceId in spaceIds)
        {
            var space = await db.Spaces.FindAsync(spaceId);
            if (space is null) continue;
            var counter = 0;
            var ops = new List<SyncOpDto>
            {
                DeleteOp(spaceId, "accountLink", ImportIds.AccountLinkId(spaceId, feedSpaceId), counter++),
            };
            foreach (var txId in txIds ?? [])
                ops.Add(DeleteOp(spaceId, "txMeta", ImportIds.TxMetaId(spaceId, txId), counter++));
            await writer.ApplyAsync(space, null, ops);
        }
    }

    private static SyncOpDto DeleteOp(string spaceId, string entity, string entityId, int counter) => new(
        ImportIds.OpId($"feeddel:{spaceId}:{entityId}"),
        spaceId,
        entity,
        entityId,
        new Dictionary<string, JsonElement>(),
        ServerHlc.Now(counter),
        Deleted: true);
}
