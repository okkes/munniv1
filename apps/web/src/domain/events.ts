import type { TransactionRow } from '@/db/types';

/** Event math (approved events design) — all pure. */

/** positive cents spent inside the event (expenses; refunds reduce) */
export function eventSpentCents(txs: readonly TransactionRow[], eventId: string): number {
  let total = 0;
  for (const tx of txs) {
    if (tx.deleted !== 0 || tx.eventId !== eventId || tx.txType !== 'expense') continue;
    total += -tx.amountCents;
  }
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
    if (tx.deleted !== 0 || tx.eventId !== eventId || tx.txType !== 'expense') continue;
    const cat = catalog.byId(tx.catId);
    const mainId = cat.parentId ?? cat.id;
    totals.set(mainId, (totals.get(mainId) ?? 0) + -tx.amountCents);
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
    if (tx.deleted !== 0 || tx.eventId !== eventId || tx.txType !== 'expense') continue;
    const cat = catalog.byId(tx.catId);
    if ((cat.parentId ?? cat.id) !== mainCatId) continue;
    totals.set(cat.id, (totals.get(cat.id) ?? 0) + -tx.amountCents);
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
