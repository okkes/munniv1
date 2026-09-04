import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, oidcSignOut, setAccessTokenGetter, setOidcSignOut } from './authToken';

describe('authToken bridge', () => {
  afterEach(() => {
    setAccessTokenGetter(null);
    setOidcSignOut(null);
  });

  it('returns undefined while no getter is registered', async () => {
    expect(await getAccessToken()).toBeUndefined();
  });

  it('delegates to the registered getter and can be unregistered', async () => {
    setAccessTokenGetter(async () => 'tok-123');
    expect(await getAccessToken()).toBe('tok-123');
    setAccessTokenGetter(null);
    expect(await getAccessToken()).toBeUndefined();
  });

  it('oidcSignOut reports false without a handler, true after one runs', async () => {
    expect(await oidcSignOut('https://app/')).toBe(false);
    const handler = vi.fn(async () => undefined);
    setOidcSignOut(handler);
    expect(await oidcSignOut('https://app/')).toBe(true);
    expect(handler).toHaveBeenCalledWith('https://app/');
  });
});
