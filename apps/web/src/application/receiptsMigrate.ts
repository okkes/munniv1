import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import type { ReceiptRow } from '@/db/types';
import { receiptLinkId } from '@/domain/feedIds';
import { receiptSnapshot } from './receiptLinks';
import { ensureStoreFeed } from './storeFeed';

/**
 * Receipts v2 → v3 migration, once per identity. Old model: store
 * receipts were fanned out per space (`rcpt:{store}:{ext}@{space}`)
 * with the tx link ON the row. New model: one global row in the store
 * feed + snapshot receiptLink rows per space.
 *  - every legacy store receipt becomes a global row (deduped by
 *    storeRef — otherwise the next sync would re-ingest and re-match)
 *  - linked ones additionally become a snapshot link in their space
 *  - the old rows tombstone; photo receipts stay as they are (the
 *    readers keep understanding them)
 */
const FLAG_KEY = 'receiptsV3Migrated';

/** legacy instance id: the device-migration convention (store name) */
const legacyInstanceOf = (source: ReceiptRow['source']): string => source;

export async function migrateLegacyReceipts(store: StorageBackend, repo: Repo): Promise<void> {
  if ((await store.metaGet(FLAG_KEY))?.value) return;
  const feedId = await ensureStoreFeed(store);
  if (!feedId) return; // offline or not signed in — retried next open

  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  const seenGlobal = new Set((await store.bySpace('receipt', feedId)).map((r) => r.storeRef));

  for (const space of spaces) {
    const legacyRows = (await store.bySpace('receipt', space.id)).filter(
      (r) => r.deleted === 0 && r.source !== 'photo' && r.storeRef,
    );
    for (const row of legacyRows) {
      const instanceId = row.instanceId ?? legacyInstanceOf(row.source);
      const externalId = row.storeRef!.slice(row.source.length + 1);
      const globalId = `rcpt:${row.source}:${instanceId}:${externalId}`;
      if (!seenGlobal.has(row.storeRef)) {
        seenGlobal.add(row.storeRef);
        await repo.upsert('receipt', feedId, globalId, {
          source: row.source,
          date: row.date,
          totalCents: row.totalCents,
          merchant: row.merchant,
          items: row.items,
          storeRef: row.storeRef,
          instanceId,
          payment: row.payment,
        });
      }
      if (row.txId) {
        await repo.upsert('receiptLink', space.id, receiptLinkId(space.id, globalId), {
          ...receiptSnapshot({ ...row, id: globalId, instanceId }),
          txId: row.txId,
          auto: 0,
        });
      }
      await repo.remove('receipt', space.id, row.id);
    }
  }
  await store.metaPut(FLAG_KEY, true);
}
