import { describe, expect, it } from 'vitest';
import { budgetRealityCheck, collectInsights, debtAcceleration, priceCreep, smallHabit, subscriptionOverlap, weekendMultiplier } from './insights';
import type { InsightInputs } from './insights';
import type { AccountRow, BudgetRow, RecurringRow, TransactionRow } from '@/db/types';

const tx = (partial: Partial<TransactionRow>): TransactionRow =>
  ({
    id: Math.random().toString(36).slice(2),
    spaceId: 's1',
    accountId: 'a1',
    date: '2026-07-05',
    amountCents: -1000,
    currency: 'EUR',
    merchant: 'Shop',
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    ...partial,
  }) as TransactionRow;

const rec = (partial: Partial<RecurringRow>): RecurringRow =>
  ({ id: 'r1', spaceId: 's1', name: 'Netflix', kind: 'subscription', amountCents: 1399, every: 'month', dueDay: 1, active: 1, deleted: 0, ...partial }) as RecurringRow;

const catalog = {
  byId: (id: string | undefined) => ({ id: id ?? 'uncategorized', parentId: id === 'streaming' ? 'entertainment' : undefined }),
  childrenOf: () => [] as { id: string }[],
};

const base = (partial: Partial<InsightInputs>): InsightInputs => ({
  txs: [],
  recurrings: [],
  budgets: [],
  loans: [],
  accountsById: new Map(),
  catalog,
  periods: [
    { start: '2026-06-01', end: '2026-06-30' },
    { start: '2026-07-01', end: '2026-07-31' },
  ],
  today: '2026-07-10',
  ...partial,
});

describe('insight detectors', () => {
  it('price creep fires on a SUSTAINED increase, stays silent under €0.50/mo or one-offs', () => {
    const charges = [
      tx({ recurringId: 'r1', amountCents: -1399, date: '2026-03-01' }),
      tx({ recurringId: 'r1', amountCents: -1399, date: '2026-04-01' }),
      tx({ recurringId: 'r1', amountCents: -1599, date: '2026-06-01' }),
      tx({ recurringId: 'r1', amountCents: -1599, date: '2026-07-01' }),
    ];
    const hits = priceCreep(base({ recurrings: [rec({})], txs: charges }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: 'creep:r1:1599', severity: 'leak', impactCents: 2400 });

    // a single pricier charge (proration) is not a price change yet
    expect(priceCreep(base({ recurrings: [rec({})], txs: charges.slice(0, 3) }))).toHaveLength(0);

    const tiny = charges.map((c) => ({ ...c, amountCents: c.amountCents === -1599 ? -1420 : c.amountCents }));
    expect(priceCreep(base({ recurrings: [rec({})], txs: tiny }))).toHaveLength(0);
  });

  it('subscription overlap groups by main category', () => {
    const subs = [
      rec({ id: 'r1', name: 'Netflix', catId: 'streaming' }),
      rec({ id: 'r2', name: 'Disney+', catId: 'streaming', amountCents: 999 }),
      rec({ id: 'r3', name: 'Gym', catId: 'sport' }),
    ];
    const hits = subscriptionOverlap(base({ recurrings: subs }));
    expect(hits).toHaveLength(1);
    expect(hits[0].params.names).toBe('Netflix + Disney+');
    expect(hits[0].impactCents).toBe((1399 + 999) * 12);
  });

  it('small habit needs 8 hits and €20 in the current period', () => {
    const coffees = Array.from({ length: 9 }, (_, i) =>
      tx({ merchant: 'Koffiebar', amountCents: -350, date: `2026-07-0${(i % 9) + 1}` }),
    );
    const hits = smallHabit(base({ txs: coffees }));
    expect(hits).toHaveLength(1);
    expect(hits[0].params.n).toBe(9);

    expect(smallHabit(base({ txs: coffees.slice(0, 5) }))).toHaveLength(0);
  });

  it('weekend multiplier needs a 1.8× ratio and real money', () => {
    const txs = [
      // Fridays/Saturdays in July 2026: 3,4,10,11 …
      tx({ amountCents: -40_000, date: '2026-07-03' }),
      tx({ amountCents: -40_000, date: '2026-07-04' }),
      tx({ amountCents: -40_000, date: '2026-07-10' }),
      tx({ amountCents: -2_000, date: '2026-07-06' }), // a Monday
    ];
    const hits = weekendMultiplier(base({ txs }));
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('pattern');

    expect(weekendMultiplier(base({ txs: [tx({ amountCents: -2_000, date: '2026-07-06' })] }))).toHaveLength(0);
  });

  it('budget reality check wants three straight overshoots', () => {
    const budget: BudgetRow = {
      id: 'b1',
      spaceId: 's1',
      name: 'Food',
      catIds: ['consumption'],
      amountCents: 10_000,
      every: 'month',
      anchor: '2026-01-01',
      deleted: 0,
    } as BudgetRow;
    const overshoots = ['2026-04-05', '2026-05-05', '2026-06-05'].map((date) =>
      tx({ catId: 'consumption', amountCents: -15_000, date }),
    );
    const hits = budgetRealityCheck(base({ budgets: [budget], txs: overshoots }));
    expect(hits).toHaveLength(1);
    expect(hits[0].params.suggested).toBe(15_000);

    // one good month breaks the streak
    const mixed = overshoots.slice(0, 2).concat(tx({ catId: 'consumption', amountCents: -5_000, date: '2026-06-05' }));
    expect(budgetRealityCheck(base({ budgets: [budget], txs: mixed }))).toHaveLength(0);
  });

  it('debt acceleration quantifies €25/month extra on the biggest debt', () => {
    // v2: the loan IS a liability account — remaining is its balance
    const loan: AccountRow = {
      id: 'd1',
      spaceId: 's1',
      name: 'Student loan',
      type: 'loan',
      source: 'manual',
      currency: 'EUR',
      balanceCents: -2_500_000,
      originalCents: 2_500_000,
      interestPctYear: 8,
      paymentCents: 30_000,
      deleted: 0,
    } as AccountRow;
    const hits = debtAcceleration(base({ loans: [loan] }));
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('win');
    expect(hits[0].params.months).toBeGreaterThan(0);
    expect(hits[0].impactCents).toBeGreaterThan(2_000);

    expect(debtAcceleration(base({ loans: [{ ...loan, paymentCents: undefined } as AccountRow] }))).toHaveLength(0);
    // per-MONTH claim: a weekly payer (arc 3 cadence) is out of scope
    expect(debtAcceleration(base({ loans: [{ ...loan, paymentEvery: 'week' } as AccountRow] }))).toHaveLength(0);
  });

  it('the engine ranks work by impact and caps the wins', () => {
    const loan = { id: 'd1', spaceId: 's1', name: 'L', type: 'loan', source: 'manual', currency: 'EUR', balanceCents: -2_500_000, originalCents: 2_500_000, interestPctYear: 8, paymentCents: 30_000, deleted: 0 } as AccountRow;
    const subs = [rec({ id: 'r1', catId: 'streaming' }), rec({ id: 'r2', name: 'HBO', catId: 'streaming' })];
    const ranked = collectInsights(base({ loans: [loan], recurrings: subs }));
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    // the win never outranks the leak
    expect(ranked[0].severity).not.toBe('win');
    expect(ranked.at(-1)!.severity).toBe('win');
  });
});
