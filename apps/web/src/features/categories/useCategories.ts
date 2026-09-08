import { useMemo } from 'react';
import { useQuery } from '@/db/useQuery';
import { buildCatalog, visibleCategoryRows } from '@/domain/catalog';
import type { Cat, Catalog } from '@/domain/catalog';
import type { CatalogDoc } from '@/domain/catalogDoc';
import { CATALOG_BASELINE } from '@/generated/catalogBaseline';
import { getCurrentLang } from '@/i18n';
import type { TFunc, TranslationKey } from '@/i18n';
import { useData } from '@/app/data';

// the catalog itself is pure domain code (domain/catalog.ts) so the
// service worker can build it too; this hook only adds the live query
export type { Cat, Catalog } from '@/domain/catalog';

/** display name for either kind */
export function catName(cat: Cat, t: TFunc): string {
  // operator-published names (catalog document) win over the bundled key
  return cat.names?.[getCurrentLang()] ?? cat.name ?? (cat.nameKey ? t(cat.nameKey as TranslationKey) : cat.id);
}

/**
 * Built-in catalog merged with the visible custom categories.
 *
 * Scope rule (matches the legacy app): categories created in a personal
 * space are user-scoped — visible across ALL the user's personal
 * spaces; categories created in a shared space belong to that space
 * only. Custom rows are ordinary synced data either way.
 */
export function useCategories(): Catalog {
  const { store, spaceId } = useData();

  const visible = useQuery(store, async () => {
    const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
    const cats = (await store.allRows('category')).filter((c) => c.deleted === 0);
    const doc = ((await store.metaGet('catalog'))?.value as CatalogDoc | undefined) ?? CATALOG_BASELINE;
    return { ...visibleCategoryRows(spaces, cats, spaceId), doc };
  }, [spaceId]);

  return useMemo(
    () => buildCatalog(visible?.rows ?? [], visible?.sharedScope ?? false, visible?.hiddenMains ?? [], visible?.doc),
    [visible],
  );
}
