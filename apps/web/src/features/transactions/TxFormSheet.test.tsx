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

  it('save stays tappable — an invalid tap names the blocker until the form is whole (#195)', async () => {
    await openForm();
    const save = screen.getByTestId('txform-save') as HTMLButtonElement;
    expect(save.disabled).toBe(false); // never disabled for validity
    fireEvent.click(save);
    // first failing requirement: the merchant name
    expect(await screen.findByTestId('txform-save-blocker')).toBeTruthy();
    expect(screen.getByTestId('txform-merchant').getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Bakker' } });
    expect(screen.getByTestId('txform-save-blocker')).toBeTruthy(); // still no amount
    expect(screen.getByTestId('txform-merchant').getAttribute('aria-invalid')).toBe('false');

    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '0' } });
    expect(screen.getByTestId('txform-save-blocker')).toBeTruthy(); // zero is not a transaction

    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '4,50' } });
    await waitFor(() => expect(screen.queryByTestId('txform-save-blocker')).toBeNull());
    // 15s cap: first coverage-load flake 2026-08-25 (5s default in a
    // 70s file) — a second flake means reworking, not re-timing
  }, 15_000);

  it('register-style amount entry: bare digits fill cents from the right (user request)', async () => {
    await openForm();
    const amount = screen.getByTestId('txform-amount') as HTMLInputElement;
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: '5' } });
    expect(amount.value).toBe('0,05');
    fireEvent.change(amount, { target: { value: '0,055' } });
    expect(amount.value).toBe('0,55');
    fireEvent.change(amount, { target: { value: '0,550' } });
    expect(amount.value).toBe('5,50');
    // the comma path stays: it promotes the digits to euros
    fireEvent.change(amount, { target: { value: '5,50,' } });
    expect(amount.value).toBe('550,');
    fireEvent.change(amount, { target: { value: '550,7' } });
    expect(amount.value).toBe('550,7');
  });

  it('adds an expense with a picked category and shows it in the list', async () => {
    await openForm();
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '12,34' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Bakker Bart' } });

    // the category row opens the split-categories editor (#211) —
    // pick through its per-entry picker, Done stages the single category
    fireEvent.click(screen.getByTestId('txform-category'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-groceries'));
    fireEvent.click(await screen.findByTestId('part-cat-save'));
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

  it('#228 feedback: counterparty-FIRST on the form\'s own row — the pick fills the special category', async () => {
    await openForm();
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '25,00' } });
    // the form's Counterparty row is the counter-first door now (#228
    // feedback: the editor shows no counter line anymore)
    fireEvent.click(screen.getByTestId('txform-counter'));
    // the bare door lists every tracked account (no category asked yet);
    // a savings pick on an outgoing row can only mean Set aside
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    await waitFor(() => expect(screen.getByTestId('txform-category').textContent).toContain('Set aside'));
    expect(screen.getByTestId('txform-counter').textContent).toContain('Demo Savings');
  }, 15_000);

  it('#228: a lone ◆ pick in the editor becomes the FORM\'s counterparty; save mints the row-key leg', async () => {
    await openForm();
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '50,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Mixed Save' } });

    fireEvent.click(screen.getByTestId('txform-category'));
    // the ◆ pick asks its counterparty on the spot; the pot answers —
    // the single entry spans the whole, so the ADD door shuts
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    await screen.findByTestId('counter-default');
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('demo_save'));
    expect((screen.getByTestId('part-cat-add') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('part-cat-one-special')).toBeTruthy();
    fireEvent.click(screen.getByTestId('part-cat-save'));
    // the answer landed at the FORM level — the counterparty row says so
    await waitFor(() => expect(screen.getByTestId('txform-counter').textContent).toContain('Demo Savings'));
    fireEvent.click(screen.getByTestId('txform-save'));

    const { MunniDB } = await import('@/db/schema');
    const { mirrorTxId } = await import('@/domain/feedIds');
    const db = new MunniDB('munni_demo');
    await waitFor(
      async () => {
        const row = (await db.transactions.toArray()).find((t) => t.merchant === 'Mixed Save');
        expect(row).toBeTruthy();
        expect(row!.catId).toBe('savingDeposit');
        expect(row!.linkedAccountId).toBe('demo_save');
        expect(row!.cats ?? undefined).toBeUndefined();
        // the pot leg rides the ROW's own key, sized to the whole €50
        const mid = mirrorTxId(row!.id);
        expect(row!.transferPeerId).toBe(mid);
        expect(await db.transactions.get(mid)).toMatchObject({ accountId: 'demo_save', amountCents: 5000 });
      },
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('no manual account: the form explains itself and doors to accounts', async () => {
    const { renderAppAsUser, USER_TEST_DB } = await import('@/test/harness');
    indexedDB.deleteDatabase(USER_TEST_DB);
    // a user space with ZERO writable accounts (no seed)
    renderAppAsUser('/transactions', { spaces: [{ id: 's-user', name: 'Personal' }] });
    await screen.findByTestId('tx-list');
    fireEvent.click(screen.getByTestId('tx-add'));
    // #179 (user): the CTA lands on the SPACE's own accounts screen with
    // the add chooser opening on arrival — not the global overview
    expect(await screen.findByTestId('txform-no-accounts')).toBeTruthy();
    fireEvent.click(screen.getByTestId('txform-add-account'));
    expect(await screen.findByTestId('screen-space-accounts')).toBeTruthy();
    expect(await screen.findByTestId('chooser-manual-form', {}, { timeout: 5000 })).toBeTruthy();
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

  it('#269: the adjustment names its impact; target mode writes the difference; category locks', async () => {
    await openForm();
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    const before = (await db.accounts.get('demo_main'))!.balanceCents;

    fireEvent.click(screen.getByTestId('txform-adjustment'));
    // the panel arrives; the category is munni's own, locked
    await screen.findByTestId('txform-adjust-panel');
    expect(screen.getByTestId('txform-adjust-cat').textContent).toContain('Balance Adjustment');
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '50,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Fix saldo' } });
    expect(screen.getByTestId('txform-adjust-impact').textContent).toContain('→');

    // target mode: the typed 50,00 is the balance to LAND ON — the row
    // gets the difference and the account ends exactly there
    fireEvent.click(screen.getByTestId('txform-adjust-mode-target'));
    fireEvent.click(screen.getByTestId('txform-save'));
    await waitFor(async () => {
      const row = (await db.transactions.toArray()).find((r) => r.merchant === 'Fix saldo');
      expect(row?.amountCents).toBe(5000 - before);
      expect(row?.catId).toBe('balanceAdjustment');
      expect(row?.txType).toBe('adjustment');
      expect((await db.accounts.get('demo_main'))!.balanceCents).toBe(5000);
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('a transfer kind demands its counterparty; the counterparty derives the type', async () => {
    await openForm();
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '25,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Naar spaarpot' } });

    // #133 D: no kind row — the always-there counterparty row IS the
    // transfer door; picking the pot derives the type
    fireEvent.click(screen.getByTestId('txform-counter'));
    await screen.findByTestId('counter-accounts');
    fireEvent.click(screen.getByTestId('counter-pick-demo_save'));
    await waitFor(() => expect(screen.getByTestId('txform-counter').textContent).toContain('Demo Savings'));
    expect((screen.getByTestId('txform-save') as HTMLButtonElement).disabled).toBe(false);

    // the Adjustment toggle marks a correction; save writes the marker
    fireEvent.click(screen.getByTestId('txform-adjustment'));
    fireEvent.click(screen.getByTestId('txform-save'));
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const row = (await db.transactions.toArray()).find((r) => r.merchant === 'Naar spaarpot');
      expect(row?.txType).toBe('adjustment');
      expect(row?.adjustment).toBe(1);
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('the Create door builds a missing counterparty through the full chooser', async () => {
    await openForm();
    fireEvent.click(screen.getByTestId('txform-counter'));
    await screen.findByTestId('counter-accounts');

    // one creation door now (user redesign 2026-08-01): the chooser's
    // manual path, built in place and handed straight back
    fireEvent.click(screen.getByTestId('counter-full-setup'));
    fireEvent.click(await screen.findByTestId('chooser-manual'));
    fireEvent.click(await screen.findByTestId('chooser-accttype-savings'));
    fireEvent.change(await screen.findByTestId('chooser-acctform-name'), { target: { value: 'Vakantiepot' } });
    fireEvent.click(screen.getByTestId('chooser-acctform-save'));

    // the fresh manual account IS the counterparty; the leg stays a
    // plain Transfer (R2 — the pot's ledger will carry the saving story)
    await waitFor(() => expect(screen.getByTestId('txform-counter').textContent).toContain('Vakantiepot'));
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
    // #133 D: the counterparty row is the transfer door now
    fireEvent.click(screen.getByTestId('txform-counter'));
    await screen.findByTestId('counter-accounts');
    fireEvent.click(screen.getByTestId('counter-pick-demo_save'));
    // the mirror checkbox retired (typed-splits v2): a MANUAL counter's
    // leg is ALWAYS minted — the pot's own ledger is the record
    expect(screen.queryByTestId('txform-mirror')).toBeNull();
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
      // the mirror wears the pot's R1 stamp + the Q8 movement sub
      expect(inc).toMatchObject({ accountId: 'demo_save', txType: 'saving', catId: 'savingDeposit', linkedAccountId: 'demo_main', needsReview: 0 });
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

  it('the marked special category carries the flat-loan story (typed-splits v2)', async () => {
    await openForm();
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '30,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Aflossing lening' } });

    // the bare-type exit retired: the flat structure's "Loan payment" is
    // the marked Repaid category, picked in the cats editor (#211) — the
    // debt type follows the pick, no counterparty demanded
    fireEvent.click(screen.getByTestId('txform-category'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    await screen.findByTestId('speccat-loanRepayment'); // the diamond mark
    fireEvent.click(screen.getByTestId('catpicker-loanRepayment'));
    fireEvent.click(await screen.findByTestId('part-cat-save'));

    // #133 D: no kind row to read — the category chip carries the story
    await waitFor(() => expect(screen.getByTestId('txform-category').textContent).toContain('Repaid'));
    expect((screen.getByTestId('txform-save') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('txform-save'));

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const row = (await db.transactions.toArray()).find((r) => r.merchant === 'Aflossing lening');
      // typed + the picked special sub, deliberately NO counterparty —
      // the default-loan bucket (unassigned payments) picks it up
      expect(row).toMatchObject({ txType: 'debtPayment', catId: 'loanRepayment', needsReview: 0 });
      expect(row?.linkedAccountId).toBeFalsy();
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('#309: a movement category refuses to SAVE bare — red counter field; the ask’s Default answers it', async () => {
    // savingDeposit: the ask is NOT mandatory (unlike the transfer
    // family, whose editor rolls a dismissed pick back), so a bare
    // movement could reach save — and used to land silently default-
    // linked by the boot fold. Now the save itself refuses.
    await openForm();
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '50,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Spaarpot' } });
    fireEvent.click(screen.getByTestId('txform-category'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    // the ask opens on the pick — walking away keeps the bare story
    await screen.findByTestId('counter-default');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(await screen.findByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('txform-category').textContent).toContain('Set aside'));
    // #309 (user): "we should not be able to continue" — the save
    // refuses and names the field instead of writing a silent default
    fireEvent.click(await screen.findByTestId('txform-save'));
    expect((await screen.findByTestId('txform-save-blocker')).textContent).toContain('Counterparty required');
    expect(screen.getByTestId('txform-counter').className).toContain('ring-negative');

    // answering through the field: the pinned Default is the one tap
    fireEvent.click(screen.getByTestId('txform-counter'));
    fireEvent.click(await screen.findByTestId('counter-default'));
    await waitFor(() => expect(screen.queryByTestId('txform-save-blocker')).toBeNull());
    fireEvent.click(screen.getByTestId('txform-save'));
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const row = (await db.transactions.toArray()).find((r) => r.merchant === 'Spaarpot');
      expect(row).toMatchObject({ catId: 'savingDeposit', needsReview: 0 });
      expect(row?.linkedAccountId).toBeTruthy();
    }, { timeout: 5000 });
    db.close();
  }, 20_000);

  it('with several manual accounts nothing pre-selects — save requires a pick', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    fireEvent.click(screen.getByTestId('tx-add'));
    await screen.findByTestId('txform-save');
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '4,50' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Bakker' } });
    const save = screen.getByTestId('txform-save') as HTMLButtonElement;
    expect((await screen.findByTestId('txform-account')).textContent).toContain('Pick an account');
    // valid amount+merchant, but no account: the tap names it (#195)
    fireEvent.click(save);
    expect(await screen.findByTestId('txform-save-blocker')).toBeTruthy();
    // S6811: a button carries data-invalid (aria-invalid is inputs-only)
    expect(screen.getByTestId('txform-account').getAttribute('data-invalid')).toBe('true');
    fireEvent.click(screen.getByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
    await waitFor(() => expect(screen.queryByTestId('txform-save-blocker')).toBeNull());
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
    // #259: an attached feed's gate must follow the move too
    const { accountLinkId } = await import('@/domain/feedIds');
    const linkId = accountLinkId('demo_space', 'feed_hs');
    await repo.upsert('accountLink', 'demo_space', linkId, {
      feedSpaceId: 'feed_hs', accountId: 'a-feed-hs', historyFrom: '2026-06-01', archived: 0,
    });

    fireEvent.click(screen.getByTestId('tx-add'));
    await screen.findByTestId('txform-save');
    fireEvent.click(await screen.findByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '9,99' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Oud bonnetje' } });
    fireEvent.change(screen.getByTestId('txform-date'), { target: { value: '2026-05-15' } });

    // refused with the way out, not a dead end — the save tap points at
    // the start-gate card's own explanation (#195)
    await screen.findByTestId('txform-before-start');
    fireEvent.click(screen.getByTestId('txform-save'));
    expect(await screen.findByTestId('txform-save-blocker')).toBeTruthy();
    fireEvent.click(screen.getByTestId('txform-move-start'));

    // the space start moved to the row's date — the error clears, save arms
    await waitFor(async () => {
      expect((await db.spaces.get('demo_space'))?.historyStartDate).toBe('2026-05-15');
    }, { timeout: 5000 });
    // …and the attachment's own gate moved WITH it (the bare space write
    // used to leave links behind — the other-device leak)
    await waitFor(async () => {
      expect((await db.accountLinks.get(linkId))?.historyFrom).toBe('2026-05-15');
    }, { timeout: 5000 });
    await waitFor(() => expect(screen.queryByTestId('txform-before-start')).toBeNull());
    expect(screen.queryByTestId('txform-save-blocker')).toBeNull();
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
