import { create } from 'zustand';
import { identityKey, readSessionIdentity, useSession } from '@/app/session';
import { isNativeApp, nativeBiometricAvailable, nativeBiometricVerify } from '@/lib/platform';

/**
 * App lock, scoped to the SIGNED-IN identity: WebAuthn platform
 * authenticator (fingerprint / face via the OS) with a hashed PIN
 * fallback, required again after a configurable period out of sight.
 * Signed out -> no lock: the gate protects a person's session, and it
 * must never brick the login screen for the next user of a shared
 * machine. The config survives sign-out, so the same person's lock
 * re-arms when they sign back in. This is a UI gate in front of the
 * app — IndexedDB itself is not encrypted (no PWA can do that), which
 * is the same trade-off banking PWAs make.
 */

export type BiometricKind = 'webauthn' | 'native';

export interface LockConfig {
  enabled: boolean;
  /** WebAuthn credential id (base64url), when biometrics are set up */
  credentialId?: string;
  /** which biometric path unlocks (native-benefits §1): 'native' = the
   * OS prompt via the Capacitor plugin (nothing to store), 'webauthn' =
   * the platform passkey in credentialId. Pre-§1 configs carry only
   * credentialId — resolved as 'webauthn' by effectiveBiometricKind. */
  biometricKind?: BiometricKind;
  pinSalt: string;
  pinHash: string;
  /** seconds hidden before the app locks again (0 = immediately) */
  timeoutSec: number;
  /** #315 (user): last moment this identity was seen unlocked (epoch ms).
   * Written on unlock and cheaply while unlocked, so a page refresh
   * within timeoutSec boots unlocked. Same trust domain as the config
   * itself (a UI gate, not crypto); missing/invalid/future -> locked. */
  lastActiveAt?: number;
}

/** the config's biometric path, resolving pre-§1 configs (credentialId only) */
export const effectiveBiometricKind = (config: Pick<LockConfig, 'credentialId' | 'biometricKind'>): BiometricKind | null => {
  if (config.biometricKind) return config.biometricKind;
  return config.credentialId ? 'webauthn' : null;
};

const LEGACY_KEY = 'munni_lock';
const keyForIdentity = (): string | null => {
  const identity = readSessionIdentity();
  return identity ? `munni_lock_${identityKey(identity)}` : null;
};

export function readLockConfig(): LockConfig | null {
  const key = keyForIdentity();
  if (!key) return null; // signed out — never locked
  try {
    // #298 (user): a pre-scoping DEVICE-global config belonged to
    // whoever set it — adopting it into the next identity handed a
    // deleted user's PIN to a fresh signup, gating their onboarding.
    // The lock is a per-identity fact; stale device relics just clear.
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LockConfig;
    return parsed.enabled && parsed.pinHash ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLockConfig(config: LockConfig | null): void {
  const key = keyForIdentity();
  if (!key) return; // lock settings only exist inside a session
  if (config) localStorage.setItem(key, JSON.stringify(config));
  else localStorage.removeItem(key);
}

// ── PIN hashing (SHA-256 with a random salt; local gate, not a vault) ──
const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const randomSalt = (): string => toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

export const validPin = (pin: string): boolean => /^\d{4,8}$/.test(pin);

// ── WebAuthn platform authenticator ────────────────────────────────────
const b64url = (buffer: ArrayBuffer) =>
  // '=' is base64 padding and only ever appears at the end
  btoa(String.fromCodePoint(...new Uint8Array(buffer))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const fromB64url = (value: string) =>
  Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.codePointAt(0)!);

export async function biometricAvailable(): Promise<boolean> {
  // native shell: WKWebView has no WebAuthn platform authenticator, so
  // availability means the OS biometric prompt (native-benefits §1)
  if (isNativeApp()) return nativeBiometricAvailable();
  try {
    return (
      typeof PublicKeyCredential !== 'undefined' &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

export interface BiometricRegistration {
  kind: BiometricKind;
  /** present only for 'webauthn' */
  credentialId?: string;
}

/** sets up the unlock factor: the OS prompt on native (nothing stored),
 * a device-bound passkey on web/PWA */
export async function registerBiometric(): Promise<BiometricRegistration | null> {
  if (isNativeApp()) {
    // prove the prompt actually works before promising it as the factor
    return (await nativeBiometricVerify('munni')) ? { kind: 'native' } : null;
  }
  const credentialId = await registerWebauthn();
  return credentialId ? { kind: 'webauthn', credentialId } : null;
}

/** creates a device-bound passkey used purely as an unlock factor */
async function registerWebauthn(): Promise<string | null> {
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'munni' },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'munni-lock',
          displayName: 'munni app lock',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    return credential ? b64url(credential.rawId) : null;
  } catch {
    return null; // user cancelled or unsupported — PIN remains the factor
  }
}

/** OS-level user verification along the config's biometric path.
 *  #202: the signal lets the PIN pad dismiss an in-flight passkey sheet
 *  the moment the user starts typing — they chose the other factor. */
export async function verifyBiometric(
  config: Pick<LockConfig, 'credentialId' | 'biometricKind'>,
  reason = 'munni',
  signal?: AbortSignal,
): Promise<boolean> {
  const kind = effectiveBiometricKind(config);
  if (kind === 'native') return nativeBiometricVerify(reason);
  if (kind !== 'webauthn' || !config.credentialId) return false;
  try {
    const assertion = await navigator.credentials.get({
      signal,
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64url(config.credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return assertion !== null;
  } catch {
    return false;
  }
}

// ── lock state ──────────────────────────────────────────────────────────
/** pure decision: should the app lock after `elapsedMs` out of sight? */
export const shouldLock = (config: LockConfig | null, elapsedMs: number): boolean =>
  config !== null && elapsedMs >= config.timeoutSec * 1000;

/** #315 (user): boot decision — a refresh within the configured timeout of
 * the persisted last-active stamp stays unlocked. Fail closed: a missing
 * or corrupted stamp, and a stamp from the future (the clock moved
 * backward), cannot prove recent activity. */
export const bootLocked = (config: LockConfig | null, now: number): boolean => {
  if (!config) return false; // no lock armed — nothing to gate
  const stamp = config.lastActiveAt;
  if (typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp > now) return true;
  return shouldLock(config, now - stamp);
};

/** refresh the last-active stamp — only an UNLOCKED page extends trust
 * (a refresh under the lock screen must come back locked) */
function touchLockStamp(): void {
  if (useLock.getState().locked) return;
  const config = readLockConfig();
  if (config) writeLockConfig({ ...config, lastActiveAt: Date.now() });
}

function clearLockStamp(): void {
  const config = readLockConfig();
  // JSON.stringify drops the explicit undefined — the stamp is gone
  if (config?.lastActiveAt !== undefined) writeLockConfig({ ...config, lastActiveAt: undefined });
}

interface LockState {
  locked: boolean;
  /** #202: the auto passkey prompt fires ONCE per lock cycle — remounts
   *  (the OS sheet backgrounding the page re-locks with timeout 0) used
   *  to re-prompt forever while the user was trying to type the PIN */
  promptSpent: boolean;
  lock: () => void;
  unlock: () => void;
  spendPrompt: () => void;
}

export const useLock = create<LockState>((set) => ({
  locked: bootLocked(readLockConfig(), Date.now()),
  promptSpent: false,
  lock: () => {
    set({ locked: true, promptSpent: false });
    clearLockStamp(); // #315: locking outlives any refresh
  },
  unlock: () => {
    set({ locked: false });
    touchLockStamp(); // #315: unlocking IS fresh activity
  },
  spendPrompt: () => set({ promptSpent: true }),
}));

/** low-frequency safety net for pages killed without a pagehide */
const STAMP_INTERVAL_MS = 30_000;

/** watches visibility and re-locks after the configured timeout */
export function initLockWatcher(): void {
  let hiddenAt: number | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      touchLockStamp(); // #315: going out of sight is the last active moment
    } else if (hiddenAt !== null) {
      if (shouldLock(readLockConfig(), Date.now() - hiddenAt)) useLock.getState().lock();
      else touchLockStamp();
      hiddenAt = null;
    }
  });

  // #315 (user): a refresh keeps its unlock only through the persisted
  // stamp — pagehide catches the reload itself, the slow tick covers
  // hard kills that never fire it. Any tab may stamp (shared storage).
  window.addEventListener('pagehide', touchLockStamp);
  setInterval(() => {
    if (document.visibilityState === 'visible') touchLockStamp();
  }, STAMP_INTERVAL_MS);

  // signing in or out is itself fresh verification — never keep a stale
  // lock across an identity change (logout must free a shared machine)
  let lastIdentity = useSession.getState().identity;
  useSession.subscribe((state) => {
    if (state.identity !== lastIdentity) {
      lastIdentity = state.identity;
      useLock.getState().unlock();
    }
  });
}
