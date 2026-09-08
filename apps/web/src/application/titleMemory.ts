import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { visibleTransactions, writeTxTransform } from '@/db/joined';
import { merchantKey } from '@/domain/merchantKey';

/**
 * Title memory (user request): renaming a transaction teaches the app —
 * the next arrival of the same merchant gets the preferred title
 * automatically, exactly like category memory. The bank's original
 * merchant is never touched; the rename lives in the transformation
 * overlay and the detail screen always shows the original underneath.
 */

/** merchantKey → the title the user most often renames this merchant to */
export function buildTitleMemory(
  txs: readonly { merchant: string; titleOverride?: string; deleted?: 0 | 1 }[],
): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const tx of txs) {
    const title = tx.titleOverride?.trim();
    if (!title || tx.deleted === 1) continue;
    const key = merchantKey(tx.merchant);
    if (!key) continue;
    const perTitle = votes.get(key) ?? new Map<string, number>();
    perTitle.set(title, (perTitle.get(title) ?? 0) + 1);
    votes.set(key, perTitle);
  }
  const memory = new Map<string, string>();
  for (const [key, perTitle] of votes) {
    const best = [...perTitle.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    memory.set(key, best[0]);
  }
  return memory;
}

/** idempotent pass over the space: remembered renames land on rows that
 *  have none yet — runs beside the counterparty/PayPal linkers */
export async function applyTitleMemory(store: StorageBackend, repo: Repo, spaceId: string): Promise<number> {
  const txs = await visibleTransactions(store, spaceId);
  const memory = buildTitleMemory(txs);
  if (memory.size === 0) return 0;
  let applied = 0;
  for (const tx of txs) {
    if (tx.deleted === 1 || tx.titleOverride) continue;
    const remembered = memory.get(merchantKey(tx.merchant));
    if (!remembered) continue;
    await writeTxTransform(repo, tx, { titleOverride: remembered });
    applied++;
  }
  return applied;
}
