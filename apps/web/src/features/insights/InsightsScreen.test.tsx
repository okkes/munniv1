// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/harness';

/** a long-running debt makes the acceleration detector fire deterministically */
async function createBigDebt() {
  renderApp('/debts');
  await screen.findByTestId('screen-debts');
  // loans v2: the "+" opens the account chooser — the loan IS an account
  fireEvent.click(await screen.findByTestId('debts-add'));
  fireEvent.click(await screen.findByTestId('chooser-accttype-loan'));
  fireEvent.change(await screen.findByTestId('chooser-acctform-name'), { target: { value: 'Student loan' } });
  fireEvent.change(screen.getByTestId('chooser-acctform-balance'), { target: { value: '25000' } });
  fireEvent.change(screen.getByTestId('chooser-acctform-original'), { target: { value: '25000' } });
  fireEvent.change(screen.getByTestId('chooser-acctform-apr'), { target: { value: '8' } });
  fireEvent.change(screen.getByTestId('chooser-acctform-payment'), { target: { value: '300' } });
  fireEvent.click(screen.getByTestId('chooser-acctform-save'));
  await waitFor(() => expect(document.querySelector('[data-testid^="debt-card-"]')).toBeTruthy());
}

describe('Insights (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('a detector finding renders, expands with detail, and dismisses for good', async () => {
    await createBigDebt();

    cleanup();
    renderApp('/insights');
    await screen.findByTestId('screen-insights');
    const head = await waitFor(
      () => {
        const el = document.querySelector('[data-testid^="insight-head-debtacc"]');
        expect(el).toBeTruthy();
        return el!;
      },
      { timeout: 5000 },
    );
    expect(head.textContent).toContain('Student loan');

    fireEvent.click(head);
    const body = await waitFor(() => {
      const el = document.querySelector('[data-testid^="insight-body-"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(body.textContent).toMatch(/months earlier/);

    fireEvent.click(screen.getByTestId('insight-dismiss'));
    // synced dismissal: gone now, still gone on a fresh mount. Other
    // detectors (weekend spending) may legitimately fire depending on how
    // the demo seed's relative dates land on the calendar — only the
    // dismissed finding must stay away, not the whole screen.
    await waitFor(() => expect(document.querySelector('[data-testid^="insight-head-debtacc"]')).toBeNull());
    cleanup();
    renderApp('/insights');
    await screen.findByTestId('screen-insights');
    await waitFor(() => {
      const settled =
        screen.queryByTestId('insights-empty') ?? document.querySelector('[data-testid^="insight-head-"]');
      expect(settled).toBeTruthy();
    }, { timeout: 5000 });
    expect(document.querySelector('[data-testid^="insight-head-debtacc"]')).toBeNull();
  }, 20_000);

  it('the weekly digest notifies once and the marker holds it back after', async () => {
    const shown: string[] = [];
    vi.stubGlobal('Notification', { permission: 'granted' } as unknown as typeof Notification);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ showNotification: (title: string) => { shown.push(title); return Promise.resolve(); } }) },
    });

    await createBigDebt();
    cleanup();
    renderApp('/insights');
    await screen.findByTestId('screen-insights');
    await waitFor(() => expect(shown).toHaveLength(1), { timeout: 5000 });

    // same ISO week, fresh mount: quiet
    cleanup();
    renderApp('/insights');
    await screen.findByTestId('screen-insights');
    await waitFor(() => expect(document.querySelector('[data-testid^="insight-head-"]')).toBeTruthy(), { timeout: 5000 });
    expect(shown).toHaveLength(1);
  }, 20_000);

  it('the home block surfaces the top insight; the settings row reaches the screen', async () => {
    await createBigDebt();

    cleanup();
    renderApp('/home');
    // the TOP insight may be the calendar-dependent weekend detector
    // instead of the seeded debt — the block just has to surface one
    const block = await screen.findByTestId('home-insight', {}, { timeout: 5000 });
    expect(block.textContent?.length).toBeGreaterThan(0);
    fireEvent.click(block);
    await screen.findByTestId('screen-insights');
    // …and the debt finding is on the full screen either way
    await waitFor(() => expect(document.querySelector('[data-testid^="insight-head-debtacc"]')).toBeTruthy(), {
      timeout: 5000,
    });

    cleanup();
    renderApp('/settings');
    await screen.findByTestId('screen-settings');
    fireEvent.click(screen.getByTestId('settings-insights-row'));
    expect(await screen.findByTestId('screen-insights')).toBeTruthy();
  }, 20_000);
});
