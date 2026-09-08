import { BUILTIN_CATEGORIES } from './categories';
import type { BuiltinCategory, CatDirection } from './categories';
import type { Lang } from '@/i18n';
import type { TxType } from '@/db/types';

/**
 * The operator-published catalog document (admin-catalog design):
 * builtin categories + prediction keywords as versioned CONTENT. The
 * bundled arrays are the baseline every client carries; a fetched
 * document overlays them — renames, additions and tombstones — without
 * an app update. Offline profiles never fetch and keep the baseline of
 * the version they installed (approved ruling #1).
 */

export interface CatalogDocCategory {
  id: string;
  parentId?: string;
  /** all three languages, required by the admin form (multilanguage rule) */
  names: Record<Lang, string>;
  icon: string;
  color?: string;
  txTypes?: TxType[];
  direction?: CatDirection;
  isParent?: boolean;
  hidden?: boolean;
  positive?: boolean;
  /** tombstone: no longer offered; AC3 detaches transactions to uncategorized */
  deleted?: boolean;
}

export interface CatalogKeywordRule {
  catId: string;
  keywords: string[];
}

/** operator-curated merchant patterns per store (receipts v3 R9): the
 *  auto-matcher's fingerprint improves without an app release */
export interface CatalogStoreRule {
  /** ReceiptSource id, e.g. 'ah' */
  id: string;
  patterns: string[];
}

export interface CatalogDoc {
  version: number;
  categories: CatalogDocCategory[];
  keywords: CatalogKeywordRule[];
  stores?: CatalogStoreRule[];
}

/** a builtin whose display name may come from the document */
export type MergedBuiltin = BuiltinCategory & { names?: Record<Lang, string> };

/**
 * Overlay the document on the bundled baseline:
 * - matching ids override names/icon/color/hidden;
 * - tombstones turn the entry hidden (kept so history still renders);
 * - unknown ids append as new builtin-like categories.
 */
export function mergedBuiltins(doc: CatalogDoc | null | undefined): MergedBuiltin[] {
  if (!doc?.categories?.length) return BUILTIN_CATEGORIES;
  const byId = new Map(doc.categories.map((c) => [c.id, c]));
  const out: MergedBuiltin[] = BUILTIN_CATEGORIES.map((base) => {
    const over = byId.get(base.id);
    if (!over) return base;
    byId.delete(base.id);
    return {
      ...base,
      names: over.names,
      icon: over.icon || base.icon,
      color: over.color ?? base.color,
      hidden: over.deleted ? true : (over.hidden ?? base.hidden),
    };
  });
  for (const added of byId.values()) {
    if (added.deleted) continue; // a tombstone for something we never had
    out.push({
      id: added.id,
      parentId: added.parentId,
      nameKey: 'cat.uncategorized', // never rendered: names wins below
      names: added.names,
      icon: added.icon,
      color: added.color,
      isParent: added.isParent,
      hidden: added.hidden,
      positive: added.positive,
      txTypes: added.txTypes ?? ['expense'],
      direction: added.direction ?? 'both',
    });
  }
  return out;
}

/** ids the operator tombstoned — AC3's detach pass consumes this */
export function tombstonedIds(doc: CatalogDoc | null | undefined): string[] {
  return (doc?.categories ?? []).filter((c) => c.deleted).map((c) => c.id);
}
