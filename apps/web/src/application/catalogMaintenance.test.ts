// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { HlcClock } from '@/sync/hlc';
import { applyCatalogTombstones, migrateReimbursementSlices, migrateSignContradictions, migrateUnlinkedTransferKinds } from './catalogMaintenance';

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

describe('reimbursement slice migration (redesign, answer d)', () => {
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

  it('rewrites legacy NET slices to gross + reimbursed on both sides, once', async () => {
    const { store, repo } = await seeded();
    expect(await migrateReimbursementSlices(store, repo)).toBe(2);

    const exp = await store.get('transaction', 'exp');
    expect(exp?.splits).toEqual([
      { catId: 'groceries', amountCents: 6_000 },
      { catId: 'reimbursed', amountCents: 4_000 },
    ]);
    const cred = await store.get('transaction', 'cred');
    expect(cred?.splits).toEqual([{ catId: 'reimbursed', amountCents: 4_000 }]);
    expect((await store.get('transaction', 'plain'))?.splits).toBeUndefined();

    // marker gates the rerun
    expect(await migrateReimbursementSlices(store, repo)).toBe(0);
  });
});

describe('unlinked transfer-kind migration (kind simplification)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  it('rewrites counterparty-less transfer-family rows to income/expense by sign, once', async () => {
    const store = new DexieBackend(new MunniDB(`munni_tkm_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('tkm'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    const base = { accountId: 'a', currency: 'EUR', merchant: 'X', needsReview: 0 as const };
    // orphans of the old free type picker: no counterparty anywhere
    await repo.upsert('transaction', SPACE, 'sv', { ...base, date: '2026-01-01', amountCents: -5_000, txType: 'saving' });
    await repo.upsert('transaction', SPACE, 'iv', { ...base, date: '2026-01-02', amountCents: 5_000, txType: 'investment' });
    await repo.upsert('transaction', SPACE, 'tf', { ...base, date: '2026-01-03', amountCents: -1_000, txType: 'transfer' });
    // linked rows keep their derived type exactly as-is
    await repo.upsert('transaction', SPACE, 'ok', { ...base, date: '2026-01-04', amountCents: -2_000, txType: 'saving', linkedAccountId: 'b' });
    // standard + adjustment rows are not the migration's business
    await repo.upsert('transaction', SPACE, 'ex', { ...base, date: '2026-01-05', amountCents: -300, txType: 'expense' });
    await repo.upsert('transaction', SPACE, 'ad', { ...base, date: '2026-01-06', amountCents: 300, txType: 'adjustment' });

    expect(await migrateUnlinkedTransferKinds(store, repo)).toBe(3);
    expect((await store.get('transaction', 'sv'))?.txType).toBe('expense');
    expect((await store.get('transaction', 'iv'))?.txType).toBe('income');
    expect((await store.get('transaction', 'tf'))?.txType).toBe('expense');
    expect((await store.get('transaction', 'ok'))?.txType).toBe('saving');
    expect((await store.get('transaction', 'ex'))?.txType).toBe('expense');
    expect((await store.get('transaction', 'ad'))?.txType).toBe('adjustment');

    // marker gates the rerun
    expect(await migrateUnlinkedTransferKinds(store, repo)).toBe(0);
  });

  it('a bare "no counter account" label (arc 2) is deliberate — never flattened', async () => {
    const store = new DexieBackend(new MunniDB(`munni_tkm_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('tkm'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    const base = { accountId: 'a', currency: 'EUR', merchant: 'X', needsReview: 0 as const };
    // fresh-device scenario: synced rows include a deliberate bare pick
    // (locked sub filed at the write edge) next to a true old orphan
    await repo.upsert('transaction', SPACE, 'bare', { ...base, date: '2026-01-01', amountCents: -5_000, txType: 'debtPayment', catId: 'loanRepayment' });
    await repo.upsert('transaction', SPACE, 'orphan', { ...base, date: '2026-01-02', amountCents: -5_000, txType: 'debtPayment', catId: 'housing' });

    expect(await migrateUnlinkedTransferKinds(store, repo)).toBe(1);
    expect(await store.get('transaction', 'bare')).toMatchObject({ txType: 'debtPayment', catId: 'loanRepayment' });
    expect((await store.get('transaction', 'orphan'))?.txType).toBe('expense');
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

describe('family-sub back-fill (arc 2 locked doors)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  it('placeholder transfer-family rows file the sign-picked sub, once; deliberate data survives', async () => {
    const { migrateFamilySubs } = await import('./catalogMaintenance');
    const store = new DexieBackend(new MunniDB(`munni_tfs_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('tfs'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    const base = { accountId: 'a', currency: 'EUR', merchant: 'X', needsReview: 0 as const };
    // linked pre-arc-2 transfers on the hidden placeholder — both signs
    await repo.upsert('transaction', SPACE, 'out', { ...base, date: '2026-01-01', amountCents: -5_000, txType: 'saving', linkedAccountId: 'b', catId: 'uncategorized' });
    await repo.upsert('transaction', SPACE, 'in', { ...base, date: '2026-01-02', amountCents: 5_000, txType: 'transfer', linkedAccountId: 'b' });
    // deliberate category, splits, and standard rows stay untouched
    await repo.upsert('transaction', SPACE, 'kept', { ...base, date: '2026-01-03', amountCents: -2_000, txType: 'saving', linkedAccountId: 'b', catId: 'savingWithdraw' });
    await repo.upsert('transaction', SPACE, 'split', { ...base, date: '2026-01-04', amountCents: -2_000, txType: 'saving', linkedAccountId: 'b', splits: [{ catId: 'groceries', amountCents: 2_000 }] });
    await repo.upsert('transaction', SPACE, 'ex', { ...base, date: '2026-01-05', amountCents: -300, txType: 'expense' });

    expect(await migrateFamilySubs(store, repo)).toBe(2);
    expect((await store.get('transaction', 'out'))?.catId).toBe('savingDeposit');
    expect((await store.get('transaction', 'in'))?.catId).toBe('transferIn');
    expect((await store.get('transaction', 'kept'))?.catId).toBe('savingWithdraw');
    expect((await store.get('transaction', 'split'))?.catId).toBeUndefined();
    expect((await store.get('transaction', 'ex'))?.catId).toBeUndefined();

    // marker gates the rerun
    expect(await migrateFamilySubs(store, repo)).toBe(0);
  });
});

describe('sign-contradiction heal (pre-2026-07-28 bulk-apply damage)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  it('re-derives standard rows typed against their sign, once', async () => {
    const store = new DexieBackend(new MunniDB(`munni_sgn_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('sgn'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    const base = { accountId: 'a', currency: 'EUR', merchant: 'X', needsReview: 0 as const };
    await repo.upsert('transaction', SPACE, 'wrongPlus', { ...base, date: '2026-04-01', amountCents: 100_000, txType: 'income' });
    await repo.upsert('transaction', SPACE, 'wrongMinus', { ...base, date: '2026-04-02', amountCents: -100_000, txType: 'expense' });
    await repo.upsert('transaction', SPACE, 'fine', { ...base, date: '2026-04-03', amountCents: -500, txType: 'expense' });
    await repo.upsert('transaction', SPACE, 'saving', { ...base, date: '2026-04-04', amountCents: 2_000, txType: 'saving', linkedAccountId: 'b' });
    // the damage predates the write-path invariant — corrupt via the raw
    // store, exactly how those rows exist in the wild
    for (const [id, txType] of [['wrongPlus', 'expense'], ['wrongMinus', 'income']] as const) {
      const row = await store.get('transaction', id);
      await store.put('transaction', { ...row!, txType });
    }

    expect(await migrateSignContradictions(store, repo)).toBe(2);
    expect((await store.get('transaction', 'wrongPlus'))?.txType).toBe('income');
    expect((await store.get('transaction', 'wrongMinus'))?.txType).toBe('expense');
    expect((await store.get('transaction', 'fine'))?.txType).toBe('expense');
    expect((await store.get('transaction', 'saving'))?.txType).toBe('saving');

    // marker gates the rerun
    expect(await migrateSignContradictions(store, repo)).toBe(0);
  });
});
