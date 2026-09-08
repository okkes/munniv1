// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
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
    useLock.setState({ locked: true });
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
});
