// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

/**
 * The 2026-07-29 iOS 401 regression: the Logto context error is SHARED —
 * a cancelled fetch AFTER a successful exchange (iOS kills the
 * display-name PUT during the /#/home navigation) set it, and the
 * callback screen's unconditional wipe then deleted the freshly
 * persisted tokens while munni_session survived → signed-in-but-
 * tokenless 401 loop. The wipe must only fire while NOT authenticated.
 */
let mockError: Error | null = null;
let mockAuthed = false;

vi.mock('@logto/react', () => ({
  LogtoProvider: ({ children }: { children: ReactNode }) => children,
  useLogto: () => ({
    getIdTokenClaims: async () => undefined,
    getAccessToken: async () => undefined,
    isAuthenticated: mockAuthed,
    isLoading: false,
    signIn: async () => undefined,
    signOut: async () => undefined,
  }),
  useHandleSignInCallback: () => ({ error: mockError, isAuthenticated: mockAuthed, isLoading: false }),
}));

describe('WebCallbackScreen error handling', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('logto:app:idToken', 'fresh');
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'user', sub: 's' }));
  });

  it('a context error AFTER authentication never wipes the fresh tokens', async () => {
    mockError = new Error('Load failed'); // WebKit's cancelled-fetch error
    mockAuthed = true;
    const { CallbackScreen } = await import('./logto');
    render(<CallbackScreen />);
    expect(localStorage.getItem('logto:app:idToken')).toBe('fresh');
    expect(localStorage.getItem('munni_last_logto_wipe')).toBeNull();
  });

  it('a failed exchange (not authenticated) still wipes the poisoned state', async () => {
    mockError = new Error('Grant request is invalid');
    mockAuthed = false;
    const { CallbackScreen } = await import('./logto');
    render(<CallbackScreen />);
    expect(localStorage.getItem('logto:app:idToken')).toBeNull();
    expect(localStorage.getItem('munni_last_logto_wipe')).toContain('web-callback-error');
  });
});
