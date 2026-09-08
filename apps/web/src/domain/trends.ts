import type { AccountRow, TransactionRow } from '@/db/types';
import { netAmountCents } from './reimbursement';
import type { Period } from './periods';

/**
 * Trends & net worth (design T1/T2): pure series builders over local
 * data. Reimbursements count NET (consistent with every list); pending
 * rows are the bank's reservation noise and stay out.
 */

interface CatalogLookup {
  byId: (id: string | undefined) => { id: string; parentId?: string };
  childrenOf: (id: string) => { id: string }[];
}

/** the earlier of two ISO dates (lexicographic — these are strings, not numbers) */
export const minIso = (a: string, b: string): string => (a < b ? a : b); // NOSONAR(S7766)

const countable = (tx: TransactionRow): boolean =>
  tx.deleted === 0 && tx.pending !== 1 && tx.txType === 'expense';

/** the cat ids a selection covers: a main includes its subs, a sub itself */
function coveredIds(catalog: CatalogLookup, catId: string): Set<string> {
  return new Set([catId, ...catalog.childrenOf(catId).map((child) => child.id)]);
}

/**
 * Expense cents per period for one category (main or sub) — or ALL
 * expenses when catId is undefined. Split parts count toward their own
 * category, the remainder toward the parent's.
 */
/** how much of one transaction falls inside the covered categories */
function txContribution(tx: TransactionRow, ids: ReadonlySet<string> | null): number {
  const net = Math.abs(netAmountCents(tx));
  if (!ids) return net;
  if (!tx.splits?.length) return ids.has(tx.catId ?? '') ? net : 0;
  let sum = 0;
  let splitTotal = 0;
  for (const part of tx.splits) {
    splitTotal += Math.abs(part.amountCents);
    if (ids.has(part.catId)) sum += Math.abs(part.amountCents);
  }
  // the unsplit remainder still belongs to the tx's own category
  if (ids.has(tx.catId ?? '')) sum += Math.max(0, net - splitTotal);
  return sum;
}

export function categorySeries(
  txs: readonly TransactionRow[],
  periods: readonly Period[],
  catalog: CatalogLookup,
  catId?: string,
): number[] {
  const ids = catId ? coveredIds(catalog, catId) : null;
  return periods.map((period) => {
    let sum = 0;
    for (const tx of txs) {
      if (countable(tx) && tx.date >= period.start && tx.date <= period.end) sum += txContribution(tx, ids);
    }
    return sum;
  });
}

export interface CashflowPoint {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

/** income vs expense per period (gross income, net expenses) */
export function cashflowSeries(txs: readonly TransactionRow[], periods: readonly Period[]): CashflowPoint[] {
  return periods.map((period) => {
    let income = 0;
    let expense = 0;
    for (const tx of txs) {
      if (tx.deleted !== 0 || tx.pending === 1 || tx.date < period.start || tx.date > period.end) continue;
      if (tx.txType === 'income') income += tx.amountCents;
      else if (tx.txType === 'expense') expense += Math.abs(netAmountCents(tx));
    }
    return { incomeCents: income, expenseCents: expense, netCents: income - expense };
  });
}

export interface NetWorthPoint {
  date: string;
  cents: number;
}

/**
 * Balance history reconstructed, not stored: for every account,
 * balance(t) = balanceNow − Σ amounts of its transactions AFTER t.
 * Accounts without transactions contribute a flat line — honest for
 * savings/brokerage rows that only carry a balance.
 */
export function netWorthSeries(
  accounts: readonly Pick<AccountRow, 'id' | 'balanceCents' | 'archived' | 'deleted'>[],
  txs: readonly TransactionRow[],
  dates: readonly string[],
): NetWorthPoint[] {
  const live = accounts.filter((account) => account.deleted === 0 && account.archived !== 1);
  const nowCents = live.reduce((sum, account) => sum + account.balanceCents, 0);
  const accountIds = new Set(live.map((account) => account.id));
  const movements = txs
    .filter((tx) => tx.deleted === 0 && tx.pending !== 1 && accountIds.has(tx.accountId))
    .map((tx) => ({ date: tx.date, cents: tx.amountCents }));
  return dates.map((date) => {
    const after = movements.reduce((sum, m) => (m.date > date ? sum + m.cents : sum), 0);
    return { date, cents: nowCents - after };
  });
}
