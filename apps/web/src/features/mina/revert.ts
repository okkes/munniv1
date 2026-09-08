import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import type { MinaLedgerEntry } from './steps';

/**
 * Undo everything a tutorial run created (user ruling): ledgered spaces
 * fall with ALL their contents (the normal space-scoped entity sweep, so
 * synced identities converge on every device); loose accounts and
 * transactions in surviving spaces tombstone individually. Bank-fed rows
 * are never in the ledger by construction.
 */
export async function revertMinaRun(store: StorageBackend, repo: Repo, ledger: readonly MinaLedgerEntry[]): Promise<void> {
  const deadSpaces = new Set(ledger.filter((e) => e.entity === 'space').map((e) => e.id));
  for (const spaceId of deadSpaces) await sweepSpace(store, repo, spaceId);
  for (const entry of ledger) {
    if (entry.entity === 'space' || deadSpaces.has(entry.spaceId)) continue;
    const row = await store.get(entry.entity, entry.id);
    if (row?.deleted === 0) await repo.remove(entry.entity, entry.spaceId, entry.id);
  }
}

/** the space row last: readers watching the space see contents drain first */
async function sweepSpace(store: StorageBackend, repo: Repo, spaceId: string): Promise<void> {
  for (const entity of ['transaction', 'account', 'accountLink', 'budget', 'category'] as const) {
    for (const row of await store.bySpace(entity, spaceId)) {
      if (row.deleted === 0) await repo.remove(entity, spaceId, row.id);
    }
  }
  await repo.remove('space', spaceId, spaceId);
}
