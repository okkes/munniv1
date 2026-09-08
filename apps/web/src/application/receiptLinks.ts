import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { receiptLinkId } from '@/domain/feedIds';
import type { Repo } from '@/db/repo';
import type { StorageBackend } from '@/db/backend';
import type { ReceiptLinkRow, ReceiptRow } from '@/db/types';

/**
 * Receipts v3 (approved redesign, rulings 1+2): the per-space presence
 * of a receipt is a `receiptLink` row carrying a SNAPSHOT of the
 * payload. Linked receipts therefore follow the transactions — they
 * survive the owner leaving the space and the connection instance being
 * removed — because rendering them never needs the owner's store feed.
 */

/** the payload fields a link snapshot carries */
export interface ReceiptSnapshot {
  receiptId?: string;
  source: ReceiptRow['source'];
  instanceId?: string;
  date: string;
  totalCents: number;
  merchant?: string;
  items?: ReceiptRow['items'];
  image?: string;
  payment?: ReceiptRow['payment'];
}

/** the snapshot a link carries, built from a global receipt row */
export function receiptSnapshot(receipt: ReceiptRow): ReceiptSnapshot {
  return {
    receiptId: receipt.id,
    source: receipt.source,
    instanceId: receipt.instanceId,
    date: receipt.date,
    totalCents: receipt.totalCents,
    merchant: receipt.merchant,
    items: receipt.items,
    image: receipt.image,
    payment: receipt.payment,
  };
}

/** link (or re-link) a global receipt into a space, optionally to a tx */
export async function writeReceiptLink(
  repo: Repo,
  spaceId: string,
  receipt: ReceiptRow,
  txId: string | undefined,
  auto: boolean,
): Promise<string> {
  const id = receiptLinkId(spaceId, receipt.id);
  await repo.upsert('receiptLink', spaceId, id, {
    ...receiptSnapshot(receipt),
    txId: txId ?? (null as never), // explicit null clears a stale link
    auto: auto ? 1 : 0,
  });
  return id;
}

/** every receipt visible in a space: v3 snapshot links + legacy rows */
export interface SpaceReceiptView {
  /** the row that renders (legacy rows are adapted into link shape) */
  link: ReceiptLinkRow;
  /** true when this is a pre-v3 `receipt` row (writes go to the old id) */
  legacy: boolean;
}

const legacyAsLink = (row: ReceiptRow): ReceiptLinkRow => ({
  id: row.id,
  spaceId: row.spaceId,
  receiptId: row.storeRef ? row.id : undefined,
  txId: row.txId,
  source: row.source,
  instanceId: row.instanceId,
  date: row.date,
  totalCents: row.totalCents,
  merchant: row.merchant,
  items: row.items,
  image: row.image,
  payment: row.payment,
  fieldVersions: row.fieldVersions,
  deleted: row.deleted,
});

export async function spaceReceipts(store: StorageBackend, spaceId: string): Promise<SpaceReceiptView[]> {
  const [links, legacyRows] = await Promise.all([
    store.bySpace('receiptLink', spaceId),
    store.bySpace('receipt', spaceId),
  ]);
  const views: SpaceReceiptView[] = links
    .filter((l) => l.deleted === 0)
    .map((link) => ({ link, legacy: false }));
  const linkedReceiptIds = new Set(views.map((v) => v.link.receiptId).filter(Boolean));
  for (const row of legacyRows) {
    if (row.deleted !== 0) continue;
    // a migrated row may coexist with its v3 link for a while — link wins
    if (row.storeRef && linkedReceiptIds.has(row.id)) continue;
    views.push({ link: legacyAsLink(row), legacy: true });
  }
  views.sort((a, b) => b.link.date.localeCompare(a.link.date));
  return views;
}

export function useSpaceReceipts(): SpaceReceiptView[] | undefined {
  const { store, spaceId } = useData();
  return useQuery(store, async () => spaceReceipts(store, spaceId), [spaceId]);
}

// ── normalized entries (what the screens render and act on) ──────────────

export type ReceiptKind = 'link' | 'legacy' | 'global';

/** one receipt as a screen sees it, whatever storage generation it is */
export interface ReceiptEntry {
  kind: ReceiptKind;
  /** ReceiptRow-shaped payload — rendering + linking always work on this */
  data: ReceiptRow;
  /** the receiptLink row id (kind 'link' — unlink target) */
  linkId?: string;
  txId?: string;
}

const linkAsReceipt = (link: ReceiptLinkRow): ReceiptRow => ({
  id: link.receiptId ?? link.id,
  spaceId: link.spaceId,
  txId: link.txId,
  source: link.source,
  date: link.date,
  totalCents: link.totalCents,
  merchant: link.merchant,
  items: link.items,
  image: link.image,
  instanceId: link.instanceId,
  payment: link.payment,
  fieldVersions: link.fieldVersions,
  deleted: link.deleted,
});

export const viewAsEntry = (view: SpaceReceiptView): ReceiptEntry =>
  view.legacy
    ? { kind: 'legacy', data: linkAsReceipt(view.link), txId: view.link.txId }
    : { kind: 'link', data: linkAsReceipt(view.link), linkId: view.link.id, txId: view.link.txId };

export const globalAsEntry = (row: ReceiptRow): ReceiptEntry => ({ kind: 'global', data: row });

/** the receipt attached to one transaction (v3 link or legacy row) */
export function useTxReceiptEntry(txId: string | undefined): ReceiptEntry | null | undefined {
  const { store, spaceId } = useData();
  return useQuery(
    store,
    async () => {
      if (!txId) return null;
      const all = await spaceReceipts(store, spaceId);
      const view = all.find((v) => v.link.txId === txId);
      return view ? viewAsEntry(view) : null;
    },
    [spaceId, txId],
  );
}
