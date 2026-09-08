import type { BudgetRow, TransactionRow } from '@/db/types';
import { txSliceViews } from './txSlices';
import type { Period } from './periods';

/**
 * Budget math, all pure (budgets design doc, approved 2026-07-09):
 * spending counts a budget's category family's expenses inside the
 * budget's own anchored period; carry-over is REPLAYED from history —
 * never stored — so every device computes the same numbers.
 */

const DAY_MS = 86_400_000;
// replay guard: weekly budgets anchored years back stay bounded
const MAX_REPLAY_PERIODS = 260;

const localIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const shiftDays = (d: Date, days: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/** clamp an anchor day into a target month (31st → Feb 28) */
const monthStart = (anchor: Date, monthOffset: number): Date => {
  const first = new Date(anchor.getFullYear(), anchor.getMonth() + monthOffset, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(anchor.getDate(), lastDay));
};

/** how many whole cycles lie between the anchor and `today` */
export function cycleIndex(budget: BudgetRow, today: string): number {
  const anchor = parse(budget.anchor);
  const now = parse(today);
  if (now < anchor) return 0;
  if (budget.every === 'month') {
    const months = (now.getFullYear() - anchor.getFullYear()) * 12 + (now.getMonth() - anchor.getMonth());
    // not yet reached this month's anchor day → still the previous cycle
    return now < monthStart(anchor, months) ? months - 1 : months;
  }
  const len = budget.every === 'week' ? 7 : 14;
  const days = Math.round((now.getTime() - anchor.getTime()) / DAY_MS);
  return Math.floor(days / len);
}

/** the budget's period at cycle `index` (0 = the anchor's own period) */
export function budgetPeriodAt(budget: BudgetRow, index: number): Period {
  const anchor = parse(budget.anchor);
  if (budget.every === 'month') {
    const start = monthStart(anchor, index);
    return { start: localIso(start), end: localIso(shiftDays(monthStart(anchor, index + 1), -1)) };
  }
  const len = budget.every === 'week' ? 7 : 14;
  const start = shiftDays(anchor, index * len);
  return { start: localIso(start), end: localIso(shiftDays(start, len - 1)) };
}

/** the period containing `today` (or the anchor period before it starts) */
export const currentBudgetPeriod = (budget: BudgetRow, today: string): Period =>
  budgetPeriodAt(budget, cycleIndex(budget, today));

/** whole days until the cycle resets, today included (list/home/detail) */
export const budgetDaysLeft = (budget: BudgetRow, today: string): number =>
  Math.max(0, Math.round((Date.parse(currentBudgetPeriod(budget, today).end) - Date.parse(today)) / 86_400_000)) + 1;

interface CatalogLookup {
  byId: (id: string | undefined) => { id: string; parentId?: string };
  childrenOf: (id: string) => { id: string }[];
}

/** the ids a budget's categories claim: each main claims all its subs */
export function budgetFamily(catIds: readonly string[], catalog: CatalogLookup): Set<string> {
  return new Set(catIds.flatMap((id) => [id, ...catalog.childrenOf(id).map((c) => c.id)]));
}

/** positive cents spent by the family inside a period (refunds reduce it).
 *  Slice-aware (reimbursement redesign; typed-splits v2): a split
 *  transaction contributes only its family slices, so reimbursed value
 *  never counts as spending — and a typed part answers to its OWN kind
 *  (a loan part inside the phone bill never eats the telecom budget). */
export function budgetSpentCents(
  txs: readonly TransactionRow[],
  family: ReadonlySet<string>,
  period: Period,
): number {
  let total = 0;
  for (const tx of txs) {
    if (tx.deleted !== 0) continue;
    if (tx.date < period.start || tx.date > period.end) continue;
    for (const view of txSliceViews(tx)) {
      if (view.effType !== 'expense' || !family.has(view.catId ?? '')) continue;
      // whole-row views (a category spread included, #211) contribute
      // SIGNED — refunds keep reducing spend; parts are magnitudes
      total += view.fromParts ? Math.abs(view.amountCents) : -view.amountCents;
    }
  }
  return total;
}

/**
 * Unused money rolled into the current period. Replayed from history:
 * mode 'periods' looks back at most N cycles; mode 'cap' replays the
 * whole (bounded) history but never accumulates beyond the cap.
 */
export function carriedCents(
  budget: BudgetRow,
  txs: readonly TransactionRow[],
  family: ReadonlySet<string>,
  today: string,
): number {
  if (budget.carryOver !== 1) return 0;
  const current = cycleIndex(budget, today);
  if (current <= 0) return 0;

  const window =
    budget.carryMode === 'periods'
      ? Math.min(current, Math.max(1, budget.carryPeriods ?? 1))
      : Math.min(current, MAX_REPLAY_PERIODS);
  const cap = budget.carryMode === 'cap' ? Math.max(0, budget.carryCapCents ?? 0) : Number.POSITIVE_INFINITY;

  let carried = 0;
  for (let index = current - window; index < current; index++) {
    const spent = budgetSpentCents(txs, family, budgetPeriodAt(budget, index));
    const leftover = budget.amountCents + carried - spent;
    carried = Math.min(Math.max(leftover, 0), cap);
  }
  return carried;
}

export interface BudgetStatus {
  budget: BudgetRow;
  period: Period;
  spentCents: number;
  carriedCents: number;
  /** amount + carried */
  limitCents: number;
  /** limit − spent (negative = over) */
  leftCents: number;
  /** spent / limit; 0 when the limit is 0 */
  ratio: number;
}

export function budgetStatus(
  budget: BudgetRow,
  txs: readonly TransactionRow[],
  catalog: CatalogLookup,
  today: string,
): BudgetStatus {
  const family = budgetFamily(budget.catIds, catalog);
  const period = currentBudgetPeriod(budget, today);
  const carried = carriedCents(budget, txs, family, today);
  const spent = budgetSpentCents(txs, family, period);
  const limit = budget.amountCents + carried;
  return {
    budget,
    period,
    spentCents: spent,
    carriedCents: carried,
    limitCents: limit,
    leftCents: limit - spent,
    ratio: limit > 0 ? spent / limit : 0,
  };
}

/** over-budget first (worst ratio), then closest to the limit */
export const sortByUrgency = (statuses: readonly BudgetStatus[]): BudgetStatus[] =>
  [...statuses].sort((a, b) => b.ratio - a.ratio);

/**
 * Category exclusivity (per space): a category may live in one budget.
 * Returns, for each candidate id, the name of the budget already
 * claiming it (directly or via the main↔sub family) — the picker
 * disables those with a badge naming the owner.
 */
export function categoryConflicts(
  candidates: readonly string[],
  otherBudgets: readonly BudgetRow[],
  catalog: CatalogLookup,
): Map<string, string> {
  const conflicts = new Map<string, string>();
  const families = otherBudgets.map((b) => ({ name: b.name, family: budgetFamily(b.catIds, catalog) }));
  for (const id of candidates) {
    const own = budgetFamily([id], catalog);
    const owner = families.find((f) => [...own].some((member) => f.family.has(member)));
    if (owner) conflicts.set(id, owner.name);
  }
  return conflicts;
}
