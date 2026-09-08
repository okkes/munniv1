import type { TransactionRow } from '@/db/types';
import { txSliceViews } from './txSlices';
import type { TxSliceView } from './txSlices';

/** Event math (approved events design; typed-splits v2: per-part events
 *  — "this €30 of the dinner is the trip") — all pure. */

/** the row's parts that belong to this event as EXPENSES */
function eventViews(tx: TransactionRow, eventId: string): TxSliceView[] {
  if (tx.deleted !== 0) return [];
  return txSliceViews(tx).filter((view) => view.eventId === eventId && view.effType === 'expense');
}

const viewSpent = (view: TxSliceView): number => (view.fromParts ? Math.abs(view.amountCents) : -view.amountCents);

/** positive cents spent inside the event (expenses; refunds reduce) */
export function eventSpentCents(txs: readonly TransactionRow[], eventId: string): number {
  let total = 0;
  for (const tx of txs) for (const view of eventViews(tx, eventId)) total += viewSpent(view);
  return total;
}

interface CatalogLookup {
  byId: (id: string | undefined) => { id: string; parentId?: string };
}

/** main-category totals of the event's expenses, largest first */
export function eventCategoryBreakdown(
  txs: readonly TransactionRow[],
  eventId: string,
  catalog: CatalogLookup,
): { catId: string; totalCents: number }[] {
  const totals = new Map<string, number>();
  for (const tx of txs) {
    for (const view of eventViews(tx, eventId)) {
      const cat = catalog.byId(view.catId);
      const mainId = cat.parentId ?? cat.id;
      totals.set(mainId, (totals.get(mainId) ?? 0) + viewSpent(view));
    }
  }
  return [...totals.entries()]
    .map(([catId, totalCents]) => ({ catId, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

/** sub-category totals inside one of the event's main categories, largest first */
export function eventSubcategoryBreakdown(
  txs: readonly TransactionRow[],
  eventId: string,
  catalog: CatalogLookup,
  mainCatId: string,
): { catId: string; totalCents: number }[] {
  const totals = new Map<string, number>();
  for (const tx of txs) {
    for (const view of eventViews(tx, eventId)) {
      const cat = catalog.byId(view.catId);
      if ((cat.parentId ?? cat.id) !== mainCatId) continue;
      totals.set(cat.id, (totals.get(cat.id) ?? 0) + viewSpent(view));
    }
  }
  return [...totals.entries()]
    .map(([catId, totalCents]) => ({ catId, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

/** dated events: average spend per day of the (inclusive) range */
export function eventPerDayCents(totalCents: number, from?: string, to?: string): number | null {
  if (!from || !to || to < from) return null;
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  return Math.round(totalCents / days);
}

/** the transactions inside an event's date range not yet attached to it */
export function suggestableTxs(txs: readonly TransactionRow[], eventId: string, from?: string, to?: string): TransactionRow[] {
  if (!from || !to) return [];
  return txs.filter(
    (tx) => tx.deleted === 0 && !tx.eventId && tx.txType === 'expense' && tx.date >= from && tx.date <= to && tx.eventId !== eventId,
  );
}
