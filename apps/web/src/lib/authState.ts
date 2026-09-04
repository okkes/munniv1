/**
 * Nuke the Logto SDK's persisted state (sign-in session, id/refresh
 * tokens). After a password change on ANOTHER device the stored refresh
 * token is dead and the half-finished sign-in session poisons every
 * retry ("Grant request is invalid" loop) — the user had to delete the
 * app + browser cache by hand. Clearing makes the next attempt a
 * genuinely fresh sign-in instead.
 *
 * Every wipe leaves a breadcrumb (who + when) so the Diagnose report can
 * attribute "keys existed and were removed" vs "keys never written" —
 * the discriminator the 2026-07-29 iOS 401 hunt was missing.
 */
export const LOGTO_WIPE_KEY = 'munni_last_logto_wipe';

export function clearStaleLogtoState(reason: string): void {
  for (const store of [localStorage, sessionStorage]) {
    for (const key of Object.keys(store)) {
      if (key.startsWith('logto:')) store.removeItem(key);
    }
  }
  try {
    localStorage.setItem(LOGTO_WIPE_KEY, JSON.stringify({ reason, ts: new Date().toISOString() }));
  } catch {
    // breadcrumb is best-effort — never let it break the wipe itself
  }
}
