// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';
import { MunniDB } from '@/db/schema';
import { DexieBackend } from '@/db/backend';
import { Repo } from '@/db/repo';
import { HlcClock } from '@/sync/hlc';

/** loans v2: the Debts "+" opens the account chooser on the liability
 *  type grid — creating the loan ACCOUNT is creating the debt */
async function createLoan(name: string, current: string, apr?: string, payment?: string, original?: string) {
  fireEvent.click(await screen.findByTestId('debts-add'));
  fireEvent.click(await screen.findByTestId('chooser-accttype-loan'));
  fireEvent.change(await screen.findByTestId('chooser-acctform-name'), { target: { value: name } });
  fireEvent.change(screen.getByTestId('chooser-acctform-balance'), { target: { value: current } });
  if (original) fireEvent.change(screen.getByTestId('chooser-acctform-original'), { target: { value: original } });
  if (apr) fireEvent.change(screen.getByTestId('chooser-acctform-apr'), { target: { value: apr } });
  if (payment) fireEvent.change(screen.getByTestId('chooser-acctform-payment'), { target: { value: payment } });
  fireEvent.click(screen.getByTestId('chooser-acctform-save'));
  await waitFor(() => {
    expect(document.querySelector('[data-testid^="debt-card-"]')).toBeTruthy();
  });
  // creation auto-offers matching payments — close the (empty) sheet so
  // its candidate rows never shadow the test's own tx rows
  await screen.findByTestId('loanmatch-empty');
  fireEvent.keyDown(window, { key: 'Escape' });
  return document.querySelector('[data-testid^="debt-card-"]')!;
}

const demoRepo = (db: MunniDB) => new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });

describe('Debts (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('the Debts + mints a loan account carrying the whole story', async () => {
    renderApp('/debts');
    await screen.findByTestId('screen-debts');
    await screen.findByTestId('debts-empty');

    fireEvent.click(screen.getByTestId('debts-add'));
    // the grid is pre-filtered to liability types (v2)
    await screen.findByTestId('chooser-accttype-loan');
    expect(screen.queryByTestId('chooser-accttype-cash')).toBeNull();
    fireEvent.click(screen.getByTestId('chooser-accttype-loan'));
    fireEvent.change(await screen.findByTestId('chooser-acctform-name'), { target: { value: 'Student loan' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-original'), { target: { value: '12000' } });
    // save refuses until the CURRENT value anchors the loan
    expect((screen.getByTestId('chooser-acctform-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('chooser-acctform-balance'), { target: { value: '10000' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-iban'), { target: { value: 'NL77LOAN0000000077' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-apr'), { target: { value: '12' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-payment'), { target: { value: '120' } });
    // weekly cadence lives under Custom now (recurring-style mechanics,
    // user request 2026-08-01): the projection follows it
    fireEvent.click(screen.getByTestId('chooser-acctform-every-custom'));
    fireEvent.change(screen.getByTestId('chooser-acctform-every-unit'), { target: { value: 'week' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-note'), { target: { value: 'DUO, samen met Kim' } });
    fireEvent.click(screen.getByTestId('chooser-acctform-save'));

    const card = await waitFor(() => {
      const el = document.querySelector('[data-testid^="debt-card-"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(card.textContent).toContain('Student loan');
    expect(card.textContent).toMatch(/10.000/); // the balance is the remaining truth
    expect(card.textContent).toMatch(/of.*12.000/); // the optional original adds the story
    expect(card.textContent).toMatch(/week/);
    expect(card.textContent).toMatch(/free by/);

    // ONE object: the account row carries the debt story; no debt row
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const account = (await db.accounts.toArray()).find((a) => a.name === 'Student loan');
      expect(account).toMatchObject({
        type: 'loan',
        source: 'manual',
        balanceCents: -1_000_000,
        iban: 'NL77LOAN0000000077',
        originalCents: 1_200_000,
        interestPctYear: 12,
        paymentCents: 12_000,
        paymentEvery: 'week',
        note: 'DUO, samen met Kim',
      });
      expect(await db.debts.toArray()).toHaveLength(0);
    }, { timeout: 5000 });
    // weekly €120 ≈ €520/month on the overview (cadence-normalized)
    expect(screen.getByTestId('debts-overview').textContent).toMatch(/520/);
    db.close();
  }, 15_000);

  it('detail projects the payoff; the account editor round-trips; delete leaves cleanly', async () => {
    renderApp('/debts');
    await screen.findByTestId('screen-debts');
    const card = await createLoan('Student loan', '10000', '12', '500');

    fireEvent.click(card);
    await screen.findByTestId('debtdetail-hero');
    expect(screen.getByTestId('debtdetail-remaining').textContent).toMatch(/10.000/);
    expect(screen.getByTestId('debtdetail-projection').textContent).toMatch(/interest/);

    // edit opens the ACCOUNT editor prefilled (v2) and saves a faster payment
    fireEvent.click(screen.getByTestId('debtdetail-edit'));
    await waitFor(() => expect((screen.getByTestId('acctedit-name') as HTMLInputElement).value).toBe('Student loan'));
    expect((screen.getByTestId('acctedit-balance') as HTMLInputElement).value).toBe('10000.00');
    fireEvent.change(screen.getByTestId('acctedit-payment'), { target: { value: '1000' } });
    fireEvent.click(screen.getByTestId('acctedit-save'));
    // the write is the truth (the sheet lingers through its close animation)
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const account = (await db.accounts.toArray()).find((a) => a.name === 'Student loan');
      expect(account?.paymentCents).toBe(100_000);
    }, { timeout: 5000 });
    db.close();
    await waitFor(() => expect(screen.getByTestId('debtdetail-projection')).toBeTruthy());

    // delete (confirm sheet) — the orphaned detail hands back to the list
    fireEvent.click(screen.getByTestId('debtdetail-edit'));
    fireEvent.click(await screen.findByTestId('acctedit-delete'));
    fireEvent.click(await screen.findByTestId('acctedit-remove-confirm'));
    await screen.findByTestId('debts-empty');
  }, 15_000);

  it("the recurring form's Debt kind asks fullscreen first, then hands off prefilled", async () => {
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    fireEvent.click(await screen.findByTestId('recurring-add'));
    fireEvent.change(await screen.findByTestId('recform-name'), { target: { value: 'Car loan' } });
    fireEvent.change(screen.getByTestId('recform-amount'), { target: { value: '250' } });
    // the chip opens Mina's fullscreen ask (2026-07-29: the in-screen
    // note was hidden behind the auto-opened sheet) — Stay returns to
    // the untouched form, Continue performs the handoff
    fireEvent.click(screen.getByTestId('recform-kind-debt'));
    await screen.findByTestId('mina-debt-handoff');
    fireEvent.click(screen.getByTestId('mina-debt-handoff-stay'));
    await waitFor(() => expect(screen.queryByTestId('mina-debt-handoff')).toBeNull());
    expect((screen.getByTestId('recform-name') as HTMLInputElement).value).toBe('Car loan');

    fireEvent.click(screen.getByTestId('recform-kind-debt'));
    await screen.findByTestId('mina-debt-handoff');
    fireEvent.click(screen.getByTestId('mina-debt-handoff-continue'));
    // lands on debts with the CHOOSER open on the liability grid; picking
    // a type shows the form seeded from the recurring — its amount and
    // rhythm are the loan's PAYMENT plan (v2), never its original size
    await screen.findByTestId('screen-debts');
    fireEvent.click(await screen.findByTestId('chooser-accttype-loan'));
    await waitFor(() => expect((screen.getByTestId('chooser-acctform-name') as HTMLInputElement).value).toBe('Car loan'));
    expect((screen.getByTestId('chooser-acctform-payment') as HTMLInputElement).value).toBe('250.00');
  }, 15_000);

  it('the home block totals the debts; the settings row reaches debts', async () => {
    renderApp('/debts');
    await screen.findByTestId('screen-debts');
    await createLoan('Car loan', '5000', undefined, '250');

    cleanup();
    renderApp('/home');
    const block = await screen.findByTestId('home-debts', {}, { timeout: 5000 });
    expect(block.textContent).toMatch(/5.000/);
    fireEvent.click(block);
    await screen.findByTestId('screen-debts');

    cleanup();
    renderApp('/settings');
    await screen.findByTestId('screen-settings');
    fireEvent.click(screen.getByTestId('settings-debts-row'));
    await screen.findByTestId('screen-debts');
  }, 15_000);

  it('bare debt payments gather in the virtual card and assign to a loan', async () => {
    renderApp('/debts');
    await screen.findByTestId('screen-debts');
    const card = await createLoan('Car loan', '5000');
    // v2: the card id IS the loan account's id
    const accountId = card.getAttribute('data-testid')!.replace('debt-card-', '');

    // two counterparty-less debt payments (the arc-2 bare label)
    const db = new MunniDB('munni_demo');
    const repo = demoRepo(db);
    const base = { accountId: 'demo_main', currency: 'EUR', needsReview: 0 as const, txType: 'debtPayment' as const, catId: 'loanRepayment' };
    await repo.upsert('transaction', 'demo_space', 'bare1', { ...base, date: '2026-07-01', amountCents: -15_000, merchant: 'Aflossing' });
    await repo.upsert('transaction', 'demo_space', 'bare2', { ...base, date: '2026-07-15', amountCents: -15_000, merchant: 'Aflossing' });

    // the virtual card sums them — a computed bucket, not a stored debt
    const unassigned = await screen.findByTestId('debts-unassigned');
    expect(unassigned.textContent).toContain('Unassigned');
    await waitFor(() => expect(screen.getByTestId('debts-unassigned').textContent).toMatch(/300/), { timeout: 5000 });
    fireEvent.click(unassigned);
    await screen.findByTestId('debts-unassigned-list');
    fireEvent.click(await screen.findByTestId('tx-row-bare1'));
    await screen.findByTestId('debts-assign-options');
    fireEvent.click(screen.getByTestId(`debts-assign-${accountId}`));

    // the link files it under the loan; the bucket shrinks to the other row
    await waitFor(async () => {
      expect((await db.transactions.get('bare1'))?.linkedAccountId).toBe(accountId);
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('empty payment fields estimate from ≥3 payments; the add-payment door pre-stages the loan', async () => {
    renderApp('/debts');
    await screen.findByTestId('screen-debts');
    const card = await createLoan('Car loan', '5000');
    const accountId = card.getAttribute('data-testid')!.replace('debt-card-', '');

    const db = new MunniDB('munni_demo');
    const repo = demoRepo(db);
    const base = { accountId: 'demo_main', currency: 'EUR', needsReview: 0 as const, txType: 'debtPayment' as const, catId: 'loanRepayment', linkedAccountId: accountId };
    await repo.upsert('transaction', 'demo_space', 'pay1', { ...base, date: '2026-04-01', amountCents: -25_000, merchant: 'Termijn' });
    await repo.upsert('transaction', 'demo_space', 'pay2', { ...base, date: '2026-05-01', amountCents: -25_000, merchant: 'Termijn' });
    await repo.upsert('transaction', 'demo_space', 'pay3', { ...base, date: '2026-06-01', amountCents: -25_000, merchant: 'Termijn' });

    fireEvent.click(card);
    await screen.findByTestId('debtdetail-hero');
    // "estimated from payments": median amount + interval, never stored
    const estimate = await screen.findByTestId('debtdetail-estimate');
    expect(estimate.textContent).toMatch(/250/);
    expect(estimate.textContent).toMatch(/estimated from payments/);
    // the estimate also powers the projection despite empty explicit fields
    expect(screen.getByTestId('debtdetail-projection')).toBeTruthy();

    // the add-payment door opens the manual form staged onto this loan
    fireEvent.click(screen.getByTestId('debtdetail-add-payment'));
    await screen.findByTestId('txform-save');
    await waitFor(() => expect(screen.getByTestId('txform-kind').textContent).toContain('Debt Payment'));
    expect(screen.getByTestId('txform-counter').textContent).toContain('Car loan');
    expect((screen.getByTestId('txform-merchant') as HTMLInputElement).value).toBe('Car loan');
    db.close();
  }, 15_000);

  it('found-payments links history to the loan; pre-anchor rows count only on request', async () => {
    renderApp('/debts');
    await screen.findByTestId('screen-debts');
    const card = await createLoan('Car loan', '5000');
    const accountId = card.getAttribute('data-testid')!.replace('debt-card-', '');

    // a bare debt payment from YESTERDAY — before the loan's balance
    // date (typed in today), so linking must not move the number
    const db = new MunniDB('munni_demo');
    const repo = demoRepo(db);
    const y = new Date(Date.now() - 86_400_000);
    const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    await repo.upsert('transaction', 'demo_space', 'oldpay', {
      accountId: 'demo_main', date: yesterday, amountCents: -15_000, merchant: 'Aflossing',
      currency: 'EUR', needsReview: 0, txType: 'debtPayment', catId: 'loanRepayment',
    });

    fireEvent.click(card);
    await screen.findByTestId('debtdetail-hero');
    fireEvent.click(screen.getByTestId('debtdetail-find-payments'));
    // strong match (debt-payment label) arrives pre-checked, flagged old
    await screen.findByTestId('loanmatch-pick-oldpay');
    // the strong-match pre-check settles an effect tick after the row
    await waitFor(() => expect((screen.getByTestId('loanmatch-pick-oldpay') as HTMLInputElement).checked).toBe(true));
    expect(screen.getByTestId('loanmatch-count-oldpay')).toBeTruthy();
    fireEvent.click(screen.getByTestId('loanmatch-apply'));

    await waitFor(async () => {
      expect((await db.transactions.get('oldpay'))?.linkedAccountId).toBe(accountId);
    }, { timeout: 5000 });
    // linked but NOT counted: the typed balance already contained it
    expect((await db.accounts.get(accountId))?.balanceCents).toBe(-500_000);

    // the transaction detail offers the deliberate count-it-in, once
    cleanup();
    renderApp('/transactions/oldpay');
    fireEvent.click(await screen.findByTestId('tx-detail-loan-count', {}, { timeout: 5000 }));
    await waitFor(async () => {
      expect((await db.accounts.get(accountId))?.balanceCents).toBe(-485_000);
    }, { timeout: 5000 });
    expect((await db.transactions.get('oldpay'))?.loanCounted).toBe(1);
    db.close();
  }, 20_000);

  it('a paid-off loan archives from the detail; a card stops tracking instead', async () => {
    renderApp('/debts');
    await screen.findByTestId('screen-debts');
    const card = await createLoan('Car loan', '5000');
    fireEvent.click(card);
    await screen.findByTestId('debtdetail-hero');

    // the way out (v2): archiving keeps the history and the milestone
    fireEvent.click(screen.getByTestId('debtdetail-archive'));
    await waitFor(() => expect(screen.getByTestId('debtdetail-archive').textContent).toContain('Reopen'));
    // archived loans trail the list dimmed instead of disappearing
    cleanup();
    renderApp('/debts');
    const archived = await waitFor(() => {
      const el = document.querySelector('[data-testid^="debt-card-"]');
      expect(el).toBeTruthy();
      return el!;
    }, { timeout: 5000 });
    expect(archived.className).toContain('opacity-60');
  }, 15_000);
});
