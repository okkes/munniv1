import { txMetaId } from '@/domain/feedIds';
import type { Repo } from '@/db/repo';
import type { StorageBackend } from '@/db/backend';

/**
 * #279: deleting a global account used to end at engine.purgeSpace,
 * which is FEED-space-keyed — so two kinds of remnants survived in
 * member spaces: txMeta overlays for the feed's transactions (invisible
 * but syncing forever) and the member space's OWN transaction rows on
 * the account (the legacy merged import path wrote those; they kept
 * rendering with a dangling account). Tombstone both via the repo —
 * tombstones sync to other devices, where a raw local delete would
 * resurrect on the next pull. Run BEFORE the engine purge, while the
 * feed's transaction ids are still readable.
 */
export async function purgeAccountRemnants(
  store: StorageBackend,
  repo: Repo,
  accountId: string,
  feedSpaceId: string,
): Promise<void> {
  // include tombstoned raws: their overlays are junk all the same
  const feedTxIds = (await store.bySpace('transaction', feedSpaceId))
    .filter((tx) => tx.accountId === accountId)
    .map((tx) => tx.id);
  // feed spaces carry no 'space' row, so this walks member spaces only
  const memberSpaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  for (const space of memberSpaces) {
    await purgeSpaceRemnants(store, repo, space.id, accountId, feedTxIds);
  }
}

async function purgeSpaceRemnants(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  accountId: string,
  feedTxIds: string[],
): Promise<void> {
  for (const txId of feedTxIds) {
    const metaId = txMetaId(spaceId, txId);
    const meta = await store.get('txMeta', metaId);
    if (meta?.deleted === 0) await repo.remove('txMeta', spaceId, metaId);
  }
  for (const tx of await store.bySpace('transaction', spaceId)) {
    if (tx.deleted === 0 && tx.accountId === accountId) await repo.remove('transaction', spaceId, tx.id);
  }
}
