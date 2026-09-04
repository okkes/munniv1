// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import { cachedCatalog, refreshCatalog } from './catalogSync';

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });

describe('catalog refresh (AC1)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const backend = () => new DexieBackend(new MunniDB(`munni_cat_${Math.random().toString(36).slice(2)}`));

  it('caches the document + etag, then revalidates with If-None-Match', async () => {
    const store = backend();
    const doc = { version: 2, categories: [], keywords: [{ catId: 'hobby', keywords: ['padel'] }] };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get('If-None-Match') === '"catalog-v2"') return new Response(null, { status: 304 });
      return json(doc, { ETag: '"catalog-v2"' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await refreshCatalog(store);
    expect(await cachedCatalog(store)).toEqual(doc);

    await refreshCatalog(store); // second pass rides the etag
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await cachedCatalog(store)).toEqual(doc); // 304 keeps the cache

    store.close();
  });

  it('a 204 (no document on the server) clears back to the baseline', async () => {
    const store = backend();
    await store.metaPut('catalog', { version: 9, categories: [], keywords: [] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await refreshCatalog(store);
    expect(await cachedCatalog(store)).toBeNull();
    store.close();
  });

  it('a network error keeps whatever is cached', async () => {
    const store = backend();
    await store.metaPut('catalog', { version: 5, categories: [], keywords: [] });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));
    await expect(refreshCatalog(store)).rejects.toThrow();
    expect((await cachedCatalog(store))?.version).toBe(5);
    store.close();
  });
});
