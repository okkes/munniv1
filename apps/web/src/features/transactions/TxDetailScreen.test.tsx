// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';
import { DEMO_SPACE_ID } from '@/db/seed';
import { HlcClock } from '@/sync/hlc';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';

describe('TxDetailScreen (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('quick-adds a recurring from the detail: form prefilled from the tx, created row auto-links', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    const headline = (await screen.findByTestId('tx-detail-amount')).textContent ?? '';

    fireEvent.click(screen.getByTestId('tx-detail-recurring-row'));
    fireEvent.click(await screen.findByTestId('tx-recurring-create'));

    // prefill (user request): name + amount derive from the transaction
    const nameInput = (await screen.findByTestId('recform-name')) as HTMLInputElement;
    expect(nameInput.value.length).toBeGreaterThan(0);
    const amountInput = screen.getByTestId('recform-amount') as HTMLInputElement;
    expect(headline.replace(/[^0-9]/g, '')).toContain(amountInput.value.replace(/[^0-9]/g, ''));

    fireEvent.click(screen.getByTestId('recform-save'));
    // the fresh recurring auto-links — the row shows its name, not "None"
    await waitFor(
      () => expect(screen.getByTestId('tx-detail-recurring-row').textContent).toContain(nameInput.value),
      { timeout: 5000 },
    );

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.recurringId).toBeTruthy();
    });
    db.close();
  }, 15_000);

  it('a paired transfer shows the counterpart row; unpair releases BOTH legs', async () => {
    // build the pair through the real form (mirror checkbox default ON)
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    fireEvent.click(screen.getByTestId('tx-add'));
    await screen.findByTestId('txform-save');
    fireEvent.click(await screen.findByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '75,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Pot in' } });
    fireEvent.click(screen.getByTestId('txform-kind'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-transfer'));
    await screen.findByTestId('counter-accounts');
    fireEvent.click(screen.getByTestId('counter-pick-demo_save'));
    await screen.findByTestId('txform-mirror');
    fireEvent.click(screen.getByTestId('txform-save'));

    const db = new MunniDB('munni_demo');
    let outId = '';
    let mirrorId = '';
    await waitFor(async () => {
      const rows = await db.transactions.filter((r) => r.merchant === 'Pot in' && r.deleted === 0).toArray();
      expect(rows).toHaveLength(2);
      outId = rows.find((r) => r.amountCents < 0)!.id;
      mirrorId = rows.find((r) => r.amountCents > 0)!.id;
    }, { timeout: 5000 });

    // the out-leg's detail offers the counterpart row; unpair frees both
    cleanup();
    renderApp(`/transactions/${outId}`);
    await screen.findByTestId('screen-tx-detail');
    fireEvent.click(await screen.findByTestId('tx-detail-unpair'));
    await waitFor(async () => {
      expect((await db.transactions.get(outId))?.transferPeerId).toBeFalsy();
      expect((await db.transactions.get(mirrorId))?.transferPeerId).toBeFalsy();
    }, { timeout: 5000 });
    // with a MANUAL counter and no peer, the create door returns
    await screen.findByTestId('tx-detail-create-counter');
    db.close();
  }, 20_000);

  it('opens a transaction from the list and shows its detail', async () => {
    renderApp('/transactions');
    const list = await screen.findByTestId('tx-list');
    await waitFor(() => expect(list.querySelector('[data-testid^="tx-row-"]')).toBeTruthy());
    fireEvent.click(list.querySelector('[data-testid^="tx-row-"]')!);

    expect(await screen.findByTestId('screen-tx-detail')).toBeTruthy();
    expect((await screen.findByTestId('tx-detail-amount')).textContent).toMatch(/€/);
    expect(screen.getByTestId('tx-detail-category-row')).toBeTruthy();
    expect(screen.getByTestId('tx-detail-kind-row')).toBeTruthy();
  });

  it('a manual transaction deletes through the confirm sheet — no cooldown (user request)', async () => {
    renderApp('/transactions/dm6'); // demo rows carry no importRef -> deletable
    await screen.findByTestId('screen-tx-detail');
    fireEvent.click(await screen.findByTestId('tx-detail-delete'));
    // the aligned danger sheet, instantly armed (cooldown 0)
    const confirm = (await screen.findByTestId('tx-delete-confirm')) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    // back on the list, the row is gone (tombstoned)
    const list = await screen.findByTestId('tx-list');
    await waitFor(() => expect(list.querySelector('[data-testid="tx-row-dm6"]')).toBeNull(), { timeout: 5000 });
  });

  it('a bogus tx id does not crash the screen', async () => {
    renderApp('/transactions/does-not-exist');
    // resolves to either the detail shell or a redirect back — must render something
    await waitFor(() => expect(document.body.textContent).not.toBe(''));
  });

  it('an expense attaches to a recurring cost and detaches again', async () => {
    renderApp('/transactions/dm6'); // dm6 is a demo expense
    await screen.findByTestId('screen-tx-detail');

    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-att'), { trackOutbox: false });
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec-gym', {
      name: 'Gym',
      kind: 'subscription',
      amountCents: 2499,
      every: 'month',
      dueDay: 10,
      active: 1,
    });

    fireEvent.click(await screen.findByTestId('tx-detail-recurring-row'));
    fireEvent.click(await screen.findByTestId('tx-recurring-rec-gym'));
    await waitFor(async () => expect((await db.transactions.get('dm6'))?.recurringId).toBe('rec-gym'), {
      timeout: 5000,
    });
    // the row now names the linked cost
    await waitFor(() => expect(screen.getByTestId('tx-detail-recurring-row').textContent).toContain('Gym'));

    fireEvent.click(screen.getByTestId('tx-detail-recurring-row'));
    fireEvent.click(await screen.findByTestId('tx-recurring-none'));
    await waitFor(async () => expect((await db.transactions.get('dm6'))?.recurringId).toBeFalsy(), { timeout: 5000 });
    db.close();
  }, 15_000);
});

describe('counterparty account number on the detail screen', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  const seedTx = async (counterIban: string, id: string) => {
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-cp'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, id, {
      accountId: 'demo_main',
      date: '2026-07-01',
      amountCents: -2500,
      currency: 'EUR',
      merchant: 'Counterparty Test',
      catId: 'groceries',
      txType: 'expense',
      needsReview: 0,
      counterIban,
    });
    db.close();
  };

  it('an unknown counterparty IBAN shows as a bank fact; only a transfer kind edits it', async () => {
    renderApp('/home'); // seed first, then navigate via a fresh render
    await screen.findByTestId('screen-home');
    await seedTx('NL99ELDR0000000042', 'tx-cp1');
    cleanup();
    renderApp('/transactions/tx-cp1');
    const row = (await screen.findByTestId('tx-detail-counterparty-edit')) as HTMLButtonElement;
    expect(row.textContent).toContain('NL99ELDR0000000042');
    // a standard expense keeps the row read-only (user simplification:
    // counterparty is a transfer concept — the IBAN stays visible)
    expect(row.disabled).toBe(true);
    // choosing the Transfer kind walks into the mandatory counterparty pick
    fireEvent.click(screen.getByTestId('tx-detail-kind-row'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-transfer'));
    expect(await screen.findByTestId('counter-accounts')).toBeTruthy();
  }, 15_000);

  it('a counterparty matching an own account becomes a door with account info', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    // demo_save's IBAN, spaced differently — the join normalizes
    await seedTx('NL00DEMO0000000200', 'tx-cp2');
    cleanup();
    renderApp('/transactions/tx-cp2');
    const row = await screen.findByTestId('tx-detail-counterparty-row');
    expect(row.textContent).toContain('Demo Savings');

    fireEvent.click(row);
    const sheet = await screen.findByTestId('counterparty-sheet');
    expect(sheet.textContent).toContain('NL00 DEMO 0000 0002 00'); // the account's own IBAN
  }, 15_000);
});

describe('TxTypeSheet via detail (demo tx dm6, groceries expense)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('a transfer to the savings account derives Saving and files the locked sub', async () => {
    renderApp('/transactions/dm6');
    // groceries expense → kind Transfer → pick the savings counterparty
    fireEvent.click(await screen.findByTestId('tx-detail-kind-row'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-transfer'));
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    // the savings counterparty derives Saving; groceries only speaks
    // expense → the invalidated category files the sign-picked locked
    // sub (arc 2) instead of a review round-trip
    await waitFor(() => {
      expect(screen.getByTestId('tx-detail-kind-row').textContent).toContain('Saving');
      expect(screen.getByTestId('tx-detail-category-row').textContent).toContain('Set aside');
    });
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.txType).toBe('saving');
      expect(tx?.linkedAccountId).toBe('demo_save');
      expect(tx?.catId).toBe('savingDeposit');
    });
    db.close();
  }, 15_000);

  it('the "no counter account" exit types the row bare with the locked sub', async () => {
    renderApp('/transactions/dm6');
    fireEvent.click(await screen.findByTestId('tx-detail-kind-row'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-transfer'));
    await screen.findByTestId('counter-accounts');
    fireEvent.click(screen.getByTestId('counter-none'));
    await screen.findByTestId('counter-bare-options');
    fireEvent.click(screen.getByTestId('counter-bare-debtPayment'));

    // typed + locked sub, deliberately no account on the other side —
    // the counterparty row states the bare label and stays a door
    await waitFor(() => {
      expect(screen.getByTestId('tx-detail-kind-row').textContent).toContain('Debt Payment');
      expect(screen.getByTestId('tx-detail-counter-add').textContent).toContain('No counter account');
    });
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.txType).toBe('debtPayment');
      expect(tx?.catId).toBe('loanRepayment');
      expect(tx?.linkedAccountId).toBeFalsy();
    });
    db.close();
  }, 15_000);

  it('back to Standard: the sign resolves the type and the counterparty clears', async () => {
    renderApp('/transactions/dm6');
    fireEvent.click(await screen.findByTestId('tx-detail-kind-row'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-transfer'));
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    const db = new MunniDB('munni_demo');
    await waitFor(async () => expect((await db.transactions.get('dm6'))?.txType).toBe('saving'));

    // standard on a negative amount = expense again, link gone
    fireEvent.click(screen.getByTestId('tx-detail-kind-row'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-standard'));
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.txType).toBe('expense');
      expect(tx?.linkedAccountId).toBeFalsy();
    });
    // demo rows are hand-shaped (no importRef) → Adjustment is offered
    fireEvent.click(screen.getByTestId('tx-detail-kind-row'));
    await screen.findByTestId('txkind-options');
    fireEvent.click(screen.getByTestId('txkind-adjustment'));
    await waitFor(async () => expect((await db.transactions.get('dm6'))?.txType).toBe('adjustment'));
    db.close();
  }, 15_000);
});

describe('ReimburseSection via detail (demo tx dm6, -€52.40)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('links a credit with a clamped partial amount, then unlinks it', async () => {
    renderApp('/transactions/dm6');
    // finding the counterpart lives on its own full screen now (redesign)
    fireEvent.click(await screen.findByTestId('reimb-add'));

    // pick the salary credit; the prefill is clamped to the expense (52,40)
    const picker = await screen.findByTestId('reimb-link-list');
    await waitFor(() => expect(picker.querySelector('[data-testid^="reimb-pick-"] [data-testid^="tx-row-"]')).toBeTruthy());
    fireEvent.click(picker.querySelector('[data-testid^="reimb-pick-"] [data-testid^="tx-row-"]')!);
    const amountInput = (await screen.findByTestId('reimb-amount')) as HTMLInputElement;
    expect(amountInput.value).toBe('52,40');

    // link a partial 20,00 instead
    fireEvent.change(amountInput, { target: { value: '20,00' } });
    fireEvent.click(screen.getByTestId('reimb-save'));

    const summary = await screen.findByTestId('reimb-summary');
    expect(summary.textContent).toContain('€20.00');
    expect(summary.textContent).toContain('€52.40');
    // hero shows the net amount, gross struck through
    expect(screen.getByTestId('tx-detail-amount').textContent).toContain('-€32.40');
    expect(screen.getByTestId('tx-detail-original-amount').textContent).toContain('-€52.40'); // details block owns the original now

    // redesign: slices carry the GROSS truth and the settled value sits
    // in an explicit `reimbursed` slice on BOTH sides
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const expense = await db.transactions.get('dm6');
      const creditId = expense?.reimbursements?.[0]?.txId;
      const credit = creditId ? await db.transactions.get(creditId) : undefined;
      expect(expense?.splits?.reduce((s, x) => s + x.amountCents, 0)).toBe(5240);
      expect(expense?.splits?.find((s) => s.catId === 'reimbursed')?.amountCents).toBe(2000);
      expect(credit?.splits?.reduce((s, x) => s + x.amountCents, 0)).toBe(credit?.amountCents ?? 0);
      expect(credit?.splits?.find((s) => s.catId === 'reimbursed')?.amountCents).toBe(2000);
    });

    // unlink restores the original state
    await waitFor(() =>
      expect(screen.getByTestId('reimb-list').querySelector('[data-testid^="reimb-unlink-"]')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('reimb-list').querySelector('[data-testid^="reimb-unlink-"]')!);
    await waitFor(() => {
      expect(screen.queryByTestId('reimb-summary')).toBeNull();
      expect(screen.getByTestId('tx-detail-amount').textContent).toContain('-€52.40');
    });
    // the freed value lands on Uncategorized, not the original category (user rule)
    await waitFor(async () => {
      const expense = await db.transactions.get('dm6');
      expect(expense?.splits?.find((s) => s.catId === 'uncategorized')?.amountCents).toBe(2000);
      expect(expense?.splits?.reduce((s, x) => s + x.amountCents, 0)).toBe(5240);
    });
    db.close();
  });

  it('links an expense from the income side: the credit nets out and self-files as Reimbursement', async () => {
    // strip the salary's category so the self-filing rule may act
    const first = renderApp('/transactions/dm1');
    await screen.findByTestId('tx-detail-amount');
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await db.transactions.update('dm1', { catId: 'uncategorized', needsReview: 1 });
    db.close();
    first.unmount();

    renderApp('/transactions/dm1');
    fireEvent.click(await screen.findByTestId('reimb-add-out'));
    const picker = await screen.findByTestId('reimb-link-list');
    await waitFor(() => expect(picker.querySelector('[data-testid^="reimb-pick-"] [data-testid^="tx-row-"]')).toBeTruthy());
    fireEvent.click(picker.querySelector('[data-testid^="reimb-pick-"] [data-testid^="tx-row-"]')!);
    // the prefill is already clamped to the expense's open remainder —
    // save it as-is (which expense is "most recent" is demo-data detail)
    await screen.findByTestId('reimb-amount');
    fireEvent.click(screen.getByTestId('reimb-save'));

    // hero shows what the salary is still worth, gross struck through
    await waitFor(() => expect(screen.getByTestId('tx-detail-original-amount').textContent).toContain('+€2,200.00'), { timeout: 5000 });
    expect(screen.getByTestId('tx-detail-amount').textContent).not.toContain('+€2,200.00');
    // …and the uncategorized credit filed itself as Reimbursed (redesign)
    await waitFor(() => expect(screen.getByTestId('tx-detail-category-row').textContent).toContain('Reimbursed'));

    // unlinking from this side restores the full amount
    await waitFor(() =>
      expect(screen.getByTestId('reimb-reverse').querySelector('[data-testid^="reimb-unlink-out-"]')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('reimb-reverse').querySelector('[data-testid^="reimb-unlink-out-"]')!);
    await waitFor(() => expect(screen.getByTestId('tx-detail-amount').textContent).toContain('+€2,200.00'));
  }, 15_000);
});

describe('SplitEditorSheet via detail (demo tx dm6, -€52.40)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('splits across two categories with auto-balance, then clears the split', async () => {
    renderApp('/transactions/dm6');
    // ONE unified flow (user request): the category row opens the split
    // editor seeded with a single row; a second row is added explicitly
    fireEvent.click(await screen.findByTestId('tx-detail-category-row'));
    await screen.findByTestId('split-editor');
    fireEvent.click(screen.getByTestId('split-add-row'));

    // shrink the first row: a remainder appears and blocks saving
    fireEvent.change(screen.getByTestId('split-amount-0'), { target: { value: '30,00' } });
    const remainder = await screen.findByTestId('split-remainder');
    expect(remainder.textContent).toContain('€22.40');
    expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(true);

    // give the second row a category, auto-balance the remainder, save
    fireEvent.click(screen.getByTestId('split-cat-1'));
    fireEvent.click(await screen.findByTestId('catpicker-restaurants'));
    fireEvent.click(screen.getByTestId('split-remainder'));
    await waitFor(() => expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('split-save'));

    // the categories block shows one row per slice
    const catBlock = await screen.findByTestId('tx-detail-categories');
    await waitFor(() => expect(catBlock.textContent).toContain('€30.00'));
    expect(catBlock.textContent).toContain('€22.40');
    await screen.findByTestId('tx-detail-cat-restaurants');

    // clear the split again
    fireEvent.click(screen.getByTestId('tx-detail-category-row'));
    fireEvent.click(await screen.findByTestId('split-clear'));
    await waitFor(() => expect(screen.queryByTestId('tx-detail-cat-restaurants')).toBeNull());
  });

  it('percentage mode balances to 100 and stores materialized euro amounts', async () => {
    renderApp('/transactions/dm6');
    fireEvent.click(await screen.findByTestId('tx-detail-category-row'));
    await screen.findByTestId('split-editor');
    fireEvent.click(screen.getByTestId('split-add-row'));
    // the gate (user request): the fresh row must be finished — category
    // AND a value — before another may be added
    expect((screen.getByTestId('split-add-row') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('split-cat-1'));
    fireEvent.click(await screen.findByTestId('catpicker-restaurants'));
    fireEvent.change(screen.getByTestId('split-amount-1'), { target: { value: '0,01' } });

    // a third row can be added and removed again
    fireEvent.click(screen.getByTestId('split-add-row'));
    fireEvent.click(await screen.findByTestId('split-remove-2'));

    // switch to % — the euro shape carries over (100 / 0)
    fireEvent.click(screen.getByTestId('split-mode-pct'));
    expect((screen.getByTestId('split-amount-0') as HTMLInputElement).value).toBe('100');

    // 60% leaves 40% open; auto-balance hands it to the last row
    fireEvent.change(screen.getByTestId('split-amount-0'), { target: { value: '60' } });
    const remainder = await screen.findByTestId('split-remainder');
    expect(remainder.textContent).toContain('40%');
    expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('split-cat-1'));
    fireEvent.click(await screen.findByTestId('catpicker-restaurants'));
    fireEvent.click(screen.getByTestId('split-remainder'));
    await waitFor(() => expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('split-save'));

    // the detail shows euros: 60/40 of €52.40, exactly partitioned
    const catBlock = await screen.findByTestId('tx-detail-categories');
    await waitFor(() => expect(catBlock.textContent).toContain('€31.44'));
    expect(catBlock.textContent).toContain('€20.96');

    // reopening restores percentage mode with the stored shares
    fireEvent.click(screen.getByTestId('tx-detail-category-row'));
    await screen.findByTestId('split-editor');
    await waitFor(() => expect((screen.getByTestId('split-amount-0') as HTMLInputElement).value).toBe('60'));
    expect((screen.getByTestId('split-amount-1') as HTMLInputElement).value).toBe('40');
  });
});

describe('bulk apply from the detail (user request)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('recategorizing offers to reach every same-merchant transaction, reviewed included', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-bulk'), { trackOutbox: false });
    for (const [id, needsReview] of [['blk-a', 0], ['blk-b', 1]] as const) {
      await repo.upsert('transaction', DEMO_SPACE_ID, id, {
        accountId: 'demo_main', date: '2026-06-01', amountCents: -900, currency: 'EUR',
        merchant: 'BULKSHOP BV', catId: 'groceries', txType: 'expense', needsReview,
      });
    }
    cleanup();

    renderApp('/transactions/blk-a');
    fireEvent.click(await screen.findByTestId('tx-detail-category-row'));
    fireEvent.click(await screen.findByTestId('split-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-hobby'));
    fireEvent.click(screen.getByTestId('split-save'));

    // the offer names the ONE other BULKSHOP row (reviewed or not)
    const offer = await screen.findByTestId('tx-detail-bulk-offer');
    expect(offer.textContent).toContain('1');
    fireEvent.click(screen.getByTestId('tx-detail-bulk-apply'));

    await waitFor(async () => {
      expect(await db.transactions.get('blk-b')).toMatchObject({ catId: 'hobby', needsReview: 0 });
    });
    // offer consumed — but the dismissal render trails the DB write, so wait for it
    await waitFor(() => expect(screen.queryByTestId('tx-detail-bulk-offer')).toBeNull());
    db.close();
  }, 15_000);

  it('the bar opens a selection sheet and apply skips unchecked rows', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-bulk-sel'), { trackOutbox: false });
    for (const id of ['sel-a', 'sel-b', 'sel-c']) {
      await repo.upsert('transaction', DEMO_SPACE_ID, id, {
        accountId: 'demo_main', date: '2026-06-01', amountCents: -700, currency: 'EUR',
        merchant: 'SELECTSHOP BV', catId: 'groceries', txType: 'expense', needsReview: 0,
      });
    }
    cleanup();

    renderApp('/transactions/sel-a');
    fireEvent.click(await screen.findByTestId('tx-detail-category-row'));
    fireEvent.click(await screen.findByTestId('split-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-hobby'));
    fireEvent.click(screen.getByTestId('split-save'));

    // open the selection sheet from the bar, uncheck one target
    fireEvent.click(await screen.findByTestId('tx-detail-bulk-expand'));
    await screen.findByTestId('tx-detail-bulk-list');
    // select-all toggles the whole set: none → apply disarms, all → rearms
    fireEvent.click(screen.getByTestId('tx-detail-bulk-select-all'));
    expect((screen.getByTestId('tx-detail-bulk-apply-sheet') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('tx-detail-bulk-select-all'));
    fireEvent.click(screen.getByTestId('tx-detail-bulk-sel-b'));
    fireEvent.click(screen.getByTestId('tx-detail-bulk-apply-sheet'));

    await waitFor(async () => {
      expect((await db.transactions.get('sel-c'))?.catId).toBe('hobby');
    });
    expect((await db.transactions.get('sel-b'))?.catId).toBe('groceries'); // unchecked stays
    db.close();
  }, 15_000);
});

describe('title rename (user request)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('renames the title, keeps the original visible, and bulk-applies to similar rows', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-title'), { trackOutbox: false });
    for (const id of ['ttl-a', 'ttl-b']) {
      await repo.upsert('transaction', DEMO_SPACE_ID, id, {
        accountId: 'demo_main', date: '2026-06-01', amountCents: -900, currency: 'EUR',
        merchant: 'ODIDO NETHERLANDS B.V.', catId: 'telecom', txType: 'expense', needsReview: 0,
        importRef: `bank-${id}`, // imported rows get the rename pencil
      });
    }
    cleanup();

    renderApp('/transactions/ttl-a');
    fireEvent.click(await screen.findByTestId('tx-detail-rename'));
    fireEvent.change(await screen.findByTestId('tx-rename-input'), { target: { value: 'Odido' } });
    fireEvent.click(screen.getByTestId('tx-rename-save'));

    // the details block keeps the bank's original in sight
    await waitFor(() => expect(screen.getByTestId('tx-detail-original-title').textContent).toContain('ODIDO NETHERLANDS'));

    // the bulk bar offers the sibling; applying renames it too
    await screen.findByTestId('tx-detail-title-bulk');
    fireEvent.click(screen.getByTestId('tx-detail-bulk-apply'));
    await waitFor(async () => {
      expect((await db.transactions.get('ttl-b'))?.titleOverride).toBe('Odido');
    });
    expect((await db.transactions.get('ttl-a'))?.titleOverride).toBe('Odido');
    db.close();
  }, 15_000);
});

describe('detail sections customize (user request)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('hiding notes removes the section; the toggle brings it back', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-custom'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'cust-a', {
      accountId: 'demo_main', date: '2026-06-01', amountCents: -500, currency: 'EUR',
      merchant: 'CUSTOMSHOP', catId: 'groceries', txType: 'expense', needsReview: 0,
    });
    cleanup();

    renderApp('/transactions/cust-a');
    await screen.findByTestId('tx-detail-notes');

    // customize is its own screen now (user request): toggle there,
    // return to the detail to see the section gone — then restore it
    const notesHidden = async () =>
      ((await db.spaces.get(DEMO_SPACE_ID))?.txDetailBlocks ?? []).some((b) => b.id === 'notes' && b.hidden === 1);

    fireEvent.click(screen.getByTestId('tx-detail-customize'));
    await screen.findByTestId('tx-customize-list');
    fireEvent.click(screen.getByTestId('tx-block-toggle-notes'));
    // the write must LAND before unmounting (in-flight puts die with the app)
    await waitFor(async () => expect(await notesHidden()).toBe(true), { timeout: 5000 });
    cleanup();
    renderApp('/transactions/cust-a');
    // the detail shell mounts before the row loads — wait for the LOADED
    // screen (the customize door), not the shell testid, before poking it
    const customize = await screen.findByTestId('tx-detail-customize', {}, { timeout: 5000 });
    // the hidden-notes pref rides the SPACE row's emission, which can trail
    // the tx row that revealed the customize door — wait for it
    await waitFor(() => expect(screen.queryByTestId('tx-detail-notes')).toBeNull());

    fireEvent.click(customize);
    await screen.findByTestId('tx-customize-list');
    fireEvent.click(screen.getByTestId('tx-block-toggle-notes'));
    await waitFor(async () => expect(await notesHidden()).toBe(false), { timeout: 5000 });
    cleanup();
    renderApp('/transactions/cust-a');
    await screen.findByTestId('tx-detail-notes');
    db.close();
  }, 15_000);
});
