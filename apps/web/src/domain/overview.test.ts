import { describe, expect, it } from 'vitest';
import type { AccountRow, TransactionRow } from '@/db/types';
import { categoryBreakdown, contributionCents, overviewSummary, txsForKind } from './overview';
import { inPeriod, periodHistory } from './periods';

const PERIOD = { start: '2026-07-01', end: '2026-07-31' };

const tx = (partial: Partial<TransactionRow>): TransactionRow =>
  ({
    id: Math.random().toString(36).slice(2),
    spaceId: 's',
    accountId: 'checking',
    date: '2026-07-10',
    amountCents: -1000,
    currency: 'EUR',
    merchant: 'M',
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    fieldVersions: {},
    ...partial,
  }) as TransactionRow;

const accounts = new Map<string, AccountRow>([
  ['checking', { id: 'checking', type: 'checking' } as AccountRow],
  ['savings', { id: 'savings', type: 'savings' } as AccountRow],
  ['broker', { id: 'broker', type: 'brokerage' } as AccountRow],
]);

describe('periodHistory', () => {
  it('monthly periods start on the configured day', () => {
    const periods = periodHistory('month', 20, 3, new Date(2026, 6, 7)); // 7 Jul, before day 20
    expect(periods).toHaveLength(3);
    expect(periods.at(-1)).toEqual({ start: '2026-06-20', end: '2026-07-19' }); // current
    expect(periods[0]).toEqual({ start: '2026-04-20', end: '2026-05-19' });
  });

  it('monthly after the start day rolls into the new period', () => {
    const [current] = periodHistory('month', 5, 1, new Date(2026, 6, 7)); // 7 Jul, after day 5
    expect(current).toEqual({ start: '2026-07-05', end: '2026-08-04' });
  });

  it('weekly periods are Monday-anchored and contiguous', () => {
    const periods = periodHistory('week', 1, 2, new Date(2026, 6, 8)); // Wed 8 Jul 2026
    expect(periods[1]).toEqual({ start: '2026-07-06', end: '2026-07-12' });
    expect(periods[0]).toEqual({ start: '2026-06-29', end: '2026-07-05' });
  });

  it('biweekly periods are 14 days and never drift', () => {
    const [p] = periodHistory('biweekly', 1, 1, new Date(2026, 6, 8));
    const days = (Date.parse(p.end) - Date.parse(p.start)) / 86_400_000 + 1;
    expect(days).toBe(14);
    expect(inPeriod('2026-07-08', p)).toBe(true);
  });

  it('weekly/biweekly periods start on the chosen weekday', () => {
    // periodDay 3 = Wednesday; on Wed 8 Jul 2026 the current week IS 8 Jul…
    const [wed] = periodHistory('week', 3, 1, new Date(2026, 6, 8));
    expect(wed).toEqual({ start: '2026-07-08', end: '2026-07-14' });
    // …and on Tue 7 Jul it is still the week that began the previous Wednesday
    const [prev] = periodHistory('week', 3, 1, new Date(2026, 6, 7));
    expect(prev).toEqual({ start: '2026-07-01', end: '2026-07-07' });
    // sunday-start biweekly stays 14 days on the sunday grid
    const [sun] = periodHistory('biweekly', 7, 1, new Date(2026, 6, 8));
    expect(new Date(sun.start).getDay()).toBe(0); // JS Sunday
    expect((Date.parse(sun.end) - Date.parse(sun.start)) / 86_400_000 + 1).toBe(14);
  });
});

describe('contribution sign mechanics (user spec)', () => {
  it('-400 from checking to savings counts as +400 saved', () => {
    expect(contributionCents('saving', tx({ txType: 'saving', amountCents: -40_000 }))).toBe(40_000);
  });

  it('+400 back from savings counts as -400 saved', () => {
    expect(contributionCents('saving', tx({ txType: 'saving', amountCents: 40_000 }))).toBe(-40_000);
  });

  it('the same reversal applies to investments', () => {
    expect(contributionCents('investment', tx({ txType: 'investment', amountCents: -25_000 }))).toBe(25_000);
    expect(contributionCents('investment', tx({ txType: 'investment', amountCents: 25_000 }))).toBe(-25_000);
  });

  it('spending is positive, income keeps its sign', () => {
    expect(contributionCents('expense', tx({ amountCents: -1250 }))).toBe(1250);
    expect(contributionCents('income', tx({ txType: 'income', amountCents: 200_000 }))).toBe(200_000);
  });
});

describe('overviewSummary', () => {
  it('sums per type within the period and skips other periods/deleted rows', () => {
    const txs = [
      tx({ txType: 'income', amountCents: 220_000 }),
      tx({ amountCents: -5_000 }),
      tx({ amountCents: -2_000 }),
      tx({ txType: 'saving', amountCents: -40_000 }),
      tx({ txType: 'investment', amountCents: -25_000 }),
      // -500 into the family pot, +100 taken back: net +400 funded (green)
      tx({ txType: 'funding', amountCents: -50_000 }),
      tx({ txType: 'funding', amountCents: 10_000 }),
      tx({ txType: 'debtPayment', amountCents: -30_000 }),
      tx({ amountCents: -99_900, date: '2026-06-30' }), // outside period
      tx({ amountCents: -99_900, deleted: 1 } as Partial<TransactionRow>),
    ];
    const summary = overviewSummary(txs, accounts, PERIOD);
    expect(summary).toEqual({
      incomeCents: 220_000,
      expenseCents: 7_000,
      savingCents: 40_000,
      investmentCents: 25_000,
      fundingCents: 40_000,
      debtCents: 30_000,
    });
  });

  it('mirror rows on the savings/brokerage account do not double-count', () => {
    const txs = [
      // transfer visible from BOTH sides (both accounts attached)
      tx({ txType: 'saving', amountCents: -40_000, accountId: 'checking' }),
      tx({ txType: 'saving', amountCents: 40_000, accountId: 'savings' }), // mirror — excluded
      tx({ txType: 'investment', amountCents: -25_000, accountId: 'checking' }),
      tx({ txType: 'investment', amountCents: 25_000, accountId: 'broker' }), // mirror — excluded
    ];
    const summary = overviewSummary(txs, accounts, PERIOD);
    expect(summary.savingCents).toBe(40_000);
    expect(summary.investmentCents).toBe(25_000);
  });

  it('interest earned ON a savings account still counts as income', () => {
    const txs = [tx({ txType: 'income', amountCents: 52, accountId: 'savings' })];
    expect(overviewSummary(txs, accounts, PERIOD).incomeCents).toBe(52);
  });
});

describe('categoryBreakdown', () => {
  const catalog = {
    byId: (id: string | undefined) => {
      const known: Record<string, { id: string; parentId?: string }> = {
        groceries: { id: 'groceries', parentId: 'consumption' },
        restaurants: { id: 'restaurants', parentId: 'consumption' },
        gym: { id: 'gym', parentId: 'sport' },
        uncategorized: { id: 'uncategorized' },
      };
      return known[id ?? 'uncategorized'] ?? known.uncategorized;
    },
  };

  it('groups by main category with sorted sub totals', () => {
    const txs = [
      tx({ catId: 'groceries', amountCents: -3_000 }),
      tx({ catId: 'groceries', amountCents: -1_000 }),
      tx({ catId: 'restaurants', amountCents: -6_000 }),
      tx({ catId: 'gym', amountCents: -2_500 }),
    ];
    const groups = categoryBreakdown('expense', txs, accounts, PERIOD, catalog);
    expect(groups.map((g) => g.catId)).toEqual(['consumption', 'sport']);
    expect(groups[0].totalCents).toBe(10_000);
    expect(groups[0].subs.map((s) => s.catId)).toEqual(['restaurants', 'groceries']);
    expect(groups[0].subs[1]).toEqual({ catId: 'groceries', totalCents: 4_000, count: 2 });
  });

  it('kind filtering flows through (income never mixes into expense)', () => {
    const txs = [tx({ txType: 'income', catId: 'groceries', amountCents: 5_000 })];
    expect(categoryBreakdown('expense', txs, accounts, PERIOD, catalog)).toEqual([]);
    expect(txsForKind('income', txs, accounts, PERIOD)).toHaveLength(1);
  });
});
