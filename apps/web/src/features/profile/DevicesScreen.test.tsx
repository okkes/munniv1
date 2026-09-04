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
});
