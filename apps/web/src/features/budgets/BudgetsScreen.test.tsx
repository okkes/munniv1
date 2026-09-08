// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

async function createBudget(name: string, amount: string, catTestId = 'budget-cat-groceries') {
  fireEvent.click(await screen.findByTestId('budgets-add'));
  await screen.findByTestId('screen-budget-form');
  fireEvent.change(screen.getByTestId('budgetform-name'), { target: { value: name } });
  fireEvent.change(screen.getByTestId('budgetform-amount'), { target: { value: amount } });
  // anchored in the past so the detail's period nav has cycles to walk
  const past = new Date();
  past.setMonth(past.getMonth() - 3, 1);
  fireEvent.change(screen.getByTestId('budgetform-anchor'), {
    target: { value: `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-01` },
  });
  // mains start collapsed now (user request) — unfold before picking
  fireEvent.click(await screen.findByTestId('budgetform-fold-consumption'));
  fireEvent.click(await screen.findByTestId(catTestId));
  fireEvent.click(screen.getByTestId('budgetform-save'));
  await screen.findByTestId('screen-budgets');
}

describe('Budgets (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('creates a budget; the list card shows urgency-colored numbers', async () => {
    renderApp('/budgets');
    await screen.findByTestId('screen-budgets');
    await screen.findByTestId('budgets-empty');

    await createBudget('Food', '500');
    const card = await waitFor(() => {
      const el = document.querySelector('[data-testid^="budget-card-"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(card.textContent).toContain('Food');
    // the demo seed has groceries spending this month → spent shows money
    await waitFor(() => expect(card.textContent).toMatch(/€[1-9]/));
    expect(card.textContent).toMatch(/left|over/);
  }, 15_000);

  it('a category claimed by one budget is disabled with a badge in the next', async () => {
    renderApp('/budgets');
    await screen.findByTestId('screen-budgets');
    await createBudget('Food', '500');

    fireEvent.click(screen.getByTestId('budgets-add'));
    await screen.findByTestId('screen-budget-form');
    fireEvent.click(await screen.findByTestId('budgetform-fold-consumption'));
    const conflict = await screen.findByTestId('budget-cat-conflict-groceries');
    expect(conflict.textContent).toContain('Food');
    expect((screen.getByTestId('budget-cat-groceries') as HTMLButtonElement).disabled).toBe(true);
  }, 15_000);

  it('detail shows the cycle numbers, per-category rows, and past periods', async () => {
    renderApp('/budgets');
    await screen.findByTestId('screen-budgets');
    await createBudget('Food', '500');

    const card = await waitFor(() => {
      const el = document.querySelector('[data-testid^="budget-card-"]');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(card);
    await screen.findByTestId('budgetdetail-hero');
    await waitFor(() => expect(screen.getByTestId('budgetdetail-spent').textContent).toMatch(/€/));
    // the current cycle announces its remaining days (user request)
    expect(screen.getByTestId('budgetdetail-daysleft').textContent).toMatch(/\d+/);

    // category rows are FILTERS now (user request): tapping narrows the
    // payments list and tapping again clears
    const catRow = screen.getByTestId('budgetdetail-cat-groceries');
    fireEvent.click(catRow);
    await waitFor(() => expect(catRow.className).toContain('bg-accent-soft'));
    fireEvent.click(catRow);
    await waitFor(() => expect(catRow.className).not.toContain('bg-accent-soft'));

    // period nav walks backwards and returns
    const label = screen.getByTestId('budgetdetail-period').textContent;
    fireEvent.click(screen.getByTestId('budgetdetail-prev'));
    await waitFor(() => expect(screen.getByTestId('budgetdetail-period').textContent).not.toBe(label));
    fireEvent.click(screen.getByTestId('budgetdetail-next'));
    await waitFor(() => expect(screen.getByTestId('budgetdetail-period').textContent).toBe(label));

    // edit opens prefilled; delete needs a second tap and lands on the list
    fireEvent.click(screen.getByTestId('budgetdetail-edit'));
    await screen.findByTestId('screen-budget-form');
    await waitFor(() => expect((screen.getByTestId('budgetform-name') as HTMLInputElement).value).toBe('Food'));
    fireEvent.click(await screen.findByTestId('budgetform-delete'));
    fireEvent.click(screen.getByTestId('budgetform-delete'));
    await screen.findByTestId('screen-budgets');
    await waitFor(() => expect(document.querySelector('[data-testid^="budget-card-"]')).toBeNull());
  }, 15_000);

  it('the home block surfaces the budget and leads back to the list', async () => {
    renderApp('/budgets');
    await screen.findByTestId('screen-budgets');
    await createBudget('Food', '500');

    renderApp('/home');
    const block = await screen.findByTestId('home-budgets', {}, { timeout: 5000 });
    expect(block.textContent).toContain('Food');
    fireEvent.click(screen.getByTestId('home-budgets-all'));
    expect(await screen.findByTestId('screen-budgets')).toBeTruthy();
  }, 15_000);

  it('carry-over config saves and the settings row reaches the screen', async () => {
    renderApp('/settings');
    await screen.findByTestId('screen-settings');
    fireEvent.click(screen.getByTestId('settings-budgets-row'));
    await screen.findByTestId('screen-budgets');

    fireEvent.click(screen.getByTestId('budgets-add'));
    await screen.findByTestId('screen-budget-form');
    fireEvent.change(screen.getByTestId('budgetform-name'), { target: { value: 'Fun' } });
    fireEvent.change(screen.getByTestId('budgetform-amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('budgetform-every-week'));
    fireEvent.click(await screen.findByTestId('budget-cat-entertainment'));
    fireEvent.click(screen.getByTestId('budgetform-carry'));
    fireEvent.click(await screen.findByTestId('budgetform-carrymode-cap'));
    fireEvent.change(screen.getByTestId('budgetform-carrycap'), { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('budgetform-notify-90'));
    fireEvent.click(screen.getByTestId('budgetform-save'));
    await screen.findByTestId('screen-budgets');

    // reopen: the configuration round-trips
    const card = await waitFor(() => {
      const el = document.querySelector('[data-testid^="budget-card-"]');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId('budgetdetail-edit'));
    await screen.findByTestId('screen-budget-form');
    await waitFor(() => expect((screen.getByTestId('budgetform-name') as HTMLInputElement).value).toBe('Fun'));
    expect((screen.getByTestId('budgetform-carrycap') as HTMLInputElement).value).toBe('150.00');
    expect(screen.getByTestId('budgetform-notify-90').className).toContain('border-accent');
  }, 15_000);
});
