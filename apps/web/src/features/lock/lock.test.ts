// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/app/session';
import {
  biometricAvailable,
  effectiveBiometricKind,
  hashPin,
  initLockWatcher,
  randomSalt,
  readLockConfig,
  registerBiometric,
  shouldLock,
  useLock,
  validPin,
  verifyBiometric,
  writeLockConfig,
} from './lock';
import type { LockConfig } from './lock';

const config = (overrides: Partial<LockConfig> = {}): LockConfig => ({
  enabled: true,
  pinSalt: 'salt',
  pinHash: 'hash',
  timeoutSec: 60,
  ...overrides,
});

const signIn = (kind: 'demo' | 'offline' = 'demo') =>
  useSession.getState().login(kind === 'demo' ? { kind: 'demo' } : { kind: 'offline', profileId: 'p1' });

describe('lock config + pin (identity-scoped)', () => {
  beforeEach(() => {
    localStorage.clear();
    useSession.getState().logout();
  });

  it('round-trips through localStorage and rejects broken payloads', () => {
    signIn();
    expect(readLockConfig()).toBeNull();
    writeLockConfig(config());
    expect(readLockConfig()?.timeoutSec).toBe(60);
    writeLockConfig(null);
    expect(readLockConfig()).toBeNull();
    localStorage.setItem('munni_lock_demo', 'not json');
    expect(readLockConfig()).toBeNull();
    localStorage.setItem('munni_lock_demo', JSON.stringify({ enabled: true })); // missing pinHash
    expect(readLockConfig()).toBeNull();
  });

  it('signed out there is no lock config to read or write', () => {
    writeLockConfig(config()); // must be a no-op
    expect(localStorage).toHaveLength(0);
    expect(readLockConfig()).toBeNull();
  });

  it('each identity keeps its own lock; sign-out hides it, re-sign-in restores it', () => {
    signIn('demo');
    writeLockConfig(config({ timeoutSec: 300 }));
    useSession.getState().logout();
    expect(readLockConfig()).toBeNull(); // shared machine: login stays reachable

    signIn('offline');
    expect(readLockConfig()).toBeNull(); // someone else's lock never applies

    useSession.getState().logout();
    signIn('demo');
    expect(readLockConfig()?.timeoutSec).toBe(300); // same person: lock re-arms
  });

  it('migrates a pre-scoping device-global config to the active identity', () => {
    localStorage.setItem('munni_lock', JSON.stringify(config({ timeoutSec: 900 })));
    signIn('demo');
    expect(readLockConfig()?.timeoutSec).toBe(900);
    expect(localStorage.getItem('munni_lock')).toBeNull();
    expect(localStorage.getItem('munni_lock_demo')).toBeTruthy();
  });

  it('validPin: 4-8 digits only', () => {
    expect(validPin('1234')).toBe(true);
    expect(validPin('12345678')).toBe(true);
    expect(validPin('123')).toBe(false);
    expect(validPin('123456789')).toBe(false);
    expect(validPin('12a4')).toBe(false);
  });

  it('hashPin is salted and deterministic', async () => {
    const salt = randomSalt();
    expect(salt).toHaveLength(32);
    const a = await hashPin('1234', salt);
    expect(a).toBe(await hashPin('1234', salt));
    expect(a).not.toBe(await hashPin('1234', randomSalt()));
    expect(a).not.toBe(await hashPin('4321', salt));
  });
});

describe('shouldLock', () => {
  it('locks only when enabled and the timeout elapsed', () => {
    expect(shouldLock(null, 999_999)).toBe(false);
    expect(shouldLock(config({ timeoutSec: 60 }), 59_000)).toBe(false);
    expect(shouldLock(config({ timeoutSec: 60 }), 60_000)).toBe(true);
    expect(shouldLock(config({ timeoutSec: 0 }), 0)).toBe(true); // immediately
  });
});

describe('useLock store', () => {
  it('lock/unlock toggle the gate', () => {
    useLock.setState({ locked: false });
    useLock.getState().lock();
    expect(useLock.getState().locked).toBe(true);
    useLock.getState().unlock();
    expect(useLock.getState().locked).toBe(false);
  });
});

describe('webauthn wrappers', () => {
  it('biometricAvailable is false where PublicKeyCredential is missing', async () => {
    expect(await biometricAvailable()).toBe(false);
  });

  it('registerBiometric returns the credential id as base64url; cancel/verify-failure degrade', async () => {
    const rawId = new Uint8Array([1, 2, 3, 250]).buffer;
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { create: vi.fn().mockResolvedValue({ rawId }), get: vi.fn().mockResolvedValue({}) },
    });
    const registration = await registerBiometric();
    expect(registration).toEqual({ kind: 'webauthn', credentialId: 'AQID-g' }); // base64url, unpadded
    expect(await verifyBiometric(registration!)).toBe(true);

    (navigator.credentials.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cancelled'));
    expect(await registerBiometric()).toBeNull();
    (navigator.credentials.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no'));
    expect(await verifyBiometric(registration!)).toBe(false);
  });

  it('the native shell path: register verifies once, verify uses the OS prompt (§1)', async () => {
    vi.stubGlobal('Capacitor', {
      isNativePlatform: () => true,
      Plugins: {
        NativeBiometric: {
          isAvailable: vi.fn().mockResolvedValue({ isAvailable: true }),
          verifyIdentity: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    try {
      expect(await registerBiometric()).toEqual({ kind: 'native' });
      expect(await verifyBiometric({ biometricKind: 'native' })).toBe(true);

      const plugins = (globalThis as unknown as { Capacitor: { Plugins: { NativeBiometric: { verifyIdentity: ReturnType<typeof vi.fn> } } } })
        .Capacitor.Plugins.NativeBiometric;
      plugins.verifyIdentity.mockRejectedValue(new Error('cancelled'));
      expect(await registerBiometric()).toBeNull(); // prompt must work before it becomes the factor
      expect(await verifyBiometric({ biometricKind: 'native' })).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('pre-§1 configs (credentialId only) still resolve to the webauthn path', () => {
    expect(effectiveBiometricKind({ credentialId: 'abc' })).toBe('webauthn');
    expect(effectiveBiometricKind({ biometricKind: 'native' })).toBe('native');
    expect(effectiveBiometricKind({})).toBeNull();
  });
});

describe('lock watcher', () => {
  it('re-locks after the timeout out of sight and unlocks on identity change', () => {
    localStorage.clear();
    useSession.getState().login({ kind: 'demo' });
    writeLockConfig(config({ timeoutSec: 0 }));
    useLock.setState({ locked: false });
    initLockWatcher();

    let visibility = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    document.dispatchEvent(new Event('visibilitychange')); // going hidden arms the timer
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange')); // returning past the timeout locks
    expect(useLock.getState().locked).toBe(true);

    // signing out (identity change) frees the shared machine
    useSession.getState().logout();
    expect(useLock.getState().locked).toBe(false);
  });
});
