// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

async function createGoal(name: string, target: string) {
  fireEvent.click(await screen.findByTestId('goals-add'));
  await screen.findByTestId('goalform-name');
  fireEvent.change(screen.getByTestId('goalform-name'), { target: { value: name } });
  fireEvent.change(screen.getByTestId('goalform-target'), { target: { value: target } });
  fireEvent.click(screen.getByTestId('goalform-save'));
  await waitFor(() => {
    expect(document.querySelector('[data-testid^="goal-card-"]')).toBeTruthy();
  });
  return document.querySelector('[data-testid^="goal-card-"]')!;
}

// the sheet's close animation never finishes in happy-dom, so completion
// is observed on the numbers, not on the sheet unmounting
async function fund(kind: 'goaldetail-fund' | 'goaldetail-withdraw', amount: string, expected: RegExp) {
  fireEvent.click(screen.getByTestId(kind));
  const input = await screen.findByTestId('goalfund-amount');
  fireEvent.change(input, { target: { value: amount } });
  fireEvent.click(screen.getByTestId('goalfund-save'));
  // the input resets in the same batch as the sheet close — once it's
  // empty, the stale close can no longer race the next open
  await waitFor(() => expect((screen.getByTestId('goalfund-amount') as HTMLInputElement).value).toBe(''));
  await waitFor(() => expect(screen.getByTestId('goaldetail-allocated').textContent).toMatch(expected), { timeout: 5000 });
}

describe('Goals (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('creates a goal; the header shows the savings honesty numbers', async () => {
    renderApp('/goals');
    await screen.findByTestId('screen-goals');
    await screen.findByTestId('goals-empty');

    // the form offers the goal-themed covers, not the event scenes
    fireEvent.click(await screen.findByTestId('goals-add'));
    await screen.findByTestId('goalform-pic-house');
    expect(screen.queryByTestId('goalform-pic-beach')).toBeNull();

    const card = await createGoal('New car', '1000');
    expect(card.textContent).toContain('New car');
    // demo savings account holds €8,150 — saved and unallocated show it
    const overview = screen.getByTestId('goals-overview');
    await waitFor(() => expect(overview.textContent).toMatch(/8.150/));
    expect(screen.queryByTestId('goals-negative-note')).toBeNull();
  }, 15_000);

  it('funding and withdrawing move the allocation and write history', async () => {
    renderApp('/goals');
    await screen.findByTestId('screen-goals');
    const card = await createGoal('Bike', '500');

    fireEvent.click(card);
    await screen.findByTestId('goaldetail-hero');
    await fund('goaldetail-fund', '100', /€100[.,]00/);
    await fund('goaldetail-withdraw', '40', /€60[.,]00/);

    const history = screen.getByTestId('goaldetail-history');
    expect(history.textContent).toContain('+€100.00');
    expect(history.textContent).toMatch(/-€40[.,]00/);
  }, 15_000);

  it('allocating more than the savings balance flags the rebalance note', async () => {
    renderApp('/goals');
    await screen.findByTestId('screen-goals');
    const card = await createGoal('House', '20000');

    fireEvent.click(card);
    await screen.findByTestId('goaldetail-hero');
    // €9,000 into €8,150 of savings → unallocated −€850 (user must fix it)
    await fund('goaldetail-fund', '9000', /€9[.,]000[.,]00/);

    cleanup();
    renderApp('/goals');
    const note = await screen.findByTestId('goals-negative-note', {}, { timeout: 5000 });
    expect(note.textContent).toMatch(/850/);
  }, 15_000);

  it('the home block surfaces progress; the settings row reaches goals', async () => {
    renderApp('/goals');
    await screen.findByTestId('screen-goals');
    await createGoal('New car', '1000');

    cleanup();
    renderApp('/home');
    const block = await screen.findByTestId('home-goals', {}, { timeout: 5000 });
    expect(block.textContent).toContain('New car');
    fireEvent.click(screen.getByTestId('home-goals-all'));
    await screen.findByTestId('screen-goals');

    cleanup();
    renderApp('/settings');
    await screen.findByTestId('screen-settings');
    fireEvent.click(screen.getByTestId('settings-goals-row'));
    await screen.findByTestId('screen-goals');
  }, 15_000);
});
