import { describe, expect, it } from 'vitest';
import type { AccountRow, GoalRow, TransactionRow } from '@/db/types';
import { eventCategoryBreakdown, eventPerDayCents, eventSpentCents, eventSubcategoryBreakdown, suggestableTxs } from './events';
import { goalOverview, goalProgress, paceCentsPerMonth, savingsTotalCents } from './goals';

const tx = (partial: Partial<TransactionRow>): TransactionRow =>
  ({
    id: Math.random().toString(36).slice(2),
    spaceId: 's1',
    accountId: 'a',
    date: '2026-07-05',
    amountCents: -1000,
    currency: 'EUR',
    merchant: 'x',
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    fieldVersions: {},
    ...partial,
  }) as TransactionRow;

const account = (partial: Partial<AccountRow>): AccountRow =>
  ({
    id: Math.random().toString(36).slice(2),
    spaceId: 's1',
    name: 'acct',
    type: 'savings',
    source: 'manual',
    currency: 'EUR',
    balanceCents: 0,
    deleted: 0,
    fieldVersions: {},
    ...partial,
  }) as AccountRow;

describe('events math', () => {
  const catalog = { byId: (id: string | undefined) => ({ id: id ?? '', parentId: id === 'restaurants' ? 'food' : undefined }) };

  it('sums expenses (refunds reduce), ignores other events and income', () => {
    const txs = [
      tx({ eventId: 'e1', amountCents: -4000 }),
      tx({ eventId: 'e1', amountCents: 500 }), // refund
      tx({ eventId: 'e2', amountCents: -9999 }),
      tx({ eventId: 'e1', amountCents: 2000, txType: 'income' }),
    ];
    expect(eventSpentCents(txs, 'e1')).toBe(3500);
  });

  it('breaks down by main category and averages per day', () => {
    const txs = [
      tx({ eventId: 'e1', catId: 'restaurants', amountCents: -3000 }),
      tx({ eventId: 'e1', catId: 'transport', amountCents: -1000 }),
    ];
    expect(eventCategoryBreakdown(txs, 'e1', catalog)).toEqual([
      { catId: 'food', totalCents: 3000 },
      { catId: 'transport', totalCents: 1000 },
    ]);
    expect(eventPerDayCents(7000, '2026-07-01', '2026-07-07')).toBe(1000);
    expect(eventPerDayCents(7000)).toBeNull();
  });

  it('drills a main category into its sub totals (user request)', () => {
    const txs = [
      tx({ eventId: 'e1', catId: 'restaurants', amountCents: -3000 }),
      tx({ eventId: 'e1', catId: 'restaurants', amountCents: -500 }),
      tx({ eventId: 'e1', catId: 'transport', amountCents: -1000 }),
    ];
    expect(eventSubcategoryBreakdown(txs, 'e1', catalog, 'food')).toEqual([
      { catId: 'restaurants', totalCents: 3500 },
    ]);
    expect(eventSubcategoryBreakdown(txs, 'e1', catalog, 'transport')).toEqual([
      { catId: 'transport', totalCents: 1000 },
    ]);
  });

  it('suggests unattached expenses inside the date range', () => {
    const inside = tx({ date: '2026-07-03', amountCents: -100 });
    const attached = tx({ date: '2026-07-03', eventId: 'other' });
    const outside = tx({ date: '2026-08-01' });
    expect(suggestableTxs([inside, attached, outside], 'e1', '2026-07-01', '2026-07-07')).toEqual([inside]);
  });
});

describe('goals math', () => {
  const goal = (partial: Partial<GoalRow>): GoalRow =>
    ({ id: 'g', spaceId: 's1', name: 'g', targetCents: 100_000, allocatedCents: 0, deleted: 0, fieldVersions: {}, ...partial }) as GoalRow;

  it('saved total counts non-archived savings accounts only', () => {
    const accounts = [
      account({ balanceCents: 50_000 }),
      account({ balanceCents: 20_000, archived: 1 }),
      account({ balanceCents: 99_999, type: 'checking' }),
    ];
    expect(savingsTotalCents(accounts)).toBe(50_000);
  });

  it('unallocated may go negative after a savings withdrawal (ruling)', () => {
    const overview = goalOverview([goal({ allocatedCents: 60_000 })], [account({ balanceCents: 40_000 })]);
    expect(overview.unallocatedCents).toBe(-20_000);
  });

  it('pace divides the gap over the months left', () => {
    const g = goal({ allocatedCents: 40_000, targetDate: '2027-01-15' });
    expect(paceCentsPerMonth(g, '2026-07-09')).toBe(10_000); // 60k over 6 months
    expect(paceCentsPerMonth(goal({ allocatedCents: 100_000, targetDate: '2027-01-15' }), '2026-07-09')).toBe(0);
    expect(paceCentsPerMonth(goal({}), '2026-07-09')).toBeNull();
    expect(goalProgress(goal({ allocatedCents: 25_000 }))).toBeCloseTo(0.25);
  });
});

// debts math moved to its own file (src/domain/debts.test.ts) when the
// arc-3 loan work outgrew this guest spot
