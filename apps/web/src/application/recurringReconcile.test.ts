// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { DexieBackend } from '@/db/backend';
import { Repo } from '@/db/repo';
import { merchantKey } from '@/domain/merchantKey';
import { reconcileRecurringLinks } from './recurring';

const SPACE = 'sp1';

describe('recurring auto-reconcile adopts the recurring facts (#360)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  it('links + adopts catId and counterparty, but the row STAYS unreviewed', async () => {
    const store = new DexieBackend(new MunniDB(`munni_recon_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('recon'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    await repo.upsert('recurring', SPACE, 'rec1', {
      name: 'Gym',
      kind: 'subscription',
      amountCents: 2500,
      every: 'month',
      dueDay: 3,
      active: 1,
      merchantKey: merchantKey('GYM AMSTERDAM'),
      catId: 'sport',
      linkedAccountId: 'acctX',
    });
    const base = { accountId: 'a', currency: 'EUR', txType: 'expense' as const, merchant: 'GYM AMSTERDAM' };
    await repo.upsert('transaction', SPACE, 'fresh', {
      ...base,
      date: '2026-08-03',
      amountCents: -2500,
      needsReview: 1,
      catId: 'uncategorized',
    });
    // reimbursement-filed rows keep their attribution (same rule as the
    // manual link)
    await repo.upsert('transaction', SPACE, 'expecting', {
      ...base,
      date: '2026-07-03',
      amountCents: -2500,
      needsReview: 1,
      catId: 'expenseReimburse',
    });

    expect(await reconcileRecurringLinks(store, repo, SPACE)).toBe(2);
    const fresh = await store.get('transaction', 'fresh');
    expect(fresh?.recurringId).toBe('rec1');
    expect(fresh?.catId).toBe('sport');
    expect(fresh?.linkedAccountId).toBe('acctX');
    expect(fresh?.needsReview).toBe(1); // the machine guessed — the user still confirms
    const expecting = await store.get('transaction', 'expecting');
    expect(expecting?.recurringId).toBe('rec1');
    expect(expecting?.catId).toBe('expenseReimburse');
  });
});
