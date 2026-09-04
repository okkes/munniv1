import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { visibleTransactions, writeTxTransform } from '@/db/joined';
import { tombstonedIds } from '@/domain/catalogDoc';
import { UNCATEGORIZED_ID, autoSubFor } from '@/domain/categories';
import { givenCents, settledSplits, totalReimbursedCents } from '@/domain/reimbursement';
import { kindOf, standardTypeFor } from '@/domain/txKind';
import { cachedCatalog } from '@/sync/catalogSync';

/**
 * AC3: apply the catalog document's tombstones locally, once per
 * published version. Retired builtins detach their transactions (raw
 * rows and per-space overlays) to Uncategorized and put them back into
 * review — the same story as deleting a user category. Custom subs the
 * user created under a retired premade parent cascade away with it
 * (user ruling: "in that case we can't do much about it"); custom
 * categories are otherwise never touched by catalog updates.
 */
export async function applyCatalogTombstones(store: StorageBackend, repo: Repo): Promise<number> {
  const doc = await cachedCatalog(store);
  if (!doc) return 0;
  const dead = new Set(tombstonedIds(doc));
  if (dead.size === 0) return 0;
  const markerKey = `catalogDetach_v${doc.version}`;
  if (await store.metaGet(markerKey)) return 0;

  let touched = 0;
  // cascade: custom subs under a retired premade parent
  const orphans = (await store.allRows('category')).filter(
    (c) => c.deleted === 0 && !!c.parentId && dead.has(c.parentId),
  );
  for (const orphan of orphans) {
    await repo.remove('category', orphan.spaceId, orphan.id);
    dead.add(orphan.id); // their transactions detach in the same pass
    touched++;
  }
  for (const tx of await store.allRows('transaction')) {
    if (tx.deleted === 0 && tx.catId && dead.has(tx.catId)) {
      await repo.upsert('transaction', tx.spaceId, tx.id, { catId: UNCATEGORIZED_ID, needsReview: 1 });
      touched++;
    }
  }
  for (const meta of await store.allRows('txMeta')) {
    if (meta.deleted === 0 && meta.catId && dead.has(meta.catId)) {
      await repo.upsert('txMeta', meta.spaceId, meta.id, { catId: UNCATEGORIZED_ID, needsReview: 1 });
      touched++;
    }
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

/**
 * Reimbursement redesign migration (answer d, docs/
 * reimbursement-redesign.md): legacy rows carried NET slices — the
 * settled value had silently shrunk away. One pass per identity rewrites
 * every linked transaction (both sides, per space overlay) to gross
 * slices + an explicit `reimbursed` slice. Tie-breaks use category IDS,
 * not localized names, so concurrent migrations on two devices write
 * byte-identical splits and LWW converges cleanly.
 */
export async function migrateReimbursementSlices(store: StorageBackend, repo: Repo): Promise<number> {
  const markerKey = 'reimbSettledSlices_v1';
  if (await store.metaGet(markerKey)) return 0;
  const nameOf = (id: string) => id;

  let touched = 0;
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  for (const space of spaces) {
    touched += await migrateSpaceReimbursements(repo, await visibleTransactions(store, space.id), nameOf);
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

/** a transfer-family row wearing its family's locked sub is a DELIBERATE
 *  arc-2 bare label ("no counter account") — never a pre-2026-07-25
 *  orphan: old rows kept their spending category, bare picks always file
 *  the sub at the write edge */
const isBareFamilyLabel = (tx: { txType: Parameters<typeof autoSubFor>[0]; catId?: string }): boolean =>
  !!tx.catId && (tx.catId === autoSubFor(tx.txType, -1) || tx.catId === autoSubFor(tx.txType, 1));

/**
 * Kind simplification migration (user ruling 2026-07-25, "auto-migrate
 * to regular"): the old UI let anyone pick saving / investment / debt
 * payment / transfer WITHOUT a counterparty — under the simplified model
 * of that era a transfer-kind row without one was unrepresentable. One
 * pass per identity rewrites those orphans to plain income/expense by
 * sign. Categories stay untouched (like all silent migrations, coherence
 * is enforced on the next human edit), and rows WITH a counterparty keep
 * their derived type exactly as-is.
 *
 * Arc 2 made counterless rows legal again (the bare "no counter account"
 * label): those wear their family's locked sub and are skipped — else a
 * fresh device re-running this pass over synced rows would flatten a
 * deliberate choice.
 */
export async function migrateUnlinkedTransferKinds(store: StorageBackend, repo: Repo): Promise<number> {
  const markerKey = 'txKindUnlinked_v1';
  if (await store.metaGet(markerKey)) return 0;

  let touched = 0;
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  for (const space of spaces) {
    for (const tx of await visibleTransactions(store, space.id)) {
      if (tx.deleted !== 0 || kindOf(tx.txType) !== 'transfer' || tx.linkedAccountId) continue;
      if (isBareFamilyLabel(tx)) continue;
      await writeTxTransform(repo, tx, { txType: standardTypeFor(tx.amountCents) });
      touched++;
    }
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

/**
 * 2026-08-01 (user, ss review): the debt family shrank to exactly the
 * arc-2 pair — Repaid / Borrowed. Rows on the retired lendMoney /
 * creditCardPayment subs refile under the sign-picked family sub, raw
 * rows and per-space overlays alike; review status stays untouched.
 */
const RETIRED_DEBT_SUBS = new Set(['lendMoney', 'creditCardPayment']);

export async function migrateRetiredDebtSubs(store: StorageBackend, repo: Repo): Promise<number> {
  const markerKey = 'debtSubsRetired_v1';
  if (await store.metaGet(markerKey)) return 0;

  let touched = 0;
  for (const tx of await store.allRows('transaction')) {
    if (tx.deleted === 0 && tx.catId && RETIRED_DEBT_SUBS.has(tx.catId)) {
      await repo.upsert('transaction', tx.spaceId, tx.id, { catId: autoSubFor('debtPayment', tx.amountCents) });
      touched++;
    }
  }
  for (const meta of await store.allRows('txMeta')) {
    if (meta.deleted === 0 && meta.catId && RETIRED_DEBT_SUBS.has(meta.catId)) {
      const raw = await store.get('transaction', meta.txId);
      await repo.upsert('txMeta', meta.spaceId, meta.id, { catId: autoSubFor('debtPayment', raw?.amountCents ?? -1) });
      touched++;
    }
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

/**
 * Arc 2 (locked doors) back-fill: transfer-family rows that still sit on
 * the uncategorized placeholder file under the family's sign-picked
 * locked sub — the list reads "Set aside" instead of a blank category
 * line. Deliberate categories and splits stay untouched; new writes file
 * at the edges, this one pass covers what already exists. Per-space
 * overlays each file their own sub (transformation data is per-space).
 */
export async function migrateFamilySubs(store: StorageBackend, repo: Repo): Promise<number> {
  const markerKey = 'txFamilySubs_v1';
  if (await store.metaGet(markerKey)) return 0;

  let touched = 0;
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  for (const space of spaces) {
    for (const tx of await visibleTransactions(store, space.id)) {
      if (tx.deleted !== 0 || tx.splits?.length) continue;
      if (tx.catId && tx.catId !== UNCATEGORIZED_ID) continue;
      const sub = autoSubFor(tx.txType, tx.amountCents);
      if (!sub) continue;
      await writeTxTransform(repo, tx, { catId: sub });
      touched++;
    }
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

/**
 * Standard-kind rows whose stored type contradicts their sign (+€1000
 * typed 'expense', user ss 2026-07-28): the old bulk-apply copied the
 * decision's type verbatim across mixed-sign merchant groups (fixed at
 * the source the same day). One pass re-derives those rows by sign.
 */
export async function migrateSignContradictions(store: StorageBackend, repo: Repo): Promise<number> {
  // v2 (2026-08-01): rerun once — sign-blind MEMORY predictions kept
  // writing contradicting standard types into txMeta overlays (which
  // invariants never see) until predictTx learned the sign rule
  const markerKey = 'txSignType_v2';
  if (await store.metaGet(markerKey)) return 0;

  let touched = 0;
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  for (const space of spaces) {
    for (const tx of await visibleTransactions(store, space.id)) {
      if (tx.deleted !== 0 || kindOf(tx.txType) !== 'standard' || tx.amountCents === 0) continue;
      const derived = standardTypeFor(tx.amountCents);
      if (tx.txType === derived) continue;
      await writeTxTransform(repo, tx, { txType: derived });
      touched++;
    }
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

async function migrateSpaceReimbursements(
  repo: Repo,
  txs: Awaited<ReturnType<typeof visibleTransactions>>,
  nameOf: (id: string) => string,
): Promise<number> {
  let touched = 0;
  for (const tx of txs) {
    if (tx.deleted !== 0) continue;
    const settled = tx.amountCents < 0 ? totalReimbursedCents(tx) : givenCents(txs, tx.id);
    if (settled <= 0) continue;
    const next = settledSplits(tx, settled, nameOf);
    if (JSON.stringify(next) === JSON.stringify(tx.splits ?? [])) continue;
    await writeTxTransform(repo, tx, { splits: next });
    touched++;
  }
  return touched;
}
