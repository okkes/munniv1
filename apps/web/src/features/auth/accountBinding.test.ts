// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOUND_USER_KEY, verifyAccountBinding } from './accountBinding';

function memStore() {
  const meta = new Map<string, unknown>();
  return {
    meta,
    metaGet: async (key: string) => (meta.has(key) ? { key, value: meta.get(key) } : undefined),
    metaPut: async (key: string, value: unknown) => void meta.set(key, value),
  };
}

const USER = { kind: 'user', sub: 'bind-test', testAuth: true } as const;

describe('remote-wipe binding check', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('munni_session', JSON.stringify(USER));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const me = (userId: string) =>
    Promise.resolve(new Response(JSON.stringify({ userId }), { status: 200, headers: { 'content-type': 'application/json' } }));

  it('binds on first sight, stays quiet while the id matches, wipes on mismatch', async () => {
    const store = memStore();
    const onDead = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockImplementation(() => me('user-a'));
    await verifyAccountBinding(store, USER, onDead);
    expect(store.meta.get(BOUND_USER_KEY)).toBe('user-a');
    await verifyAccountBinding(store, USER, onDead);
    expect(onDead).not.toHaveBeenCalled();

    // the account was deleted elsewhere — the server JIT-provisioned a
    // FRESH user row for the same login: this device's copy is dead
    fetchMock.mockImplementation(() => me('user-b'));
    await verifyAccountBinding(store, USER, onDead);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('offline, errors and 404s all verify nothing — only the mismatch acts', async () => {
    const store = memStore();
    store.meta.set(BOUND_USER_KEY, 'user-a');
    const onDead = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    await verifyAccountBinding(store, USER, onDead);
    fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 404 })));
    await verifyAccountBinding(store, USER, onDead);
    fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 500 })));
    await verifyAccountBinding(store, USER, onDead);
    // a gateway hiccup must never wipe a device
    expect(onDead).not.toHaveBeenCalled();
  });
});
