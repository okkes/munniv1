import type { TransactionRow, TxType } from '@/db/types';
import { cleanBankText } from '@/lib/text';
import { txSliceViews } from './txSlices';

export interface TxFilter {
  /** matches merchant and bank description, case/whitespace-insensitive */
  query?: string;
  /** empty/undefined set = all accounts */
  accountIds?: ReadonlySet<string>;
  onlyNeedsReview?: boolean;
  /** only rows still sitting on the hidden Uncategorized builtin */
  onlyUncategorized?: boolean;
  /** category ids to match — a main category passes itself plus its subs */
  catIds?: ReadonlySet<string>;
  txTypes?: ReadonlySet<TxType>;
  /** inclusive yyyy-mm-dd bounds (overview drill-down scopes to a period) */
  from?: string;
  to?: string;
}

/** text hit on merchant/description — part labels included (typed-splits
 *  v2: "Sarah's loan" finds the payment it names) — or, for numeric
 *  queries ('10', '10,99'), a digit-substring hit on the amount: '10'
 *  finds 10,99 and 210,15 alike (user request) */
function matchesQuery(tx: TransactionRow, q: string, amountQ: string | null, signQ: -1 | 0 | 1): boolean {
  const labels = (tx.splits ?? []).map((s) => s.label ?? '').join(' ');
  const haystack = `${tx.titleOverride ?? ''} ${cleanBankText(tx.merchant)} ${cleanBankText(tx.description)} ${labels}`.toLowerCase();
  if (haystack.includes(q)) return true;
  if (!amountQ || !String(Math.abs(tx.amountCents)).includes(amountQ)) return false;
  // #267 r2 (user): a leading +/- constrains the money's direction —
  // "+13,91" finds only the incoming 13,91s
  return signQ === 0 || Math.sign(tx.amountCents) === signQ;
}

/** a row answers a category/type filter through its PARTS (typed-splits
 *  v2): the phone bill with a loan part shows under Debt payment too */
const anySlice = (tx: TransactionRow, hit: (view: ReturnType<typeof txSliceViews>[number]) => boolean): boolean =>
  txSliceViews(tx).some(hit);

/** transfers carry no category by design — they never count as
 *  uncategorized. Slice-aware (#126 r8): an unfinished PART keeps its
 *  split findable under the quick filter. */
const isUncategorized = (tx: TransactionRow): boolean =>
  anySlice(tx, (v) => (v.catId === 'uncategorized' || v.catId == null) && v.effType !== 'transfer');

/** #267 r2: the direction a leading +/- constrains (0 = both) */
function querySign(q: string | undefined): -1 | 0 | 1 {
  if (q?.startsWith('+')) return 1;
  if (q?.startsWith('-')) return -1;
  return 0;
}

export function filterTxs(txs: TransactionRow[], filter: TxFilter): TransactionRow[] {
  const q = filter.query?.trim().toLowerCase();
  const signQ = querySign(q);
  const digits = q?.replaceAll(/[\s.,€+-]/g, '') ?? '';
  const amountQ = /^\d+$/.test(digits) ? digits : null;
  return txs.filter((tx) => {
    if (filter.accountIds?.size && !filter.accountIds.has(tx.accountId)) return false;
    if (filter.onlyNeedsReview && tx.needsReview !== 1) return false;
    if (filter.onlyUncategorized && !isUncategorized(tx)) return false;
    if (filter.catIds?.size && !anySlice(tx, (v) => filter.catIds!.has(v.catId ?? ''))) return false;
    if (filter.txTypes?.size && !anySlice(tx, (v) => filter.txTypes!.has(v.effType))) return false;
    if (filter.from && tx.date < filter.from) return false;
    if (filter.to && tx.date > filter.to) return false;
    return !q || matchesQuery(tx, q, amountQ, signQ);
  });
}

export const hasActiveFilter = (f: TxFilter): boolean =>
  Boolean(
    f.query?.trim() || f.accountIds?.size || f.onlyNeedsReview || f.catIds?.size || f.txTypes?.size || f.from || f.to,
  );

/**
 * #126 r8 (user request): a filtered list shows only the parts a filter
 * actually matches — the split's OTHER pieces stay out of view. Returns
 * the matching part indexes for the part-partitioning filters (category,
 * type, uncategorized); every part matches when none of those are on.
 * Query/date/account filters keep whole-row semantics — a merchant hit
 * belongs to every part.
 */
export function matchingPartIndexes(
  tx: Pick<TransactionRow, 'splits' | 'txType' | 'catId'>,
  filter: Pick<TxFilter, 'catIds' | 'txTypes' | 'onlyUncategorized'>,
): number[] {
  const parts = (tx.splits ?? []).filter((s) => s.catId !== 'reimbursed');
  const partitioning = Boolean(filter.catIds?.size || filter.txTypes?.size || filter.onlyUncategorized);
  const all = parts.map((_, i) => i);
  if (!partitioning) return all;
  return all.filter((i) => {
    const part = parts[i];
    const partCatIds = part.cats?.length ? part.cats.map((c) => c.catId) : [part.catId];
    if (filter.catIds?.size && !partCatIds.some((catId) => filter.catIds!.has(catId))) return false;
    if (filter.txTypes?.size && !filter.txTypes.has(part.txType ?? tx.txType)) return false;
    return !filter.onlyUncategorized || partCatIds.includes('uncategorized');
  });
}
