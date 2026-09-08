import { apiFetch } from '@/lib/api';
import type { StorageBackend } from '@/db/backend';
import type { CatalogDoc } from '@/domain/catalogDoc';
import { CATALOG_BASELINE } from '@/generated/catalogBaseline';

/**
 * Opportunistic catalog refresh (admin-catalog AC1): fetch the
 * operator-published document, cache it in meta, revalidate by ETag.
 * Only syncing (user) identities call this — demo/offline keep the
 * bundled baseline forever (approved ruling #1, zero-network promise).
 */
export const CATALOG_META_KEY = 'catalog';
const ETAG_META_KEY = 'catalogEtag';

export async function refreshCatalog(store: StorageBackend): Promise<void> {
  const etag = (await store.metaGet(ETAG_META_KEY))?.value as string | undefined;
  const response = await apiFetch('/catalog', etag ? { headers: { 'If-None-Match': etag } } : undefined);
  if (response.status === 304) return; // cached copy is current
  if (response.status === 204) {
    // the server has no document (fresh install / rollback): baseline rules
    await store.metaDelete(CATALOG_META_KEY);
    await store.metaDelete(ETAG_META_KEY);
    return;
  }
  if (!response.ok) return; // offline / error — keep whatever we have
  const doc = (await response.json()) as CatalogDoc;
  await store.metaPut(CATALOG_META_KEY, doc);
  const nextEtag = response.headers.get('ETag');
  if (nextEtag) await store.metaPut(ETAG_META_KEY, nextEtag);
}

/** the effective document: fetched copy first, then the baseline the
 *  build baked in (AC3) — offline profiles live on that baseline forever */
export async function cachedCatalog(store: StorageBackend): Promise<CatalogDoc | null> {
  return ((await store.metaGet(CATALOG_META_KEY))?.value as CatalogDoc | undefined) ?? CATALOG_BASELINE;
}
