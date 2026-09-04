// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/app/session';
import {
  biometricAvailable,
  bootLocked,
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

  it('#298: a pre-scoping device-global config is a dead relic — cleared, never adopted', () => {
    localStorage.setItem('munni_lock', JSON.stringify(config({ timeoutSec: 900 })));
    signIn('demo');
    // the fresh identity must NOT inherit the previous user's PIN
    expect(readLockConfig()).toBeNull();
    expect(localStorage.getItem('munni_lock')).toBeNull();
    expect(localStorage.getItem('munni_lock_demo')).toBeNull();
  })

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

describe('#315 bootLocked (a refresh keeps the unlock within the window)', () => {
  const T = 1_700_000_000_000;

  beforeEach(() => {
    localStorage.clear();
    useSession.getState().logout();
  });

  it('no armed lock -> never locked', () => {
    expect(bootLocked(null, T)).toBe(false);
  });

  it('stays unlocked inside the window, locks from the boundary on', () => {
    expect(bootLocked(config({ timeoutSec: 60, lastActiveAt: T - 59_000 }), T)).toBe(false);
    expect(bootLocked(config({ timeoutSec: 60, lastActiveAt: T - 60_000 }), T)).toBe(true);
    expect(bootLocked(config({ timeoutSec: 300, lastActiveAt: T - 299_000 }), T)).toBe(false);
  });

  it('fail-closed: missing stamp (pre-#315 config), NaN stamp, future stamp', () => {
    expect(bootLocked(config(), T)).toBe(true); // never seen unlocked -> today's behavior
    expect(bootLocked(config({ lastActiveAt: Number.NaN }), T)).toBe(true);
    expect(bootLocked(config({ lastActiveAt: T + 1 }), T)).toBe(true); // clock moved backward
  });

  it('timeout 0 ("immediately") locks every boot regardless of a fresh stamp', () => {
    expect(bootLocked(config({ timeoutSec: 0, lastActiveAt: T }), T)).toBe(true);
  });

  it('a corrupted non-number stamp in storage fails closed through the read path', () => {
    signIn();
    localStorage.setItem(
      'munni_lock_demo',
      JSON.stringify({ enabled: true, pinSalt: 's', pinHash: 'h', timeoutSec: 60, lastActiveAt: 'yesterday' }),
    );
    expect(bootLocked(readLockConfig(), T)).toBe(true);
  });
});

describe('#315 last-active stamp (store actions)', () => {
  beforeEach(() => {
    localStorage.clear();
    useSession.getState().logout();
    signIn();
  });

  it('unlock persists the stamp — the next boot inside the window skips the PIN', () => {
    writeLockConfig(config({ timeoutSec: 60 }));
    useLock.setState({ locked: true, promptSpent: false });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      useLock.getState().unlock();
    } finally {
      now.mockRestore();
    }
    expect(readLockConfig()?.lastActiveAt).toBe(1_000_000);
    expect(bootLocked(readLockConfig(), 1_000_000 + 59_000)).toBe(false); // the #315 refresh
    expect(bootLocked(readLockConfig(), 1_000_000 + 61_000)).toBe(true);
  });

  it('lock() clears the stamp — a refresh under the lock screen comes back locked', () => {
    writeLockConfig(config({ timeoutSec: 60, lastActiveAt: 1_000_000 }));
    useLock.setState({ locked: false, promptSpent: false });
    useLock.getState().lock();
    expect(readLockConfig()?.lastActiveAt).toBeUndefined();
    expect(localStorage.getItem('munni_lock_demo')).not.toContain('lastActiveAt');
    expect(bootLocked(readLockConfig(), 1_000_001)).toBe(true);
  });
});

describe('#315 activity stamping (watcher)', () => {
  const setVisibility = (v: 'visible' | 'hidden') =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });

  beforeEach(() => {
    localStorage.clear();
    useSession.getState().logout();
    signIn();
    writeLockConfig(config({ timeoutSec: 60 }));
  });

  it('pagehide stamps only while unlocked (a locked page never extends trust)', () => {
    initLockWatcher();
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    try {
      useLock.setState({ locked: true, promptSpent: false });
      window.dispatchEvent(new Event('pagehide'));
      expect(readLockConfig()?.lastActiveAt).toBeUndefined();

      useLock.setState({ locked: false });
      window.dispatchEvent(new Event('pagehide'));
    } finally {
      now.mockRestore();
    }
    expect(readLockConfig()?.lastActiveAt).toBe(2_000_000);
  });

  it('going hidden stamps the moment the page left sight', () => {
    useLock.setState({ locked: false, promptSpent: false });
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000_000);
    try {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      now.mockRestore();
      setVisibility('visible');
    }
    expect(readLockConfig()?.lastActiveAt).toBe(3_000_000);
  });

  it('the slow tick stamps while visible and unlocked (kill without pagehide)', () => {
    useLock.setState({ locked: false, promptSpent: false });
    setVisibility('visible');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(4_000_000);
      initLockWatcher(); // this registration owns the fake interval
      vi.advanceTimersByTime(30_000);
    } finally {
      vi.useRealTimers();
    }
    expect(readLockConfig()?.lastActiveAt).toBe(4_030_000);
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
