import type { AccountRow, TransactionRow, TxType } from '@/db/types';
import { REIMBURSEMENT_MAIN_ID } from './categories';
import { inPeriod } from './periods';
import type { Period } from './periods';

/**
 * Period overview: how much was earned / spent / saved / invested,
 * summed by transaction type over the space's period.
 *
 * Sign mechanics (from the account-holder's perspective, i.e. the
 * checking side): a saving-type transaction of -400 on your checking
 * account means +400 saved; +400 arriving back from savings means
 * -400 saved in that period. The same reversal applies to investments.
 * To avoid double counting when BOTH sides of a transfer live in the
 * space (checking and the savings account itself), the mirror rows on
 * savings/brokerage accounts are excluded from those buckets.
 */

export type OverviewKind = 'income' | 'expense' | 'saving' | 'investment' | 'funding' | 'debt';

export const OVERVIEW_KINDS: OverviewKind[] = ['income', 'expense', 'saving', 'investment', 'funding', 'debt'];

const MIRROR_ACCOUNT_TYPES: Record<OverviewKind, string[]> = {
  income: [],
  expense: [],
  saving: ['savings'],
  investment: ['brokerage'],
  funding: [], // the other side lives in ANOTHER space's books — no in-space mirror
  debt: ['loan', 'mortgage'],
};

/** signed contribution of one transaction to a bucket (cents) */
export function contributionCents(kind: OverviewKind, tx: TransactionRow): number {
  switch (kind) {
    case 'income':
      return tx.amountCents; // income txs are positive by construction
    case 'expense':
      return -tx.amountCents; // spent is a positive number; refunds reduce it
    case 'saving':
    case 'investment':
      return -tx.amountCents; // -400 out of checking = +400 put aside
    case 'funding':
      // -500 into the family pot = +500 funded (green); taking money
      // back OUT of a pot turns the period negative (user rule)
      return -tx.amountCents;
    case 'debt':
      return -tx.amountCents; // -300 to the loan = +300 repaid; borrowing flips it
  }
}

const KIND_TX_TYPE: Record<OverviewKind, TxType> = {
  income: 'income',
  expense: 'expense',
  saving: 'saving',
  investment: 'investment',
  funding: 'funding',
  debt: 'debtPayment',
};

export function txsForKind(
  kind: OverviewKind,
  txs: TransactionRow[],
  accountsById: Map<string, AccountRow>,
  period: Period,
): TransactionRow[] {
  const excludedAccountTypes = MIRROR_ACCOUNT_TYPES[kind];
  return txs.filter((tx) => {
    if (tx.deleted !== 0 || tx.txType !== KIND_TX_TYPE[kind] || !inPeriod(tx.date, period)) return false;
    const accountType = accountsById.get(tx.accountId)?.type;
    return !accountType || !excludedAccountTypes.includes(accountType);
  });
}

export interface OverviewSummary {
  incomeCents: number;
  expenseCents: number;
  savingCents: number;
  investmentCents: number;
  fundingCents: number;
  debtCents: number;
}

export function overviewSummary(
  txs: TransactionRow[],
  accountsById: Map<string, AccountRow>,
  period: Period,
): OverviewSummary {
  const total = (kind: OverviewKind) =>
    txsForKind(kind, txs, accountsById, period).reduce((sum, tx) => sum + contributionCents(kind, tx), 0);
  return {
    incomeCents: total('income'),
    expenseCents: total('expense'),
    savingCents: total('saving'),
    investmentCents: total('investment'),
    fundingCents: total('funding'),
    debtCents: total('debt'),
  };
}

// ── category breakdown (main category → sub categories) ────────────────

export interface CatBreakdownSub {
  catId: string;
  totalCents: number;
  count: number;
}

export interface CatBreakdownGroup {
  /** main category id (or the sub's own id when it has no parent) */
  catId: string;
  totalCents: number;
  subs: CatBreakdownSub[];
}

interface CatalogLookup {
  byId: (id: string | undefined) => { id: string; parentId?: string };
}

/** one category's transactions in a period (a main matches its whole
 *  family, a sub only itself — same attribution as categoryBreakdown),
 *  newest first, with the signed total */
/**
 * What one transaction puts into ONE category (positive cents): split
 * transactions partition across their slices — several slices under the
 * same parent sum up instead of double-counting the whole amount.
 */
export function categoryContributionCents(
  kind: OverviewKind,
  tx: TransactionRow,
  catId: string,
  catalog: CatalogLookup,
): number {
  if (tx.splits?.length) {
    let cents = 0;
    for (const slice of tx.splits) {
      const cat = catalog.byId(slice.catId);
      // settled/expected/received value is not spending (redesign rule c)
      if ((cat.parentId ?? cat.id) === REIMBURSEMENT_MAIN_ID) continue;
      if (cat.id === catId || cat.parentId === catId) cents += slice.amountCents;
    }
    return cents;
  }
  const cat = catalog.byId(tx.catId);
  if ((cat.parentId ?? cat.id) === REIMBURSEMENT_MAIN_ID) return 0;
  return cat.id === catId || cat.parentId === catId ? contributionCents(kind, tx) : 0;
}

export function txsForCategory(
  kind: OverviewKind,
  txs: TransactionRow[],
  accountsById: Map<string, AccountRow>,
  period: Period,
  catId: string,
  catalog: CatalogLookup,
): { txs: TransactionRow[]; totalCents: number } {
  // split transactions belong to every category their slices touch
  const matches = txsForKind(kind, txs, accountsById, period).filter(
    (tx) => categoryContributionCents(kind, tx, catId, catalog) !== 0,
  );
  matches.sort((a, b) => b.date.localeCompare(a.date));
  return {
    txs: matches,
    totalCents: matches.reduce((sum, tx) => sum + categoryContributionCents(kind, tx, catId, catalog), 0),
  };
}

/** groups a kind's transactions by main category, sorted by size —
 *  split transactions land per slice, not on their primary category */
export function categoryBreakdown(
  kind: OverviewKind,
  txs: TransactionRow[],
  accountsById: Map<string, AccountRow>,
  period: Period,
  catalog: CatalogLookup,
): CatBreakdownGroup[] {
  const groups = new Map<string, CatBreakdownGroup & { subMap: Map<string, CatBreakdownSub> }>();
  const add = (catId: string | undefined, cents: number) => {
    const cat = catalog.byId(catId);
    const mainId = cat.parentId ?? cat.id;
    // the reimbursement tree never shows in the breakdown (redesign rule c)
    if (mainId === REIMBURSEMENT_MAIN_ID) return;
    let group = groups.get(mainId);
    if (!group) {
      group = { catId: mainId, totalCents: 0, subs: [], subMap: new Map() };
      groups.set(mainId, group);
    }
    group.totalCents += cents;
    let sub = group.subMap.get(cat.id);
    if (!sub) {
      sub = { catId: cat.id, totalCents: 0, count: 0 };
      group.subMap.set(cat.id, sub);
    }
    sub.totalCents += cents;
    sub.count += 1;
  };
  for (const tx of txsForKind(kind, txs, accountsById, period)) {
    if (tx.splits?.length) {
      for (const slice of tx.splits) add(slice.catId, slice.amountCents);
    } else {
      add(tx.catId, contributionCents(kind, tx));
    }
  }
  return [...groups.values()]
    .map(({ subMap, ...group }) => ({ ...group, subs: [...subMap.values()].sort((a, b) => b.totalCents - a.totalCents) }))
    .sort((a, b) => b.totalCents - a.totalCents);
}
