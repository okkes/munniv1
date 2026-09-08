import type { CatDirection, TransactionRow, TxType } from '@/db/types';
import { UNCATEGORIZED_ID } from './categories';

/**
 * Category–transaction compatibility rules.
 *
 * A transaction's sign is bank truth: negative = debit, positive =
 * credit. A category assignment is valid when the category's type
 * matches the transaction's type AND the category's direction allows
 * the transaction's side. Editing a category (type change, direction
 * change, moving a sub to a parent of another type, deletion) can break
 * existing assignments — those transactions are warned about first,
 * then reset to Uncategorized and flagged for review.
 */

export const directionOfTx = (tx: Pick<TransactionRow, 'amountCents'>): 'debit' | 'credit' =>
  tx.amountCents < 0 ? 'debit' : 'credit';

export const directionAllows = (direction: CatDirection | undefined, side: 'debit' | 'credit'): boolean =>
  !direction || direction === 'both' || direction === side;

/** ids of a parent and every sub underneath it */
export function subtreeIds(parentId: string, cats: { id: string; parentId?: string }[]): Set<string> {
  const ids = new Set<string>([parentId]);
  for (const cat of cats) if (cat.parentId === parentId) ids.add(cat.id);
  return ids;
}

const usesCat = (tx: TransactionRow, catIds: Set<string>): boolean =>
  (tx.catId !== undefined && catIds.has(tx.catId)) || (tx.splits ?? []).some((s) => catIds.has(s.catId));

/** transactions that would conflict if the category subtree changed to `newType` */
export function affectedByTypeChange(txs: TransactionRow[], catIds: Set<string>, newType: TxType): TransactionRow[] {
  return txs.filter((tx) => tx.deleted === 0 && usesCat(tx, catIds) && tx.txType !== newType);
}

/** transactions on the wrong side if the sub's direction changed to `newDirection` */
export function affectedByDirectionChange(
  txs: TransactionRow[],
  catId: string,
  newDirection: CatDirection,
): TransactionRow[] {
  const ids = new Set([catId]);
  return txs.filter((tx) => tx.deleted === 0 && usesCat(tx, ids) && !directionAllows(newDirection, directionOfTx(tx)));
}

/** every transaction still using a category that is about to be deleted */
export function affectedByDelete(txs: TransactionRow[], catIds: Set<string>): TransactionRow[] {
  return txs.filter((tx) => tx.deleted === 0 && usesCat(tx, catIds));
}

/**
 * Field patch that detaches a transaction from a broken category:
 * back to Uncategorized, flagged for review. Splits drop the broken
 * rows' category but keep the amounts (also uncategorized).
 */
export function detachCategoryPatch(tx: TransactionRow, catIds: Set<string>): Partial<TransactionRow> {
  const patch: Partial<TransactionRow> = { needsReview: 1 };
  if (tx.catId !== undefined && catIds.has(tx.catId)) patch.catId = UNCATEGORIZED_ID;
  if ((tx.splits ?? []).some((s) => catIds.has(s.catId))) {
    patch.splits = tx.splits!.map((s) => (catIds.has(s.catId) ? { ...s, catId: UNCATEGORIZED_ID } : s));
  }
  return patch;
}
