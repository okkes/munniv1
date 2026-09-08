import { txMetaId } from '@/domain/feedIds';
import type { StorageBackend } from './backend';
import type { Repo } from './repo';
import type { AccountLinkRow, AccountRow, TransactionRow, TxMetaRow } from './types';

/**
 * Feature B join layer: what a space "sees".
 *
 * Raw bank data lives once, in the account's feed space. A viewing
 * space sees a raw transaction through its attachments, dressed with
 * the space's own transformation overlay (txMeta). Rows created before
 * the feed migration still carry both halves merged — those are served
 * as-is (dual-read), so mid-migration devices never show gaps.
 */

export interface SpaceTx extends TransactionRow {
  /** present when the row is a joined feed transaction (not a legacy merged row) */
  feedSpaceId?: string;
}

const TRANSFORM_DEFAULTS = (raw: TransactionRow): Pick<TransactionRow, 'catId' | 'txType' | 'needsReview'> => ({
  catId: undefined, // renders as Uncategorized until a member categorizes it
  txType: raw.amountCents >= 0 ? 'income' : 'expense',
  needsReview: 1,
});

function joinTx(raw: TransactionRow, meta: TxMetaRow | undefined, spaceId: string, feedSpaceId: string): SpaceTx {
  const defaults = TRANSFORM_DEFAULTS(raw);
  return {
    ...raw,
    spaceId,
    feedSpaceId,
    catId: meta?.catId ?? defaults.catId,
    txType: meta?.txType ?? defaults.txType,
    // reserved (pending) charges are not review material: the bank will
    // replace them with their booked twin
    needsReview: raw.pending === 1 ? 0 : (meta?.needsReview ?? defaults.needsReview),
    notes: meta?.notes,
    titleOverride: meta?.titleOverride,
    splits: meta?.splits,
    reimbursements: meta?.reimbursements,
    linkedAccountId: meta?.linkedAccountId,
    transferPeerId: meta?.transferPeerId,
    recurringId: meta?.recurringId,
    eventId: meta?.eventId,
    loanCounted: meta?.loanCounted,
  };
}

/** attachments of a space (non-deleted; archived ones still serve history) */
export async function spaceAccountLinks(store: StorageBackend, spaceId: string): Promise<AccountLinkRow[]> {
  return (await store.bySpace('accountLink', spaceId)).filter((l) => l.deleted === 0);
}

/** every transaction the space sees: legacy merged rows + joined feed rows */
export async function visibleTransactions(store: StorageBackend, spaceId: string): Promise<SpaceTx[]> {
  const [own, links, metas, space] = await Promise.all([
    store.bySpace('transaction', spaceId),
    spaceAccountLinks(store, spaceId),
    store.bySpace('txMeta', spaceId),
    store.get('space', spaceId),
  ]);
  // the space's own rows respect the history start too (arc 5): stored
  // in full, filtered at display — exactly like attached feed rows.
  // Rows from before the start (sync races, a start date moved newer)
  // stay in the database but out of every screen.
  const startGate = space?.historyStartDate;
  const legacy = own.filter((t) => t.deleted === 0 && (!startGate || t.date >= startGate));
  const metaByTx = new Map(metas.filter((m) => m.deleted === 0).map((m) => [m.txId, m]));

  const out: SpaceTx[] = [...legacy];
  for (const link of links) {
    const feedTxs = (await store.bySpace('transaction', link.feedSpaceId)).filter(
      (t) =>
        t.deleted === 0 &&
        t.accountId === link.accountId &&
        (!link.historyFrom || t.date >= link.historyFrom),
    );
    for (const raw of feedTxs) out.push(joinTx(raw, metaByTx.get(raw.id), spaceId, link.feedSpaceId));
  }
  return out;
}

/**
 * The space's transactions WITHOUT the history gates (user design
 * 2026-08-01): recurring DETECTION reads the full stored history — a
 * yearly subscription needs charges from before the space's start date
 * to show a pattern at all, and banks may backfill years of data that
 * the display gate deliberately hides. Deletion and attachment rules
 * still apply; only the date gates are lifted. Screens keep reading
 * visibleTransactions — the extra rows serve as pattern EVIDENCE, they
 * never enter the space's lists.
 */
export async function historyTransactions(store: StorageBackend, spaceId: string): Promise<SpaceTx[]> {
  const [own, links, metas] = await Promise.all([
    store.bySpace('transaction', spaceId),
    spaceAccountLinks(store, spaceId),
    store.bySpace('txMeta', spaceId),
  ]);
  const metaByTx = new Map(metas.filter((m) => m.deleted === 0).map((m) => [m.txId, m]));
  const out: SpaceTx[] = own.filter((t) => t.deleted === 0);
  for (const link of links) {
    const feedTxs = (await store.bySpace('transaction', link.feedSpaceId)).filter(
      (t) => t.deleted === 0 && t.accountId === link.accountId,
    );
    for (const raw of feedTxs) out.push(joinTx(raw, metaByTx.get(raw.id), spaceId, link.feedSpaceId));
  }
  return out;
}

export interface SpaceAccount extends AccountRow {
  /** present when the account arrives via an attachment */
  link?: AccountLinkRow;
}

/** every account the space sees: legacy in-space rows + attached feed accounts */
export async function visibleAccounts(store: StorageBackend, spaceId: string): Promise<SpaceAccount[]> {
  const [own, links] = await Promise.all([store.bySpace('account', spaceId), spaceAccountLinks(store, spaceId)]);
  const out: SpaceAccount[] = own.filter((a) => a.deleted === 0);
  for (const link of links) {
    const account = await store.get('account', link.accountId);
    if (account?.deleted === 0) out.push({ ...account, link });
  }
  return out;
}

/** transformation fields a space may hold an opinion on */
export type TxTransformFields = Partial<
  Pick<
    TxMetaRow,
    'catId' | 'txType' | 'needsReview' | 'notes' | 'titleOverride' | 'splits' | 'reimbursements' | 'linkedAccountId' | 'transferPeerId' | 'recurringId' | 'eventId' | 'loanCounted'
  >
>;

/**
 * The single write path for transformation edits: joined feed rows get
 * their overlay written (creating it deterministically on first edit);
 * legacy merged rows keep writing in place until migrated.
 */
export async function writeTxTransform(
  repo: Repo,
  tx: Pick<SpaceTx, 'id' | 'spaceId' | 'feedSpaceId' | 'txType' | 'needsReview'> &
    Partial<Pick<SpaceTx, 'amountCents' | 'date' | 'linkedAccountId' | 'transferPeerId' | 'loanCounted'>>,
  fields: TxTransformFields,
): Promise<void> {
  // loans v2 (review finding): the balance coupling lives at THIS choke
  // point — every linkedAccountId writer (user edits, auto-linkers, the
  // match sheet) moves the manual loan exactly once; hanging it off one
  // hook left frozen balances and wrong-way refunds on the other paths
  const linkChanged = Object.hasOwn(fields, 'linkedAccountId');
  const prevLinked = linkChanged ? tx.linkedAccountId : undefined;

  if (!tx.feedSpaceId) {
    await repo.upsert('transaction', tx.spaceId, tx.id, fields);
  } else {
    await repo.upsert('txMeta', tx.spaceId, txMetaId(tx.spaceId, tx.id), {
      txId: tx.id,
      // first write materializes the current effective view alongside the edit
      txType: tx.txType,
      needsReview: tx.needsReview,
      ...fields,
    });
  }

  if (linkChanged && prevLinked !== (fields.linkedAccountId ?? undefined)) {
    // re-read the MERGED row post-write: the caller's snapshot may carry
    // a stale transferPeerId or miss a loanCounted written a beat ago
    const { applyLoanLinkDelta } = await import('@/application/loanBalance');
    const raw = await repo.store.get('transaction', tx.id);
    const meta = tx.feedSpaceId ? await repo.store.get('txMeta', txMetaId(tx.spaceId, tx.id)) : undefined;
    if (raw) {
      const merged = {
        amountCents: raw.amountCents,
        date: raw.date,
        transferPeerId: tx.feedSpaceId ? meta?.transferPeerId : raw.transferPeerId,
        loanCounted: tx.feedSpaceId ? meta?.loanCounted : raw.loanCounted,
      };
      await applyLoanLinkDelta(repo.store, repo, merged, prevLinked, fields.linkedAccountId ?? undefined).catch(() => undefined);
    }
  }
}
