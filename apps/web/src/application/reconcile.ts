import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import type { TransactionRow, TxMetaRow } from '@/db/types';
import { txMetaId } from '@/domain/feedIds';
import { reconcilePlan } from '@/domain/reconcile';
import type { ReconcileMatch, ReconcilePlan } from '@/domain/reconcile';
import { logActivity } from './activity';

/**
 * Applies an imported-vs-linked reconciliation (master plan requirement
 * x): the connection is the truth — matched imports hand their edits to
 * the truth row (unless the user opted a match out), then every judged
 * import inside the coverage is deleted. Pre-coverage history survives.
 */

/** every raw row of one account, wherever it lives (feed or merged space) */
export async function buildReconcilePlan(
  store: StorageBackend,
  accountId: string,
): Promise<ReconcilePlan | null> {
  const rows = (await store.allRows('transaction')).filter((t) => t.deleted === 0 && t.accountId === accountId);
  if (rows.length === 0) return null;
  return reconcilePlan(rows);
}

/** the fields that make up a space's opinion about a transaction */
const OPINION_FIELDS = [
  'catId',
  'txType',
  'needsReview',
  'notes',
  'titleOverride',
  'splits',
  'reimbursements',
  'linkedAccountId',
  'recurringId',
  'eventId',
] as const;

const pickOpinions = (source: Partial<TxMetaRow> & Partial<TransactionRow>) => {
  const out: Record<string, unknown> = {};
  for (const field of OPINION_FIELDS) {
    const value = (source as Record<string, unknown>)[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
};

async function migrateMatch(store: StorageBackend, repo: Repo, match: ReconcileMatch, spaceIds: string[]): Promise<void> {
  // merged rows (demo/offline) carry their opinions directly
  const direct = pickOpinions(match.imported);
  if (Object.keys(direct).length > 0) {
    await repo.upsert('transaction', match.linked.spaceId, match.linked.id, direct);
  }
  for (const spaceId of spaceIds) {
    const metas = (await store.bySpace('txMeta', spaceId)).filter((m) => m.deleted === 0 && m.txId === match.imported.id);
    for (const meta of metas) {
      await repo.upsert('txMeta', spaceId, txMetaId(spaceId, match.linked.id), {
        txId: match.linked.id,
        ...pickOpinions(meta),
      });
    }
    // receipts follow the surviving row
    for (const receipt of (await store.bySpace('receipt', spaceId)).filter((r) => r.deleted === 0 && r.txId === match.imported.id)) {
      await repo.upsert('receipt', spaceId, receipt.id, { txId: match.linked.id });
    }
  }
}

type ReimbLink = { txId: string; amountCents: number };

/** re-point links at a replacement row, drop links whose row is gone;
 *  undefined when nothing referenced a replaced id */
function rewriteLinks(
  links: ReimbLink[] | undefined,
  replacements: ReadonlyMap<string, string | null>,
): ReimbLink[] | undefined {
  if (!links?.some((l) => replacements.has(l.txId))) return undefined;
  const next: ReimbLink[] = [];
  for (const link of links) {
    if (!replacements.has(link.txId)) {
      next.push(link);
      continue;
    }
    const target = replacements.get(link.txId);
    if (target) next.push({ ...link, txId: target });
    // null target: the row is gone — the link goes with it
  }
  return next;
}

async function repointIn(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  entity: 'txMeta' | 'transaction',
  replacements: ReadonlyMap<string, string | null>,
): Promise<void> {
  for (const row of await store.bySpace(entity, spaceId)) {
    if (row.deleted !== 0) continue;
    const next = rewriteLinks(row.reimbursements, replacements);
    if (next) await repo.upsert(entity, spaceId, row.id, { reimbursements: next });
  }
}

/** reimbursement links pointing at a replaced/deleted row get re-pointed or dropped */
async function repointReimbursements(
  store: StorageBackend,
  repo: Repo,
  spaceIds: string[],
  replacements: ReadonlyMap<string, string | null>,
): Promise<void> {
  for (const spaceId of spaceIds) {
    await repointIn(store, repo, spaceId, 'txMeta', replacements);
    await repointIn(store, repo, spaceId, 'transaction', replacements);
  }
}

export interface ReconcileResult {
  migrated: number;
  removed: number;
}

export async function applyReconcile(
  store: StorageBackend,
  repo: Repo,
  activeSpaceId: string,
  plan: ReconcilePlan,
  ignoredImportedIds: ReadonlySet<string>,
): Promise<ReconcileResult> {
  const spaceIds = (await store.allRows('space')).filter((s) => s.deleted === 0).map((s) => s.id);

  // links referencing a matched import re-point to its truth row; links
  // referencing a deleted mismatch are dropped
  const replacements = new Map<string, string | null>();
  let migrated = 0;
  for (const match of plan.matches) {
    if (!ignoredImportedIds.has(match.imported.id)) {
      await migrateMatch(store, repo, match, spaceIds);
      migrated++;
    }
    replacements.set(match.imported.id, match.linked.id);
  }
  for (const row of plan.mismatched) replacements.set(row.id, null);
  await repointReimbursements(store, repo, spaceIds, replacements);

  // the truth stands — every judged import goes (ignored matches too:
  // ignoring only skips the EDIT migration, the duplicate still falls)
  const toDelete = [...plan.matches.map((m) => m.imported), ...plan.mismatched];
  for (const row of toDelete) {
    await repo.remove('transaction', row.spaceId, row.id);
  }

  void logActivity(store, repo, activeSpaceId, 'reconcile', `${migrated}/${toDelete.length}`);
  return { migrated, removed: toDelete.length };
}
