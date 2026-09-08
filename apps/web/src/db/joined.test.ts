// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { accountLinkId, feedSpaceId, txMetaId } from '@/domain/feedIds';
import { MunniDB } from './schema';
import { Repo } from './repo';
import { DexieBackend } from './backend';
import { visibleAccounts, visibleTransactions, writeTxTransform } from './joined';

let counter = 0;
let db: MunniDB;
let repo: Repo;

const FEED = feedSpaceId('NL69INGB0123456789');
const SPACE = 'space_a';
const OTHER_SPACE = 'space_b';

async function seedFeed() {
  // raw account + two raw txs inside the feed space
  await repo.upsert('account', FEED, 'acct1', {
    name: 'Bank · 6789',
    type: 'checking',
    source: 'gocardless',
    currency: 'EUR',
    balanceCents: 10_000,
    iban: 'NL69INGB0123456789',
  });
  await repo.upsert('transaction', FEED, 'raw1', {
    accountId: 'acct1',
    date: '2026-07-01',
    amountCents: -4210,
    currency: 'EUR',
    merchant: 'Albert Heijn',
  });
  await repo.upsert('transaction', FEED, 'raw2', {
    accountId: 'acct1',
    date: '2026-06-01',
    amountCents: 220_000,
    currency: 'EUR',
    merchant: 'Werkgever BV',
  });
  // attach to SPACE from 2026-06-15 (raw2 predates it)
  await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, FEED), {
    feedSpaceId: FEED,
    accountId: 'acct1',
    historyFrom: '2026-06-15',
  });
}

describe('feature B join layer', () => {
  beforeEach(() => {
    db = new MunniDB(`joined_test_${++counter}`);
    repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
  });

  it('a space sees feed transactions from its history-from date, with defaults', async () => {
    await seedFeed();
    const txs = await visibleTransactions(new DexieBackend(db), SPACE);
    expect(txs.map((t) => t.id)).toEqual(['raw1']); // raw2 is before historyFrom
    const [tx] = txs;
    expect(tx.spaceId).toBe(SPACE); // viewed through the space
    expect(tx.feedSpaceId).toBe(FEED);
    expect(tx.merchant).toBe('Albert Heijn'); // raw survives
    expect(tx.txType).toBe('expense'); // default from sign
    expect(tx.needsReview).toBe(1); // uncategorized until someone decides
  });

  it('a pending (reserved) feed transaction is visible but never review material', async () => {
    await seedFeed();
    await repo.upsert('transaction', FEED, 'raw-pending', {
      accountId: 'acct1',
      date: '2026-07-02',
      amountCents: -1500,
      currency: 'EUR',
      merchant: 'Tikkie',
      pending: 1,
    });
    const txs = await visibleTransactions(new DexieBackend(db), SPACE);
    const pending = txs.find((t) => t.id === 'raw-pending')!;
    expect(pending.pending).toBe(1);
    expect(pending.needsReview).toBe(0); // the booked twin replaces it later
  });

  it('transformation is per space: an edit in one space never leaks to another', async () => {
    await seedFeed();
    await repo.upsert('accountLink', OTHER_SPACE, accountLinkId(OTHER_SPACE, FEED), {
      feedSpaceId: FEED,
      accountId: 'acct1',
    });

    const [txInA] = await visibleTransactions(new DexieBackend(db), SPACE);
    await writeTxTransform(repo, txInA, { catId: 'groceries', needsReview: 0 });

    const [againInA] = await visibleTransactions(new DexieBackend(db), SPACE);
    expect(againInA.catId).toBe('groceries');
    expect(againInA.needsReview).toBe(0);

    const inB = (await visibleTransactions(new DexieBackend(db), OTHER_SPACE)).find((t) => t.id === 'raw1');
    expect(inB?.catId).toBeUndefined(); // space B holds its own opinion
    expect(inB?.needsReview).toBe(1);
  });

  it('overlay ids are deterministic — concurrent edits converge on one row', async () => {
    await seedFeed();
    const [tx] = await visibleTransactions(new DexieBackend(db), SPACE);
    await writeTxTransform(repo, tx, { catId: 'groceries' });
    await writeTxTransform(repo, tx, { notes: 'weekly shop' });
    const metas = await db.txMeta.where('spaceId').equals(SPACE).toArray();
    expect(metas).toHaveLength(1);
    expect(metas[0].id).toBe(txMetaId(SPACE, 'raw1'));
    expect(metas[0].catId).toBe('groceries');
    expect(metas[0].notes).toBe('weekly shop');
  });

  it('legacy merged rows keep working and writing in place (dual-read)', async () => {
    await repo.upsert('transaction', SPACE, 'legacy1', {
      accountId: 'oldAcct',
      date: '2026-07-02',
      amountCents: -900,
      currency: 'EUR',
      merchant: 'Bakker',
      catId: 'groceries',
      txType: 'expense',
      needsReview: 0,
    });
    const txs = await visibleTransactions(new DexieBackend(db), SPACE);
    const legacy = txs.find((t) => t.id === 'legacy1')!;
    expect(legacy.feedSpaceId).toBeUndefined();
    expect(legacy.catId).toBe('groceries');

    await writeTxTransform(repo, legacy, { notes: 'ok' });
    expect((await db.transactions.get('legacy1'))?.notes).toBe('ok'); // written in place
    expect(await db.txMeta.count()).toBe(0); // no overlay for legacy rows
  });

  it('visibleAccounts includes attached feed accounts with their link info', async () => {
    await seedFeed();
    const accounts = await visibleAccounts(new DexieBackend(db), SPACE);
    const attached = accounts.find((a) => a.id === 'acct1')!;
    expect(attached.link?.feedSpaceId).toBe(FEED);
    expect(attached.balanceCents).toBe(10_000); // balance is raw — same everywhere
  });

  it('feed and overlay ids are stable across devices/reconnects', () => {
    expect(feedSpaceId('nl69 ingb 0123 4567 89')).toBe(FEED); // normalization
    expect(txMetaId(SPACE, 'raw1')).toBe(txMetaId(SPACE, 'raw1'));
    expect(txMetaId(SPACE, 'raw1')).not.toBe(txMetaId(OTHER_SPACE, 'raw1'));
  });
});
