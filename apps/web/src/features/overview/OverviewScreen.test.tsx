// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_TXS } from '@/db/demo-data';
import { isoDaysAgo } from '@/db/seed';
import { inPeriod, periodHistory } from '@/domain/periods';
import { renderApp } from '@/test/harness';

// /€[1-9]/ (not /€\d/) so the assertion cannot pass on the €0.00 that
// renders before the live query has delivered the seeded transactions
describe('Overview (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('home shows the four period tiles with money values', async () => {
    renderApp('/home');
    await screen.findByTestId('home-overview-expense');
    // the demo seed guarantees a purchase inside the current period (dm102, daysAgo 0)
    await waitFor(() => expect(screen.getByTestId('home-overview-expense').textContent).toMatch(/€[1-9]/));
    expect(screen.getByTestId('home-overview-income')).toBeTruthy();
    expect(screen.getByTestId('home-overview-saving')).toBeTruthy();
    expect(screen.getByTestId('home-overview-investment')).toBeTruthy();
  });

  it('tapping a tile opens the drill-down with total, chart and category groups', async () => {
    renderApp('/home');
    await screen.findByTestId('home-overview-expense');
    fireEvent.click(screen.getByTestId('home-overview-expense'));

    await screen.findByTestId('screen-overview');
    await waitFor(() => expect(screen.getByTestId('overview-total').textContent).toMatch(/€[1-9]/));
    expect(screen.getByTestId('overview-barchart')).toBeTruthy();
    expect(screen.getByTestId('overview-stackedbar')).toBeTruthy();

    // main categories render; expanding one reveals its sub categories
    const group = await waitFor(() => {
      const el = document.querySelector('[data-testid^="overview-group-"]');
      expect(el).toBeTruthy();
      return el!;
    });
    const catId = group.getAttribute('data-testid')!.replace('overview-group-', '');
    fireEvent.click(group);
    expect(await screen.findByTestId(`overview-subs-${catId}`)).toBeTruthy();
    expect(document.querySelectorAll(`[data-testid="overview-subs-${catId}"] .m-num`).length).toBeGreaterThan(0);
  });

  it('category rows open the in-context drill with total, bars and payments', async () => {
    renderApp('/overview/expense');
    await screen.findByTestId('screen-overview');
    await waitFor(() => expect(screen.getByTestId('overview-total').textContent).toMatch(/€[1-9]/));

    const group = await waitFor(() => {
      const el = document.querySelector('[data-testid^="overview-group-"]');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(group); // unfold
    const all = await waitFor(() => {
      const el = document.querySelector('[data-testid^="overview-all-"]');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(all);

    // stays inside the analysis: the category's own screen, not the tab
    await screen.findByTestId('screen-category-drill');
    await waitFor(() => expect(screen.getByTestId('catdrill-total').textContent).toMatch(/€[1-9]/));
    expect(screen.getByTestId('overview-barchart')).toBeTruthy();
    const list = await screen.findByTestId('catdrill-list');
    expect(list.querySelectorAll('[data-testid^="tx-row-"]').length).toBeGreaterThan(0);

    // #168 r5 (user): a payment row goes STRAIGHT to the transaction
    // page — the in-between peek sheet is retired
    fireEvent.click(list.querySelector('[data-testid^="tx-row-"]')!);
    expect(await screen.findByTestId('screen-tx-detail')).toBeTruthy();
    expect(screen.queryByTestId('tx-peek')).toBeNull();
  });

  it('the drill period selector swaps the list to the chosen period', async () => {
    renderApp('/overview/expense/groceries');
    await screen.findByTestId('screen-category-drill');
    await waitFor(() => expect(screen.getByTestId('catdrill-total').textContent).toMatch(/€/));
    const label = screen.getByTestId('catdrill-period').textContent;

    fireEvent.click(screen.getByTestId('overview-bar-0')); // oldest period
    await waitFor(() => expect(screen.getByTestId('catdrill-period').textContent).not.toBe(label));
  });

  it('selecting an older period updates the total', async () => {
    renderApp('/overview/expense');
    await screen.findByTestId('screen-overview');
    await waitFor(() => expect(screen.getByTestId('overview-total').textContent).toMatch(/€[1-9]/));
    const current = screen.getByTestId('overview-total').textContent;

    fireEvent.click(screen.getByTestId('overview-bar-0')); // oldest period
    await waitFor(() => expect(screen.getByTestId('overview-total').textContent).not.toBe(current));
  });

  it('saving uses the checking-side sign mechanic (deposits count positive)', async () => {
    // compute, from the seed itself, a period bar that holds a saving deposit —
    // never fireEvent inside waitFor: the clicks mutate the DOM, which re-runs
    // the callback forever and starves waitFor's own timeout (real hang we had)
    const periods = periodHistory('month', 1, 6);
    const depositDate = DEMO_TXS.filter((tx) => tx.cat === 'savingDeposit')
      .map((tx) => isoDaysAgo(tx.daysAgo))
      .find((date) => periods.some((p) => inPeriod(date, p)));
    expect(depositDate).toBeTruthy(); // the seed always has a deposit in range
    const barIndex = periods.findIndex((p) => inPeriod(depositDate!, p));

    renderApp('/overview/saving');
    await screen.findByTestId('screen-overview');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="overview-bar-"]')).toHaveLength(6);
    });

    fireEvent.click(screen.getByTestId(`overview-bar-${barIndex}`));
    // demo savingDeposit rows are negative on the checking account ->
    // shown as a positive amount saved once the live query has delivered
    await waitFor(() => expect(screen.getByTestId('overview-total').textContent).toMatch(/€[1-9]/));
    expect(screen.getByTestId('overview-total').textContent).not.toContain('-');
  });
});
