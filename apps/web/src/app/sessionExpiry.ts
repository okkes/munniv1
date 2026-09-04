/**
 * #222: a dead refresh grant (Logto answers `invalid_grant` to the
 * refresh POST) is an IDENTITY state, not connectivity — every API
 * call 401s while the network is fine, and only a fresh sign-in can
 * cure it. The SDK swallows the failure into `undefined`, which used
 * to read as "no bearer sent — proves nothing" downstream, so the app
 * showed "server not available" forever. This flag names the state:
 * the UI says "sign in again", and the token bridge stops hammering
 * the dead grant.
 */
let expired = false;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

/** returns true only on the marking transition — callers report once */
export function markSessionExpired(): boolean {
  if (expired) return false;
  expired = true;
  notify();
  return true;
}

export function clearSessionExpired(): void {
  if (!expired) return;
  expired = false;
  notify();
}

export const isSessionExpired = (): boolean => expired;

export function subscribeSessionExpiry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Logto's verdict on a spent refresh grant, in either error shape */
export function isInvalidGrantError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rawCode = (err as { code?: unknown }).code;
  const code = typeof rawCode === 'string' ? rawCode : '';
  const message = err instanceof Error ? err.message : '';
  return code.includes('invalid_grant') || message.includes('Grant request is invalid');
}

const PAGE_LOADED_AT = Date.now();
const REENTRY_KEY = 'munni_grant_reheal';
/** #272: cross-tab cooldown so a dead IdP session can't redirect-loop */
const REENTRY_AT_KEY = 'munni_grant_reheal_at';
const REENTRY_COOLDOWN_MS = 10 * 60_000;

// #272: the idle-return shape — expiry usually SURFACES the moment the
// user comes back to a long-idle tab (the foreground refresh fails).
// Nothing unsaved is at risk right then, so the redirect may fire.
let lastBecameVisibleAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lastBecameVisibleAt = Date.now();
  });
}

const inQuietWindow = (): boolean => {
  if (Date.now() - PAGE_LOADED_AT <= 30_000) return true; // near app open
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true; // backgrounded
  return Date.now() - lastBecameVisibleAt <= 10_000; // just came back
};

/**
 * One silent redirect per expiry, only in QUIET windows (near app open,
 * backgrounded, or within seconds of returning to the tab — #272): the
 * IdP session cookie usually outlives the grant, so the round-trip
 * re-mints tokens without the user typing anything. Mid-use we show the
 * banner instead — a surprise redirect would eat unsaved sheet state.
 * A cross-tab cooldown keeps a dead IdP session from redirect-looping.
 */
export async function attemptSilentReentry(signIn: () => Promise<void>): Promise<boolean> {
  if (!navigator.onLine) return false;
  if (!inQuietWindow()) return false;
  if (sessionStorage.getItem(REENTRY_KEY)) return false;
  const lastAt = Number(localStorage.getItem(REENTRY_AT_KEY) ?? 0);
  if (Date.now() - lastAt < REENTRY_COOLDOWN_MS) return false;
  sessionStorage.setItem(REENTRY_KEY, '1');
  localStorage.setItem(REENTRY_AT_KEY, String(Date.now()));
  await signIn();
  return true;
}

/** a token minted again — the next expiry gets its own silent attempt */
export function clearReentryMark(): void {
  sessionStorage.removeItem(REENTRY_KEY);
}

/** test seam — module state must not leak between specs */
export function resetSessionExpiryForTests(): void {
  expired = false;
  listeners.clear();
  lastBecameVisibleAt = 0;
  localStorage.removeItem(REENTRY_AT_KEY);
}
