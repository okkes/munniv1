import { CATEGORY_BY_ID } from '@/domain/categories';
import {
  affectedByDelete,
  affectedByDirectionChange,
  affectedByTypeChange,
  detachCategoryPatch,
} from '@/domain/categoryRules';
import { adoptedCategoryId } from '@/domain/feedIds';
import type { CategoryRow, CatDirection, TransactionRow, TxSplit, TxType } from '@/db/types';
import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';

/**
 * Category edit/delete with impact analysis. Edits that break existing
 * category assignments (type change, direction change, moving a sub to
 * a parent of another type, deletion) first report how many
 * transactions are affected so the UI can warn; committing detaches
 * those transactions to Uncategorized + review. All writes go through
 * the Repo so they sync like any other change.
 */

export interface CategoryChanges {
  name?: string;
  icon?: string;
  color?: string;
  txType?: TxType;
  direction?: CatDirection;
  parentId?: string;
}

export interface PendingCommit {
  affected: TransactionRow[];
  commit: () => Promise<void>;
}

/** spaces whose transactions can reference this category (its visibility) */
async function visibleSpaceIds(store: StorageBackend, row: CategoryRow): Promise<string[]> {
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  const home = spaces.find((s) => s.id === row.spaceId);
  if (home?.kind === 'shared') return [row.spaceId];
  return spaces.filter((s) => s.kind !== 'shared').map((s) => s.id);
}

async function txsInSpaces(store: StorageBackend, spaceIds: string[]): Promise<TransactionRow[]> {
  const ids = new Set(spaceIds);
  return (await store.allRows('transaction')).filter((t) => t.deleted === 0 && ids.has(t.spaceId));
}

const parentTypeOf = async (store: StorageBackend, parentId: string): Promise<TxType> => {
  const builtin = CATEGORY_BY_ID.get(parentId);
  if (builtin) return builtin.txTypes[0];
  const custom = await store.get('category', parentId);
  return custom?.txType ?? 'expense';
};

/** #244 (user): direction left the user's hands — a sub simply follows
 *  its parent's nature. Income subs are credit, expense subs debit;
 *  anything else (legacy custom mains of other types) stays open. */
export const directionForType = (txType: TxType): CatDirection => {
  if (txType === 'income') return 'credit';
  return txType === 'expense' ? 'debit' : 'both';
};

async function detachAll(repo: Repo, affected: TransactionRow[], catIds: Set<string>): Promise<void> {
  for (const tx of affected) {
    await repo.upsert('transaction', tx.spaceId, tx.id, detachCategoryPatch(tx, catIds));
  }
}

/** subs of a custom parent (non-deleted, same space) */
export async function subsOf(store: StorageBackend, parent: CategoryRow): Promise<CategoryRow[]> {
  return (await store.allRows('category')).filter((c) => c.deleted === 0 && c.parentId === parent.id);
}

interface EditImpact {
  affected: TransactionRow[];
  detachIds: Set<string>;
  /** the sub's new inherited type when it moves under another parent */
  movedType?: TxType;
}

const addBroken = (impact: EditImpact, broken: TransactionRow[], catIds: Iterable<string>) => {
  if (broken.length === 0) return;
  for (const tx of broken) {
    if (!impact.affected.some((a) => a.id === tx.id)) impact.affected.push(tx);
  }
  for (const id of catIds) impact.detachIds.add(id);
};

/** rule 1: type change on a parent breaks every differently-typed tx in the subtree */
const typeChangeImpact = (impact: EditImpact, txs: TransactionRow[], row: CategoryRow, changes: CategoryChanges, subtree: Set<string>) => {
  if (row.isParent !== 1 || !changes.txType || changes.txType === row.txType) return;
  addBroken(impact, affectedByTypeChange(txs, subtree, changes.txType), subtree);
};

/** rule 2: direction change on a sub breaks wrong-side txs */
const directionChangeImpact = (impact: EditImpact, txs: TransactionRow[], row: CategoryRow, changes: CategoryChanges) => {
  if (row.isParent === 1 || !changes.direction || changes.direction === (row.direction ?? 'both')) return;
  addBroken(impact, affectedByDirectionChange(txs, row.id, changes.direction), [row.id]);
};

/** rule 3: moving a sub under a parent of another type breaks differently-typed txs */
const moveImpact = async (impact: EditImpact, store: StorageBackend, txs: TransactionRow[], row: CategoryRow, changes: CategoryChanges) => {
  if (row.isParent === 1 || !changes.parentId || changes.parentId === row.parentId) return;
  impact.movedType = await parentTypeOf(store, changes.parentId);
  if (impact.movedType === row.txType) return;
  addBroken(impact, affectedByTypeChange(txs, new Set([row.id]), impact.movedType), [row.id]);
};

/**
 * Prepare an edit. `affected` is what the warning shows; `commit`
 * detaches those transactions and saves the change (type changes on a
 * parent propagate the stored txType to its subs for consistency).
 */
export async function prepareCategoryEdit(
  store: StorageBackend,
  repo: Repo,
  row: CategoryRow,
  changes: CategoryChanges,
): Promise<PendingCommit> {
  const txs = await txsInSpaces(store, await visibleSpaceIds(store, row));
  const subs = row.isParent === 1 ? await subsOf(store, row) : [];
  const subtree = new Set([row.id, ...subs.map((s) => s.id)]);

  const impact: EditImpact = { affected: [], detachIds: new Set() };
  typeChangeImpact(impact, txs, row, changes, subtree);
  directionChangeImpact(impact, txs, row, changes);
  await moveImpact(impact, store, txs, row, changes);

  return {
    affected: impact.affected,
    commit: async () => {
      if (impact.detachIds.size > 0) await detachAll(repo, impact.affected, impact.detachIds);
      const patch: Partial<CategoryRow> = { ...changes };
      // #244: a moved sub follows its NEW parent's nature — type and
      // direction both re-derive (the user never states either)
      if (impact.movedType) {
        patch.txType = impact.movedType;
        patch.direction = directionForType(impact.movedType);
      }
      await repo.upsert('category', row.spaceId, row.id, patch);
      // keep stored txType on subs consistent with the parent
      if (row.isParent === 1 && changes.txType && changes.txType !== row.txType) {
        for (const sub of subs) {
          await repo.upsert('category', sub.spaceId, sub.id, { txType: changes.txType });
        }
      }
    },
  };
}

/** Prepare a delete: parents cascade to their subs; users get detached. */
export async function prepareCategoryDelete(store: StorageBackend, repo: Repo, row: CategoryRow): Promise<PendingCommit> {
  const subs = row.isParent === 1 ? await subsOf(store, row) : [];
  const subtree = new Set([row.id, ...subs.map((s) => s.id)]);
  const txs = await txsInSpaces(store, await visibleSpaceIds(store, row));
  const affected = affectedByDelete(txs, subtree);
  return {
    affected,
    commit: async () => {
      await detachAll(repo, affected, subtree);
      for (const sub of subs) await repo.remove('category', sub.spaceId, sub.id);
      await repo.remove('category', row.spaceId, row.id);
    },
  };
}

/** Create a custom main category with its locked "Other" sub. */
export async function createMainCategory(
  repo: Repo,
  spaceId: string,
  input: { name: string; icon: string; color: string; txType: TxType; otherName: string },
): Promise<string> {
  const id = repo.newId();
  await repo.upsert('category', spaceId, id, {
    name: input.name,
    icon: input.icon,
    color: input.color,
    txType: input.txType,
    isParent: 1,
    sortOrder: 999,
    builtin: 0,
  });
  await repo.upsert('category', spaceId, repo.newId(), {
    parentId: id,
    name: input.otherName,
    icon: input.icon,
    color: '',
    txType: input.txType,
    direction: 'both',
    isOther: 1,
    sortOrder: 9999,
    builtin: 0,
  });
  return id;
}

/** Create a custom sub under any parent (type AND direction inherited
 *  from the parent — #244: the user never states a direction). */
export async function createSubCategory(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  input: { parentId: string; name: string; icon: string },
): Promise<string> {
  const id = repo.newId();
  const txType = await parentTypeOf(store, input.parentId);
  await repo.upsert('category', spaceId, id, {
    parentId: input.parentId,
    name: input.name,
    icon: input.icon,
    color: '',
    txType,
    direction: directionForType(txType),
    sortOrder: 999,
    builtin: 0,
  });
  return id;
}

/** the copyable payload of a category row (fresh envelope on the target) */
const categoryCopyFields = (r: CategoryRow, overrides: Partial<CategoryRow>): Record<string, unknown> => ({
  parentId: r.parentId,
  name: r.name,
  icon: r.icon,
  color: r.color,
  txType: r.txType,
  direction: r.direction,
  isParent: r.isParent,
  isOther: r.isOther,
  sortOrder: r.sortOrder,
  builtin: 0,
  ...overrides,
});

/**
 * Copy a personal (user-scoped) category into a shared space. Parents
 * are copied with their whole subtree; a sub under a builtin parent is
 * copied alone. Transactions are not touched.
 */
export async function copyCategoryToSpace(
  store: StorageBackend,
  repo: Repo,
  targetSpaceId: string,
  row: CategoryRow,
): Promise<void> {
  if (row.isParent === 1) {
    const newParentId = repo.newId();
    await repo.upsert('category', targetSpaceId, newParentId, categoryCopyFields(row, { parentId: undefined }));
    for (const sub of await subsOf(store, row)) {
      await repo.upsert('category', targetSpaceId, repo.newId(), categoryCopyFields(sub, { parentId: newParentId }));
    }
  } else {
    await repo.upsert('category', targetSpaceId, repo.newId(), categoryCopyFields(row, {}));
  }
}

/** rewrites a category-entry array through the id map; undefined when
 *  nothing changed — shared by row `cats` (#211) and part spreads */
const remapCatEntries = <T extends { catId: string }>(entries: T[] | undefined, idMap: Map<string, string>): T[] | undefined => {
  if (!entries?.some((c) => idMap.has(c.catId))) return undefined;
  return entries.map((c) => (idMap.has(c.catId) ? { ...c, catId: idMap.get(c.catId)! } : c));
};

/** rewrites a splits array through the id map; undefined when nothing changed */
const remapSplits = (splits: TxSplit[] | undefined, idMap: Map<string, string>): TxSplit[] | undefined => {
  if (!splits?.some((s) => idMap.has(s.catId) || (s.cats ?? []).some((c) => idMap.has(c.catId)))) return undefined;
  return splits.map((s) => ({
    ...s,
    ...(idMap.has(s.catId) ? { catId: idMap.get(s.catId)! } : {}),
    ...(s.cats?.length ? { cats: remapCatEntries(s.cats, idMap) ?? s.cats } : {}),
  }));
};

/** rows that reference categories (transactions and overlays share the shape) */
type CatHolder = Pick<TransactionRow, 'id' | 'catId' | 'cats' | 'splits'>;

/** every category id one row references: its own, its `cats` entries and
 *  each part's own + spread (#211) */
const holderCatIds = (holder: CatHolder): (string | undefined)[] => [
  holder.catId,
  ...(holder.cats ?? []).map((c) => c.catId),
  ...(holder.splits ?? []).flatMap((s) => [s.catId, ...(s.cats ?? []).map((c) => c.catId)]),
];

const collectUserScopedUse = (holders: CatHolder[], userScoped: (id?: string) => CategoryRow | undefined): Set<string> => {
  const used = new Set<string>();
  for (const holder of holders) {
    for (const catId of holderCatIds(holder)) {
      if (userScoped(catId)) used.add(catId!);
    }
  }
  return used;
};

/**
 * Copy whole units: a used sub pulls its custom parent with ALL siblings
 * (a half-copied group would be confusing); subs under builtin parents
 * copy alone.
 */
const planCopyUnits = (used: Set<string>, catById: Map<string, CategoryRow>, personalIds: Set<string>) => {
  const parentUnits = new Map<string, CategoryRow>();
  const loneSubs: CategoryRow[] = [];
  for (const id of used) {
    const row = catById.get(id)!;
    if (row.isParent === 1) {
      parentUnits.set(row.id, row);
      continue;
    }
    const parent = row.parentId ? catById.get(row.parentId) : undefined;
    if (parent && personalIds.has(parent.spaceId)) parentUnits.set(parent.id, parent);
    else loneSubs.push(row);
  }
  return { parentUnits, loneSubs };
};

async function copyUnitsIntoSpace(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  parentUnits: Map<string, CategoryRow>,
  loneSubs: CategoryRow[],
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  const copy = async (row: CategoryRow, overrides: Partial<CategoryRow>): Promise<string> => {
    const newId = adoptedCategoryId(spaceId, row.id);
    idMap.set(row.id, newId);
    await repo.upsert('category', spaceId, newId, categoryCopyFields(row, overrides));
    return newId;
  };
  for (const parent of parentUnits.values()) {
    const newParentId = await copy(parent, { parentId: undefined });
    for (const sub of await subsOf(store, parent)) await copy(sub, { parentId: newParentId });
  }
  for (const sub of loneSubs) await copy(sub, {});
  return idMap;
}

async function rewriteReferences(
  repo: Repo,
  entity: 'transaction' | 'txMeta',
  spaceId: string,
  holders: CatHolder[],
  idMap: Map<string, string>,
): Promise<void> {
  for (const holder of holders) {
    const catId = holder.catId ? idMap.get(holder.catId) : undefined;
    const cats = remapCatEntries(holder.cats, idMap);
    const splits = remapSplits(holder.splits, idMap);
    if (!catId && !cats && !splits) continue;
    await repo.upsert(entity, spaceId, holder.id, {
      ...(catId ? { catId } : {}),
      ...(cats ? { cats } : {}),
      ...(splits ? { splits } : {}),
    });
  }
}

/**
 * A personal space that becomes shared adopts every user-scoped custom
 * category its transactions use: the rows are copied into the space
 * (deterministic ids — concurrent inviters converge) and the space's
 * transactions and overlays are rewritten to the copies. Without this,
 * those references stop resolving the moment the space turns shared —
 * for every member INCLUDING the owner — and render as Uncategorized.
 * Idempotent: after adoption the references point at space-local rows,
 * so a second run finds nothing user-scoped in use.
 */
export async function adoptUserCategoriesOnShare(store: StorageBackend, repo: Repo, spaceId: string): Promise<void> {
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  const personalIds = new Set(spaces.filter((s) => s.kind !== 'shared' && s.id !== spaceId).map((s) => s.id));

  const [allTxs, allMetas, allCats] = await Promise.all([
    store.bySpace('transaction', spaceId),
    store.bySpace('txMeta', spaceId),
    store.allRows('category'),
  ]);
  const txs = allTxs.filter((t) => t.deleted === 0);
  const metas = allMetas.filter((m) => m.deleted === 0);
  const cats = allCats.filter((c) => c.deleted === 0);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const userScoped = (id: string | undefined): CategoryRow | undefined => {
    const row = id ? catById.get(id) : undefined;
    return row && personalIds.has(row.spaceId) ? row : undefined;
  };

  const used = collectUserScopedUse([...txs, ...metas], userScoped);
  if (used.size === 0) return;

  const { parentUnits, loneSubs } = planCopyUnits(used, catById, personalIds);
  const idMap = await copyUnitsIntoSpace(store, repo, spaceId, parentUnits, loneSubs);
  await rewriteReferences(repo, 'transaction', spaceId, txs, idMap);
  await rewriteReferences(repo, 'txMeta', spaceId, metas, idMap);
}
