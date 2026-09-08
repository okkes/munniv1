import { visibleTransactions, writeTxTransform } from '@/db/joined';
import type { SpaceTx } from '@/db/joined';
import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { kindOf } from '@/domain/txKind';
import { autoSubFor } from '@/domain/categories';
import { isLiability } from '@/features/accounts/accountTypes';
import { matchTransferPairs } from '@/domain/transferMatch';
import type { TransferLeg } from '@/domain/transferMatch';

/**
 * Pair the two legs of a transfer WITHIN each space's own books. Spaces
 * never reference each other's transactions (user rule 2026-08-01 — the
 * cross-space case is the FUNDING type instead: each side keeps its own
 * books, nothing points across).
 *
 * Idempotent and conservative (PayPal-matcher rules): peered rows never
 * re-enter, ambiguity leaves legs alone. Second pass: an out-leg whose
 * linkedAccountId deliberately names an account may claim that account's
 * RAW income twin (untyped bank row) — the "picture only updated half"
 * case — typing it as the mirror in the same stroke.
 */
export async function linkTransferPairs(store: StorageBackend, repo: Repo): Promise<number> {
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0 && !!s.kind);
  let linked = 0;
  for (const space of spaces) {
    linked += await linkSpacePairs(store, repo, space.id);
  }
  return linked;
}

async function linkSpacePairs(store: StorageBackend, repo: Repo, spaceId: string): Promise<number> {
  const all = await visibleTransactions(store, spaceId);
  const byId = new Map(all.map((tx) => [tx.id, tx]));
  const asLeg = (tx: SpaceTx): TransferLeg => ({
    id: tx.id,
    accountId: tx.accountId,
    amountCents: tx.amountCents,
    date: tx.date,
    linkedAccountId: tx.linkedAccountId,
    transferPeerId: tx.transferPeerId,
  });

  // funding sits in the transfer family since 2026-08-01 but never has a
  // second leg in these books (the shared account keeps its own) — it
  // must not enter the pairing pool
  const typed = all.filter((tx) => kindOf(tx.txType) === 'transfer' && tx.txType !== 'funding');
  const pairs = matchTransferPairs(typed.map(asLeg));
  let linked = 0;
  for (const [outId, incId] of pairs) {
    await writePair(repo, byId.get(outId), byId.get(incId), {});
    linked++;
  }

  // pass 2: deliberate out-legs claim their raw income twin
  const paired = new Set<string>([...pairs.keys(), ...pairs.values()]);
  const rawIncomes = all.filter((tx) => tx.amountCents > 0 && tx.txType === 'income' && !tx.linkedAccountId && !tx.transferPeerId && !paired.has(tx.id));
  const openOuts = typed.filter((tx) => tx.amountCents < 0 && !!tx.linkedAccountId && !tx.transferPeerId && !paired.has(tx.id));
  for (const out of openOuts) {
    const twins = rawIncomes.filter(
      (inc) =>
        !paired.has(inc.id) &&
        inc.accountId === out.linkedAccountId &&
        inc.amountCents === Math.abs(out.amountCents) &&
        Math.abs(Date.parse(inc.date) - Date.parse(out.date)) <= 2 * 86_400_000,
    );
    if (twins.length !== 1) continue; // none, or ambiguous — a human's call
    const twin = twins[0];
    paired.add(out.id);
    paired.add(twin.id);
    // the twin becomes the typed mirror: same family member, pointing
    // back, settled, filed under the family's sign-picked locked sub —
    // exactly what a manual link would have produced
    await writePair(repo, out, twin, {
      txType: out.txType,
      linkedAccountId: out.accountId,
      needsReview: 0,
      catId: autoSubFor(out.txType, twin.amountCents),
    });
    linked++;
  }
  return linked;
}

async function writePair(repo: Repo, out: SpaceTx | undefined, inc: SpaceTx | undefined, incExtra: Parameters<typeof writeTxTransform>[2]): Promise<void> {
  if (!out || !inc) return;
  await writeTxTransform(repo, out, { transferPeerId: inc.id });
  await writeTxTransform(repo, inc, { ...incExtra, transferPeerId: out.id });
}

/**
 * Write the OTHER side of a transfer onto a manual counter account (user
 * request: "-100 to savings used to update only half the picture").
 * Mirror row: opposite amount, same date/merchant, same family member,
 * pointing back, peered both ways, settled. The manual counter account's
 * live balance moves by the mirror amount — the same rule every manual
 * write follows.
 */
export async function createCounterTransaction(store: StorageBackend, repo: Repo, tx: SpaceTx, counterAccountId: string): Promise<string> {
  const id = repo.newId();
  await repo.upsert('transaction', tx.spaceId, id, {
    accountId: counterAccountId,
    date: tx.date,
    amountCents: -tx.amountCents,
    currency: tx.currency,
    merchant: tx.merchant,
    txType: tx.txType,
    catId: autoSubFor(tx.txType, -tx.amountCents),
    linkedAccountId: tx.accountId,
    transferPeerId: tx.id,
    needsReview: 0 as const,
  });
  await writeTxTransform(repo, tx, { transferPeerId: id });
  const account = await store.get('account', counterAccountId);
  // manual LIABILITIES are owned by the loan link coupling (loans v2):
  // linking already moved the balance once, and mirroring on top of it
  // double-charged the loan (review finding). Other manual counters
  // (savings, cash…) keep getting their mirror-side move here.
  if (account?.deleted === 0 && account.source === 'manual' && !isLiability(account.type)) {
    await repo.upsert('account', account.spaceId, account.id, { balanceCents: account.balanceCents - tx.amountCents });
  }
  return id;
}
