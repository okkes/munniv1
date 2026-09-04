// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { HlcClock } from '@/sync/hlc';
import { foldDebtsIntoAccounts, foldedLoanAccountId } from './debts';

const SPACE = 's1';

describe('loans v2 fold (debt rows collapse into their liability account)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  function fresh() {
    const store = new DexieBackend(new MunniDB(`munni_fold_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('fold'), { trackOutbox: false });
    return { store, repo };
  }

  it('copies the story onto the backing account, blank-only, and tombstones the debt', async () => {
    const { store, repo } = fresh();
    await repo.upsert('account', SPACE, 'a1', {
      name: 'ABN loan', type: 'loan', source: 'manual', currency: 'EUR', balanceCents: -50_000,
      // a field the account ALREADY carries must win over the debt's copy
      interestPctYear: 3,
    });
    await repo.upsert('debt', SPACE, 'd1', {
      name: 'Car loan', accountId: 'a1', originalCents: 90_000, interestPctYear: 9,
      paymentCents: 5_000, paymentEvery: 'week', note: 'aflossing', merchantKey: 'santander',
    });

    await foldDebtsIntoAccounts(store, repo);

    const account = await store.get('account', 'a1');
    expect(account).toMatchObject({
      originalCents: 90_000,
      interestPctYear: 3, // the account's own value won
      paymentCents: 5_000,
      paymentEvery: 'week',
      note: 'aflossing',
      merchantKey: 'santander',
      trackAsDebt: 1,
    });
    expect((await store.get('debt', 'd1'))?.deleted).toBe(1);

    // running again is a no-op (every-boot sweep must be idempotent)
    await foldDebtsIntoAccounts(store, repo);
    expect((await store.get('account', 'a1'))?.interestPctYear).toBe(3);
  });

  it('an account-less debt mints a manual loan account at its remaining value, deterministically', async () => {
    const { store, repo } = fresh();
    await repo.upsert('space', SPACE, SPACE, { name: 'S', currency: 'EUR', kind: 'personal' });
    await repo.upsert('debt', SPACE, 'd2', { name: 'Lent to Sam', originalCents: 40_000, remainingCents: 25_000 });

    await foldDebtsIntoAccounts(store, repo);

    // deterministic id: two devices folding the same debt converge by LWW
    const minted = await store.get('account', foldedLoanAccountId('d2'));
    expect(minted).toMatchObject({
      name: 'Lent to Sam', type: 'loan', source: 'manual', currency: 'EUR',
      balanceCents: -25_000, originalCents: 40_000, trackAsDebt: 1,
    });
  });

  it('archived maps by type: loans archive the account, cards just stop tracking', async () => {
    const { store, repo } = fresh();
    await repo.upsert('account', SPACE, 'loan1', { name: 'Old loan', type: 'loan', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('account', SPACE, 'card1', { name: 'Visa', type: 'credit', source: 'gocardless', currency: 'EUR', balanceCents: -100 });
    await repo.upsert('debt', SPACE, 'dLoan', { name: 'Old loan', accountId: 'loan1', archived: 1 });
    await repo.upsert('debt', SPACE, 'dCard', { name: 'Visa debt', accountId: 'card1', archived: 1 });

    await foldDebtsIntoAccounts(store, repo);

    // the paid-off milestone keeps its history…
    expect((await store.get('account', 'loan1'))?.archived).toBe(1);
    // …but a live credit card must NOT vanish from account lists
    const card = await store.get('account', 'card1');
    expect(card?.archived).not.toBe(1);
    expect(card?.trackAsDebt).toBe(0);
  });
});
