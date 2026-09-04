import { describe, expect, it } from 'vitest';
import { ageOfMoneyDays, allocationId, availableCents, availableRecCents, recBucketId, recurringPeriodShare, spentByRecurring, spreadEvenly, toAllocateCents } from './allocation';
import type { AccountRow, AllocationRow, TransactionRow } from '@/db/types';

const tx = (partial: Partial<TransactionRow>): TransactionRow =>
  ({
    id: Math.random().toString(36).slice(2),
    spaceId: 's1',
    accountId: 'a1',
    date: '2026-01-05',
    amountCents: -1000,
    currency: 'EUR',
    merchant: 'Shop',
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    ...partial,
  }) as TransactionRow;

const alloc = (periodStart: string, catId: string, assignedCents: number): AllocationRow =>
  ({ id: allocationId('s1', periodStart, catId), spaceId: 's1', periodStart, catId, assignedCents, deleted: 0 }) as AllocationRow;

const P1 = { start: '2026-01-01', end: '2026-01-31' };
const P2 = { start: '2026-02-01', end: '2026-02-28' };
const accounts = new Map<string, AccountRow>();
const catalog = { byId: (id: string | undefined) => ({ id: id ?? 'uncategorized', parentId: id === 'coffee' ? 'food' : undefined }) };

describe('allocation math', () => {
  it('cell ids are deterministic per (space, period, category)', () => {
    expect(allocationId('s1', '2026-01-01', 'food')).toBe('alloc:s1:2026-01-01:food');
    expect(allocationId('s1', '2026-01-01', 'food')).toBe(allocationId('s1', '2026-01-01', 'food'));
  });

  it('unassigned income carries into the next period (cumulative to-allocate)', () => {
    const txs = [
      tx({ txType: 'income', amountCents: 100_000, date: '2026-01-03' }),
      tx({ txType: 'income', amountCents: 200_000, date: '2026-02-03' }),
    ];
    const allocations = [alloc('2026-01-01', 'food', 80_000)];
    // Jan: 1000 in, 800 assigned → 200 carries; Feb adds 2000 → 2200 left
    expect(toAllocateCents([P1, P2], txs, accounts, allocations)).toBe(220_000);
    expect(toAllocateCents([P1], txs, accounts, allocations)).toBe(20_000);
  });

  it('over-assignment shows negative to-allocate', () => {
    const txs = [tx({ txType: 'income', amountCents: 50_000, date: '2026-01-03' })];
    expect(toAllocateCents([P1], txs, accounts, [alloc('2026-01-01', 'food', 60_000)])).toBe(-10_000);
  });

  it('available rolls leftovers and overspends across periods; off = this period alone', () => {
    const txs = [
      tx({ catId: 'food', amountCents: -30_000, date: '2026-01-10' }),
      // sub category rolls up into the food envelope
      tx({ catId: 'coffee', amountCents: -25_000, date: '2026-02-10' }),
    ];
    const allocations = [alloc('2026-01-01', 'food', 50_000), alloc('2026-02-01', 'food', 10_000)];
    // on: (500−300) + (100−250) = 50
    expect(availableCents('food', [P1, P2], true, txs, catalog, allocations)).toBe(5_000);
    // off: 100 − 250 = −150
    expect(availableCents('food', [P1, P2], false, txs, catalog, allocations)).toBe(-15_000);
  });

  it('age of money averages FIFO ages over recent expenses', () => {
    const txs = [
      tx({ txType: 'income', amountCents: 10_000, date: '2026-01-01' }),
      tx({ txType: 'income', amountCents: 20_000, date: '2026-01-15' }),
      tx({ txType: 'expense', amountCents: -5_000, date: '2026-01-11' }),
      tx({ txType: 'expense', amountCents: -6_000, date: '2026-01-21' }),
    ];
    // first expense eats day-1 money at 10 days; second still starts on
    // the day-1 tranche at 20 days → average 15
    expect(ageOfMoneyDays(txs)).toBe(15);
    expect(ageOfMoneyDays([])).toBeNull();
    expect(ageOfMoneyDays([txs[0]])).toBeNull();
  });

  it('spreads the leftover evenly with the remainder up front', () => {
    const spread = spreadEvenly(100, ['a', 'b', 'c']);
    expect([...spread.values()]).toEqual([34, 33, 33]);
    expect(spreadEvenly(0, ['a']).size).toBe(0);
    expect(spreadEvenly(-5, ['a']).size).toBe(0);
  });

  it('translates a recurring cost into the period cadence (set-aside suggestion)', () => {
    expect(recurringPeriodShare({ amountCents: 1200, every: 'month' }, 'month')).toBe(1200);
    expect(recurringPeriodShare({ amountCents: 24_000, every: 'year' }, 'month')).toBe(2000); // 1/12
    expect(recurringPeriodShare({ amountCents: 1000, every: 'week' }, 'month')).toBe(4333); // ~52/12
    expect(recurringPeriodShare({ amountCents: 24_000, every: 'year' }, 'week')).toBe(462); // 1/52
    expect(recurringPeriodShare({ amountCents: 2400, every: 'month', everyN: 2 }, 'month')).toBe(1200);
  });

  it('recurring set-asides mirror the envelope math on their own bucket', () => {
    const period = { start: '2026-01-01', end: '2026-01-31' };
    const txs = [
      tx({ txType: 'expense', amountCents: -1599, date: '2026-01-12', recurringId: 'rec1' }),
      tx({ txType: 'expense', amountCents: -999, date: '2026-01-13' }), // unlinked: not counted
    ];
    expect(spentByRecurring(txs, period).get('rec1')).toBe(1599);
    const allocations: AllocationRow[] = [
      { id: allocationId('s', period.start, recBucketId('rec1')), spaceId: 's', periodStart: period.start, catId: recBucketId('rec1'), assignedCents: 2000, deleted: 0, fieldVersions: {} },
    ];
    expect(availableRecCents('rec1', [period], true, txs, allocations)).toBe(401); // 20.00 − 15.99
  });
});
