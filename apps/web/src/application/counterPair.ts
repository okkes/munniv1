import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { visibleTransactions, writeTxTransform, type SpaceTx } from '@/db/joined';
import { accountStamp, movementCatFor } from '@/domain/txType';
import { autoSubFor, stampMovementSub } from '@/domain/categories';

/**
 * #133 step B — the pick-existing door's SECOND half: the source row's
 * own write already carried `transferPeerId = picked` (so the mirror
 * engine minted nothing); this writes the reciprocal onto the picked
 * row — link back, peer back, and the category its own account's stamp
 * dictates. Both writes carry their peer in the SAME write, so neither
 * side ever mints. Balances stay untouched: the picked row was already
 * part of its account's declared reality ("nothing is minted, nothing
 * moves").
 *
 * #237 (user decision "a"): a SAME-SIGN pick is the wallet story — the
 * source (the bank top-up) is the transfer leg, the picked row IS the
 * real purchase and keeps its own category and type. Only the pairing
 * rides onto it; the overviews keep counting the purchase, once.
 *
 * #237 r2: the picked row MUST be resolved as the space sees it (the
 * joined view). A bare `store.get` returns the RAW feed-space row,
 * and writeTxTransform then writes the reciprocal onto the raw row —
 * which every reader ignores (the overlay owns transferPeerId on feed
 * rows). That silent void made every bank-fed pick a one-way pair:
 * the source pointed at the purchase, the purchase knew nothing, and
 * the match sheet kept offering it (user screenshots, 2026-08-16).
 */
export async function pairWithExistingRow(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  source: { id: string; accountId: string; amountCents?: number },
  pickedTxId: string,
  rows?: SpaceTx[],
): Promise<void> {
  const picked =
    (rows ?? []).find((row) => row.id === pickedTxId) ??
    (await visibleTransactions(store, spaceId)).find((row) => row.id === pickedTxId);
  if (picked?.deleted !== 0) return;
  if (source.amountCents !== undefined && Math.sign(picked.amountCents) === Math.sign(source.amountCents)) {
    await writeTxTransform(repo, picked, { transferPeerId: source.id });
    return;
  }
  const account = await store.get('account', picked.accountId);
  const stamp = account?.deleted === 0 ? accountStamp(account.type) : undefined;
  // #133 r5: an unstamped picked row files by ITS counter's kind (the
  // source account) — the bijection holds on both sides of the pair
  const sourceType = (await store.get('account', source.accountId))?.type;
  await writeTxTransform(repo, picked, {
    linkedAccountId: source.accountId,
    transferPeerId: source.id,
    catId:
      (stamp ? stampMovementSub(stamp, picked.amountCents) : undefined) ??
      (sourceType ? movementCatFor(sourceType, picked.amountCents) : autoSubFor('transfer', picked.amountCents)),
    needsReview: 0,
  });
}
