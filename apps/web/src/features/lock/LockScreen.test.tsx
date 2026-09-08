// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/harness';
import { useSession } from '@/app/session';
import { LockScreen } from './LockScreen';
import { hashPin, useLock, writeLockConfig } from './lock';

const tap = (...keys: string[]) => {
  for (const k of keys) fireEvent.click(screen.getByTestId(`lock-key-${k}`));
};

describe('LockScreen (PIN keypad — no platform authenticator in tests)', () => {
  beforeEach(async () => {
    localStorage.clear();
    useSession.getState().login({ kind: 'demo' }); // lock config is identity-scoped
    writeLockConfig({ enabled: true, pinSalt: 's', pinHash: await hashPin('1234', 's'), timeoutSec: 60 });
    useLock.setState({ locked: true, promptSpent: false });
  });

  it('typing the right PIN on the keypad unlocks without a confirm button', async () => {
    renderWithProviders(<LockScreen />);
    await screen.findByTestId('lock-dots');
    tap('1', '2', '3', '4');
    await waitFor(() => expect(useLock.getState().locked).toBe(false));
  });

  it('a wrong PIN errors only after the maximum length and clears the dots', async () => {
    renderWithProviders(<LockScreen />);
    await screen.findByTestId('lock-dots');
    tap('9', '9', '9', '9', '9', '9', '9', '9');
    expect(await screen.findByTestId('lock-pin-error')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('lock-dots').getAttribute('data-length')).toBe('0'));
    expect(useLock.getState().locked).toBe(true);
  });

  it('backspace removes a digit; a longer PIN also matches mid-entry', async () => {
    useSession.getState().login({ kind: 'demo' });
    writeLockConfig({ enabled: true, pinSalt: 's', pinHash: await hashPin('123456', 's'), timeoutSec: 60 });
    renderWithProviders(<LockScreen />);
    await screen.findByTestId('lock-dots');
    tap('1', '2', '9');
    fireEvent.click(screen.getByTestId('lock-key-back'));
    expect(screen.getByTestId('lock-dots').getAttribute('data-length')).toBe('2');
    tap('3', '4', '5', '6');
    await waitFor(() => expect(useLock.getState().locked).toBe(false));
  });

  it('no biometric key is rendered without a stored credential', async () => {
    renderWithProviders(<LockScreen />);
    await screen.findByTestId('lock-dots');
    expect(screen.queryByTestId('lock-unlock')).toBeNull();
  });

  it('#202: the passkey auto-prompt fires once per LOCK CYCLE — remounts stay quiet', async () => {
    writeLockConfig({
      enabled: true, pinSalt: 's', pinHash: await hashPin('1234', 's'), timeoutSec: 0,
      biometricKind: 'webauthn', credentialId: 'AAAA',
    });
    const get = vi.fn(async () => null); // user dismisses the sheet
    vi.stubGlobal('navigator', { ...navigator, credentials: { get } });
    try {
      renderWithProviders(<LockScreen />);
      await screen.findByTestId('lock-dots');
      await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

      // the OS sheet backgrounded the page → re-lock → REMOUNT: no re-prompt
      cleanup();
      renderWithProviders(<LockScreen />);
      await screen.findByTestId('lock-dots');
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(get).toHaveBeenCalledTimes(1);

      // the pad's own fingerprint key stays an EXPLICIT re-prompt
      fireEvent.click(screen.getByTestId('lock-unlock'));
      await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

      // the next lock cycle gets its fresh auto-prompt again
      useLock.setState({ locked: false });
      useLock.getState().lock();
      cleanup();
      renderWithProviders(<LockScreen />);
      await screen.findByTestId('lock-dots');
      await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('#202: typing the PIN dismisses the in-flight passkey sheet (abort)', async () => {
    writeLockConfig({
      enabled: true, pinSalt: 's', pinHash: await hashPin('1234', 's'), timeoutSec: 0,
      biometricKind: 'webauthn', credentialId: 'AAAA',
    });
    let seenSignal: AbortSignal | undefined;
    const get = vi.fn(async (options: { signal?: AbortSignal }) => {
      seenSignal = options.signal;
      return new Promise(() => undefined); // the OS sheet hangs open
    });
    vi.stubGlobal('navigator', { ...navigator, credentials: { get } });
    try {
      renderWithProviders(<LockScreen />);
      await screen.findByTestId('lock-dots');
      await waitFor(() => expect(seenSignal).toBeTruthy());
      expect(seenSignal!.aborted).toBe(false);
      tap('1');
      expect(seenSignal!.aborted).toBe(true);
      // …and the PIN still unlocks on its own
      tap('2', '3', '4');
      await waitFor(() => expect(useLock.getState().locked).toBe(false));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
