import { visibleTransactions, writeTxTransform } from '@/db/joined';
import type { SpaceTx } from '@/db/joined';
import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { kindOf } from '@/domain/txKind';
import { autoSubFor, stampMovementSub } from '@/domain/categories';
import { accountStamp, familyForCounter, movementCatFor } from '@/domain/txType';
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

  // funding left the transfer family when its type retired (2026-08-05)
  // — kindOf files leftover unmigrated rows as standard, out of the pool
  const typed = all.filter((tx) => kindOf(tx.txType) === 'transfer');
  const pairs = matchTransferPairs(typed.map(asLeg));
  let linked = 0;
  for (const [outId, incId] of pairs) {
    await writePair(store, repo, byId.get(outId), byId.get(incId), {});
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
    // the twin becomes the typed mirror: pointing back, settled, wearing
    // its own account's STAMP with the forced movement sub (R1/Q8) — an
    // unstamped twin files by ITS counter's kind (#133 r5 bijection)
    const stamp = accountStamp((await store.get('account', twin.accountId))?.type);
    const outType = (await store.get('account', out.accountId))?.type;
    await writePair(store, repo, out, twin, {
      txType: stamp ?? (outType ? familyForCounter(outType) : 'transfer'),
      linkedAccountId: out.accountId,
      needsReview: 0,
      catId:
        (stamp ? stampMovementSub(stamp, twin.amountCents) : undefined) ??
        (outType ? movementCatFor(outType, twin.amountCents) : autoSubFor('transfer', twin.amountCents)),
    });
    linked++;
  }
  return linked;
}

async function writePair(store: StorageBackend, repo: Repo, out: SpaceTx | undefined, inc: SpaceTx | undefined, incExtra: Parameters<typeof writeTxTransform>[2]): Promise<void> {
  if (!out || !inc) return;
  // the model's pairing rules (typed-splits v2): a null counterparty
  // auto-fills from the other leg, and a STAMPED leg stores its stamp +
  // the forced movement sub (Q8) so the raw row reads true too. The
  // peer in the same write keeps the choke point from minting — pairing
  // two REAL rows is the pick-existing case by construction. #133 r5:
  // an UNSTAMPED leg whose counter is a special account files the
  // family's movement sub — a checking↔savings pair reads "Set aside",
  // never "Transfer out"; regular↔regular pairs stay untouched.
  const enrich = async (leg: SpaceTx, other: SpaceTx): Promise<Parameters<typeof writeTxTransform>[2]> => {
    const stamp = accountStamp((await store.get('account', leg.accountId))?.type);
    if (stamp) {
      return {
        ...(leg.linkedAccountId ? {} : { linkedAccountId: other.accountId }),
        txType: stamp,
        catId: stampMovementSub(stamp, leg.amountCents),
        needsReview: 0 as const,
      };
    }
    const counterType = (await store.get('account', other.accountId))?.type;
    const family = counterType ? familyForCounter(counterType) : 'transfer';
    return {
      ...(leg.linkedAccountId ? {} : { linkedAccountId: other.accountId }),
      ...(family !== 'transfer' && counterType ? { txType: family, catId: movementCatFor(counterType, leg.amountCents) } : {}),
    };
  };
  await writeTxTransform(repo, out, { ...(await enrich(out, inc)), transferPeerId: inc.id });
  await writeTxTransform(repo, inc, { ...(await enrich(inc, out)), ...incExtra, transferPeerId: out.id });
}

// createCounterTransaction retired 2026-08-05 (typed-splits v2): the
// mirror leg is minted by the writeTxTransform choke point the moment a
// MANUAL counter account is linked (application/mirrorMint.ts) — one
// deterministic mirror per source row, balance riding its lifecycle.
