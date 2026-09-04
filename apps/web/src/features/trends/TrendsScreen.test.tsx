// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

describe('TrendsScreen (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('settings reaches trends; all three views render charts from demo data', async () => {
    renderApp('/settings');
    await screen.findByTestId('screen-settings');
    fireEvent.click(screen.getByTestId('settings-trends-row'));
    await screen.findByTestId('screen-trends');

    // categories view: bars exist and the current period shows a number
    await screen.findByTestId('trends-cat-chart');
    expect(screen.getByTestId('trends-cat-current').textContent).toMatch(/€/);

    // narrowing to a main uses the picker (per-space hidden mains apply)
    fireEvent.click(screen.getByTestId('trends-cat-picker'));
    fireEvent.click(await screen.findByTestId('trends-cat-consumption'));
    await waitFor(() => expect(screen.getByTestId('trends-cat-picker').textContent).toContain('Consumption'));

    fireEvent.click(screen.getByTestId('trends-view-cashflow'));
    await screen.findByTestId('trends-flow-chart');
    expect(screen.getByTestId('trends-flow-net').textContent).toMatch(/€/);

    fireEvent.click(screen.getByTestId('trends-view-networth'));
    await screen.findByTestId('trends-worth-chart');
    // the line ends at the sum of today's balances (LEAN demo — the rich
    // seed with its v2 loan accounts is e2e-only; the specs pin 8,080.55)
    expect(screen.getByTestId('trends-worth-now').textContent).toContain('11,570.55');
  }, 15_000);

  it('the opt-in net-worth home block appears via Customize Home', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    expect(screen.queryByTestId('home-networth')).toBeNull(); // hidden by default

    // customize lives on its own screen now (user request) — toggle
    // there, then back to Home for the payoff
    fireEvent.click(screen.getByTestId('home-customize'));
    await screen.findByTestId('home-customize-list');
    fireEvent.click(screen.getByTestId('home-block-toggle-networth'));
    fireEvent.click(screen.getByTestId('tab-home'));
    const block = await screen.findByTestId('home-networth', {}, { timeout: 5000 });
    expect(block.textContent).toContain('11,570.55');
  }, 15_000);
});
