// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { DexieBackend } from '@/db/backend';
import { Repo } from '@/db/repo';
import { propagateRecurringCategory } from './recurring';

const SPACE = 'sp1';

describe('recurring category propagation (the recurring owns the category)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  async function seed() {
    const store = new DexieBackend(new MunniDB(`munni_rcat_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('rcat'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    const base = { accountId: 'a', currency: 'EUR', txType: 'expense' as const, needsReview: 0 as const, merchant: 'Gym' };
    await repo.upsert('transaction', SPACE, 'linked1', { ...base, date: '2026-06-01', amountCents: -2_500, recurringId: 'rec1', catId: 'groceries' });
    await repo.upsert('transaction', SPACE, 'linked2', { ...base, date: '2026-07-01', amountCents: -2_500, recurringId: 'rec1', catId: 'sport' });
    // the reimbursement exception: these keep their attribution
    await repo.upsert('transaction', SPACE, 'expecting', { ...base, date: '2026-07-05', amountCents: -2_500, recurringId: 'rec1', catId: 'expenseReimburse' });
    // other recurrings and loose rows are not touched
    await repo.upsert('transaction', SPACE, 'other', { ...base, date: '2026-07-08', amountCents: -900, recurringId: 'rec2', catId: 'groceries' });
    await repo.upsert('transaction', SPACE, 'loose', { ...base, date: '2026-07-09', amountCents: -900, catId: 'groceries' });
    return { store, repo };
  }

  it('re-files every linked transaction, honoring the reimbursement exception', async () => {
    const { store, repo } = await seed();
    expect(await propagateRecurringCategory(store, repo, SPACE, 'rec1', 'sport')).toBe(1);
    expect((await store.get('transaction', 'linked1'))?.catId).toBe('sport');
    expect((await store.get('transaction', 'linked2'))?.catId).toBe('sport'); // already there
    expect((await store.get('transaction', 'expecting'))?.catId).toBe('expenseReimburse');
    expect((await store.get('transaction', 'other'))?.catId).toBe('groceries');
    expect((await store.get('transaction', 'loose'))?.catId).toBe('groceries');
  });

  it('a cleared recurring category files linked rows as uncategorized', async () => {
    const { store, repo } = await seed();
    expect(await propagateRecurringCategory(store, repo, SPACE, 'rec1', undefined)).toBe(2);
    expect((await store.get('transaction', 'linked1'))?.catId).toBe('uncategorized');
    expect((await store.get('transaction', 'linked2'))?.catId).toBe('uncategorized');
  });
});
