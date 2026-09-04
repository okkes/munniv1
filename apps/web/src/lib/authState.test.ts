// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { LOGTO_WIPE_KEY, clearStaleLogtoState } from './authState';

describe('clearStaleLogtoState', () => {
  it('removes logto:* from both stores, keeps the session, leaves a breadcrumb', () => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('logto:app:idToken', 'x');
    localStorage.setItem('logto:app:refreshToken', 'y');
    sessionStorage.setItem('logto:app:signInSession', 'z');
    localStorage.setItem('munni_session', 's');

    clearStaleLogtoState('unit-test');

    expect(localStorage.getItem('logto:app:idToken')).toBeNull();
    expect(localStorage.getItem('logto:app:refreshToken')).toBeNull();
    expect(sessionStorage.getItem('logto:app:signInSession')).toBeNull();
    expect(localStorage.getItem('munni_session')).toBe('s');
    // the breadcrumb names the call site — the Diagnose report prints it
    // to separate "app wiped the keys" from "keys never written"
    expect(localStorage.getItem(LOGTO_WIPE_KEY)).toContain('unit-test');
  });
});
