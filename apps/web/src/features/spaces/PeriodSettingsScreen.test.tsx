// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

/** the budget period as its own settings screen (extracted from space
 *  settings) — reached from the Settings tab, applying immediately */
describe('PeriodSettingsScreen (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  const openFromSettings = async () => {
    renderApp('/settings');
    fireEvent.click(await screen.findByTestId('settings-period-row'));
    await screen.findByTestId('screen-period-settings');
  };

  it('opens from the Settings tab and switches to a bi-weekly period starting Wednesday', async () => {
    await openFromSettings();
    // the form renders only once the space row loaded (fast-tap guard)
    fireEvent.click(await screen.findByTestId('space-period-biweekly', {}, { timeout: 5000 }));
    expect(screen.getByTestId('period-explain')).toBeTruthy();
    // weekly/bi-weekly periods pick a START WEEKDAY instead (legacy
    // parity) — rendered once the live query reflects the persisted type
    expect(await screen.findByTestId('space-weekday-3', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('space-period-day')).toBeNull();
    fireEvent.click(screen.getByTestId('space-weekday-3'));

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(
      async () => {
        const space = (await db.spaces.toArray()).find((s) => s.deleted === 0);
        expect(space?.periodType).toBe('biweekly');
        expect(space?.periodDay).toBe(3); // Wednesday
      },
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('monthly start day is free while typing and clamps + persists on blur', async () => {
    await openFromSettings();
    const day = await screen.findByTestId('space-period-day');
    fireEvent.change(day, { target: { value: '40' } });
    expect((day as HTMLInputElement).value).toBe('40'); // free while typing (deletable '1')
    fireEvent.blur(day);
    // there is no save button: blur clamps and persists in one step
    await waitFor(() => expect((day as HTMLInputElement).value).toBe('28'));

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(
      async () => {
        const space = (await db.spaces.toArray()).find((s) => s.deleted === 0);
        expect(space?.periodType).toBe('month');
        expect(space?.periodDay).toBe(28);
      },
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);
});
