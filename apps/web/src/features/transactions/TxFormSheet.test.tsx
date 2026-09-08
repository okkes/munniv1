// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

const openForm = async () => {
  renderApp('/transactions');
  await screen.findByTestId('tx-list');
  fireEvent.click(screen.getByTestId('tx-add'));
  await screen.findByTestId('txform-save');
  // two demo manual accounts → nothing pre-selects (user redesign
  // 2026-07-31): pick the main one through the account field + sheet
  fireEvent.click(await screen.findByTestId('txform-account'));
  fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
};

describe('TxFormSheet (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('save stays disabled until amount and merchant are valid', async () => {
    await openForm();
    const save = screen.getByTestId('txform-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Bakker' } });
    expect(save.disabled).toBe(true); // still no amount

    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '0' } });
    expect(save.disabled).toBe(true); // zero is not a transaction

    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '4,50' } });
    await waitFor(() => expect(save.disabled).toBe(false));
  });

  it('adds an expense with a picked category and shows it in the list', async () => {
    await openForm();
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '12,34' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Bakker Bart' } });

    // the category row opens the UNIFIED editor (same as review) —
    // pick through its per-row picker, Done stages the single category
    fireEvent.click(screen.getByTestId('txform-category'));
    fireEvent.click(await screen.findByTestId('split-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-groceries'));
    fireEvent.click(await screen.findByTestId('split-save'));
    await waitFor(() => expect(screen.getByTestId('txform-category').textContent).toContain('Grocery'));

    fireEvent.click(screen.getByTestId('txform-save'));
    // generous timeout: coverage instrumentation slows the liveQuery round-trip
    await waitFor(
      () => {
        const row = [...screen.getByTestId('tx-list').querySelectorAll('[data-testid^="tx-row-"]')].find((r) =>
          r.textContent?.includes('Bakker Bart'),
        );
        expect(row).toBeTruthy();
        expect(row!.textContent).toContain('-€12.34');
        expect(row!.textContent).toContain('Grocery');
      },
      { timeout: 5000 },
    );
    // coverage instrumentation pushes this flow past vitest's 5s default
  }, 15_000);

  it('no manual account: the form explains itself and doors to accounts', async () => {
    const { renderAppAsUser, USER_TEST_DB } = await import('@/test/harness');
    indexedDB.deleteDatabase(USER_TEST_DB);
    // a user space with ZERO writable accounts (no seed)
    renderAppAsUser('/transactions', { spaces: [{ id: 's-user', name: 'Personal' }] });
    await screen.findByTestId('tx-list');
    fireEvent.click(screen.getByTestId('tx-add'));
    // the empty state replaces the form and the CTA lands on accounts
    expect(await screen.findByTestId('txform-no-accounts')).toBeTruthy();
    fireEvent.click(screen.getByTestId('txform-add-account'));
    expect(await screen.findByTestId('screen-accounts')).toBeTruthy();
  }, 15_000);

  it('a manual expense adjusts the account balance live (user bug: it froze)', async () => {
    await openForm();
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    const before = (await db.accounts.get('demo_main'))!.balanceCents;

    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '50,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Markt' } });
    fireEvent.click(screen.getByTestId('txform-save'));

    await waitFor(async () => {
      expect((await db.accounts.get('demo_main'))!.balanceCents).toBe(before - 5000);
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('a transfer kind demands its counterparty; the counterparty derives the type', async () => {
    await openForm();
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '25,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Naar spaarpot' } });

    // the kind row sits on the form (user simplification); picking
    // Transfer opens the mandatory counterparty picker right away
    fireEvent.click(screen.getByTestId('txform-kind'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-transfer'));
    await screen.findByTestId('counter-accounts');
    // save is blocked while the counterparty is missing
    expect((screen.getByTestId('txform-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('counter-pick-demo_save'));
    // the savings counterparty derives Saving on the kind row
    await waitFor(() => expect(screen.getByTestId('txform-kind').textContent).toContain('Saving'));
    expect(screen.getByTestId('txform-counter').textContent).toContain('Demo Savings');
    expect((screen.getByTestId('txform-save') as HTMLButtonElement).disabled).toBe(false);

    // back to Standard: the counterparty row leaves with the kind
    fireEvent.click(screen.getByTestId('txform-kind'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-standard'));
    await waitFor(() => expect(screen.queryByTestId('txform-counter')).toBeNull());

    // adjustment saves as a correction row (manual-only third kind)
    fireEvent.click(screen.getByTestId('txform-kind'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-adjustment'));
    await waitFor(() => expect(screen.getByTestId('txform-kind').textContent).toContain('Adjustment'));
    fireEvent.click(screen.getByTestId('txform-save'));
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const row = (await db.transactions.toArray()).find((r) => r.merchant === 'Naar spaarpot');
      expect(row?.txType).toBe('adjustment');
      expect(row?.linkedAccountId).toBeFalsy();
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('the Create door builds a missing counterparty through the full chooser', async () => {
    await openForm();
    fireEvent.click(screen.getByTestId('txform-kind'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-transfer'));
    await screen.findByTestId('counter-accounts');

    // one creation door now (user redesign 2026-08-01): the chooser's
    // manual path, built in place and handed straight back
    fireEvent.click(screen.getByTestId('counter-full-setup'));
    fireEvent.click(await screen.findByTestId('chooser-manual'));
    fireEvent.click(await screen.findByTestId('chooser-accttype-savings'));
    fireEvent.change(await screen.findByTestId('chooser-acctform-name'), { target: { value: 'Vakantiepot' } });
    fireEvent.click(screen.getByTestId('chooser-acctform-save'));

    // the fresh manual account IS the counterparty; savings → Saving
    await waitFor(() => expect(screen.getByTestId('txform-counter').textContent).toContain('Vakantiepot'));
    expect(screen.getByTestId('txform-kind').textContent).toContain('Saving');
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const made = (await db.accounts.toArray()).find((a) => a.name === 'Vakantiepot');
      expect(made).toMatchObject({ type: 'savings', source: 'manual', balanceCents: 0 });
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('a fully synced (open banking) account is never offered for manual rows', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    // make the demo checking account look bank-synced
    const [{ MunniDB }, { DexieBackend }, { Repo }, { HlcClock }] = await Promise.all([
      import('@/db/schema'),
      import('@/db/backend'),
      import('@/db/repo'),
      import('@/sync/hlc'),
    ]);
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('gc'), { trackOutbox: false });
    await repo.upsert('account', 'demo_space', 'demo_main', { source: 'gocardless' });
    db.close();

    fireEvent.click(screen.getByTestId('tx-add'));
    await screen.findByTestId('txform-save');
    // demo_save is the ONLY manual account left → it picks itself on the
    // field; the picker sheet never offers the bank-synced demo_main
    await waitFor(() => expect(screen.getByTestId('txform-account').textContent).toContain('Demo Savings'), { timeout: 5000 });
    fireEvent.click(screen.getByTestId('txform-account'));
    await screen.findByTestId('txform-account-demo_save');
    expect(screen.queryByTestId('txform-account-demo_main')).toBeNull();
  });

  it('a manual-counter transfer writes the mirror; the list collapses the pair', async () => {
    await openForm();
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '100,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Naar spaarpot' } });
    fireEvent.click(screen.getByTestId('txform-kind'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-transfer'));
    await screen.findByTestId('counter-accounts');
    fireEvent.click(screen.getByTestId('counter-pick-demo_save'));
    // the mirror offer shows for a MANUAL counter, checked by default
    const mirror = (await screen.findByTestId('txform-mirror')) as HTMLInputElement;
    expect(mirror.checked).toBe(true);
    fireEvent.click(screen.getByTestId('txform-save'));

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    let outId = '';
    await waitFor(async () => {
      const rows = await db.transactions.filter((r) => r.merchant === 'Naar spaarpot' && r.deleted === 0).toArray();
      expect(rows).toHaveLength(2); // both legs exist…
      const out = rows.find((r) => r.amountCents < 0)!;
      const inc = rows.find((r) => r.amountCents > 0)!;
      expect(out.transferPeerId).toBe(inc.id); // …peered both ways
      expect(inc.transferPeerId).toBe(out.id);
      expect(inc).toMatchObject({ accountId: 'demo_save', txType: 'saving', linkedAccountId: 'demo_main', needsReview: 0 });
      outId = out.id;
    }, { timeout: 5000 });

    // the LIST shows the pair as ONE row: the outgoing leg with the
    // "From → To" note; the incoming leg stays hidden
    await waitFor(() => {
      const rows = [...screen.getByTestId('tx-list').querySelectorAll('[data-testid^="tx-row-"]')].filter((r) =>
        r.textContent?.includes('Naar spaarpot'),
      );
      expect(rows).toHaveLength(1);
      expect(screen.getByTestId(`tx-row-pair-${outId}`).textContent).toContain('→');
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('the "no counter account" exit types the row bare and files the locked sub', async () => {
    await openForm();
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '30,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Aflossing lening' } });
    fireEvent.click(screen.getByTestId('txform-kind'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-transfer'));
    await screen.findByTestId('counter-accounts');
    expect((screen.getByTestId('txform-save') as HTMLButtonElement).disabled).toBe(true);

    // the bare exit: name the family member directly, no account link
    fireEvent.click(screen.getByTestId('counter-none'));
    await screen.findByTestId('counter-bare-options');
    fireEvent.click(screen.getByTestId('counter-bare-debtPayment'));

    // the label completes the transfer intent: counter row says so, the
    // kind row carries the named member, save is armed
    await waitFor(() => expect(screen.getByTestId('txform-counter').textContent).toContain('No counter account'));
    expect(screen.getByTestId('txform-kind').textContent).toContain('Debt Payment');
    expect(screen.queryByTestId('txform-mirror')).toBeNull(); // nothing to mirror
    expect((screen.getByTestId('txform-save') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('txform-save'));

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const row = (await db.transactions.toArray()).find((r) => r.merchant === 'Aflossing lening');
      // typed + sign-picked locked sub, deliberately NO counterparty
      expect(row).toMatchObject({ txType: 'debtPayment', catId: 'loanRepayment', needsReview: 0 });
      expect(row?.linkedAccountId).toBeFalsy();
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('with several manual accounts nothing pre-selects — save requires a pick', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    fireEvent.click(screen.getByTestId('tx-add'));
    await screen.findByTestId('txform-save');
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '4,50' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Bakker' } });
    const save = screen.getByTestId('txform-save') as HTMLButtonElement;
    expect((await screen.findByTestId('txform-account')).textContent).toContain('Pick an account');
    expect(save.disabled).toBe(true); // valid amount+merchant, but no account
    fireEvent.click(screen.getByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
    await waitFor(() => expect(save.disabled).toBe(false));
  });

  it('a date before the space start is refused; one tap moves the start (arc 5)', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    const [{ MunniDB }, { DexieBackend }, { Repo }, { HlcClock }] = await Promise.all([
      import('@/db/schema'),
      import('@/db/backend'),
      import('@/db/repo'),
      import('@/sync/hlc'),
    ]);
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('hs'), { trackOutbox: false });
    await repo.upsert('space', 'demo_space', 'demo_space', { historyStartDate: '2026-06-01' });

    fireEvent.click(screen.getByTestId('tx-add'));
    await screen.findByTestId('txform-save');
    fireEvent.click(await screen.findByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '9,99' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Oud bonnetje' } });
    fireEvent.change(screen.getByTestId('txform-date'), { target: { value: '2026-05-15' } });

    // refused with the way out, not a dead end
    await screen.findByTestId('txform-before-start');
    expect((screen.getByTestId('txform-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('txform-move-start'));

    // the space start moved to the row's date — the error clears, save arms
    await waitFor(async () => {
      expect((await db.spaces.get('demo_space'))?.historyStartDate).toBe('2026-05-15');
    }, { timeout: 5000 });
    await waitFor(() => expect(screen.queryByTestId('txform-before-start')).toBeNull());
    expect((screen.getByTestId('txform-save') as HTMLButtonElement).disabled).toBe(false);
    db.close();
  }, 15_000);

  it('the income toggle stores a positive amount', async () => {
    await openForm();
    fireEvent.click(screen.getByTestId('txform-income'));
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '50' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Refund BV' } });
    fireEvent.click(screen.getByTestId('txform-save'));
    await waitFor(
      () => {
        const row = [...screen.getByTestId('tx-list').querySelectorAll('[data-testid^="tx-row-"]')].find((r) =>
          r.textContent?.includes('Refund BV'),
        );
        expect(row!.textContent).toContain('+€50.00');
      },
      { timeout: 5000 },
    );
  });
});
