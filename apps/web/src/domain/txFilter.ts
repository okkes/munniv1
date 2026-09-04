import type { TransactionRow, TxType } from '@/db/types';
import { cleanBankText } from '@/lib/text';

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

/** text hit on merchant/description, or — for numeric queries ('10',
 *  '10,99') — a digit-substring hit on the amount: '10' finds 10,99 and
 *  210,15 alike (user request) */
function matchesQuery(tx: TransactionRow, q: string, amountQ: string | null): boolean {
  const haystack = `${tx.titleOverride ?? ''} ${cleanBankText(tx.merchant)} ${cleanBankText(tx.description)}`.toLowerCase();
  if (haystack.includes(q)) return true;
  return !!amountQ && String(Math.abs(tx.amountCents)).includes(amountQ);
}

/** transfers carry no category by design — they never count as uncategorized */
const isUncategorized = (tx: TransactionRow): boolean =>
  (tx.catId === 'uncategorized' || tx.catId == null) && tx.txType !== 'transfer';

export function filterTxs(txs: TransactionRow[], filter: TxFilter): TransactionRow[] {
  const q = filter.query?.trim().toLowerCase();
  const digits = q?.replaceAll(/[\s.,€-]/g, '') ?? '';
  const amountQ = /^\d+$/.test(digits) ? digits : null;
  return txs.filter((tx) => {
    if (filter.accountIds?.size && !filter.accountIds.has(tx.accountId)) return false;
    if (filter.onlyNeedsReview && tx.needsReview !== 1) return false;
    if (filter.onlyUncategorized && !isUncategorized(tx)) return false;
    if (filter.catIds?.size && !filter.catIds.has(tx.catId ?? '')) return false;
    if (filter.txTypes?.size && !filter.txTypes.has(tx.txType)) return false;
    if (filter.from && tx.date < filter.from) return false;
    if (filter.to && tx.date > filter.to) return false;
    return !q || matchesQuery(tx, q, amountQ);
  });
}

export const hasActiveFilter = (f: TxFilter): boolean =>
  Boolean(
    f.query?.trim() || f.accountIds?.size || f.onlyNeedsReview || f.catIds?.size || f.txTypes?.size || f.from || f.to,
  );
