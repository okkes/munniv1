// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getApiCapabilities } from './api';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('apiFetch', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends X-User-Sub for test-auth user identities', async () => {
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'user', sub: 'alice', testAuth: true }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));
    await apiFetch('/friends');
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init!.headers);
    expect(headers.get('X-User-Sub')).toBe('alice');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('refuses the network entirely for demo/offline identities', async () => {
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'demo' }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));
    await expect(apiFetch('/health')).rejects.toThrow(/local-only/);
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'offline', profileId: 'p1' }));
    await expect(apiFetch('/health')).rejects.toThrow(/local-only/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still fetches while signed out (login provisioning)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));
    await apiFetch('/health');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves caller-supplied headers and method', async () => {
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'user', sub: 'a', testAuth: true }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));
    await apiFetch('/x', { method: 'DELETE', headers: { 'X-Extra': '1' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init!.method).toBe('DELETE');
    expect(new Headers(init!.headers).get('X-Extra')).toBe('1');
  });
});

describe('getApiCapabilities', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('answers "no server features" for offline identities without touching the network', async () => {
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'offline', profileId: 'p1' }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));
    expect((await getApiCapabilities()).gocardless).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches the first result for the page lifetime', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ capabilities: { gocardless: true } }));
    const first = await getApiCapabilities();
    const second = await getApiCapabilities();
    expect(first.gocardless).toBe(true);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('dead-session handling (401 → retry → re-login)', () => {
  it('retries once with a fresh token, then clears the session and returns to login', async () => {
    const { resetAuthExpiryGuard } = await import('./api');
    resetAuthExpiryGuard();
    const { setAccessTokenGetter, signalAuthReady } = await import('@/app/authToken');
    signalAuthReady(); // the restore finished — apiFetch may proceed
    setAccessTokenGetter(async () => 'stale-but-real-token'); // a REAL bearer gets rejected
    const { useSession } = await import('@/app/session');
    // apiFetch reads the persisted identity, not the store snapshot
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'user', sub: 'stale-user' }));
    localStorage.setItem('logto:app-id:idToken', 'stale'); // dead SDK state must be shed too
    useSession.setState({ identity: { kind: 'user', sub: 'stale-user' } });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls.push('call');
      return new Response('{}', { status: 401 });
    }));
    const assignSpy = vi.fn();
    const original = globalThis.location;
    vi.stubGlobal('location', { ...original, assign: assignSpy });

    const { apiFetch } = await import('./api');
    const res = await apiFetch('/me/spaces');
    expect(res.status).toBe(401);
    expect(calls.length).toBe(2); // original + fresh-token retry
    expect(useSession.getState().identity).toBeNull(); // session cleared
    expect(localStorage.getItem('logto:app-id:idToken')).toBeNull(); // fresh sign-in guaranteed
    expect(assignSpy).toHaveBeenCalledWith('/#/login');

    // a second 401 in the same page load must not loop the navigation
    await apiFetch('/me/spaces');
    expect(assignSpy).toHaveBeenCalledTimes(1);
    setAccessTokenGetter(null);
  });

  it('a 401 without a bearer never forces a logout (cold-start boot race)', async () => {
    // an app update always cold-starts: requests fired before the token
    // getter exists carry no bearer — those 401s prove nothing about the
    // refresh token and must NOT wipe the session (user: had to sign in
    // after every update)
    const { resetAuthExpiryGuard, apiFetch } = await import('./api');
    resetAuthExpiryGuard();
    const { setAccessTokenGetter, signalAuthReady } = await import('@/app/authToken');
    signalAuthReady();
    setAccessTokenGetter(null); // no getter yet — exactly the boot window
    const { useSession } = await import('@/app/session');
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'user', sub: 'booting-user' }));
    useSession.setState({ identity: { kind: 'user', sub: 'booting-user' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const assignSpy = vi.fn();
    vi.stubGlobal('location', { ...globalThis.location, assign: assignSpy });

    const res = await apiFetch('/me/spaces');
    expect(res.status).toBe(401); // the caller sees the 401 …
    expect(useSession.getState().identity).not.toBeNull(); // … but stays signed in
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
