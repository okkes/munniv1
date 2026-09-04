import { config } from '@/app/config';
import { getAccessToken, waitForAuthReady } from '@/app/authToken';
import { readSessionIdentity } from '@/app/session';
import { protocolIssueFor } from './protocol';
import type { ProtocolIssue } from './protocol';
import { getDeviceId } from '@/db/device';
import { isNativeApp } from './platform';

/** what kind of device this is, as far as the server needs to know */
function devicePlatform(): string {
  if (!isNativeApp()) return 'web';
  return /Android/i.test(navigator.userAgent) ? 'android' : 'ios';
}

/** rejects API access for identities that promised to stay offline */
function assertNetworkAllowed(): void {
  const identity = readSessionIdentity();
  // the local-first law, enforced at the choke point: demo/offline
  // identities never touch the network, whatever a screen forgets to
  // gate. Signed out (null) stays allowed — login provisioning needs it.
  if (identity && identity.kind !== 'user') {
    throw new Error('local-only identity — API access denied');
  }
}

// one guard for the whole page: a dead session must trigger exactly one
// return to the login screen, however many background calls hit the 401
let handlingAuthExpiry = false;

/** test seam */
export function resetAuthExpiryGuard(): void {
  handlingAuthExpiry = false;
}

/** Authenticated fetch to the munni API for the current user identity. */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  opts?: {
    /** #281: statuses a caller HANDLES as a designed branch (e.g. the
     *  /feeds 409 → personal-feed fallback) — expected, so not reported */
    expectStatuses?: readonly number[];
  },
): Promise<Response> {
  assertNetworkAllowed();
  const identity = readSessionIdentity();
  // Cold-start guard: every app update forces a cold start, and screens
  // fire their requests the moment they mount — BEFORE Logto finished
  // restoring the session. Those requests went out with no bearer, hit
  // 401 twice and the dead-session handler below logged the user out and
  // wiped a perfectly healthy refresh token (user: "I must log in after
  // every update"). Wait for the restore to finish first.
  if (identity?.kind === 'user' && !identity.testAuth) await waitForAuthReady();
  let sentBearer = false;
  const attempt = async (): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    // logged-in devices: every request names the calling device so the
    // server can stamp last-seen and enforce a remote disconnect
    headers.set('X-Munni-Device', getDeviceId());
    headers.set('X-Munni-Platform', devicePlatform());
    if (identity?.kind === 'user') {
      if (identity.testAuth) headers.set('X-User-Sub', identity.sub);
      else {
        const token = await getAccessToken();
        sentBearer = !!token;
        if (token) headers.set('Authorization', `Bearer ${token}`);
      }
    }
    return fetch(`${config.apiUrl}${path}`, { ...init, headers });
  };
  let response = await attempt();
  if (response.status === 410) {
    // remote disconnect (user ruling: disconnect = wipe): another device
    // revoked this one — data.tsx listens and erases this copy
    const body = await response.clone().json().catch(() => null);
    if ((body as { error?: string } | null)?.error === 'device-revoked') {
      globalThis.dispatchEvent(new CustomEvent('munni:device-revoked'));
    }
  }
  if (response.status === 401 && identity?.kind === 'user' && !identity.testAuth) {
    // maybe just an expired access token — the SDK mints a fresh one
    response = await attempt();
    // a 401 WITHOUT a bearer proves nothing about the refresh token —
    // only a rejected real token means the session is truly dead
    if (response.status === 401 && sentBearer && !handlingAuthExpiry) {
      // the refresh token is dead too (IdP restart, revocation): no
      // amount of retrying helps. Clear the session and return to the
      // login screen instead of sitting on "server unreachable" until a
      // manual sign-out (user report).
      handlingAuthExpiry = true;
      const { reportError } = await import('@/lib/report');
      reportError('auth', new Error('refresh token dead: forced re-login after double 401'));
      const { clearStaleLogtoState } = await import('@/lib/authState');
      clearStaleLogtoState('double-401'); // dead refresh token must not poison the next sign-in
      const { useSession } = await import('@/app/session');
      useSession.getState().logout();
      globalThis.location.assign('/#/login');
    }
  }
  // #186 (user rule): UNEXPECTED server answers reach GlitchTip from the
  // choke point — callers keep swallowing into UI state, but the trace
  // survives. Identity states (401/403/410) have their own handlers,
  // and plain 4xx are the caller's business; 5xx and 409 are the
  // "should not happen" band (the re-import 409 resolved itself and
  // left no trace anywhere).
  if ((response.status >= 500 || response.status === 409) && !opts?.expectStatuses?.includes(response.status)) {
    const { reportWarning } = await import('@/lib/report');
    reportWarning('api', `apiFetch ${init.method ?? 'GET'} ${path} -> ${response.status}`, { status: response.status });
  }
  return response;
}

export interface ApiCapabilities {
  gocardless: boolean;
  push?: boolean;
  vapidPublicKey?: string;
  /** logo.dev brand search proxy configured server-side */
  logos?: boolean;
}

let capabilities: ApiCapabilities | null = null;
let protocolIssue: ProtocolIssue | null = null;

/** test seam: the per-page-load cache must not leak between test cases */
export function resetApiCapabilitiesCache(): void {
  capabilities = null;
  protocolIssue = null;
}

/** the last /health handshake verdict — null while unknown or compatible */
export const getProtocolIssue = (): ProtocolIssue | null => protocolIssue;

/** Server feature flags from /health (cached per page load). */
export async function getApiCapabilities(): Promise<ApiCapabilities> {
  if (capabilities) return capabilities;
  const identity = readSessionIdentity();
  // offline identities get the "no server features" answer without a
  // network call — and without caching it, in case a user signs in later
  if (identity && identity.kind !== 'user') return { gocardless: false };
  try {
    const res = await fetch(`${config.apiUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as {
      capabilities?: ApiCapabilities;
      protocol?: number;
      minClientProtocol?: number;
    };
    protocolIssue = protocolIssueFor(body);
    capabilities = body.capabilities ?? { gocardless: false };
    return capabilities;
  } catch {
    // transient failure (booted offline, radio still asleep): answer "no
    // features" but do NOT cache it — the next caller gets a fresh try
    return { gocardless: false };
  }
}
