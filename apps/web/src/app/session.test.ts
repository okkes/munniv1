// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { identityKey, readSessionIdentity, useSession } from './session';

describe('session persistence (local-first: restarts must not sign out)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useSession.setState({ identity: null });
  });

  it('login persists the identity in localStorage', () => {
    useSession.getState().login({ kind: 'demo' });
    expect(JSON.parse(localStorage.getItem('munni_session')!)).toEqual({ kind: 'demo' });
    expect(readSessionIdentity()).toEqual({ kind: 'demo' });
  });

  it('survives a simulated app restart (fresh read from storage)', () => {
    useSession.getState().login({ kind: 'user', sub: 'abc', testAuth: true });
    // "restart": nothing but storage remains
    expect(readSessionIdentity()).toEqual({ kind: 'user', sub: 'abc', testAuth: true });
  });

  it('falls back to a pre-migration sessionStorage entry', () => {
    sessionStorage.setItem('munni_session', JSON.stringify({ kind: 'demo' }));
    expect(readSessionIdentity()).toEqual({ kind: 'demo' });
  });

  it('logout clears both storages', () => {
    useSession.getState().login({ kind: 'demo' });
    sessionStorage.setItem('munni_session', JSON.stringify({ kind: 'demo' }));
    useSession.getState().logout();
    expect(localStorage.getItem('munni_session')).toBeNull();
    expect(sessionStorage.getItem('munni_session')).toBeNull();
    expect(readSessionIdentity()).toBeNull();
  });

  it('rejects corrupted or unknown identities', () => {
    localStorage.setItem('munni_session', '{broken');
    expect(readSessionIdentity()).toBeNull();
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'nonsense' }));
    expect(readSessionIdentity()).toBeNull();
  });

  it('identityKey sanitizes subs for db names', () => {
    expect(identityKey({ kind: 'user', sub: 'a.b|c d' })).toBe('user_a_b_c_d');
    expect(identityKey({ kind: 'demo' })).toBe('demo');
    expect(identityKey({ kind: 'offline', profileId: 'x1' })).toBe('offline_x1');
  });
});
