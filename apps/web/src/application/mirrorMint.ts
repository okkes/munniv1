import { autoSubFor, stampMovementSub } from '@/domain/categories';
import { mirrorTxId } from '@/domain/feedIds';
import { accountStamp, familyForCounter, movementCatFor } from '@/domain/txType';
import { isLiability } from '@/features/accounts/accountTypes';
import { countsTowardLoan } from './loanBalance';
import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import type { AccountRow } from '@/db/types';

/**
 * Mint-on-link (typed-splits v2, user 2026-08-05): linking a MANUAL
 * account as transfer counterparty creates the mirror row ON that
 * account — typed by its stamp, movement category by its own sign — and
 * that mirror's lifecycle carries the balance: create moves it, delete
 * refunds. This replaces the loans-v2 delta lane (applyLoanLinkDelta)
 * and the opt-in mirror checkbox: the special account's ledger is the
 * record now. Bank-fed counterparts mint nothing — their real row
 * arrives and the pair matcher links it.
 *
 * The mirror id is DETERMINISTIC (mirrorTxId), so two devices linking
 * the same row converge on one mirror via LWW, and unlink can find its
 * own mint without bookkeeping.
 *
 * Liability balances keep the loans-v2 cutoff: a source row dated on or
 * before the account's balanceAsOf is presumed inside that number and
 * moves nothing (countsTowardLoan; the loanCounted one-shot still
 * overrides). Non-liability manual balances always move — that matches
 * the retired createCounterTransaction behavior.
 */

export interface MirrorSource {
  id: string;
  accountId: string;
  amountCents: number;
  date: string;
  time?: string;
  currency: string;
  merchant: string;
  loanCounted?: 1;
}

/** a counter account we mint on: the space's own MANUAL account —
 *  never a funding pot (#152: funding shows no transactions at all, so
 *  a minted leg would be invisible clutter; balances stay out too) */
async function mintableCounter(store: StorageBackend, accountId: string | undefined): Promise<AccountRow | null> {
  if (!accountId) return null;
  const account = await store.get('account', accountId);
  if (account?.deleted !== 0 || account.source !== 'manual' || account.type === 'funding') return null;
  return account;
}

const balanceMoves = (account: AccountRow, source: MirrorSource): boolean =>
  !isLiability(account.type) || countsTowardLoan(account, source);

/** the resize step (#133 r4): OUR live mint tracks the source money —
 *  a spread entry's edited amount moves the mirror and its balance by
 *  the delta. Null when nothing needs to move. */
async function planResizeStep(
  store: StorageBackend,
  source: MirrorSource,
  linkedId: string,
  mid: string,
): Promise<((repo: Repo) => Promise<void>) | null> {
  const account = await mintableCounter(store, linkedId);
  const mirror = await store.get('transaction', mid);
  const mirrorAmount = -source.amountCents;
  if (!account || mirror?.deleted !== 0 || mirror.accountId !== account.id || mirror.amountCents === mirrorAmount) {
    return null;
  }
  const delta = mirrorAmount - mirror.amountCents;
  return async (repo) => {
    await repo.upsert('transaction', account.spaceId, mid, { amountCents: mirrorAmount });
    if (balanceMoves(account, source)) {
      const fresh = await store.get('account', account.id);
      if (fresh?.deleted === 0) {
        await repo.upsert('account', fresh.spaceId, fresh.id, { balanceCents: fresh.balanceCents + delta });
      }
    }
  };
}

/** what the source row's own write must carry (peer set on mint, cleared
 *  when the unlink removes our mint) */
export interface MirrorPlan {
  sourceFields: { transferPeerId?: string | null };
  execute: (repo: Repo) => Promise<void>;
}

/**
 * Plans the mirror consequence of a linkedAccountId change. Reads fresh
 * state (never the caller's snapshot — the loans-v2 stale-peer lesson).
 * `incomingPeer` set means the caller pairs an EXISTING row (Q2's
 * pick-existing door) — nothing is minted, nothing moves.
 */
export async function planMirrorChange(
  store: StorageBackend,
  source: MirrorSource,
  prevLinkedId: string | undefined,
  nextLinkedId: string | undefined,
  currentPeerId: string | undefined,
  incomingPeer: string | null | undefined,
): Promise<MirrorPlan> {
  const steps: Array<(repo: Repo) => Promise<void>> = [];
  const sourceFields: MirrorPlan['sourceFields'] = {};
  const mid = mirrorTxId(source.id);

  // the old link loses OUR mint (a picked/bank peer is left alone —
  // unpairing a real row is the unpair button's job, not the link's)
  if (prevLinkedId && prevLinkedId !== nextLinkedId && currentPeerId === mid) {
    const prevAccount = await mintableCounter(store, prevLinkedId);
    const mirror = await store.get('transaction', mid);
    if (prevAccount && mirror?.deleted === 0 && mirror.accountId === prevAccount.id) {
      steps.push(async (repo) => {
        await repo.remove('transaction', prevAccount.spaceId, mid);
        if (balanceMoves(prevAccount, source)) {
          const fresh = await store.get('account', prevAccount.id);
          if (fresh?.deleted === 0) {
            await repo.upsert('account', fresh.spaceId, fresh.id, {
              balanceCents: fresh.balanceCents - -source.amountCents,
            });
          }
        }
      });
      sourceFields.transferPeerId = null;
    }
  }

  // #133 r4 — RESIZE: same link, new money (a spread entry's amount
  // edited). Only OUR mint moves; a picked/bank peer is a real row.
  if (prevLinkedId && prevLinkedId === nextLinkedId && currentPeerId === mid) {
    const resize = await planResizeStep(store, source, nextLinkedId, mid);
    if (resize) steps.push(resize);
  }

  if (nextLinkedId && nextLinkedId !== prevLinkedId && !incomingPeer) {
    const nextAccount = await mintableCounter(store, nextLinkedId);
    // an existing live mirror (same deterministic id) means another
    // device already minted — converge by adopting it
    const existing = await store.get('transaction', mid);
    const alreadyMinted = existing?.deleted === 0 && existing.accountId === nextAccount?.id;
    if (nextAccount && (currentPeerId === undefined || currentPeerId === mid || sourceFields.transferPeerId === null)) {
      const stamp = accountStamp(nextAccount.type);
      // #133 r5: an unstamped mirror files by ITS counter's kind — the
      // source account (a savings row's leg on a manual regular account
      // reads "Take out", not "Transfer in")
      const sourceType = (await store.get('account', source.accountId))?.type;
      const mirrorAmount = -source.amountCents;
      steps.push(async (repo) => {
        if (!alreadyMinted) {
          await repo.upsert('transaction', nextAccount.spaceId, mid, {
            accountId: nextAccount.id,
            date: source.date,
            ...(source.time ? { time: source.time } : {}),
            amountCents: mirrorAmount,
            currency: source.currency,
            merchant: source.merchant,
            txType: stamp ?? (sourceType ? familyForCounter(sourceType) : 'transfer'),
            catId:
              (stamp ? stampMovementSub(stamp, mirrorAmount) : undefined) ??
              (sourceType ? movementCatFor(sourceType, mirrorAmount) : autoSubFor('transfer', mirrorAmount)),
            needsReview: 0 as const,
            linkedAccountId: source.accountId,
            transferPeerId: source.id,
          });
          if (balanceMoves(nextAccount, source)) {
            const fresh = await store.get('account', nextAccount.id);
            if (fresh?.deleted === 0) {
              await repo.upsert('account', fresh.spaceId, fresh.id, {
                balanceCents: fresh.balanceCents + mirrorAmount,
              });
            }
          }
        }
        // balanceAsOf deliberately NOT stamped (loans-v2 rule): a link
        // consequence is not a balance declaration
      });
      sourceFields.transferPeerId = mid;
    }
  }

  return {
    sourceFields,
    execute: async (repo) => {
      for (const step of steps) await step(repo);
    },
  };
}

/**
 * Heal door for rows LINKED before the mint engine existed (or whose
 * mirror was deleted): mint the manual counter leg for the current link
 * as if it were fresh. Returns the mirror id when something was minted.
 */
export async function mintMirrorForExistingLink(
  store: StorageBackend,
  repo: Repo,
  source: MirrorSource,
  linkedAccountId: string | undefined,
  currentPeerId: string | undefined,
): Promise<string | null> {
  if (!linkedAccountId) return null;
  const plan = await planMirrorChange(store, source, undefined, linkedAccountId, currentPeerId, undefined);
  const peer = plan.sourceFields.transferPeerId;
  if (typeof peer !== 'string') return null;
  await plan.execute(repo);
  return peer;
}

// planCatEntryMirrors retired (#228, user): entries of a category spread
// carry no counterparties anymore — one counterparty per (split)
// transaction, so the row- and part-level lifecycles above are the whole
// engine. The boot fold (migrateEntryCounters) retires or re-keys the
// mints the old per-entry model left behind.

/**
 * Deleting a source row must take its mint along: the mirror row is
 * tombstoned and the balance it moved comes back. Call BEFORE removing
 * the source (the merged row must still be readable).
 */
export async function removeMirrorForDeletedSource(
  store: StorageBackend,
  repo: Repo,
  source: MirrorSource,
  linkedAccountId: string | undefined,
): Promise<void> {
  const plan = await planMirrorChange(store, source, linkedAccountId, undefined, mirrorTxId(source.id), undefined);
  await plan.execute(repo);
}
