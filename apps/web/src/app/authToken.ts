/**
 * Access-token bridge: the Logto provider (React context) registers a
 * getter here so non-React code (ApiSyncBackend) can fetch tokens.
 */
type TokenGetter = () => Promise<string | undefined>;

let getter: TokenGetter | null = null;

export function setAccessTokenGetter(fn: TokenGetter | null): void {
  getter = fn;
}

// ── auth readiness ───────────────────────────────────────────────────────
// On a cold PWA start the sync engine used to race Logto's session
// restore: the first requests went out without a token, got a 401 and
// poisoned the bootstrap. Sync now waits for this signal (the Logto
// provider fires it once restoring finished, either way).
let authReadyResolve: (() => void) | null = null;
const authReadyPromise = new Promise<void>((resolve) => {
  authReadyResolve = resolve;
});

export function signalAuthReady(): void {
  authReadyResolve?.();
  authReadyResolve = null;
}

/** resolves once the OIDC session restore finished (test auth: immediately) */
export function waitForAuthReady(): Promise<void> {
  return authReadyPromise;
}

// Single-flight: Logto ROTATES refresh tokens, so two concurrent refreshes
// race — the loser presents the already-consumed token and Logto revokes the
// whole grant family (dead refresh token → double 401 → forced re-login).
// Serializing concurrent callers onto one in-flight fetch removes the race.
let inflight: Promise<string | undefined> | null = null;

export async function getAccessToken(): Promise<string | undefined> {
  if (!getter) return undefined;
  inflight ??= getter().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Logto's signOut, registered by the provider (no-op when unconfigured). */
let signOutHandler: ((postLogoutRedirectUri: string) => Promise<void>) | null = null;

export function setOidcSignOut(fn: ((uri: string) => Promise<void>) | null): void {
  signOutHandler = fn;
}

export async function oidcSignOut(postLogoutRedirectUri: string): Promise<boolean> {
  if (!signOutHandler) return false;
  await signOutHandler(postLogoutRedirectUri);
  return true;
}

/**
 * Logto's signIn, registered by the provider — the 401 self-heal uses it
 * to re-enter the OIDC flow when a signed-in user has no mintable token
 * (evicted/wiped client keys while the IdP session cookie survives: the
 * round-trip is silent and re-mints tokens).
 */
let signInHandler: ((redirectUri: string) => Promise<void>) | null = null;

export function setOidcSignIn(fn: ((uri: string) => Promise<void>) | null): void {
  signInHandler = fn;
}

export async function oidcSignIn(redirectUri: string): Promise<boolean> {
  if (!signInHandler) return false;
  await signInHandler(redirectUri);
  return true;
}
