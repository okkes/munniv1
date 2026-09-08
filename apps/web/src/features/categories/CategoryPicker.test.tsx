// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

describe('CategoryPicker direction filtering (via add-transaction form)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('an expense hides credit-only categories', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    fireEvent.click(screen.getByTestId('tx-add'));
    // the account field replaced the chips (2026-07-31): the CategoryPicker
    // direction only needs AN account — pick the main one through the sheet
    fireEvent.click(await screen.findByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));

    // expense (debit): the custom Padel main's Other sub (direction both)
    // is offered once the catalog's live query delivers the custom rows…
    fireEvent.click(screen.getByTestId('txform-category'));
    fireEvent.click(await screen.findByTestId('split-cat-0'));
    await screen.findByTestId('catpicker-groceries');
    await screen.findByTestId('catpicker-demo_cat_padel_other');
    // …while the demo credit-only sub "Side gig" is hidden
    expect(screen.queryByTestId('catpicker-demo_cat_sidegig')).toBeNull();
  }, 15_000);

  it('income shows credit-only categories and hides debit-only ones', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    fireEvent.click(screen.getByTestId('tx-add'));
    // the account field replaced the chips (2026-07-31): the CategoryPicker
    // direction only needs AN account — pick the main one through the sheet
    fireEvent.click(await screen.findByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
    // toggle BEFORE opening the editor: a fresh stack per direction
    fireEvent.click(screen.getByTestId('txform-income'));
    fireEvent.click(screen.getByTestId('txform-category'));
    fireEvent.click(await screen.findByTestId('split-cat-0'));
    await screen.findByTestId('catpicker-demo_cat_sidegig');
    expect(screen.queryByTestId('catpicker-savingDeposit')).toBeNull(); // builtin debit-only
  }, 15_000);

  it('a dead-end search offers creating a custom category (user request)', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    fireEvent.click(screen.getByTestId('tx-add'));
    // the account field replaced the chips (2026-07-31): the CategoryPicker
    // direction only needs AN account — pick the main one through the sheet
    fireEvent.click(await screen.findByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
    fireEvent.click(screen.getByTestId('txform-category'));
    fireEvent.click(await screen.findByTestId('split-cat-0'));
    await screen.findByTestId('catpicker-groceries');

    // the create door is always at the list's end…
    expect(screen.getByTestId('catpicker-create-custom')).toBeTruthy();
    // …and a no-result search says so explicitly
    fireEvent.change(screen.getByTestId('catpicker-search'), { target: { value: 'zzz-no-such-cat' } });
    expect(await screen.findByTestId('catpicker-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('catpicker-create-custom'));
    expect(await screen.findByTestId('screen-manage-cats')).toBeTruthy();
  }, 15_000);

  it('tobacco and alcohol are separate consumption categories', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    fireEvent.click(screen.getByTestId('tx-add'));
    // the account field replaced the chips (2026-07-31): the CategoryPicker
    // direction only needs AN account — pick the main one through the sheet
    fireEvent.click(await screen.findByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
    fireEvent.click(screen.getByTestId('txform-category'));
    fireEvent.click(await screen.findByTestId('split-cat-0'));
    await screen.findByTestId('catpicker-alcohol');
    expect(screen.getByTestId('catpicker-tobacco')).toBeTruthy();
    // the expected-reimbursement expense left its hidden parent and is pickable
    expect(screen.getByTestId('catpicker-expenseReimburse')).toBeTruthy();
  });
});
