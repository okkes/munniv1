// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { HlcClock } from '@/sync/hlc';
import { receiptLinkId } from '@/domain/feedIds';
import { migrateLegacyReceipts } from './receiptsMigrate';

const FEED = 'feed-stores';
vi.mock('./storeFeed', () => ({
  ensureStoreFeed: async () => FEED,
  myStoreFeedId: () => FEED,
}));

describe('migrateLegacyReceipts (v2 fan-out → v3 global + snapshot links)', () => {
  it('moves store receipts to the feed, links the linked one, spares photos', async () => {
    const db = new MunniDB(`receipts_migrate_${Math.random().toString(36).slice(2)}`);
    const backend = new DexieBackend(db);
    const repo = new Repo(backend, new HlcClock('dev'), { trackOutbox: false });
    await repo.upsert('space', 's1', 's1', { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    // linked store receipt (old fan-out id shape, tx link on the row)
    await repo.upsert('receipt', 's1', 'rcpt:ah:t-1@s1', {
      txId: 'tx-1',
      source: 'ah',
      date: '2026-07-01',
      totalCents: 1200,
      merchant: 'Albert Heijn',
      items: [{ name: 'MELK', totalCents: 258 }],
      storeRef: 'ah:t-1',
    });
    // unlinked store receipt
    await repo.upsert('receipt', 's1', 'rcpt:ah:t-2@s1', {
      source: 'ah',
      date: '2026-07-02',
      totalCents: 999,
      merchant: 'Albert Heijn',
      storeRef: 'ah:t-2',
    });
    // photo receipts are untouched by the migration
    await repo.upsert('receipt', 's1', 'photo-1', {
      txId: 'tx-2',
      source: 'photo',
      date: '2026-07-03',
      totalCents: 500,
      image: 'data:image/jpeg;base64,x',
    });

    await migrateLegacyReceipts(backend, repo);

    // both store receipts live ONCE in the feed under the legacy instance
    const globals = (await db.receipts.where('spaceId').equals(FEED).toArray()).filter((r) => r.deleted === 0);
    expect(globals.map((r) => r.id).sort((a, b) => a.localeCompare(b))).toEqual(['rcpt:ah:ah:t-1', 'rcpt:ah:ah:t-2']);
    expect(globals.every((r) => r.instanceId === 'ah')).toBe(true);

    // the linked one became a snapshot link; the unlinked one did not
    const link = await db.receiptLinks.get(receiptLinkId('s1', 'rcpt:ah:ah:t-1'));
    expect(link).toMatchObject({ txId: 'tx-1', totalCents: 1200, receiptId: 'rcpt:ah:ah:t-1', auto: 0 });
    expect(link?.items).toEqual([{ name: 'MELK', totalCents: 258 }]);
    expect(await db.receiptLinks.get(receiptLinkId('s1', 'rcpt:ah:ah:t-2'))).toBeUndefined();

    // old rows tombstoned; the photo row survives untouched
    expect((await db.receipts.get('rcpt:ah:t-1@s1'))?.deleted).toBe(1);
    expect((await db.receipts.get('rcpt:ah:t-2@s1'))?.deleted).toBe(1);
    expect((await db.receipts.get('photo-1'))?.deleted).toBe(0);

    // idempotent: the flag makes the second run a no-op
    await migrateLegacyReceipts(backend, repo);
    expect((await db.receipts.where('spaceId').equals(FEED).toArray()).filter((r) => r.deleted === 0)).toHaveLength(2);
    db.close();
  });
});
