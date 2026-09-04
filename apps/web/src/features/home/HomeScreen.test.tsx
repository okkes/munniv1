// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

/**
 * The balance band's configurable meaning (user design 2026-08-01):
 * per-space mode + per-account say in the sum. Lean demo: checking
 * €3,420.55 + savings €8,150.00.
 */
describe('Home balance band (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('modes switch the meaning; account toggles bend the sum; all persisted per space', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    // default = net worth, the pre-config behavior
    await waitFor(() => expect(screen.getByTestId('home-total-balance').textContent).toContain('11,570.55'));
    expect(screen.getByTestId('band-mode-label').textContent).toContain('Net worth');

    fireEvent.click(screen.getByTestId('home-balance-band'));
    await screen.findByTestId('band-mode-row');

    // excluding the savings account bends the sum
    fireEvent.click(await screen.findByTestId('band-acct-demo_save'));
    await waitFor(() => expect(screen.getByTestId('home-total-balance').textContent).toContain('3,420.55'));

    // custom mode starts empty and counts only picked accounts
    fireEvent.click(screen.getByTestId('band-mode-custom'));
    await waitFor(() => expect(screen.getByTestId('band-mode-label').textContent).toContain('Picked accounts'));
    await waitFor(() => expect(screen.getByTestId('home-total-balance').textContent).toContain('0.00'));
    fireEvent.click(await screen.findByTestId('band-acct-demo_main'));
    await waitFor(() => expect(screen.getByTestId('home-total-balance').textContent).toContain('3,420.55'));

    // cash mode ignores the earlier net-worth exclusion list? No — the
    // exclusion list is shared by the sum modes, so savings stays out
    fireEvent.click(screen.getByTestId('band-mode-cash'));
    await waitFor(() => expect(screen.getByTestId('band-mode-label').textContent).toContain('Total cash'));
    await waitFor(() => expect(screen.getByTestId('home-total-balance').textContent).toContain('3,420.55'));
  }, 15_000);
});
