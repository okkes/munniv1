import type { AccountRow, TransactionRow } from '@/db/types';
import { REIMBURSEMENT_MAIN_ID, mainCatOf } from './categories';
import { inPeriod } from './periods';
import { txSliceViews } from './txSlices';
import type { TxSliceView } from './txSlices';
import { accountStamp } from './txType';
import type { Period } from './periods';

/**
 * Period overview: how much was earned / spent / saved / invested.
 *
 * Typed-splits v2 (user Q6, 2026-08-05): the family buckets — saved,
 * debt, invested, funded — are computed from the SPECIAL CATEGORIES,
 * wherever they live. A set-aside on the savings account's own ledger
 * (+400, R1-stamped) and a bare set-aside on checking (−400, R3) both
 * mean "+400 saved"; the sub carries the direction, so the measure is
 * |amount| signed by the sub's meaning. A properly linked pair can
 * never double-count by construction: its regular-side leg wears the
 * locked Transfer category, which belongs to no bucket. Income and
 * expense stay type-driven, minus the funding family (those rows are
 * standard-typed since the funding type retired, but the pot is not
 * income or spending).
 */

export type OverviewKind = 'income' | 'expense' | 'saving' | 'investment' | 'funding' | 'debt';

export const OVERVIEW_KINDS: OverviewKind[] = ['income', 'expense', 'saving', 'investment', 'funding', 'debt'];

const FAMILY_MAIN: Partial<Record<OverviewKind, string>> = {
  saving: 'saving',
  investment: 'investment',
  funding: 'funding',
  debt: 'debt',
};

/** +1 = money entered the family's story (set aside, repaid, funded…),
 *  −1 = it left; the SUB carries the direction, whichever leg it's on */
const SPECIAL_CONTRIB: Record<string, 1 | -1> = {
  savingDeposit: 1,
  savingWithdraw: -1,
  savingInterest: 1,
  savingFees: -1,
  loanRepayment: 1,
  debtBorrowed: -1,
  debtInterest: -1,
  debtFees: -1,
  investContribution: 1,
  investWithdraw: -1,
  investDividend: 1,
  investFees: -1,
  fundingOut: 1, // -500 into the family pot = +500 funded (user rule)
  fundingIn: -1,
};

/** does one PART belong to this bucket? (typed-splits v2: a split row
 *  answers per part — the container itself has no bucket) */
function viewInKind(kind: OverviewKind, view: TxSliceView): boolean {
  const familyMain = FAMILY_MAIN[kind];
  if (familyMain) return mainCatOf(view.catId) === familyMain;
  // income/expense: type-driven, minus the funding family (standard-
  // typed since the type retired, but the pot is not income/spending)
  return view.effType === kind && mainCatOf(view.catId) !== 'funding';
}

/** one part's signed contribution to a bucket */
function viewContribution(kind: OverviewKind, view: TxSliceView, tx: TransactionRow, accountsById?: Map<string, AccountRow>): number {
  switch (kind) {
    case 'income':
      return view.amountCents; // income parts are positive by construction
    case 'expense':
      return -view.amountCents; // spent is a positive number; refunds reduce it
    default: {
      const sign = SPECIAL_CONTRIB[view.catId ?? ''];
      if (sign !== undefined) return sign * Math.abs(view.amountCents);
      // invest Buy/Sell/General on the brokerage's OWN ledger move cash
      // within the account — no new money invested, no bucket movement
      if (kind === 'investment' && accountStamp(accountsById?.get(tx.accountId)?.type)) return 0;
      return -view.amountCents; // legacy family rows: the checking-side flip
    }
  }
}

/** signed contribution of one transaction to a bucket (cents) —
 *  summed over its matching parts. An UNSPLIT row keeps the classic
 *  contract (membership is the caller's txsForKind filter); only a
 *  split row's parts answer per kind themselves. */
export function contributionCents(kind: OverviewKind, tx: TransactionRow, accountsById?: Map<string, AccountRow>): number {
  return txSliceViews(tx)
    .filter((view) => !view.fromParts || viewInKind(kind, view))
    .reduce((sum, view) => sum + viewContribution(kind, view, tx, accountsById), 0);
}

export function txsForKind(
  kind: OverviewKind,
  txs: TransactionRow[],
  _accountsById: Map<string, AccountRow>,
  period: Period,
): TransactionRow[] {
  return txs.filter(
    (tx) => tx.deleted === 0 && inPeriod(tx.date, period) && txSliceViews(tx).some((view) => viewInKind(kind, view)),
  );
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
    txsForKind(kind, txs, accountsById, period).reduce((sum, tx) => sum + contributionCents(kind, tx, accountsById), 0);
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
  accountsById?: Map<string, AccountRow>,
): number {
  let cents = 0;
  for (const view of txSliceViews(tx)) {
    const cat = catalog.byId(view.catId);
    // settled/expected/received value is not spending (redesign rule c)
    if ((cat.parentId ?? cat.id) === REIMBURSEMENT_MAIN_ID) continue;
    if (cat.id !== catId && cat.parentId !== catId) continue;
    // typed parts answer to their OWN kind (a loan part never lands in
    // the expense breakdown); whole rows — category spreads included
    // (#211) — keep the kind's signed math
    if (view.fromParts && !viewInKind(kind, view)) continue;
    cents += view.fromParts ? Math.abs(view.amountCents) : viewContribution(kind, view, tx, accountsById);
  }
  return cents;
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
    (tx) => categoryContributionCents(kind, tx, catId, catalog, accountsById) !== 0,
  );
  matches.sort((a, b) => b.date.localeCompare(a.date));
  return {
    txs: matches,
    totalCents: matches.reduce((sum, tx) => sum + categoryContributionCents(kind, tx, catId, catalog, accountsById), 0),
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
    for (const view of txSliceViews(tx)) {
      if (view.fromParts && !viewInKind(kind, view)) continue; // parts answer per kind (v2)
      add(view.catId, view.fromParts ? Math.abs(view.amountCents) : viewContribution(kind, view, tx, accountsById));
    }
  }
  return [...groups.values()]
    .map(({ subMap, ...group }) => ({ ...group, subs: [...subMap.values()].sort((a, b) => b.totalCents - a.totalCents) }))
    .sort((a, b) => b.totalCents - a.totalCents);
}
