// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { HlcClock } from '@/sync/hlc';
import { applyCatalogTombstones, migrateCatSpreads, migrateCounterFiledTransfers, migrateFundingRows, normalizeReimbursements } from './catalogMaintenance';
import { catMirrorSourceId, mirrorTxId } from '@/domain/feedIds';

const SPACE = 's1';

describe('catalog tombstone pass (AC3)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  async function seeded() {
    const store = new DexieBackend(new MunniDB(`munni_ac3_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('ac3'), { trackOutbox: false });
    // a custom sub the user created under the soon-retired builtin 'gift'
    await repo.upsert('category', SPACE, 'sub1', {
      parentId: 'gift', name: 'Wrapping', icon: 'gift', color: '', txType: 'expense', sortOrder: 1, builtin: 0,
    });
    // transactions on the retired builtin, on the custom sub, and elsewhere
    await repo.upsert('transaction', SPACE, 't-gift', { accountId: 'a', date: '2026-01-01', amountCents: -100, currency: 'EUR', merchant: 'X', catId: 'gift', txType: 'expense', needsReview: 0 });
    await repo.upsert('transaction', SPACE, 't-sub', { accountId: 'a', date: '2026-01-02', amountCents: -200, currency: 'EUR', merchant: 'Y', catId: 'sub1', txType: 'expense', needsReview: 0 });
    await repo.upsert('transaction', SPACE, 't-keep', { accountId: 'a', date: '2026-01-03', amountCents: -300, currency: 'EUR', merchant: 'Z', catId: 'groceries', txType: 'expense', needsReview: 0 });
    // a feed overlay pointing at the retired id
    await repo.upsert('txMeta', SPACE, 'm1', { txId: 'raw1', catId: 'gift', txType: 'expense', needsReview: 0 });
    await store.metaPut('catalog', {
      version: 4,
      categories: [{ id: 'gift', deleted: true, names: { en: 'Gift', nl: 'Cadeau', tr: 'Hediye' }, icon: 'gift-outline' }],
      keywords: [],
    });
    return { store, repo };
  }

  it('detaches retired builtins, cascades custom subs, leaves the rest', async () => {
    const { store, repo } = await seeded();
    const touched = await applyCatalogTombstones(store, repo);
    expect(touched).toBe(4); // sub cascade + 2 transactions + 1 overlay

    expect((await store.get('category', 'sub1'))?.deleted).toBe(1); // cascaded
    expect(await store.get('transaction', 't-gift')).toMatchObject({ catId: 'uncategorized', needsReview: 1 });
    expect(await store.get('transaction', 't-sub')).toMatchObject({ catId: 'uncategorized', needsReview: 1 });
    expect(await store.get('transaction', 't-keep')).toMatchObject({ catId: 'groceries', needsReview: 0 });
    expect(await store.get('txMeta', 'm1')).toMatchObject({ catId: 'uncategorized', needsReview: 1 });
  });

  it('runs once per version (marker), and not at all without a document', async () => {
    const { store, repo } = await seeded();
    await applyCatalogTombstones(store, repo);
    expect(await applyCatalogTombstones(store, repo)).toBe(0); // marker gates the rerun

    const fresh = new DexieBackend(new MunniDB(`munni_ac3_${Math.random().toString(36).slice(2)}`));
    stores.push(fresh);
    const freshRepo = new Repo(fresh, new HlcClock('ac3b'), { trackOutbox: false });
    expect(await applyCatalogTombstones(fresh, freshRepo)).toBe(0); // no doc, no work
  });
});

describe('#228: the every-boot reimbursement normalizer', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  async function seeded() {
    const store = new DexieBackend(new MunniDB(`munni_rbm_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('rbm'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    // legacy pair: −100 expense linked 40, its slices shrunk to NET 60;
    // the +40 credit shrunk to a zero slice (old fully-given shape)
    await repo.upsert('transaction', SPACE, 'exp', {
      accountId: 'a', date: '2026-01-01', amountCents: -10_000, currency: 'EUR', merchant: 'X',
      catId: 'groceries', txType: 'expense', needsReview: 0,
      reimbursements: [{ txId: 'cred', amountCents: 4_000 }],
      splits: [{ catId: 'groceries', amountCents: 6_000 }],
    });
    await repo.upsert('transaction', SPACE, 'cred', {
      accountId: 'a', date: '2026-01-02', amountCents: 4_000, currency: 'EUR', merchant: 'Y',
      catId: 'reimburse', txType: 'income', needsReview: 0,
      splits: [{ catId: 'reimburse', amountCents: 0 }],
    });
    // untouched: no links anywhere near it
    await repo.upsert('transaction', SPACE, 'plain', {
      accountId: 'a', date: '2026-01-03', amountCents: -500, currency: 'EUR', merchant: 'Z',
      catId: 'coffee', txType: 'expense', needsReview: 0,
    });
    return { store, repo };
  }

  it('rewrites legacy NET slices into the cats model on both sides, idempotently', async () => {
    const { store, repo } = await seeded();
    expect(await normalizeReimbursements(store, repo)).toBe(2);

    // the settle bookkeeping lives in `cats` now; legacy splits clear
    const exp = await store.get('transaction', 'exp');
    expect(exp?.cats).toMatchObject([
      { catId: 'groceries', amountCents: 6_000 },
      { catId: 'reimbursed', amountCents: 4_000 },
    ]);
    expect(exp?.splits ?? undefined).toBeFalsy();
    const cred = await store.get('transaction', 'cred');
    expect(cred?.cats).toMatchObject([{ catId: 'reimbursed', amountCents: 4_000 }]);
    expect(cred?.splits ?? undefined).toBeFalsy();
    expect((await store.get('transaction', 'plain'))?.cats).toBeUndefined();

    // every boot, no marker — the second run simply finds nothing to do
    expect(await normalizeReimbursements(store, repo)).toBe(0);
  });

  it('heals the retired container-level settle: pseudo-part strips, the drained sibling restores, the link NAMES its part', async () => {
    const store = new DexieBackend(new MunniDB(`munni_rbn_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('rbn'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    // the user's ss: a +2400 split credit gave 4.20 — the old consume
    // drained split 2 and grew a reimbursed pseudo-part on the container
    await repo.upsert('transaction', SPACE, 'salary', {
      accountId: 'a', date: '2026-07-24', amountCents: 240_000, currency: 'EUR', merchant: 'Demo Corp BV',
      catId: 'salary', txType: 'income', needsReview: 0,
      splits: [
        { id: 'p1', catId: 'salary', amountCents: 120_000 },
        { id: 'p2', catId: 'incomeOther', amountCents: 119_580 },
        { catId: 'reimbursed', amountCents: 420 },
      ],
    });
    // the koffie expense's link never named a credit part (legacy shape)
    await repo.upsert('transaction', SPACE, 'koffie', {
      accountId: 'a', date: '2026-07-25', amountCents: -420, currency: 'EUR', merchant: 'Koffie',
      catId: 'eatingOut', txType: 'expense', needsReview: 0,
      reimbursements: [{ txId: 'salary', amountCents: 420 }],
    });

    expect(await normalizeReimbursements(store, repo)).toBeGreaterThan(0);

    // the link now names the largest open credit part deterministically
    const koffie = await store.get('transaction', 'koffie');
    expect(koffie?.reimbursements?.[0]?.creditPartId).toBe('p1');
    // …and the koffie expense settled in its own cats
    expect(koffie?.cats).toMatchObject([{ catId: 'reimbursed', amountCents: 420 }]);

    const salary = await store.get('transaction', 'salary');
    const parts = (salary?.splits ?? []).filter((s) => s.catId !== 'reimbursed');
    expect(parts).toHaveLength(2);
    // the pseudo-part is gone and split 2's drained amount is restored
    expect(parts.map((p) => p.amountCents)).toEqual([120_000, 120_000]);
    // the named part carries the settle inside its OWN cats
    expect(parts[0].cats).toMatchObject([
      { catId: 'salary', amountCents: 119_580 },
      { catId: 'reimbursed', amountCents: 420 },
    ]);
    expect(parts[1].cats ?? undefined).toBeFalsy();

    // convergent: a second boot rewrites nothing
    expect(await normalizeReimbursements(store, repo)).toBe(0);
  });
});

describe('#133 r5 — Transfer filed toward a special counterparty refiles by the counter kind', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  async function seeded() {
    const store = new DexieBackend(new MunniDB(`munni_cft_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('cft'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    await repo.upsert('account', SPACE, 'chk', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('account', SPACE, 'chk2', { name: 'Checking 2', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('account', SPACE, 'save', { name: 'Pot', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 1_200 });
    return { store, repo };
  }

  it('a row-level Transfer out onto a savings counter becomes Set aside (type included); regular pairs stay', async () => {
    const { store, repo } = await seeded();
    await repo.upsert('transaction', SPACE, 'bad', {
      accountId: 'chk', date: '2026-08-01', amountCents: -2_000, currency: 'EUR', merchant: 'Move',
      catId: 'transferOut', txType: 'transfer', needsReview: 0, linkedAccountId: 'save',
    });
    await repo.upsert('transaction', SPACE, 'fine', {
      accountId: 'chk', date: '2026-08-02', amountCents: -900, currency: 'EUR', merchant: 'Between',
      catId: 'transferOut', txType: 'transfer', needsReview: 0, linkedAccountId: 'chk2',
    });
    await repo.upsert('transaction', SPACE, 'bare', {
      accountId: 'chk', date: '2026-08-03', amountCents: -400, currency: 'EUR', merchant: 'Unlinked',
      catId: 'transferOut', txType: 'transfer', needsReview: 0,
    });

    expect(await migrateCounterFiledTransfers(store, repo)).toBe(1);
    expect(await store.get('transaction', 'bad')).toMatchObject({ catId: 'savingDeposit', txType: 'saving', linkedAccountId: 'save' });
    expect(await store.get('transaction', 'fine')).toMatchObject({ catId: 'transferOut', txType: 'transfer' });
    expect(await store.get('transaction', 'bare')).toMatchObject({ catId: 'transferOut' });
    // marker gates the rerun
    expect(await migrateCounterFiledTransfers(store, repo)).toBe(0);
  });

  it('#228 chain: an r4 spread ENTRY becomes a PART first (the fold), then refiles by its counter\'s kind', async () => {
    const { store, repo } = await seeded();
    const { migrateEntryCounters } = await import('./categoryModel');
    const oldMid = mirrorTxId(catMirrorSourceId('spread', 'transferOut'));
    // the r4-era state: a transferOut entry linked to the pot, its
    // entry-sized mint live on the savings ledger, balance moved
    await repo.upsert('transaction', SPACE, 'spread', {
      accountId: 'chk', date: '2026-08-01', amountCents: -5_000, currency: 'EUR', merchant: 'Mixed',
      catId: 'groceries', txType: 'expense', needsReview: 0,
      cats: [
        { catId: 'groceries', amountCents: 3_800 },
        { catId: 'transferOut', amountCents: 1_200, linkedAccountId: 'save', transferPeerId: oldMid } as never,
      ],
    });
    await repo.upsert('transaction', SPACE, oldMid, {
      accountId: 'save', date: '2026-08-01', amountCents: 1_200, currency: 'EUR', merchant: 'Mixed',
      catId: 'savingDeposit', txType: 'saving', needsReview: 0, linkedAccountId: 'chk', transferPeerId: 'spread',
    });

    // boot order: the fold relocates entry links, THEN the refile renames
    expect(await migrateEntryCounters(store, repo)).toBe(1);
    expect(await migrateCounterFiledTransfers(store, repo)).toBe(1);

    const row = await store.get('transaction', 'spread');
    expect(row?.cats ?? undefined).toBeUndefined();
    const savePart = row?.splits?.find((p) => p.catId === 'savingDeposit');
    expect(savePart).toMatchObject({ catId: 'savingDeposit', amountCents: 1_200, linkedAccountId: 'save', txType: 'saving' });
    expect(row?.splits?.find((p) => p.catId === 'groceries')).toMatchObject({ amountCents: 3_800 });
    // the entry-keyed mint retired; the part-keyed leg carries the money
    expect((await store.get('transaction', oldMid))?.deleted).toBe(1);
    expect(savePart?.transferPeerId).toBeTruthy();
    expect(await store.get('transaction', savePart!.transferPeerId!)).toMatchObject({ accountId: 'save', amountCents: 1_200, deleted: 0 });
    // retire refunded 1200, the fresh part mint moved it back — net zero
    expect((await store.get('account', 'save'))?.balanceCents).toBe(1_200);
  });
});

describe('retired debt subs refile by sign (2026-08-01)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  it('lendMoney/creditCardPayment rows land on Repaid or Borrowed; others untouched', async () => {
    const { migrateRetiredDebtSubs } = await import('./catalogMaintenance');
    const store = new DexieBackend(new MunniDB(`munni_rds_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('rds'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    const base = { accountId: 'a', currency: 'EUR', merchant: 'X', txType: 'debtPayment' as const, needsReview: 0 as const };
    await repo.upsert('transaction', SPACE, 'lent', { ...base, date: '2026-01-01', amountCents: -5_000, catId: 'lendMoney' });
    await repo.upsert('transaction', SPACE, 'cc', { ...base, date: '2026-01-02', amountCents: 4_000, catId: 'creditCardPayment' });
    await repo.upsert('transaction', SPACE, 'kept', { ...base, date: '2026-01-03', amountCents: -2_000, catId: 'loanRepayment' });
    // a per-space overlay on a raw feed row refiles too
    await repo.upsert('transaction', 'feedX', 'rawTx', { accountId: 'af', currency: 'EUR', merchant: 'B', date: '2026-01-04', amountCents: -900 } as never);
    await repo.upsert('txMeta', SPACE, 'meta1', { txId: 'rawTx', catId: 'creditCardPayment' } as never);

    expect(await migrateRetiredDebtSubs(store, repo)).toBe(3);
    expect((await store.get('transaction', 'lent'))?.catId).toBe('loanRepayment'); // debit → Repaid
    expect((await store.get('transaction', 'cc'))?.catId).toBe('debtBorrowed'); // credit → Borrowed
    expect((await store.get('transaction', 'kept'))?.catId).toBe('loanRepayment');
    expect((await store.get('txMeta', 'meta1'))?.catId).toBe('loanRepayment');
    // marker gates the rerun
    expect(await migrateRetiredDebtSubs(store, repo)).toBe(0);
  });
});

describe('#252: Bought/Sold became brokerage-internal — unstamped legs refile', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  it('investBuy/investSell off-brokerage land on Invested/Withdrawn; brokerage rows keep theirs', async () => {
    const { migrateInvestMovementSubs } = await import('./catalogMaintenance');
    const store = new DexieBackend(new MunniDB(`munni_ims_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('ims'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    await repo.upsert('account', SPACE, 'bank', { name: 'Bank', type: 'checking', currency: 'EUR', balanceCents: 0, source: 'manual' });
    await repo.upsert('account', SPACE, 'brk', { name: 'DeGiro', type: 'brokerage', currency: 'EUR', balanceCents: 0, source: 'manual' });
    const base = { currency: 'EUR', merchant: 'X', txType: 'investment' as const, needsReview: 0 as const };
    await repo.upsert('transaction', SPACE, 'leg-out', { ...base, accountId: 'bank', date: '2026-01-01', amountCents: -5_000, catId: 'investBuy' });
    await repo.upsert('transaction', SPACE, 'leg-in', { ...base, accountId: 'bank', date: '2026-01-02', amountCents: 3_000, catId: 'investSell' });
    await repo.upsert('transaction', SPACE, 'stock', { ...base, accountId: 'brk', date: '2026-01-03', amountCents: -2_000, catId: 'investBuy' });
    // a per-space overlay on a raw feed row (non-brokerage) refiles too
    await repo.upsert('transaction', 'feedY', 'rawI', { accountId: 'bank', currency: 'EUR', merchant: 'B', date: '2026-01-04', amountCents: -900 } as never);
    await repo.upsert('txMeta', SPACE, 'metaI', { txId: 'rawI', catId: 'investBuy' } as never);

    expect(await migrateInvestMovementSubs(store, repo)).toBe(3);
    expect((await store.get('transaction', 'leg-out'))?.catId).toBe('investContribution');
    expect((await store.get('transaction', 'leg-in'))?.catId).toBe('investWithdraw');
    expect((await store.get('transaction', 'stock'))?.catId).toBe('investBuy'); // brokerage keeps Bought
    expect((await store.get('txMeta', 'metaI'))?.catId).toBe('investContribution');
    // marker gates the rerun
    expect(await migrateInvestMovementSubs(store, repo)).toBe(0);
  });
});

describe('typed-splits v2 migrations (funding retirement + linked-family inversion)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  const fresh = () => {
    const store = new DexieBackend(new MunniDB(`munni_tsv2_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    return { store, repo: new Repo(store, new HlcClock('tsv2'), { trackOutbox: false }) };
  };

  it('funding rows re-type by sign and keep (or gain) their funding category, once', async () => {
    const { store, repo } = fresh();
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    const base = { accountId: 'a', currency: 'EUR', merchant: 'Pot', needsReview: 0 as const };
    await repo.upsert('transaction', SPACE, 'f-out', { ...base, date: '2026-01-01', amountCents: -5_000, txType: 'funding', catId: 'fundingOut' });
    await repo.upsert('transaction', SPACE, 'f-bare', { ...base, date: '2026-01-02', amountCents: 2_000, txType: 'funding' });
    await repo.upsert('txMeta', SPACE, 'f-meta', { txId: 'raw-f', txType: 'funding', needsReview: 0 });
    await repo.upsert('transaction', SPACE, 'raw-f', { ...base, date: '2026-01-03', amountCents: -700, txType: 'expense' });

    expect(await migrateFundingRows(store, repo)).toBe(3);
    expect(await store.get('transaction', 'f-out')).toMatchObject({ txType: 'expense', catId: 'fundingOut' });
    // a category-less funding row GAINS the sign-picked funding sub so no meaning is lost
    expect(await store.get('transaction', 'f-bare')).toMatchObject({ txType: 'income', catId: 'fundingIn' });
    expect(await store.get('txMeta', 'f-meta')).toMatchObject({ txType: 'expense', catId: 'fundingOut' });
    expect(await migrateFundingRows(store, repo)).toBe(0); // marker gates the rerun
  });

});

describe('#211 cat-spread fold (splits mean PARTS now)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  const fresh = () => {
    const store = new DexieBackend(new MunniDB(`munni_211_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    return { store, repo: new Repo(store, new HlcClock('m211'), { trackOutbox: false }) };
  };
  const base = { accountId: 'a', currency: 'EUR', merchant: 'X', needsReview: 0 as const, txType: 'expense' as const };

  it('folds bare multi-slices into row cats (pct kept), unwraps lone slices, leaves real parts and drifted sums', async () => {
    const { store, repo } = fresh();
    // bare multi-cat (classic editor output, minted ids) → cats
    await repo.upsert('transaction', SPACE, 't-spread', {
      ...base, date: '2026-01-01', amountCents: -10_000, catId: 'groceries',
      splits: [
        { id: 'a1', catId: 'groceries', amountCents: 6_000, pct: 60 },
        { id: 'a2', catId: 'householdSupplies', amountCents: 4_000, pct: 40 },
      ],
    });
    // settled whole row (1 slice + reimbursed bookkeeping) → cats
    await repo.upsert('transaction', SPACE, 't-settled', {
      ...base, date: '2026-01-02', amountCents: -5_000, catId: 'food',
      reimbursements: [{ txId: 'c1', amountCents: 2_000 }],
      splits: [{ catId: 'food', amountCents: 3_000 }, { catId: 'reimbursed', amountCents: 2_000 }],
    });
    // a lone bare slice is "no split" — unwrapped, no cats materialized
    await repo.upsert('transaction', SPACE, 't-lone', {
      ...base, date: '2026-01-03', amountCents: -700, catId: 'coffee',
      splits: [{ catId: 'coffee', amountCents: 700 }],
    });
    // a REAL split (part story) stays a container untouched
    await repo.upsert('transaction', SPACE, 't-parts', {
      ...base, date: '2026-01-04', amountCents: -6_500, catId: 'telecom',
      splits: [
        { id: 'p1', catId: 'telecom', amountCents: 4_000 },
        { id: 'p2', catId: 'loanRepayment', amountCents: 2_500, label: 'Device plan' },
      ],
    });
    // legacy drift: bare slices that no longer sum to gross stay put
    await repo.upsert('transaction', SPACE, 't-drift', {
      ...base, date: '2026-01-05', amountCents: -1_000, catId: 'fun',
      splits: [{ catId: 'fun', amountCents: 300 }, { catId: 'coffee', amountCents: 200 }],
    });
    // overlays fold the same way against the RAW row's gross
    await repo.upsert('transaction', SPACE, 'raw-m', { ...base, date: '2026-01-06', amountCents: -900, catId: 'fun' });
    await repo.upsert('txMeta', SPACE, 'meta-m', {
      txId: 'raw-m', txType: 'expense', needsReview: 0,
      splits: [{ catId: 'fun', amountCents: 400 }, { catId: 'coffee', amountCents: 500 }],
    });

    expect(await migrateCatSpreads(store, repo)).toBe(4);
    expect(await store.get('transaction', 't-spread')).toMatchObject({
      cats: [
        { catId: 'groceries', amountCents: 6_000, pct: 60 },
        { catId: 'householdSupplies', amountCents: 4_000, pct: 40 },
      ],
    });
    expect((await store.get('transaction', 't-spread'))?.splits?.length ?? 0).toBe(0);
    expect(await store.get('transaction', 't-settled')).toMatchObject({
      cats: [{ catId: 'food', amountCents: 3_000 }, { catId: 'reimbursed', amountCents: 2_000 }],
    });
    const lone = await store.get('transaction', 't-lone');
    expect(lone?.splits?.length ?? 0).toBe(0);
    expect(lone?.cats?.length ?? 0).toBe(0);
    expect((await store.get('transaction', 't-parts'))?.splits).toHaveLength(2);
    expect((await store.get('transaction', 't-drift'))?.splits).toHaveLength(2);
    expect((await store.get('transaction', 't-drift'))?.cats).toBeUndefined();
    expect(await store.get('txMeta', 'meta-m')).toMatchObject({
      cats: [{ catId: 'fun', amountCents: 400 }, { catId: 'coffee', amountCents: 500 }],
    });
    expect(await migrateCatSpreads(store, repo)).toBe(0); // marker gates the rerun
  });
});
