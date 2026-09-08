// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MunniDB } from '@/db/schema';
import { DexieBackend } from '@/db/backend';
import { hydrateProfileMeta } from './profileHydrate';

/**
 * Reinstall gap (user report 2026-07-18): the Settings avatar reads the
 * local profile copy, which only the profile screen's Save wrote — a
 * fresh install showed the stock icon even though /me knew the picture.
 */
describe('hydrateProfileMeta', () => {
  afterEach(() => vi.unstubAllGlobals());

  const backend = () => new DexieBackend(new MunniDB(`profilehydrate_${Math.random().toString(36).slice(2)}`));

  it('fills the missing local copy from /me', async () => {
    const store = backend();
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ userId: 'u1', displayName: 'Okkes', picture: 'data:image/png;base64,xx' }), { status: 200 }),
    ));
    await hydrateProfileMeta(store);
    expect((await store.metaGet('profile'))?.value).toEqual({ name: 'Okkes', picture: 'data:image/png;base64,xx' });
  });

  it('leaves an existing copy alone (no network call) and fails soft offline', async () => {
    const store = backend();
    await store.metaPut('profile', { name: 'Local', picture: undefined });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await hydrateProfileMeta(store);
    expect(fetchSpy).not.toHaveBeenCalled();

    const empty = backend();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    await hydrateProfileMeta(empty); // must not throw
    expect((await empty.metaGet('profile'))?.value).toBeUndefined();
  });
});
