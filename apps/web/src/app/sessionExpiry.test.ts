// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attemptSilentReentry,
  clearReentryMark,
  clearSessionExpired,
  isInvalidGrantError,
  isSessionExpired,
  markSessionExpired,
  resetSessionExpiryForTests,
  subscribeSessionExpiry,
} from './sessionExpiry';

describe('sessionExpiry (#222)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetSessionExpiryForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('marks once, notifies subscribers, clears again', () => {
    const seen: boolean[] = [];
    subscribeSessionExpiry(() => seen.push(isSessionExpired()));
    expect(markSessionExpired()).toBe(true);
    // re-marking is silent — callers report only the transition
    expect(markSessionExpired()).toBe(false);
    clearSessionExpired();
    expect(isSessionExpired()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('recognizes Logto’s invalid_grant in both error shapes', () => {
    // the LogtoRequestError shape: a code field
    expect(isInvalidGrantError({ code: 'oidc.invalid_grant', message: 'Grant request is invalid.' })).toBe(true);
    // a plain Error carrying the message (the react proxy re-wraps)
    expect(isInvalidGrantError(new Error('Grant request is invalid.'))).toBe(true);
    // network failures and other errors are NOT identity verdicts
    expect(isInvalidGrantError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isInvalidGrantError(undefined)).toBe(false);
    expect(isInvalidGrantError('Grant request is invalid.')).toBe(false);
  });

  it('re-enters silently once, with a cross-tab cooldown after (#272)', async () => {
    const signIn = vi.fn(async () => undefined);
    expect(await attemptSilentReentry(signIn)).toBe(true);
    expect(signIn).toHaveBeenCalledTimes(1);
    // capped: the second expiry in the same visit shows the banner instead
    expect(await attemptSilentReentry(signIn)).toBe(false);
    expect(signIn).toHaveBeenCalledTimes(1);
    // even with the per-visit mark cleared, the COOLDOWN holds — a dead
    // IdP session must never redirect-loop (#272)
    clearReentryMark();
    expect(await attemptSilentReentry(signIn)).toBe(false);
    // past the cooldown (test seam clears the stamp) it may try again
    resetSessionExpiryForTests();
    expect(await attemptSilentReentry(signIn)).toBe(true);
  });

  it('never redirects mid-use — only in quiet windows', async () => {
    const signIn = vi.fn(async () => undefined);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000); // page loaded a minute ago
    expect(await attemptSilentReentry(signIn)).toBe(false);
    expect(signIn).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('munni_grant_reheal')).toBeNull();
  });

  it('#272: the just-returned-to-the-tab window counts as quiet', async () => {
    const signIn = vi.fn(async () => undefined);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000); // long past the open window
    // the tab just came back to the foreground — the idle-return shape
    document.dispatchEvent(new Event('visibilitychange'));
    expect(await attemptSilentReentry(signIn)).toBe(true);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('never redirects while offline', async () => {
    const signIn = vi.fn(async () => undefined);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await attemptSilentReentry(signIn)).toBe(false);
    expect(signIn).not.toHaveBeenCalled();
  });
});
