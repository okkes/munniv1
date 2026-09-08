import type { AccountRow, AllocationRow, TransactionRow } from '@/db/types';
import { contributionCents, txsForKind } from './overview';
import type { Period } from './periods';

/**
 * Allocation math (approved allocation design) — all pure. Money gets a
 * job before it gets spent: per period, income is distributed across
 * main categories; spending draws each assignment down.
 */

interface CatalogLookup {
  byId: (id: string | undefined) => { id: string; parentId?: string };
}

/** deterministic cell id — concurrent edits of the same cell LWW-converge */
export const allocationId = (spaceId: string, periodStart: string, catId: string): string =>
  `alloc:${spaceId}:${periodStart}:${catId}`;

/** income received inside a period, by the overview's income rules */
export function periodIncomeCents(
  txs: readonly TransactionRow[],
  accountsById: Map<string, AccountRow>,
  period: Period,
): number {
  return txsForKind('income', [...txs], accountsById, period).reduce((sum, tx) => sum + contributionCents('income', tx), 0);
}

/** positive expense cents per MAIN category inside a period (subs roll up) */
export function spentByMainCat(txs: readonly TransactionRow[], catalog: CatalogLookup, period: Period): Map<string, number> {
  const totals = new Map<string, number>();
  for (const tx of txs) {
    if (tx.deleted !== 0 || tx.txType !== 'expense') continue;
    if (tx.date < period.start || tx.date > period.end) continue;
    const cat = catalog.byId(tx.catId);
    const mainId = cat.parentId ?? cat.id;
    totals.set(mainId, (totals.get(mainId) ?? 0) + -tx.amountCents);
  }
  return totals;
}

const assignedInPeriod = (allocations: readonly AllocationRow[], periodStart: string): number =>
  allocations.filter((a) => a.deleted === 0 && a.periodStart === periodStart).reduce((sum, a) => sum + a.assignedCents, 0);

/**
 * "Left to allocate" through the viewed period: cumulative income minus
 * cumulative assignments over the given window (oldest → viewed).
 * Unassigned income carries forward by construction (ruling #3).
 */
export function toAllocateCents(
  periods: readonly Period[],
  txs: readonly TransactionRow[],
  accountsById: Map<string, AccountRow>,
  allocations: readonly AllocationRow[],
): number {
  let left = 0;
  for (const period of periods) {
    left += periodIncomeCents(txs, accountsById, period) - assignedInPeriod(allocations, period.start);
  }
  return left;
}

/**
 * A category's envelope balance at the viewed period. Rollover on:
 * cumulative assigned − spent over the window (leftovers and overspends
 * both carry). Rollover off: this period stands alone.
 */
export function availableCents(
  catId: string,
  periods: readonly Period[],
  rollover: boolean,
  txs: readonly TransactionRow[],
  catalog: CatalogLookup,
  allocations: readonly AllocationRow[],
): number {
  const window = rollover ? periods : periods.slice(-1);
  let available = 0;
  for (const period of window) {
    const assigned = allocations
      .filter((a) => a.deleted === 0 && a.periodStart === period.start && a.catId === catId)
      .reduce((sum, a) => sum + a.assignedCents, 0);
    available += assigned - (spentByMainCat(txs, catalog, period).get(catId) ?? 0);
  }
  return available;
}

// ── recurring set-asides ─────────────────────────────────────────────────
// Every recurring cost is inevitable: the allocate screen encourages
// setting money aside for it in its own envelope, keyed by a pseudo
// bucket id so it shares the income pool with the category envelopes.

/** allocation bucket id of a recurring cost's set-aside */
export const recBucketId = (recurringId: string): string => `rec:${recurringId}`;

/** positive expense cents per linked recurring cost inside a period */
export function spentByRecurring(
  txs: readonly (TransactionRow & { recurringId?: string })[],
  period: Period,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const tx of txs) {
    if (tx.deleted !== 0 || tx.txType !== 'expense' || !tx.recurringId) continue;
    if (tx.date < period.start || tx.date > period.end) continue;
    totals.set(tx.recurringId, (totals.get(tx.recurringId) ?? 0) + -tx.amountCents);
  }
  return totals;
}

/**
 * Per-period set-aside suggestion: the recurring's cost translated to
 * the space's period cadence — a yearly bill on monthly periods
 * suggests 1/12, so the inevitable cost is saved gradually.
 */
export function recurringPeriodShare(
  rec: { amountCents: number; every: 'week' | 'month' | 'year'; everyN?: number },
  periodType: 'week' | 'month',
): number {
  const n = rec.everyN && rec.everyN > 0 ? rec.everyN : 1;
  const perYear = { week: 52 / n, month: 12 / n, year: 1 / n }[rec.every];
  const periodsPerYear = periodType === 'week' ? 52 : 12;
  return Math.round((rec.amountCents * perYear) / periodsPerYear);
}

/** a recurring set-aside's envelope balance (mirrors availableCents) */
export function availableRecCents(
  recurringId: string,
  periods: readonly Period[],
  rollover: boolean,
  txs: readonly (TransactionRow & { recurringId?: string })[],
  allocations: readonly AllocationRow[],
): number {
  const bucket = recBucketId(recurringId);
  const window = rollover ? periods : periods.slice(-1);
  let available = 0;
  for (const period of window) {
    const assigned = allocations
      .filter((a) => a.deleted === 0 && a.periodStart === period.start && a.catId === bucket)
      .reduce((sum, a) => sum + a.assignedCents, 0);
    available += assigned - (spentByRecurring(txs, period).get(recurringId) ?? 0);
  }
  return available;
}

/**
 * Age of Money: how many days the money spent had been sitting in the
 * wallet — FIFO over income, averaged across the most recent expenses.
 * The YNAB-style honesty metric: higher is calmer.
 */
export function ageOfMoneyDays(txs: readonly TransactionRow[], sampleSize = 10): number | null {
  const incomes = txs
    .filter((tx) => tx.deleted === 0 && tx.txType === 'income' && tx.amountCents > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((tx) => ({ date: tx.date, left: tx.amountCents }));
  const expenses = txs
    .filter((tx) => tx.deleted === 0 && tx.txType === 'expense' && tx.amountCents < 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (incomes.length === 0 || expenses.length === 0) return null;

  const ages: number[] = [];
  let head = 0;
  for (const expense of expenses) {
    let remaining = -expense.amountCents;
    const tranche = incomes[Math.min(head, incomes.length - 1)];
    ages.push(Math.max(0, Math.round((Date.parse(expense.date) - Date.parse(tranche.date)) / 86_400_000)));
    while (remaining > 0 && head < incomes.length) {
      const source = incomes[head];
      const used = Math.min(source.left, remaining);
      source.left -= used;
      remaining -= used;
      if (source.left === 0) head++;
    }
  }
  const sample = ages.slice(-sampleSize);
  return Math.round(sample.reduce((sum, age) => sum + age, 0) / sample.length);
}

/**
 * "Assign the rest evenly": integer split of the leftover across the
 * given categories, remainder cents going to the first ones. Returns
 * per-category increments; empty when there is nothing positive left.
 */
export function spreadEvenly(remainingCents: number, catIds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (remainingCents <= 0 || catIds.length === 0) return out;
  const base = Math.floor(remainingCents / catIds.length);
  let leftover = remainingCents - base * catIds.length;
  for (const catId of catIds) {
    const extra = leftover > 0 ? 1 : 0;
    leftover -= extra;
    out.set(catId, base + extra);
  }
  return out;
}
