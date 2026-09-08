// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { HlcClock } from '@/sync/hlc';
import { applyLoanLinkDelta, countPreAnchorTx, countsTowardLoan } from './loanBalance';

const SPACE = 's1';

describe('loans v2 balance coupling', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  async function seeded() {
    const store = new DexieBackend(new MunniDB(`munni_loanbal_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('lb'), { trackOutbox: false });
    await repo.upsert('account', SPACE, 'loan1', {
      name: 'Car loan', type: 'loan', source: 'manual', currency: 'EUR',
      balanceCents: -50_000, balanceAsOf: '2026-06-01',
    });
    await repo.upsert('account', SPACE, 'bankloan', {
      name: 'Bank loan', type: 'loan', source: 'gocardless', currency: 'EUR', balanceCents: -90_000,
    });
    return { store, repo };
  }

  it('linking a payment pays the loan down; unlinking gives it back; draws deepen it', async () => {
    const { store, repo } = await seeded();
    const payment = { amountCents: -10_000, date: '2026-07-01' };
    await applyLoanLinkDelta(store, repo, payment, undefined, 'loan1');
    expect((await store.get('account', 'loan1'))?.balanceCents).toBe(-40_000);
    await applyLoanLinkDelta(store, repo, payment, 'loan1', undefined);
    expect((await store.get('account', 'loan1'))?.balanceCents).toBe(-50_000);
    // borrowing €50 more THROUGH the loan pushes the debt deeper
    await applyLoanLinkDelta(store, repo, { amountCents: 5_000, date: '2026-07-02' }, undefined, 'loan1');
    expect((await store.get('account', 'loan1'))?.balanceCents).toBe(-55_000);
  });

  it('bank-fed loans and mirrored pairs never move', async () => {
    const { store, repo } = await seeded();
    await applyLoanLinkDelta(store, repo, { amountCents: -10_000, date: '2026-07-01' }, undefined, 'bankloan');
    expect((await store.get('account', 'bankloan'))?.balanceCents).toBe(-90_000);
    await applyLoanLinkDelta(store, repo, { amountCents: -10_000, date: '2026-07-01', transferPeerId: 'peer' }, undefined, 'loan1');
    expect((await store.get('account', 'loan1'))?.balanceCents).toBe(-50_000);
  });

  it('pre-anchor rows are presumed baked into the typed balance — unless deliberately counted', async () => {
    const { store, repo } = await seeded();
    const old = { amountCents: -10_000, date: '2026-05-15' }; // before balanceAsOf
    expect(countsTowardLoan({ balanceAsOf: '2026-06-01' }, old)).toBe(false);
    await applyLoanLinkDelta(store, repo, old, undefined, 'loan1');
    expect((await store.get('account', 'loan1'))?.balanceCents).toBe(-50_000);
    // the loanCounted override rides the same check
    expect(countsTowardLoan({ balanceAsOf: '2026-06-01' }, { ...old, loanCounted: 1 })).toBe(true);
  });

  it('countPreAnchorTx applies once and stamps the marker through the callback', async () => {
    const { store, repo } = await seeded();
    let marked = false;
    const tx = {
      id: 't1', spaceId: SPACE, amountCents: -10_000, date: '2026-05-15',
      txType: 'debtPayment', needsReview: 0 as const, linkedAccountId: 'loan1',
    };
    const applied = await countPreAnchorTx(store, repo, tx as never, async () => {
      marked = true;
    });
    expect(applied).toBe(true);
    expect(marked).toBe(true);
    expect((await store.get('account', 'loan1'))?.balanceCents).toBe(-40_000);
    // the marker makes a second call a no-op
    const again = await countPreAnchorTx(store, repo, { ...tx, loanCounted: 1 } as never, async () => undefined);
    expect(again).toBe(false);
    expect((await store.get('account', 'loan1'))?.balanceCents).toBe(-40_000);
  });
});
