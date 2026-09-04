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

  it('#305: the CONSUMER view — a link SOMEONE ELSE attached joins the feed rows, and an archived link keeps serving history', async () => {
    await seedFeed();
    // re-shape the attachment as a foreign one: the viewing user never
    // wrote it — visibleTransactions must not care WHO attached
    await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, FEED), {
      attachedBy: 'someone-else',
      attachedByName: 'Marie',
    });
    const store = new DexieBackend(db);
    const txs = await visibleTransactions(store, SPACE);
    expect(txs).toHaveLength(1); // raw2 stays behind the history gate
    expect(txs[0].id).toBe('raw1');
    expect(txs[0].feedSpaceId).toBe(FEED); // joined, not a legacy merge

    // the sharer LEFT the space: the link archives (sync-a6) but the
    // stored history keeps serving — the freeze stops NEW data, not old
    await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, FEED), { archived: 1 });
    const after = await visibleTransactions(store, SPACE);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('raw1');
  });

  it('#211: the category spread is a space opinion — cats overlay onto feed rows and stay per space', async () => {
    await seedFeed();
    const [tx] = await visibleTransactions(new DexieBackend(db), SPACE);
    const spread = [
      { catId: 'groceries', amountCents: Math.abs(tx.amountCents) - 100 },
      { catId: 'householdSupplies', amountCents: 100 },
    ];
    await writeTxTransform(repo, tx, { catId: 'groceries', cats: spread, needsReview: 0 });

    const [again] = await visibleTransactions(new DexieBackend(db), SPACE);
    // joinTx maps the overlay field; the view enriches each entry with
    // its derived type (#133 r4) — the STORED overlay stays untouched
    expect(again.cats).toEqual(spread.map((c) => ({ ...c, txType: 'expense' })));
    const metas = await db.txMeta.where('spaceId').equals(SPACE).toArray();
    expect(metas[0].cats).toEqual(spread); // stored on the overlay, not the raw row
    expect((await db.transactions.get('raw1'))?.cats).toBeUndefined();
  });

  it('#133 removal: the VIEW derives every type at the join — stored values are never read', async () => {
    await repo.upsert('account', SPACE, 'chk', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('account', SPACE, 'defpot', { name: 'Default savings', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 0, defaultFor: 'saving' });
    await repo.upsert('transaction', SPACE, 'derive1', {
      accountId: 'chk', date: '2026-07-03', amountCents: -1200, currency: 'EUR',
      // the STORED type lies on purpose (sign-legal) — the view ignores it
      merchant: 'Shop', catId: 'savingDeposit', txType: 'expense', needsReview: 0,
    });
    const store = new DexieBackend(db);
    const view = async () => (await visibleTransactions(store, SPACE)).find((t) => t.id === 'derive1');

    // a bare ◆ movement row derives its family, whatever was stored
    expect((await view())?.txType).toBe('saving');
    // linking the DEFAULT pot keeps the family (the counterparty rule)
    const tx = { id: 'derive1', spaceId: SPACE, feedSpaceId: undefined, txType: 'expense', needsReview: 0, amountCents: -1200 } as never;
    await writeTxTransform(repo, tx, { linkedAccountId: 'defpot' });
    expect((await view())?.txType).toBe('saving');
    // an ordinary category signs; parts derive per part with the row sign
    await writeTxTransform(repo, tx, { linkedAccountId: null as never, catId: 'coffee' });
    expect((await view())?.txType).toBe('expense');
    await writeTxTransform(repo, tx, {
      splits: [
        { id: 'p1', catId: 'groceries', amountCents: 700 },
        { id: 'p2', catId: 'savingDeposit', amountCents: 500 },
        // a DEFAULT-linked part wears the family, not transfer
        { id: 'p3', catId: 'savingDeposit', amountCents: 0, linkedAccountId: 'defpot' },
      ],
    });
    const parts = (await view())?.splits ?? [];
    expect(parts.map((s) => s.txType)).toEqual(['expense', 'saving', 'saving']);

    // the adjustment marker outranks everything — flag and legacy alike
    await repo.upsert('transaction', SPACE, 'adj1', {
      accountId: 'chk', date: '2026-07-04', amountCents: -50, currency: 'EUR',
      merchant: 'Fix', catId: 'groceries', txType: 'expense', needsReview: 0, adjustment: 1,
    });
    const store2 = new DexieBackend(db);
    const adj = (await visibleTransactions(store2, SPACE)).find((t) => t.id === 'adj1');
    expect(adj?.txType).toBe('adjustment');
  });

  it('#228: spread entries derive with the ROW\'s one counterparty; the row link speaks for the whole', async () => {
    await repo.upsert('account', SPACE, 'chk', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('account', SPACE, 'defpot', { name: 'Default savings', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 0, defaultFor: 'saving' });
    // the settled shape: a linked movement row whose spread holds the
    // real entry + the settled bookkeeping entry (reimbursed passes
    // through untouched — it is bookkeeping, not a story)
    await repo.upsert('transaction', SPACE, 'spread1', {
      accountId: 'chk', date: '2026-07-05', amountCents: -10_000, currency: 'EUR',
      merchant: 'Mixed', catId: 'savingDeposit', txType: 'expense', needsReview: 0,
      linkedAccountId: 'defpot',
      cats: [
        { catId: 'savingDeposit', amountCents: 6_000 },
        { catId: 'reimbursed', amountCents: 4_000 },
      ],
    });
    // a REGULAR spread without any link keeps deriving by sign per entry
    await repo.upsert('transaction', SPACE, 'spread2', {
      accountId: 'chk', date: '2026-07-06', amountCents: -5_000, currency: 'EUR',
      merchant: 'Plain', catId: 'groceries', txType: 'expense', needsReview: 0,
      cats: [
        { catId: 'groceries', amountCents: 3_000 },
        { catId: 'sweets', amountCents: 2_000 },
      ],
    });
    const store = new DexieBackend(db);
    const rows = await visibleTransactions(store, SPACE);
    const settled = rows.find((t) => t.id === 'spread1');
    // the real entry derives with the row's link (the default pot keeps
    // the saving story); the settled entry rides untouched
    expect(settled?.cats?.map((c) => c.txType)).toEqual(['saving', undefined]);
    // the row's own link names the headline
    expect(settled?.txType).toBe('saving');
    const plain = rows.find((t) => t.id === 'spread2');
    expect(plain?.cats?.map((c) => c.txType)).toEqual(['expense', 'expense']);
    expect(plain?.txType).toBe('expense');
  });

  it('#152: the attachment owns the type — stamp overlay and the funding blackout', async () => {
    await seedFeed();
    // this space says the checking feed is a SAVINGS pot: rows stamp
    await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, FEED), { type: 'savings' });
    const store = new DexieBackend(db);
    const accounts = await visibleAccounts(store, SPACE);
    expect(accounts.find((a) => a.id === 'acct1')?.type).toBe('savings');
    const txs = await visibleTransactions(store, SPACE);
    expect(txs.find((t) => t.id === 'raw1')?.txType).toBe('saving');

    // another space calls the SAME account funding — it completes the
    // picture and shows nothing
    await repo.upsert('accountLink', OTHER_SPACE, accountLinkId(OTHER_SPACE, FEED), {
      feedSpaceId: FEED, accountId: 'acct1', historyFrom: '2026-01-01', type: 'funding',
    });
    expect((await visibleAccounts(store, OTHER_SPACE)).find((a) => a.id === 'acct1')?.type).toBe('funding');
    expect(await visibleTransactions(store, OTHER_SPACE)).toEqual([]);
  });

  it('#239: a space-level display name wins in its space and NOWHERE else', async () => {
    await seedFeed();
    await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, FEED), { displayName: 'Our groceries card' });
    await repo.upsert('accountLink', OTHER_SPACE, accountLinkId(OTHER_SPACE, FEED), {
      feedSpaceId: FEED, accountId: 'acct1', historyFrom: '2026-01-01',
    });
    const store = new DexieBackend(db);
    expect((await visibleAccounts(store, SPACE)).find((a) => a.id === 'acct1')?.name).toBe('Our groceries card');
    // the other space (and the global row) keep the global name
    expect((await visibleAccounts(store, OTHER_SPACE)).find((a) => a.id === 'acct1')?.name).toBe('Bank · 6789');
    expect((await store.get('account', 'acct1'))?.name).toBe('Bank · 6789');
    // clearing the override falls back to the global name
    await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, FEED), { displayName: null as never });
    expect((await visibleAccounts(store, SPACE)).find((a) => a.id === 'acct1')?.name).toBe('Bank · 6789');
  });

  it('#152: a funding counterparty derives the funding family; nothing mints into the pot', async () => {
    await seedFeed();
    await repo.upsert('account', SPACE, 'pot1', {
      name: 'Family pot', type: 'funding', source: 'manual', currency: 'EUR', balanceCents: 0,
    });
    const store = new DexieBackend(db);
    const tx = (await visibleTransactions(store, SPACE)).find((t) => t.id === 'raw1')!;
    await writeTxTransform(repo, tx, { linkedAccountId: 'pot1' });
    // #133 removal: nothing writes the type anymore — the VIEW derives
    // funding from the counterparty
    const linked = (await visibleTransactions(store, SPACE)).find((t) => t.id === 'raw1');
    expect(linked?.txType).toBe('funding');
    // no mirror leg — the pot shows no transactions, so none are written
    const potRows = (await store.bySpace('transaction', SPACE)).filter(
      (t) => t.accountId === 'pot1' && t.deleted === 0,
    );
    expect(potRows).toEqual([]);
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
