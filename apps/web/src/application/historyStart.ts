import { spaceAccountLinks } from '@/db/joined';
import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { logActivity } from './activity';

/**
 * Moving a space's history start (arc 5) is impactful and the numbers
 * must be on the table BEFORE the write: newer hides attached feed rows
 * (recoverable — stored in full) and DELETES the space's own manual
 * rows before the new date (tombstoned, with a warning count); older
 * surfaces stored rows that may ask for review again.
 */
export interface HistoryMoveImpact {
  direction: 'newer' | 'older' | 'none';
  /** newer: attached feed rows that will hide — recoverable */
  feedHiddenCount: number;
  /** newer: the space's own rows that will tombstone */
  manualDeleteCount: number;
  /** older: stored rows (feed + own) that will surface */
  surfacedCount: number;
}

export async function historyMoveImpact(store: StorageBackend, spaceId: string, newDate: string): Promise<HistoryMoveImpact> {
  const [space, own, links] = await Promise.all([
    store.get('space', spaceId),
    store.bySpace('transaction', spaceId),
    spaceAccountLinks(store, spaceId),
  ]);
  const oldDate = space?.historyStartDate ?? '';
  if (newDate === oldDate) return { direction: 'none', feedHiddenCount: 0, manualDeleteCount: 0, surfacedCount: 0 };

  const ownLive = own.filter((t) => t.deleted === 0);
  if (newDate > oldDate) {
    // per-link gates govern feed visibility — count what falls out of them
    let feedHidden = 0;
    for (const link of links) {
      const rows = await store.bySpace('transaction', link.feedSpaceId);
      feedHidden += rows.filter(
        (t) => t.deleted === 0 && t.accountId === link.accountId && (!link.historyFrom || t.date >= link.historyFrom) && t.date < newDate,
      ).length;
    }
    return {
      direction: 'newer',
      feedHiddenCount: feedHidden,
      // every own row before the new start goes — including ones an
      // older start had already hidden (honest total)
      manualDeleteCount: ownLive.filter((t) => t.date < newDate).length,
      surfacedCount: 0,
    };
  }

  let surfaced = ownLive.filter((t) => !!oldDate && t.date >= newDate && t.date < oldDate).length;
  for (const link of links) {
    if (!link.historyFrom || link.historyFrom <= newDate) continue;
    const rows = await store.bySpace('transaction', link.feedSpaceId);
    surfaced += rows.filter(
      (t) => t.deleted === 0 && t.accountId === link.accountId && t.date >= newDate && t.date < link.historyFrom!,
    ).length;
  }
  return { direction: 'older', feedHiddenCount: 0, manualDeleteCount: 0, surfacedCount: surfaced };
}

/**
 * #259: every attach path writes a gate ("never silently unlimited"),
 * so a gateless link is always an accident — the server's connect-time
 * mirror op carries none, and the old one-shot heal burned its device-
 * local marker against an EMPTY database before the first sync ever
 * delivered the links. The sweep is idempotent and runs every boot: a
 * gateless link in a space that has a start date takes the space's
 * date, whenever it arrived. (Display already falls back at read time —
 * this makes the stored fact honest too.)
 */
export async function healGatelessLinks(store: StorageBackend, repo: Repo): Promise<number> {
  let touched = 0;
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  for (const space of spaces) {
    if (!space.historyStartDate) continue;
    for (const link of await spaceAccountLinks(store, space.id)) {
      if (link.historyFrom) continue;
      await repo.upsert('accountLink', space.id, link.id, { historyFrom: space.historyStartDate });
      touched++;
    }
  }
  return touched;
}

/**
 * The write half: the space's date moves, every attachment's gate moves
 * with it (the settings sheet is the space-wide control), and — moving
 * newer — the space's own rows before the new start tombstone.
 */
export async function applyHistoryMove(store: StorageBackend, repo: Repo, spaceId: string, newDate: string): Promise<void> {
  const [space, own, links] = await Promise.all([
    store.get('space', spaceId),
    store.bySpace('transaction', spaceId),
    spaceAccountLinks(store, spaceId),
  ]);
  const oldDate = space?.historyStartDate ?? '';
  await repo.upsert('space', spaceId, spaceId, { historyStartDate: newDate });
  for (const link of links) {
    if (link.historyFrom !== newDate) await repo.upsert('accountLink', spaceId, link.id, { historyFrom: newDate });
  }
  if (newDate > oldDate) {
    for (const tx of own.filter((t) => t.deleted === 0 && t.date < newDate)) {
      await repo.remove('transaction', spaceId, tx.id);
    }
  }
  void logActivity(store, repo, spaceId, 'spaceEdit', space?.name ?? '');
}
