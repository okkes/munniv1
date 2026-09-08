// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { isSessionExpired, resetSessionExpiryForTests } from '@/app/sessionExpiry';
import { getAccessToken, setAccessTokenGetter } from '@/app/authToken';

/**
 * #222: the app opens, Logto answers the refresh with `invalid_grant`
 * (grant family revoked), the SDK swallows it into the shared context
 * error — and the app used to show "server not available" forever.
 * The bridge must name the state and silently re-enter sign-in once.
 */
let mockError: Error | null = null;
const mockSignIn = vi.fn(async () => undefined);

vi.mock('@logto/react', () => ({
  LogtoProvider: ({ children }: { children: ReactNode }) => children,
  useLogto: () => ({
    error: mockError,
    getIdTokenClaims: async () => undefined,
    getAccessToken: async () => undefined,
    isAuthenticated: true,
    isLoading: false,
    signIn: mockSignIn,
    signOut: async () => undefined,
  }),
  useHandleSignInCallback: () => ({ error: null, isAuthenticated: false, isLoading: false }),
}));

vi.mock('@/app/config', () => ({
  config: { logto: { endpoint: 'https://idp.test', appId: 'app-id', resource: 'https://api.test' } },
  logtoConfigured: true,
  publicOrigin: () => 'https://app.test',
}));

vi.mock('@/lib/report', () => ({ reportError: vi.fn() }));

const invalidGrant = () => {
  const err = new Error('Grant request is invalid.');
  err.name = 'LogtoRequestError';
  return err;
};

describe('TokenBridge invalid_grant handling (#222)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetSessionExpiryForTests();
    setAccessTokenGetter(null);
    mockSignIn.mockClear();
    mockError = null;
  });

  it('marks the session expired and silently re-enters sign-in, once', async () => {
    mockError = invalidGrant();
    const { LogtoAppProvider } = await import('./logto');
    render(<LogtoAppProvider>{null}</LogtoAppProvider>);
    await waitFor(() => expect(isSessionExpired()).toBe(true));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith(`${window.location.origin}/auth-callback`));
    expect(sessionStorage.getItem('munni_grant_reheal')).toBe('1');
    // an expired session short-circuits the bridge — no more IdP hammering
    expect(await getAccessToken()).toBeUndefined();
  });

  it('a NEW invalid_grant in the same visit shows the banner instead of redirecting again', async () => {
    sessionStorage.setItem('munni_grant_reheal', '1'); // the one attempt is spent
    mockError = invalidGrant();
    const { LogtoAppProvider } = await import('./logto');
    render(<LogtoAppProvider>{null}</LogtoAppProvider>);
    await waitFor(() => expect(isSessionExpired()).toBe(true));
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('other context errors (network hiccups) never mark the session expired', async () => {
    mockError = new TypeError('Failed to fetch');
    const { LogtoAppProvider } = await import('./logto');
    render(<LogtoAppProvider>{null}</LogtoAppProvider>);
    // give the effect a beat — nothing must change
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isSessionExpired()).toBe(false);
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
