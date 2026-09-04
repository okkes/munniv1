// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_TEST_DB, renderAppAsUser } from '@/test/harness';
import { getDeviceId } from '@/db/device';

const otherDevice = {
  id: 'phone-abc',
  platform: 'android',
  name: null,
  createdAt: '2026-07-01T10:00:00Z',
  lastSeenAt: '2026-07-24T10:00:00Z',
  revoked: false,
};

describe('DevicesScreen (logged-in devices)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  it('lists devices, marks this one, renames, and offers disconnect only for others', async () => {
    const renames: unknown[] = [];
    renderAppAsUser('/devices', {
      api: {
        'GET /me/devices': () => [
          { ...otherDevice, id: getDeviceId(), platform: 'web' },
          otherDevice,
        ],
        [`PATCH /me/devices/${otherDevice.id}`]: (body) => {
          renames.push(body);
          return {};
        },
      },
    });

    await screen.findByTestId('screen-devices', {}, { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId(`device-row-${otherDevice.id}`)).toBeTruthy(), { timeout: 5000 });

    // my own row wears the chip and has NO disconnect button
    expect(screen.getByTestId('device-this')).toBeTruthy();
    expect(screen.queryByTestId(`device-revoke-${getDeviceId()}`)).toBeNull();
    // the Android phone can be disconnected
    expect(screen.getByTestId(`device-revoke-${otherDevice.id}`)).toBeTruthy();

    // rename the phone (auto-derived names are editable — user ruling)
    fireEvent.click(screen.getByTestId(`device-rename-${otherDevice.id}`));
    const input = (await screen.findByTestId('device-name-input', {}, { timeout: 5000 })) as HTMLInputElement;
    expect(input.value).toBe('Android app'); // auto-derived label prefilled
    fireEvent.change(input, { target: { value: 'Okkes phone' } });
    fireEvent.click(screen.getByTestId('device-name-save'));
    await waitFor(() => expect(renames).toEqual([{ name: 'Okkes phone' }]), { timeout: 5000 });

    // disconnect asks the two-step danger confirm first
    fireEvent.click(screen.getByTestId(`device-revoke-${otherDevice.id}`));
    await screen.findByTestId('device-revoke-confirm-body', {}, { timeout: 5000 });
  }, 20_000);

  it('numbers same-label twins by age and names this browser (#158)', async () => {
    // deterministic UA — happy-dom's default names no real browser
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    renderAppAsUser('/devices', {
      api: {
        'GET /me/devices': () => [
          // two unnamed web devices → same base label "Browser"
          { ...otherDevice, id: 'older-web', platform: 'web', createdAt: '2026-06-01T10:00:00Z' },
          { ...otherDevice, id: getDeviceId(), platform: 'web', createdAt: '2026-07-05T10:00:00Z' },
        ],
      },
    });

    await screen.findByTestId('screen-devices', {}, { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId('device-row-older-web')).toBeTruthy(), { timeout: 5000 });

    // the oldest keeps the bare label; the newer twin wears " (2)"
    expect(screen.getByTestId('device-row-older-web').textContent).not.toContain('(2)');
    expect(screen.getByTestId(`device-row-${getDeviceId()}`).textContent).toContain('Browser (2)');
    // only this device knows its own browser (server keeps no UA)
    expect(screen.getByTestId('device-browser').textContent).toContain('Chrome');
    expect(screen.getByTestId('device-browser').closest(`[data-testid="device-row-${getDeviceId()}"]`)).toBeTruthy();
  }, 20_000);
});
