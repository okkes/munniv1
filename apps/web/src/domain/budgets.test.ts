import { describe, expect, it } from 'vitest';
import type { BudgetRow, TransactionRow } from '@/db/types';
import {
  budgetFamily,
  budgetPeriodAt,
  budgetSpentCents,
  budgetStatus,
  carriedCents,
  categoryConflicts,
  currentBudgetPeriod,
  sortByUrgency,
} from './budgets';

const budget = (partial: Partial<BudgetRow>): BudgetRow =>
  ({
    id: 'b1',
    spaceId: 's1',
    name: 'Groceries',
    amountCents: 10_000,
    every: 'week',
    anchor: '2026-06-01', // a Monday
    catIds: ['groceries'],
    active: 1,
    deleted: 0,
    fieldVersions: {},
    ...partial,
  }) as BudgetRow;

const tx = (date: string, amountCents: number, catId = 'groceries'): TransactionRow =>
  ({
    id: `t${date}-${amountCents}`,
    spaceId: 's1',
    accountId: 'a',
    date,
    amountCents,
    currency: 'EUR',
    merchant: 'x',
    catId,
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    fieldVersions: {},
  }) as TransactionRow;

const catalog = {
  byId: (id: string | undefined) => ({ id: id ?? '', parentId: id === 'supermarket' ? 'groceries' : undefined }),
  childrenOf: (id: string) => (id === 'groceries' ? [{ id: 'supermarket' }] : []),
};

describe('budget periods', () => {
  it('weekly periods walk from the anchor date', () => {
    const b = budget({ every: 'week', anchor: '2026-06-01' });
    expect(budgetPeriodAt(b, 0)).toEqual({ start: '2026-06-01', end: '2026-06-07' });
    expect(budgetPeriodAt(b, 2)).toEqual({ start: '2026-06-15', end: '2026-06-21' });
    expect(currentBudgetPeriod(b, '2026-06-10')).toEqual({ start: '2026-06-08', end: '2026-06-14' });
  });

  it('biweekly periods are 14 days long', () => {
    const b = budget({ every: '2weeks', anchor: '2026-06-01' });
    expect(budgetPeriodAt(b, 1)).toEqual({ start: '2026-06-15', end: '2026-06-28' });
  });

  it('monthly periods clamp the anchor day into short months', () => {
    const b = budget({ every: 'month', anchor: '2026-01-31' });
    expect(budgetPeriodAt(b, 1)).toEqual({ start: '2026-02-28', end: '2026-03-30' });
    // before the anchor day, today still belongs to the previous cycle
    expect(currentBudgetPeriod(b, '2026-03-15')).toEqual({ start: '2026-02-28', end: '2026-03-30' });
    expect(currentBudgetPeriod(b, '2026-03-31')).toEqual({ start: '2026-03-31', end: '2026-04-29' });
  });
});

describe('spent + family', () => {
  it('a main category claims its subs; refunds reduce spending', () => {
    const family = budgetFamily(['groceries'], catalog);
    expect(family.has('supermarket')).toBe(true);
    const spent = budgetSpentCents(
      [tx('2026-06-02', -2500), tx('2026-06-03', -1000, 'supermarket'), tx('2026-06-04', 500), tx('2026-06-04', -999, 'transport')],
      family,
      { start: '2026-06-01', end: '2026-06-07' },
    );
    expect(spent).toBe(3000); // 2500 + 1000 − 500, transport ignored
  });
});

describe('carry-over replay', () => {
  it("mode 'periods' carries leftovers at most N cycles", () => {
    // limit 100/week: week0 spends 40 (leftover 60), week1 spends 0
    const txs = [tx('2026-06-02', -4000)];
    const withOne = budget({ carryOver: 1, carryMode: 'periods', carryPeriods: 1 });
    // in week1 the 60 from week0 is available…
    expect(carriedCents(withOne, txs, budgetFamily(['groceries'], catalog), '2026-06-10')).toBe(6000);
    // …but with N=1, by week2 only week1's (untouched full) leftover counts
    expect(carriedCents(withOne, txs, budgetFamily(['groceries'], catalog), '2026-06-17')).toBe(10_000);
  });

  it("mode 'cap' accumulates but never beyond the cap", () => {
    const capped = budget({ carryOver: 1, carryMode: 'cap', carryCapCents: 12_000 });
    // three empty weeks would carry 300 — the cap holds it at 120
    expect(carriedCents(capped, [], budgetFamily(['groceries'], catalog), '2026-06-24')).toBe(12_000);
  });

  it('overspending eats into the carried amount, never below zero', () => {
    const b = budget({ carryOver: 1, carryMode: 'periods', carryPeriods: 2 });
    // week0: spend 150 of 100 → leftover clamps to 0 (no debt carried)
    const txs = [tx('2026-06-02', -15_000)];
    expect(carriedCents(b, txs, budgetFamily(['groceries'], catalog), '2026-06-10')).toBe(0);
  });

  it('no carry before the second period or when disabled', () => {
    expect(carriedCents(budget({}), [], budgetFamily(['groceries'], catalog), '2026-06-10')).toBe(0);
    expect(carriedCents(budget({ carryOver: 1 }), [], budgetFamily(['groceries'], catalog), '2026-06-03')).toBe(0);
  });
});

describe('status + urgency', () => {
  it('computes limit, left and ratio with carry-over included', () => {
    const b = budget({ carryOver: 1, carryMode: 'periods', carryPeriods: 1 });
    const txs = [tx('2026-06-02', -4000), tx('2026-06-09', -12_000)];
    const status = budgetStatus(b, txs, catalog, '2026-06-10');
    expect(status.carriedCents).toBe(6000);
    expect(status.limitCents).toBe(16_000);
    expect(status.leftCents).toBe(4000);
    expect(status.ratio).toBeCloseTo(0.75);
  });

  it('orders over-budget first, then closest to the limit', () => {
    const mk = (name: string, spent: number) =>
      budgetStatus(budget({ id: name, name, catIds: ['groceries'] }), [tx('2026-06-02', -spent)], catalog, '2026-06-03');
    const sorted = sortByUrgency([mk('calm', 1000), mk('over', 15_000), mk('close', 9000)]);
    expect(sorted.map((s) => s.budget.name)).toEqual(['over', 'close', 'calm']);
  });
});

describe('category exclusivity', () => {
  it('flags direct claims and main↔sub family overlaps with the owner name', () => {
    const other = budget({ id: 'b2', name: 'Food', catIds: ['supermarket'] });
    const conflicts = categoryConflicts(['groceries', 'transport'], [other], catalog);
    // picking the MAIN conflicts because Food owns one of its subs
    expect(conflicts.get('groceries')).toBe('Food');
    expect(conflicts.has('transport')).toBe(false);
  });
});
