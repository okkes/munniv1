import { historyTransactions, visibleAccounts, visibleTransactions, writeTxTransform } from '@/db/joined';
import type { SpaceAccount, SpaceTx, TxTransformFields } from '@/db/joined';
import { useQuery } from '@/db/useQuery';
import { useData } from '@/app/data';
import { txTitle } from '@/lib/text';
import { logActivity } from './activity';

export type { SpaceAccount, SpaceTx, TxTransformFields };

/**
 * Application layer (architecture R1): screens ask questions and issue
 * commands here — they no longer know whether a transaction is a legacy
 * merged row or a feed row joined with this space's overlay, nor that
 * Dexie exists. The feed/overlay model (feature B) lives entirely
 * behind these hooks.
 */

/** every transaction the active space sees (legacy + attached feeds), unsorted */
export function useSpaceTransactions(): SpaceTx[] | undefined {
  const { store, spaceId } = useData();
  return useQuery(store, async () => visibleTransactions(store, spaceId), [spaceId]);
}

/** every account the active space sees (legacy + attached), with link info */
export function useSpaceAccounts(): SpaceAccount[] | undefined {
  const { store, spaceId } = useData();
  return useQuery(store, async () => visibleAccounts(store, spaceId), [spaceId]);
}

/** the space's FULL stored history, gates lifted — recurring detection
 *  only (user design 2026-08-01): patterns need the pre-start tail */
export function useSpaceHistoryTransactions(): SpaceTx[] | undefined {
  const { store, spaceId } = useData();
  return useQuery(store, async () => historyTransactions(store, spaceId), [spaceId]);
}

/** one visible transaction by id (detail screens) */
export function useSpaceTransaction(txId: string): SpaceTx | undefined {
  const { store, spaceId } = useData();
  const txs = useQuery(store, async () => visibleTransactions(store, spaceId), [spaceId]);
  return txs?.find((t) => t.id === txId);
}

/**
 * The single write path for a space's opinion about a transaction
 * (category, type, notes, splits, reimbursements, review flag): overlay
 * for feed rows, in place for legacy rows.
 *
 * `activity` names the history line this gesture writes — default
 * 'txEdit'; pass a more specific kind, or null when the caller logs a
 * richer line itself (review). Auto-relinks bypass this hook entirely
 * (writeTxTransform direct), so machine writes never reach the history.
 */
export function useTxTransform(): (tx: SpaceTx, fields: TxTransformFields, activity?: string | null) => Promise<void> {
  const { store, repo, spaceId } = useData();
  return async (tx, fields, activity = 'txEdit') => {
    // the loan balance coupling rides INSIDE writeTxTransform (loans v2
    // review): every linkedAccountId writer shares it, not just this hook
    await writeTxTransform(repo, tx, fields);
    if (activity) void logActivity(store, repo, spaceId, activity, txTitle(tx));
  };
}
