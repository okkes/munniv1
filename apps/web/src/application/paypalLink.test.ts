// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { HlcClock } from '@/sync/hlc';
import { linkPaypalFunding } from './paypalLink';

const SPACE = 's1';

describe('PayPal funding auto-link (PP1 rung 2)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  async function seeded() {
    const store = new DexieBackend(new MunniDB(`munni_pp1_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('pp1'), { trackOutbox: false });
    await repo.upsert('account', SPACE, 'acc-bank', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('account', SPACE, 'acc-pp', { name: 'PayPal', type: 'checking', source: 'gocardless', currency: 'EUR', balanceCents: 0, bankId: 'PAYPAL_PPLXLULL' });
    // funded purchase: the bank debit + the real PayPal-side transaction
    await repo.upsert('transaction', SPACE, 'bank-1', { accountId: 'acc-bank', date: '2026-07-14', amountCents: -2599, currency: 'EUR', merchant: 'PayPal (Europe) S.a.r.l. et Cie, S.C.A.', description: 'PP.4321 STEAM purchase', catId: 'hobby', txType: 'expense', needsReview: 1 });
    await repo.upsert('transaction', SPACE, 'pp-1', { accountId: 'acc-pp', date: '2026-07-15', amountCents: -2599, currency: 'EUR', merchant: 'Steam', txType: 'expense', needsReview: 1 });
    // an unrelated debit must stay untouched
    await repo.upsert('transaction', SPACE, 'bank-2', { accountId: 'acc-bank', date: '2026-07-14', amountCents: -700, currency: 'EUR', merchant: 'Albert Heijn', txType: 'expense', needsReview: 0, catId: 'groceries' });
    return { store, repo };
  }

  it('pairs the funding debit into a reviewed transfer to the PayPal account', async () => {
    const { store, repo } = await seeded();
    expect(await linkPaypalFunding(store, repo, SPACE)).toBe(1);

    // counted once: the bank side became a transfer, the PayPal side kept the spend
    expect(await store.get('transaction', 'bank-1')).toMatchObject({
      txType: 'transfer',
      linkedAccountId: 'acc-pp',
      needsReview: 0,
    });
    expect(await store.get('transaction', 'pp-1')).toMatchObject({ txType: 'expense', needsReview: 1 });
    expect(await store.get('transaction', 'bank-2')).toMatchObject({ txType: 'expense', needsReview: 0 });

    // idempotent: a second pass finds nothing left to link
    expect(await linkPaypalFunding(store, repo, SPACE)).toBe(0);
  });

  it('does nothing without a PayPal feed in the space', async () => {
    const store = new DexieBackend(new MunniDB(`munni_pp1_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('pp1b'), { trackOutbox: false });
    await repo.upsert('account', SPACE, 'acc-bank', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('transaction', SPACE, 'bank-1', { accountId: 'acc-bank', date: '2026-07-14', amountCents: -2599, currency: 'EUR', merchant: 'PayPal Europe', txType: 'expense', needsReview: 1 });
    expect(await linkPaypalFunding(store, repo, SPACE)).toBe(0);
    expect((await store.get('transaction', 'bank-1'))?.txType).toBe('expense');
  });
});
