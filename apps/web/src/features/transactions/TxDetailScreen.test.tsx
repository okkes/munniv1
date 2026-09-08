// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';
import { DEMO_SPACE_ID } from '@/db/seed';
import { accountLinkId, mirrorTxId, partMirrorSourceId, txMetaId } from '@/domain/feedIds';
import { HlcClock } from '@/sync/hlc';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';

describe('TxDetailScreen (demo identity)', () => {
  beforeEach(async () => {
    // #221: the boot chain runs the bare-row fold EVERY boot now — the
    // previous spec's chain must settle before the db goes away, or its
    // dying writes kill this spec's in-flight puts (the db.close trap)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
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
    // #133 D: the counterparty row is the transfer door now
    fireEvent.click(screen.getByTestId('txform-counter'));
    await screen.findByTestId('counter-accounts');
    // no fork here (#237): the row does not exist yet, so there is
    // nothing to point at — the form's pick still chooses directly
    fireEvent.click(screen.getByTestId('counter-pick-demo_save'));
    // the mirror checkbox retired (typed-splits v2): the pot's leg is
    // always minted for a manual counter
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

    // the out-leg's detail offers the counterpart row; #237: unpairing a
    // GENERATED leg asks what happens to it — Keep releases both legs
    // and the row survives as its own transaction
    cleanup();
    renderApp(`/transactions/${outId}`);
    await screen.findByTestId('screen-tx-detail');
    fireEvent.click(await screen.findByTestId('tx-detail-unpair'));
    fireEvent.click(await screen.findByTestId('tx-unpair-keep'));
    await waitFor(async () => {
      expect((await db.transactions.get(outId))?.transferPeerId).toBeFalsy();
      const mirror = await db.transactions.get(mirrorId);
      expect(mirror?.deleted).toBe(0); // kept — an ordinary row now
      expect(mirror?.transferPeerId).toBeFalsy();
      expect(mirror?.linkedAccountId).toBeFalsy();
    }, { timeout: 5000 });
    // the source keeps its counterparty: the create/pick doors return
    await screen.findByTestId('tx-detail-create-counter');
    await screen.findByTestId('tx-detail-pick-counter');
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
    // #133 D: the kind concept is gone from the detail
    expect(screen.queryByTestId('tx-detail-kind-row')).toBeNull();
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

  it('#228: deleting a manual row retires its row-key mint with its money', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    // the pot's PRE-EDIT baseline — the delete must restore exactly this
    // (capturing after the mint raced its two-step write: mirror row
    // first, balance a tick later)
    const db = new MunniDB('munni_demo');
    const potBase = (await waitFor(async () => {
      const pot = await db.accounts.get('demo_save');
      expect(pot).toBeTruthy();
      return pot!;
    })).balanceCents;

    // the lone ◆ pick claims the whole row: its answer is THE
    // transaction-level counterparty, the mint rides the row's own key
    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    await screen.findByTestId('counter-default');
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    // #237: manual counters fork now — creating the leg is the explicit door
    fireEvent.click(await screen.findByTestId('counter-fork-create'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('demo_save'));
    fireEvent.click(screen.getByTestId('part-cat-save'));

    const mid = mirrorTxId('dm6');
    // settled = mirror row live AND its balance move landed
    await waitFor(async () => {
      expect((await db.transactions.get(mid))?.deleted).toBe(0);
      expect((await db.accounts.get('demo_save'))?.balanceCents).toBe(potBase + 5240);
    }, { timeout: 8000 });

    fireEvent.click(await screen.findByTestId('tx-detail-delete'));
    fireEvent.click(await screen.findByTestId('tx-delete-confirm'));
    await waitFor(async () => {
      expect((await db.transactions.get('dm6'))?.deleted).toBe(1);
      expect((await db.transactions.get(mid))?.deleted).toBe(1); // the mint goes along
      expect((await db.accounts.get('demo_save'))?.balanceCents).toBe(potBase); // refunded
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  it('#228: the counterparty PROPERTY row — a pick refiles the category by the account\'s kind, remove RESETS it', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    const db = new MunniDB('munni_demo');
    const potBase = (await waitFor(async () => {
      const pot = await db.accounts.get('demo_save');
      expect(pot).toBeTruthy();
      return pot!;
    })).balanceCents;

    // the row is back on the transaction (user decision): honest "none"
    const row = await screen.findByTestId('tx-detail-counter-row');
    expect(row.textContent).toContain('No counter account');
    fireEvent.click(row);
    // groceries is regular — the generic door lists every tracked kind
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    // #237: manual counters fork now — creating the leg is the explicit door
    fireEvent.click(await screen.findByTestId('counter-fork-create'));
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      // the bijection's re-pick rule: the savings pick means Set aside
      expect(tx?.catId).toBe('savingDeposit');
      expect(tx?.linkedAccountId).toBe('demo_save');
      expect(tx?.transferPeerId).toBe(mirrorTxId('dm6'));
      expect((await db.accounts.get('demo_save'))?.balanceCents).toBe(potBase + 5240);
    }, { timeout: 8000 });
    await waitFor(() => expect(screen.getByTestId('tx-detail-counter-row').textContent).toContain('Demo Savings'));

    // remove: the category resets WITH the link (one fact, user spec)
    fireEvent.click(screen.getByTestId('tx-detail-counter-row'));
    fireEvent.click(await screen.findByTestId('counter-detach'));
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.catId).toBe('uncategorized');
      expect(tx?.linkedAccountId ?? undefined).toBeUndefined();
      expect((await db.transactions.get(mirrorTxId('dm6')))?.deleted).toBe(1);
      expect((await db.accounts.get('demo_save'))?.balanceCents).toBe(potBase);
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  it('#228: a PART\'s counterparty row links the part itself — the part-key leg mints', async () => {
    renderApp('/transactions');
    await screen.findByTestId('screen-transactions');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-cnt'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'tx-cnt', {
      accountId: 'demo_main', date: '2020-03-01', amountCents: -6000, currency: 'EUR',
      merchant: 'Two stories', catId: 'telecom', txType: 'expense', needsReview: 0,
      splits: [
        { id: 'cp1', catId: 'telecom', amountCents: 4000 },
        { id: 'cp2', catId: 'savingDeposit', amountCents: 2000, txType: 'saving' },
      ],
    });
    await screen.findByTestId('tx-parts-tx-cnt', {}, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('tx-part-row-tx-cnt-1'));
    // the part page carries its own property row
    const row = await screen.findByTestId('tx-part-counter-row');
    expect(row.textContent).toContain('No counter account');
    fireEvent.click(row);
    // the ◆ part narrows the ask to ITS kinds — the family default leads
    await screen.findByTestId('counter-default');
    // #255 r3: the part's ask carries the fork now — Create is the mint
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    fireEvent.click(await screen.findByTestId('counter-fork-create'));
    await waitFor(async () => {
      const stored = (await db.transactions.get('tx-cnt'))?.splits?.find((p) => p.id === 'cp2');
      expect(stored?.linkedAccountId).toBe('demo_save');
      const mid = mirrorTxId(partMirrorSourceId('tx-cnt', 'cp2'));
      expect(stored?.transferPeerId).toBe(mid);
      // the pot leg is the PART's €20
      expect(await db.transactions.get(mid)).toMatchObject({ accountId: 'demo_save', amountCents: 2000 });
    }, { timeout: 8000 });
    await waitFor(() => expect(screen.getByTestId('tx-part-counter-row').textContent).toContain('Demo Savings'));

    // remove: the PART's category resets with its link, the leg retires
    fireEvent.click(screen.getByTestId('tx-part-counter-row'));
    fireEvent.click(await screen.findByTestId('counter-detach'));
    await waitFor(async () => {
      const stored = (await db.transactions.get('tx-cnt'))?.splits?.find((p) => p.id === 'cp2');
      expect(stored?.catId).toBe('uncategorized');
      expect(stored?.linkedAccountId ?? undefined).toBeUndefined();
      expect((await db.transactions.get(mirrorTxId(partMirrorSourceId('tx-cnt', 'cp2'))))?.deleted).toBe(1);
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  it('#255 r3: a part points at the EXISTING pot row — pick, pair, and the countertx row wears its face', async () => {
    // CI-load rework (4th flake 2026-08-25): the old walk stacked FOUR
    // sheets (counter row → account ask → fork → dup pick) and starved
    // under full-suite coverage. The part's countertx PENCIL opens the
    // match sheet directly — the pick's write mechanics (patch + the
    // review-shape reciprocal) are identical on that path, and the
    // counter-first ask/fork doors keep their own #228/#237 specs.
    renderApp('/transactions');
    await screen.findByTestId('screen-transactions', {}, { timeout: 10_000 });
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-partpick'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'tx-pp', {
      accountId: 'demo_main', date: '2020-03-05', amountCents: -6000, currency: 'EUR',
      merchant: 'Split with pot', catId: 'telecom', txType: 'expense', needsReview: 0,
      splits: [
        { id: 'pp1', catId: 'telecom', amountCents: 4000 },
        // the counter account is already decided; only the PEER is open
        { id: 'pp2', catId: 'savingDeposit', txType: 'saving', amountCents: 2000, linkedAccountId: 'demo_save' },
      ],
    });
    // the pot row that already IS the other leg of the €20 part
    await repo.upsert('transaction', DEMO_SPACE_ID, 'pot-in', {
      accountId: 'demo_save', date: '2020-03-05', amountCents: 2000, currency: 'EUR',
      merchant: 'Pot arrival', catId: 'uncategorized', txType: 'income', needsReview: 0,
    });
    await screen.findByTestId('tx-parts-tx-pp', {}, { timeout: 10_000 });
    fireEvent.click(screen.getByTestId('tx-part-row-tx-pp-1'));
    // the pencil opens the part's own match sheet — pot-in is the
    // same-amount candidate on the linked account
    fireEvent.click(await screen.findByTestId('tx-part-countertx-edit', {}, { timeout: 10_000 }));
    fireEvent.click((await screen.findByTestId('counter-dup-pot-in', {}, { timeout: 10_000 })).querySelector('button')!);
    await waitFor(async () => {
      const stored = (await db.transactions.get('tx-pp'))?.splits?.find((sp) => sp.id === 'pp2');
      expect(stored?.linkedAccountId).toBe('demo_save');
      expect(stored?.transferPeerId).toBe('pot-in');
      // the reciprocal landed on the pot row; nothing was minted
      expect((await db.transactions.get('pot-in'))?.transferPeerId).toBe('tx-pp');
      expect(await db.transactions.get(mirrorTxId(partMirrorSourceId('tx-pp', 'pp2')))).toBeUndefined();
    }, { timeout: 10_000 });
    // the part page's Counter-transaction row wears the picked face
    await waitFor(() => expect(screen.getByTestId('tx-part-countertx-row').textContent).toContain('Pot arrival'));
    db.close();
  }, 30_000);

  it('#255 r4: BOTH sides of a part pair travel on tap — no sheet, no dead jump, and the peer wears the PART\'s face', async () => {
    renderApp('/transactions');
    await screen.findByTestId('screen-transactions');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-r4'), { trackOutbox: false });
    // the settled state the r3 pick flow writes (asserted there): the
    // PART holds the pair, the picked pot row carries the reciprocal
    // pointing at the CONTAINER row
    await repo.upsert('transaction', DEMO_SPACE_ID, 'tx-pp', {
      accountId: 'demo_main', date: '2020-03-05', amountCents: -6000, currency: 'EUR',
      merchant: 'Split with pot', catId: 'telecom', txType: 'expense', needsReview: 0,
      splits: [
        { id: 'pp1', catId: 'telecom', amountCents: 4000 },
        { id: 'pp2', catId: 'savingDeposit', amountCents: 2000, txType: 'saving', linkedAccountId: 'demo_save', transferPeerId: 'pot-in' },
      ],
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'pot-in', {
      accountId: 'demo_save', date: '2020-03-05', amountCents: 2000, currency: 'EUR',
      merchant: 'Pot arrival', catId: 'savingDeposit', txType: 'saving', needsReview: 0,
      linkedAccountId: 'demo_main', transferPeerId: 'tx-pp',
    });
    await screen.findByTestId('tx-parts-tx-pp', {}, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('tx-part-row-tx-pp-1'));
    // side A (the part page): the row wears the other leg's face…
    await waitFor(() => expect(screen.getByTestId('tx-part-countertx-row').textContent).toContain('Pot arrival'), { timeout: 8000 });
    // …and its TAP TRAVELS to the peer — no match sheet on a plain tap
    fireEvent.click(screen.getByTestId('tx-part-countertx-row'));
    expect(screen.queryByTestId('counter-fork')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('tx-detail-account-row').textContent).toContain('Demo Savings'), { timeout: 8000 });

    // side B (the picked pot row): the SAME rich row — the PART's face
    // (its own €20, never the container's €60), not a bare link row
    const peerRow = await screen.findByTestId('tx-detail-peer');
    expect(peerRow.textContent).toContain('Split with pot');
    expect(peerRow.textContent).toContain('20.00');
    expect(peerRow.textContent).not.toContain('60.00');
    // its tap travels BACK to the exact part page
    fireEvent.click(peerRow);
    await waitFor(() => expect(screen.getByTestId('tx-part-countertx-row').textContent).toContain('Pot arrival'), { timeout: 8000 });

    // re-picking lives on the pencil — THAT opens the match sheet
    fireEvent.click(screen.getByTestId('tx-part-countertx-edit'));
    await screen.findByTestId('counter-fork', {}, { timeout: 5000 });

    // #255 r4 heal-leak regression: visiting the container's detail must
    // NOT lift the part's pair to a row-level pointer (it minted a
    // duplicate pair row on the container)
    await waitFor(async () => {
      expect((await db.transactions.get('tx-pp'))?.transferPeerId).toBeFalsy();
      expect((await db.transactions.get('pot-in'))?.transferPeerId).toBe('tx-pp');
    }, { timeout: 5000 });
    db.close();
  }, 30_000);

  it('#255 r4: a MINTED part-leg resolves its synthetic back-pointer — rich face + a real landing (the blank-screen glitch)', async () => {
    const legId = mirrorTxId(partMirrorSourceId('tx-mm', 'mm2'));
    renderApp(`/transactions/${legId}`);
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-r4m'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'tx-mm', {
      accountId: 'demo_main', date: '2020-04-01', amountCents: -6000, currency: 'EUR',
      merchant: 'Mint split', catId: 'telecom', txType: 'expense', needsReview: 0,
      splits: [
        { id: 'mm1', catId: 'telecom', amountCents: 4000 },
        { id: 'mm2', catId: 'savingDeposit', amountCents: 2000, txType: 'saving', linkedAccountId: 'demo_save', transferPeerId: legId },
      ],
    });
    // the leg the part-level mint engine creates: its back-pointer is
    // the part-mirror SOURCE key ("rowId:partId") — not a row id. The
    // r4 report: this rendered a bare "Counterpart transaction" link
    // whose tap opened an EMPTY detail (the glitch screenshots).
    await repo.upsert('transaction', DEMO_SPACE_ID, legId, {
      accountId: 'demo_save', date: '2020-04-01', amountCents: 2000, currency: 'EUR',
      merchant: 'Minted leg', catId: 'savingDeposit', txType: 'saving', needsReview: 0,
      linkedAccountId: 'demo_main', transferPeerId: partMirrorSourceId('tx-mm', 'mm2'),
    });
    await screen.findByTestId('tx-detail-amount', {}, { timeout: 8000 });
    // the rich face resolves through the synthetic key to the PART
    const peerRow = await waitFor(() => {
      const row = screen.getByTestId('tx-detail-peer');
      expect(row.textContent).toContain('Mint split');
      return row;
    }, { timeout: 8000 });
    expect(peerRow.textContent).toContain('20.00');
    // the tap lands on the part's page — never on a blank screen
    fireEvent.click(peerRow);
    await waitFor(() => expect(screen.getByTestId('tx-part-countertx-row').textContent).toContain('Minted leg'), { timeout: 8000 });
    db.close();
  }, 30_000);

  it('a bogus tx id does not crash the screen', async () => {
    renderApp('/transactions/does-not-exist');
    // resolves to either the detail shell or a redirect back — must render something
    await waitFor(() => expect(document.body.textContent).not.toBe(''));
  });

  it('#221: a row on a DEFAULT account is read-only — no edit, no delete, no unpair; the peer door stays', async () => {
    renderApp('/transactions/potleg1');
    // the demo space is born with its default pot (eager mint); a minted
    // leg on it is the subject — the shape the choke writes
    const seed = new MunniDB('munni_demo');
    await waitFor(async () => expect((await seed.accounts.get('defaultacct_saving_demo_space'))?.deleted).toBe(0), { timeout: 8000 });
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('ro-seed'), { trackOutbox: false });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'potleg1', {
      accountId: 'defaultacct_saving_demo_space', date: '2026-07-20', amountCents: 20000, currency: 'EUR',
      merchant: 'Savings transfer', txType: 'saving', catId: 'savingDeposit', needsReview: 0,
      linkedAccountId: 'demo_main', transferPeerId: 'dm12',
    });
    seed.close();
    await screen.findByTestId('tx-detail-amount', {}, { timeout: 8000 });
    // the account fact resolves a beat after the row — the lock label
    // is the signal that the default-ledger gates are up
    await waitFor(() => expect(screen.getByTestId('tx-detail-cats-locked').textContent).toContain('Managed by munni'), { timeout: 8000 });

    // the ledger is munni's: no pencil, no rename, no delete, no
    // category editor, no notes/receipts/reimburse blocks
    expect(screen.queryByTestId('tx-detail-edit')).toBeNull();
    expect(screen.queryByTestId('tx-detail-rename')).toBeNull();
    expect(screen.queryByTestId('tx-detail-delete')).toBeNull();
    expect(screen.queryByTestId('tx-detail-cats-edit')).toBeNull();
    expect(screen.queryByTestId('tx-detail-customize')).toBeNull();

    // the pair row still navigates to the ORIGIN — but never releases
    await screen.findByTestId('tx-detail-peer');
    expect(screen.queryByTestId('tx-detail-unpair')).toBeNull();
  }, 15_000);

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
  beforeEach(async () => {
    // #221: the boot chain runs the bare-row fold EVERY boot now — the
    // previous spec's chain must settle before the db goes away, or its
    // dying writes kill this spec's in-flight puts (the db.close trap)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
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

  it('#220: an unknown counterparty IBAN is a read-only DETAILS fact — no transaction-level editor anywhere', async () => {
    renderApp('/home'); // seed first, then navigate via a fresh render
    await screen.findByTestId('screen-home');
    await seedTx('NL99ELDR0000000042', 'tx-cp1');
    cleanup();
    renderApp('/transactions/tx-cp1');
    const row = (await screen.findByTestId('tx-detail-original-counter')) as HTMLButtonElement;
    expect(row.textContent).toContain('NL99ELDR0000000042');
    // bank metadata: unrecognized counterparties are plain facts
    expect(row.disabled).toBe(true);
    // the old transaction-level counter row/editor is gone (#220)
    expect(screen.queryByTestId('tx-detail-counterparty-row')).toBeNull();
    expect(screen.queryByTestId('tx-detail-counterparty-edit')).toBeNull();
    expect(screen.queryByTestId('tx-detail-kind-row')).toBeNull();
  }, 15_000);

  it('#220: a counterparty matching an own account stays in DETAILS — tappable for the account info, never an editor', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    // demo_save's IBAN, spaced differently — the join normalizes
    await seedTx('NL00DEMO0000000200', 'tx-cp2');
    cleanup();
    renderApp('/transactions/tx-cp2');
    // the IBAN paints first; the account match resolves async
    const row = (await screen.findByTestId('tx-detail-original-counter')) as HTMLButtonElement;
    await waitFor(() => expect(screen.getByTestId('tx-detail-original-counter').textContent).toContain('Demo Savings'));
    expect(row.disabled).toBe(false);

    fireEvent.click(row);
    const sheet = await screen.findByTestId('counterparty-sheet');
    expect(sheet.textContent).toContain('NL00 DEMO 0000 0002 00'); // the account's own IBAN
  }, 15_000);
});

describe('TxTypeSheet via detail (demo tx dm6, groceries expense)', () => {
  beforeEach(async () => {
    // #221: the boot chain runs the bare-row fold EVERY boot now — the
    // previous spec's chain must settle before the db goes away, or its
    // dying writes kill this spec's in-flight puts (the db.close trap)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('#133 r4: Set aside answered with the savings pot KEEPS its category; the pot leg mints', async () => {
    renderApp('/transactions/dm6');
    // the ◆ pick asks its counterparty ON THE SPOT (user: "instantly…
    // before adding another category"); the pot answers it. The user's
    // category stays the story — the link makes it a movement and the
    // view derives transfer from the real counterparty.
    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    await screen.findByTestId('counter-default');
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    // #237: manual counters fork now — creating the leg is the explicit door
    fireEvent.click(await screen.findByTestId('counter-fork-create'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('demo_save'));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => {
      expect(screen.getByTestId('tx-detail-category-row').textContent).toContain('Set aside');
    });
    // #138 (user): every category row carries its money — the single
    // category spans the whole transaction
    expect(screen.getByTestId('tx-detail-category-row').textContent).toMatch(/52\.40/);
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.linkedAccountId).toBe('demo_save');
      expect(tx?.catId).toBe('savingDeposit'); // the pick survives the link
      // the deterministic mirror sits on the pot, stamped + movement-sub
      const mirror = await db.transactions.get(mirrorTxId('dm6'));
      expect(mirror).toMatchObject({ accountId: 'demo_save', amountCents: 5240, txType: 'saving', catId: 'savingDeposit', transferPeerId: 'dm6' });
    });
    db.close();
  }, 15_000);

  it('#228: a spread offers NO special categories, and a lone ◆ pick claims the whole transaction', async () => {
    renderApp('/transactions/dm6');
    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    // entry 0 stays groceries at €40; the ask must NOT open for a plain pick
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-groceries'));
    expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe(''); // no ask, no link for a plain pick
    fireEvent.change(screen.getByTestId('part-cat-amount-0'), { target: { value: '40,00' } });
    // entry 1: with TWO rows the picker hides the ◆ families entirely —
    // one special per (split) transaction, and it spans the whole
    fireEvent.click(screen.getByTestId('part-cat-add'));
    fireEvent.click(screen.getByTestId('part-cat-1'));
    await screen.findByTestId('catpicker-sweets');
    expect(screen.queryByTestId('catpicker-savingDeposit')).toBeNull();
    expect(screen.queryByTestId('catpicker-transferOut')).toBeNull();
    fireEvent.click(screen.getByTestId('catpicker-sweets'));
    // a spread never links — the editor carries no subject counter
    expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('');
    fireEvent.click(screen.getByTestId('part-cat-save'));

    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.cats?.map((c) => c.catId)).toEqual(['groceries', 'sweets']);
      expect(tx?.linkedAccountId).toBeFalsy(); // a spread means no movement story
    }, { timeout: 8000 });

    // back to ONE entry: the ◆ pick asks on the spot and CLAIMS the
    // whole — the add door shuts with the why
    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    const editors = screen.getAllByTestId('part-cats-editor');
    const editor = editors.at(-1)!;
    fireEvent.click((await within(editor).findAllByTestId('part-cat-remove-1')).at(-1)!);
    fireEvent.click(within(editor).getByTestId('part-cat-0'));
    fireEvent.click((await screen.findAllByTestId('catpicker-savingDeposit')).at(-1)!);
    await screen.findByTestId('counter-default');
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    // #237: manual counters fork now — creating the leg is the explicit door
    fireEvent.click(await screen.findByTestId('counter-fork-create'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('demo_save'));
    expect((within(editor).getByTestId('part-cat-add') as HTMLButtonElement).disabled).toBe(true);
    expect(within(editor).getByTestId('part-cat-one-special')).toBeTruthy();
    fireEvent.click(within(editor).getByTestId('part-cat-save'));

    // the single special lands at the ROW: link + category, spread gone,
    // the mirror under the row's own key
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.catId).toBe('savingDeposit');
      expect(tx?.linkedAccountId).toBe('demo_save');
      expect(tx?.cats ?? undefined).toBeUndefined();
      const mirror = await db.transactions.get(mirrorTxId('dm6'));
      expect(mirror).toMatchObject({ accountId: 'demo_save', amountCents: 5240, txType: 'saving' });
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  it('the marked special category carries the flat-loan story (typed-splits v2)', async () => {
    renderApp('/transactions/dm6');
    // the bare-type exit retired: pick the marked Repaid category in the
    // unified editor — the debt type follows, no counterparty demanded
    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    await screen.findByTestId('speccat-loanRepayment'); // the diamond mark
    fireEvent.click(screen.getByTestId('catpicker-loanRepayment'));

    // #133 r4: the ◆ pick opens the counterparty ask ON THE PICK
    // (Default pinned); walking away keeps the bare story — Done then
    // lands the category with no account on the other side
    await screen.findByTestId('counter-default');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(await screen.findByTestId('part-cat-save'));
    // #228 feedback: the property row shows the bare state; no
    // "→ account" line under the category anywhere
    await waitFor(() => {
      expect(screen.getByTestId('tx-detail-category-row').textContent).toContain('Repaid');
    });
    expect(screen.getByTestId('tx-detail-counter-row').textContent).toContain('No counter account');
    expect(screen.queryByTestId('tx-detail-cat-counter-0')).toBeNull();
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.txType).toBe('debtPayment');
      expect(tx?.catId).toBe('loanRepayment');
      expect(tx?.linkedAccountId).toBeFalsy();
    });
    db.close();
  }, 15_000);

  it('the flat-loan question: a debt-family pick offers WHICH loan; picking one mints its leg (Q1)', async () => {
    // the lean demo carries no loans (rich seed skips under vitest) —
    // give the space one so the question has an answer
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('loanpick'), { trackOutbox: false });
    await seedRepo.upsert('account', DEMO_SPACE_ID, 'lp_loan', {
      name: 'Phone plan loan', type: 'loan', source: 'manual', currency: 'EUR', balanceCents: -30_000,
    });
    seed.close();

    renderApp('/transactions/dm6');
    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-loanRepayment'));

    // #133 B/r4: the loan question IS the counterparty question, opened
    // on the pick — Default pinned on top, the seeded loan a candidate
    const loanId = 'lp_loan';
    await screen.findByTestId('counter-default');
    fireEvent.click(await screen.findByTestId(`counter-pick-${loanId}`));
    // #237: manual counters fork now — creating the leg is the explicit door
    fireEvent.click(await screen.findByTestId('counter-fork-create'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe(loanId));
    fireEvent.click(screen.getByTestId('part-cat-save'));

    // the pick keeps the Repaid story; the link carries the movement —
    // the loan's own minted leg appears at the deterministic id
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.linkedAccountId).toBe(loanId);
      expect(tx?.catId).toBe('loanRepayment');
      expect((await db.transactions.get(mirrorTxId('dm6')))?.accountId).toBe(loanId);
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  it('#133 B: a manual counterparty forks — picking the existing row pairs both sides, mints nothing', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    // seed AFTER boot — the demo rows exist only once the app seeded
    const seed = new MunniDB('munni_demo');
    // …and after the boot chain SETTLED (#221: the fold runs every boot
    // with no marker — the chain promise is the settle signal): a
    // mid-flight bare ◆ write would get folded onto the default pot,
    // clobbering the pick this test makes
    await waitFor(() => expect((globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain).toBeTruthy());
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('fork-seed'), { trackOutbox: false });
    await seedRepo.upsert('account', DEMO_SPACE_ID, 'ms1', {
      name: 'Cash pot', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 10_000,
    });
    const dm6seed = await seed.transactions.get('dm6');
    // the other leg already lives on the pot: same size, same day, +sign
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'dup1', {
      accountId: 'ms1', date: dm6seed!.date, amountCents: -dm6seed!.amountCents, currency: 'EUR',
      merchant: 'Moved in', catId: 'uncategorized', txType: 'income', needsReview: 0,
    });
    const potBalance = 10_000;
    seed.close();

    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    // #133 r4: the ask opens on the pick itself
    await screen.findByTestId('counter-default');
    fireEvent.click(await screen.findByTestId('counter-pick-ms1'));

    // the fork: create the counterpart, or point at the existing row
    // (the wrapper is inert — the TxRow button inside takes the tap)
    await screen.findByTestId('counter-fork');
    fireEvent.click((await screen.findByTestId('counter-dup-dup1')).querySelector('button')!);
    // the picked row rides the entry; Done writes and pairs both sides
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('ms1'));
    fireEvent.click(screen.getByTestId('part-cat-save'));

    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const src = await db.transactions.get('dm6');
      const picked = await db.transactions.get('dup1');
      expect(src?.linkedAccountId).toBe('ms1');
      expect(src?.transferPeerId).toBe('dup1');
      expect(picked?.linkedAccountId).toBe(src?.accountId);
      expect(picked?.transferPeerId).toBe('dm6');
      expect(picked?.catId).toBe('savingDeposit'); // the pot's stamp, by its sign
    }, { timeout: 8000 });
    // nothing minted, nothing moved: no mirror row, balance untouched
    expect(await db.transactions.get(mirrorTxId('dm6'))).toBeUndefined();
    expect((await db.accounts.get('ms1'))?.balanceCents).toBe(potBalance);
    db.close();
  }, 20_000);

  it('#268: bulk after a specific pick runs the per-sibling counter queue', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('queue-seed'), { trackOutbox: false });
    await seedRepo.upsert('account', DEMO_SPACE_ID, 'qs1', {
      name: 'Queue pot', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 10_000,
    });
    // two same-merchant expenses + one pot twin EACH
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'dt1', {
      accountId: 'demo_main', date: '2026-02-01', amountCents: -500, currency: 'EUR',
      merchant: 'Queue Shop', catId: 'uncategorized', txType: 'expense', needsReview: 0,
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'dt2', {
      accountId: 'demo_main', date: '2026-02-02', amountCents: -500, currency: 'EUR',
      merchant: 'Queue Shop', catId: 'uncategorized', txType: 'expense', needsReview: 0,
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'qc1', {
      accountId: 'qs1', date: '2026-02-01', amountCents: 500, currency: 'EUR',
      merchant: 'Pot in one', catId: 'uncategorized', txType: 'income', needsReview: 0,
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'qc2', {
      accountId: 'qs1', date: '2026-02-02', amountCents: 500, currency: 'EUR',
      merchant: 'Pot in two', catId: 'uncategorized', txType: 'income', needsReview: 0,
    });
    seed.close();
    cleanup();
    renderApp('/transactions/dt1');
    await screen.findByTestId('screen-tx-detail');

    // special cat + counter + SPECIFIC pick through the editor
    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    await screen.findByTestId('counter-default');
    fireEvent.click(await screen.findByTestId('counter-pick-qs1'));
    await screen.findByTestId('counter-fork');
    fireEvent.click((await screen.findByTestId('counter-dup-qc1')).querySelector('button')!);
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('qs1'));
    fireEvent.click(screen.getByTestId('part-cat-save'));

    // the sibling offer arms; applying opens the per-transaction queue
    // instead of copying the pick (#268 user spec)
    fireEvent.click(await screen.findByTestId('tx-detail-bulk-apply'));
    const context = await screen.findByTestId('counter-queue-context');
    expect(context.textContent).toContain('Queue Shop');
    expect(context.textContent).toContain('1/1');
    fireEvent.click((await screen.findByTestId('counter-dup-qc2')).querySelector('button')!);

    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      expect((await db.transactions.get('dt1'))?.transferPeerId).toBe('qc1');
      const sibling = await db.transactions.get('dt2');
      expect(sibling?.catId).toBe('savingDeposit');
      expect(sibling?.linkedAccountId).toBe('qs1');
      expect(sibling?.transferPeerId).toBe('qc2');
      expect((await db.transactions.get('qc2'))?.transferPeerId).toBe('dt2');
    }, { timeout: 8000 });
    db.close();
  }, 25_000);

  it('#133 B: the fork can also CREATE the counterpart — the mint, as always', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('fork-mint'), { trackOutbox: false });
    await seedRepo.upsert('account', DEMO_SPACE_ID, 'ms2', {
      name: 'Second pot', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 0,
    });
    const dm6seed = await seed.transactions.get('dm6');
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'dup2', {
      accountId: 'ms2', date: dm6seed!.date, amountCents: -dm6seed!.amountCents, currency: 'EUR',
      merchant: 'Maybe the leg', catId: 'uncategorized', txType: 'income', needsReview: 0,
    });
    seed.close();

    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    // generous waits: this file's writes + the boot chain contend under
    // full-suite load (the review-suite lesson). #133 r4: the ask opens
    // on the pick itself; Done lands the answered entry.
    await screen.findByTestId('counter-default', {}, { timeout: 8000 });
    fireEvent.click(await screen.findByTestId('counter-pick-ms2', {}, { timeout: 8000 }));
    await screen.findByTestId('counter-fork', {}, { timeout: 8000 });
    fireEvent.click(screen.getByTestId('counter-fork-create'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('ms2'), { timeout: 8000 });
    fireEvent.click(screen.getByTestId('part-cat-save'));

    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const src = await db.transactions.get('dm6');
      expect(src?.linkedAccountId).toBe('ms2');
      expect((await db.transactions.get(mirrorTxId('dm6')))?.accountId).toBe('ms2');
    }, { timeout: 8000 });
    // the candidate row stayed untouched — the mint was chosen instead
    expect((await db.transactions.get('dup2'))?.linkedAccountId).toBeUndefined();
    db.close();
  }, 20_000);

  it('#255: the match sheet searches by title AND amount; a dead-end search says so', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    const seed = new MunniDB('munni_demo');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('match-search'), { trackOutbox: false });
    await seedRepo.upsert('account', DEMO_SPACE_ID, 'ms9', {
      name: 'Search pot', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 0,
    });
    const dm6seed = await seed.transactions.get('dm6');
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'sr1', {
      accountId: 'ms9', date: dm6seed!.date, amountCents: -dm6seed!.amountCents, currency: 'EUR',
      merchant: 'Blue Coffee', catId: 'uncategorized', txType: 'income', needsReview: 0,
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'sr2', {
      accountId: 'ms9', date: dm6seed!.date, amountCents: 777, currency: 'EUR',
      merchant: 'Yellow Bakery', catId: 'uncategorized', txType: 'income', needsReview: 0,
    });
    seed.close();

    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    await screen.findByTestId('counter-default', {}, { timeout: 8000 });
    fireEvent.click(await screen.findByTestId('counter-pick-ms9', {}, { timeout: 8000 }));
    await screen.findByTestId('counter-fork', {}, { timeout: 8000 });

    // both candidate rows are reachable before any search
    await screen.findByTestId('counter-match-search');
    // narrow by TITLE — only the bakery survives
    fireEvent.change(screen.getByTestId('counter-match-search'), { target: { value: 'yellow' } });
    await waitFor(() => expect(document.querySelector('[data-testid$="-sr1"]')).toBeNull());
    expect(document.querySelector('[data-testid$="-sr2"]')).toBeTruthy();
    // narrow by AMOUNT (7,77 — comma notation like the row wears it)
    fireEvent.change(screen.getByTestId('counter-match-search'), { target: { value: '7,77' } });
    await waitFor(() => expect(document.querySelector('[data-testid$="-sr1"]')).toBeNull());
    expect(document.querySelector('[data-testid$="-sr2"]')).toBeTruthy();
    // a dead-end search says so instead of leaving a silent void
    fireEvent.change(screen.getByTestId('counter-match-search'), { target: { value: 'zzz-nothing' } });
    await screen.findByTestId('counter-fork-empty');
  }, 20_000);

  it('#133 B/#221: the Default row links onto the space\'s own pot (eagerly minted at boot)', async () => {
    renderApp('/transactions/dm6');
    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-loanRepayment'));

    // no loan exists — Default is the one-tap answer to the pick's ask
    fireEvent.click(await screen.findByTestId('counter-default'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBeTruthy());
    fireEvent.click(screen.getByTestId('part-cat-save'));

    const db = new MunniDB('munni_demo');
    const potId = `defaultacct_debtPayment_${DEMO_SPACE_ID}`;
    await waitFor(async () => {
      const pot = await db.accounts.get(potId);
      expect(pot?.defaultFor).toBe('debtPayment');
      const tx = await db.transactions.get('dm6');
      expect(tx?.linkedAccountId).toBe(potId);
      expect((await db.transactions.get(mirrorTxId('dm6')))?.accountId).toBe(potId);
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  it('#133 D: the detail carries NO kind surface — categories and the counterparty ask are the whole story', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    expect(screen.queryByTestId('tx-detail-kind-row')).toBeNull();
    expect(screen.queryByTestId('txkind-options')).toBeNull();
  }, 15_000);

  it('#152 r2: the ◆ Funding pick asks WHICH funding account — candidates filtered, pick keeps the story', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    const seed = new MunniDB('munni_demo');
    await waitFor(() => expect((globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain).toBeTruthy());
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('fund-seed'), { trackOutbox: false });
    await seedRepo.upsert('account', DEMO_SPACE_ID, 'fund1', {
      name: 'Family pot', type: 'funding', source: 'manual', currency: 'EUR', balanceCents: 0,
    });
    seed.close();

    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-fundingOut'));

    // the ask opens on the pick (#133 r4) and lists ONLY funding
    // attachments — #221: the Default shared pot pins on top, none of
    // the ordinary accounts join the list
    await screen.findByTestId('counter-pick-fund1', {}, { timeout: 8000 });
    expect(screen.getByTestId('counter-default').textContent).toContain('Default shared pot');
    expect(screen.queryByTestId('counter-pick-demo_save')).toBeNull();
    fireEvent.click(screen.getByTestId('counter-pick-fund1'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('fund1'));
    fireEvent.click(screen.getByTestId('part-cat-save'));

    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const tx = await db.transactions.get('dm6');
      expect(tx?.linkedAccountId).toBe('fund1');
      expect(tx?.catId).toBe('fundingOut'); // the funding story stays
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  it('#152 r2: the original bank counterparty stays visible once the row points elsewhere', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    const seed = new MunniDB('munni_demo');
    await waitFor(() => expect((globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain).toBeTruthy());
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    // the bank named a counterparty; nothing links yet — no facts row
    await seed.transactions.update('dm6', { counterIban: 'NL02ABNA0123456789' });
    seed.close();
    await waitFor(() => expect(screen.queryByTestId('tx-detail-original-counter')).toBeNull());

    // point the row at the savings pot — the original IBAN moves into
    // the details section as a quiet fact
    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    await screen.findByTestId('counter-default');
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    // #237: manual counters fork now — creating the leg is the explicit door
    fireEvent.click(await screen.findByTestId('counter-fork-create'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('demo_save'));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => {
      expect(screen.getByTestId('tx-detail-original-counter').textContent).toContain('NL02ABNA0123456789');
    }, { timeout: 8000 });
  }, 20_000);
});

describe('ReimburseSection via detail (demo tx dm6, -€52.40)', () => {
  beforeEach(async () => {
    // #221: the boot chain runs the bare-row fold EVERY boot now — the
    // previous spec's chain must settle before the db goes away, or its
    // dying writes kill this spec's in-flight puts (the db.close trap)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
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
    // #233 r2: both sides preview their category shift before saving
    const impact = screen.getByTestId('reimb-impact');
    expect(impact.textContent).toContain('€52.40 → €32.40');
    expect(impact.textContent).toContain('€0.00 → €20.00');
    fireEvent.click(screen.getByTestId('reimb-save'));

    // #231 r2: the section is the LINKS only — the linked row carries the
    // amount; no original/net/of rows anymore
    await waitFor(() =>
      expect(screen.getByTestId('reimb-list').querySelector('[data-testid^="reimb-row-"]')?.textContent).toContain('€20.00'),
    );
    expect(screen.queryByTestId('reimb-summary')).toBeNull();
    expect(screen.queryByTestId('reimb-net')).toBeNull();
    // hero shows the net amount, gross struck through
    expect(screen.getByTestId('tx-detail-amount').textContent).toContain('-€32.40');
    expect(screen.getByTestId('tx-detail-original-amount').textContent).toContain('-€52.40'); // details block owns the original now

    // redesign (+#211): the GROSS partition lives in the whole row's own
    // `cats` — the settled value an explicit `reimbursed` entry on BOTH
    // sides; `splits` stays reserved for real containers
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const expense = await db.transactions.get('dm6');
      const creditId = expense?.reimbursements?.[0]?.txId;
      const credit = creditId ? await db.transactions.get(creditId) : undefined;
      expect(expense?.cats?.reduce((s, x) => s + x.amountCents, 0)).toBe(5240);
      expect(expense?.cats?.find((s) => s.catId === 'reimbursed')?.amountCents).toBe(2000);
      expect(expense?.splits ?? undefined).toBeUndefined();
      expect(credit?.cats?.reduce((s, x) => s + x.amountCents, 0)).toBe(credit?.amountCents ?? 0);
      expect(credit?.cats?.find((s) => s.catId === 'reimbursed')?.amountCents).toBe(2000);
    });

    // unlink restores the original state
    await waitFor(() =>
      expect(screen.getByTestId('reimb-list').querySelector('[data-testid^="reimb-unlink-"]')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('reimb-list').querySelector('[data-testid^="reimb-unlink-"]')!);
    await waitFor(() => {
      expect(screen.getByTestId('reimb-list').querySelector('[data-testid^="reimb-row-"]')).toBeNull();
      expect(screen.getByTestId('tx-detail-amount').textContent).toContain('-€52.40');
    });
    // the freed value lands on Uncategorized, not the original category (user rule)
    await waitFor(async () => {
      const expense = await db.transactions.get('dm6');
      expect(expense?.cats?.find((s) => s.catId === 'uncategorized')?.amountCents).toBe(2000);
      expect(expense?.cats?.reduce((s, x) => s + x.amountCents, 0)).toBe(5240);
    });
    db.close();
  });

  it('#233 r3: a SPREAD expense previews every touched slice — engine-true, untouched ones stay quiet', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('impact-seed'), { trackOutbox: false });
    // hotel 60 + groceries 40 spread; a 30 reimb must eat the LARGEST
    // slice (hotel) and leave groceries untouched (#235 order)
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'imp1', {
      accountId: 'demo_main', date: '2026-05-02', amountCents: -10_000, currency: 'EUR',
      merchant: 'Spread Hotel', catId: 'hotels', txType: 'expense', needsReview: 0,
      cats: [{ catId: 'hotels', amountCents: 6000 }, { catId: 'groceries', amountCents: 4000 }],
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'imp2', {
      accountId: 'demo_main', date: '2026-05-03', amountCents: 3000, currency: 'EUR',
      merchant: 'Refund thirty', catId: 'uncategorized', txType: 'income', needsReview: 0,
    });
    seed.close();
    cleanup();
    renderApp('/transactions/imp1');
    fireEvent.click(await screen.findByTestId('reimb-add'));
    const picker = await screen.findByTestId('reimb-link-list');
    await waitFor(() => expect(picker.querySelector('[data-testid="reimb-pick-imp2"] [data-testid^="tx-row-"]')).toBeTruthy());
    fireEvent.click(picker.querySelector('[data-testid="reimb-pick-imp2"] [data-testid^="tx-row-"]')!);
    const amountInput = (await screen.findByTestId('reimb-amount')) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '30,00' } });
    const impact = await screen.findByTestId('reimb-impact');
    // expense side: hotel shrinks, reimbursed grows — groceries silent
    expect(impact.textContent).toContain('€60.00 → €30.00');
    expect(impact.textContent).toContain('€0.00 → €30.00');
    expect(impact.textContent).not.toContain('€40.00');
    // credit side self-files: its whole value moves under Reimbursed
    expect(impact.textContent).toContain('€30.00 → €0.00');
  }, 20_000);

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

  it('#197: a split expense links per PART from the credit side — the root is never offered', async () => {
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-reimb-part'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'rsplit', {
      accountId: 'demo_main', date: '2026-07-01', amountCents: -6000, currency: 'EUR',
      merchant: 'Split Lunch', catId: 'restaurants', txType: 'expense', needsReview: 0,
      // #211: the explicit cats null marks these as PARTS for the boot fold
      cats: null as never,
      splits: [
        { id: 'rs1', catId: 'restaurants', amountCents: 4500 },
        { id: 'rs2', catId: 'groceries', amountCents: 1500 },
      ],
    });

    renderApp('/transactions/dm1');
    fireEvent.click(await screen.findByTestId('reimb-add-out'));
    const picker = await screen.findByTestId('reimb-link-list');
    // the parts stand in for the container (suggested may repeat them —
    // take the list's copy); the root has no whole row anywhere
    await waitFor(() => expect(screen.queryAllByTestId('reimb-pick-rsplit-part-1').length).toBeGreaterThan(0), {
      timeout: 5000,
    });
    expect(picker.querySelector('[data-testid="reimb-pick-rsplit"]')).toBeNull();
    fireEvent.click(screen.getAllByTestId('reimb-pick-rsplit-part-1').at(-1)!.querySelector('button')!);
    // the prefill is the PART's open value, not the container's
    const amountInput = (await screen.findByTestId('reimb-amount')) as HTMLInputElement;
    expect(amountInput.value).toBe('15,00');
    fireEvent.click(screen.getByTestId('reimb-save'));
    await waitFor(async () => {
      const row = await db.transactions.get('rsplit');
      expect(row?.reimbursements).toEqual([{ txId: 'dm1', amountCents: 1500, partId: 'rs2' }]);
      // #228 (user): the settle lives ON THE PART — its own cats carry
      // the bookkeeping; the sibling and the part amounts stay untouched
      // and no `reimbursed` pseudo-part ever joins the container
      const parts = row?.splits ?? [];
      expect(parts.map((p) => p.catId)).toEqual(['restaurants', 'groceries']);
      expect(parts.map((p) => p.amountCents)).toEqual([4500, 1500]);
      expect(parts[0].cats ?? undefined).toBeFalsy();
      expect(parts[1].cats).toMatchObject([{ catId: 'reimbursed', amountCents: 1500 }]);
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('#197 r2 (user: "include the other side too"): a split CREDIT funds per PART — the link carries creditPartId', async () => {
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-reimb-cpart'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'csplit', {
      accountId: 'demo_main', date: '2026-07-02', amountCents: 8000, currency: 'EUR',
      merchant: 'Mixed refund', catId: 'reimburse', txType: 'income', needsReview: 0,
      // #211: the explicit cats null marks these as PARTS for the boot fold
      cats: null as never,
      splits: [
        { id: 'cs1', catId: 'reimburse', amountCents: 3000 },
        { id: 'cs2', catId: 'incomeOther', amountCents: 5000 },
      ],
    });

    renderApp('/transactions/dm6'); // −€52.40 groceries expense
    fireEvent.click(await screen.findByTestId('reimb-add'));
    const picker = await screen.findByTestId('reimb-link-list');
    // the split credit's PARTS stand in for it — the root has no row
    await waitFor(() => expect(screen.queryAllByTestId('reimb-pick-csplit-part-0').length).toBeGreaterThan(0), {
      timeout: 5000,
    });
    expect(picker.querySelector('[data-testid="reimb-pick-csplit"]')).toBeNull();
    fireEvent.click(screen.getAllByTestId('reimb-pick-csplit-part-0').at(-1)!.querySelector('button')!);
    // the prefill is what THAT part can still fund (its reimb earmark)
    const amountInput = (await screen.findByTestId('reimb-amount')) as HTMLInputElement;
    expect(amountInput.value).toBe('30,00');
    fireEvent.click(screen.getByTestId('reimb-save'));
    await waitFor(async () => {
      const row = await db.transactions.get('dm6');
      expect(row?.reimbursements).toEqual([{ txId: 'csplit', amountCents: 3000, creditPartId: 'cs1' }]);
      // #228 (user): the CREDIT side settles on its funding part too —
      // no pseudo-part, sibling amounts untouched
      const credit = await db.transactions.get('csplit');
      const parts = credit?.splits ?? [];
      expect(parts.map((p) => p.catId)).toEqual(['reimburse', 'incomeOther']);
      expect(parts.map((p) => p.amountCents)).toEqual([3000, 5000]);
      expect(parts[0].cats).toMatchObject([{ catId: 'reimbursed', amountCents: 3000 }]);
      expect(parts[1].cats ?? undefined).toBeFalsy();
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('#228 feedback (user ss): the settled entry pins READ-ONLY in the editor, and a special still claims the whole', async () => {
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-settled-sx'), { trackOutbox: false });
    // a settled Set-aside expense: −52.40 with €20.00 reimbursed
    await repo.upsert('transaction', DEMO_SPACE_ID, 'sx1', {
      accountId: 'demo_main', date: '2026-07-03', amountCents: -5240, currency: 'EUR',
      merchant: 'Vueling', catId: 'savingDeposit', txType: 'saving', needsReview: 0,
      reimbursements: [{ txId: 'dm1', amountCents: 2000 }],
      cats: [{ catId: 'savingDeposit', amountCents: 3240 }, { catId: 'reimbursed', amountCents: 2000 }],
    });

    renderApp('/transactions/sx1');
    fireEvent.click(await screen.findByTestId('tx-detail-cats-edit'));
    await screen.findByTestId('part-cats-editor');
    // the settled bookkeeping stands FIRST, pinned and untouchable —
    // only the reimbursement link can remove it
    expect(screen.getByTestId('part-cat-settled-0').textContent).toContain('Reimbursed');
    expect(screen.getByTestId('part-cat-settled-0').querySelector('input')).toBeNull();
    // ONE editable entry partitions the NET (32,40)
    expect(screen.getByTestId('part-cat-0').textContent).toContain('Set aside');
    expect(screen.queryByTestId('part-cat-1')).toBeNull();
    expect((screen.getByTestId('part-cat-amount-0') as HTMLInputElement).value).toBe('32,40');
    // the ss exploit is CLOSED: the lone special still claims the whole
    // — no rows can join it around the settled bookkeeping
    expect((screen.getByTestId('part-cat-add') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('part-cat-one-special')).toBeTruthy();

    // a REGULAR pick frees the add door (regular + reimbursement is the
    // one legal mix); the picker offers NO specials in the spread
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-groceries'));
    await waitFor(() => expect((screen.getByTestId('part-cat-add') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-add'));
    fireEvent.click(await screen.findByTestId('part-cat-1'));
    await screen.findByTestId('catpicker-sweets');
    expect(screen.queryByTestId('catpicker-savingDeposit')).toBeNull();
    fireEvent.click(screen.getByTestId('catpicker-sweets'));
    fireEvent.change(screen.getByTestId('part-cat-amount-0'), { target: { value: '20,00' } });
    fireEvent.change(screen.getByTestId('part-cat-amount-1'), { target: { value: '12,40' } });
    fireEvent.click(screen.getByTestId('part-cat-save'));

    // the spread lands with the settled entry RE-ATTACHED, untouched
    await waitFor(async () => {
      const row = await db.transactions.get('sx1');
      expect(row?.cats?.map((c) => [c.catId, c.amountCents])).toEqual([
        ['groceries', 2000],
        ['sweets', 1240],
        ['reimbursed', 2000],
      ]);
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  it('#228 (user ss): a settled PART wears its NET — headline, Original row, and the sibling list', async () => {
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-part-net'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'psplit', {
      accountId: 'demo_main', date: '2026-07-04', amountCents: 240_000, currency: 'EUR',
      merchant: 'Demo Corp BV', catId: 'salary', txType: 'income', needsReview: 0,
      cats: null as never,
      splits: [
        { id: 'pp1', catId: 'salary', amountCents: 120_000, cats: [{ catId: 'salary', amountCents: 119_580 }, { catId: 'reimbursed', amountCents: 420 }] },
        { id: 'pp2', catId: 'incomeOther', amountCents: 120_000 },
      ],
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'pkoffie', {
      accountId: 'demo_main', date: '2026-07-05', amountCents: -420, currency: 'EUR',
      merchant: 'Koffie', catId: 'reimbursed', txType: 'expense', needsReview: 0,
      reimbursements: [{ txId: 'psplit', amountCents: 420, creditPartId: 'pp1' }],
      cats: [{ catId: 'reimbursed', amountCents: 420 }],
    });

    renderApp('/transactions/psplit');
    // the container's part row already wears the NET…
    await waitFor(() => expect(screen.getByTestId('tx-detail-category-row').textContent).toContain('1,195.80'));
    fireEvent.click(screen.getByTestId('tx-detail-category-row'));
    // …and the part page's headline is what the part is WORTH (its
    // settled bookkeeping nets it) — the gross moved into Original
    await waitFor(() => expect(screen.getByTestId('tx-part-amount').textContent).toContain('1,195.80'));
    // #231 r2: the reimb card is links-only — no original/net rows; the
    // facts card still carries the part's gross
    expect(screen.queryByTestId('tx-part-original')).toBeNull();
    expect(screen.queryByTestId('tx-part-net')).toBeNull();
    // the siblings list nets too — and the untouched one keeps its face
    const siblings = screen.getByTestId('tx-part-siblings');
    expect(siblings.textContent).toContain('1,195.80');
    expect(siblings.textContent).toContain('1,200.00');
    // the settled bookkeeping renders as its own quiet row on the
    // category card — never a counter subline
    expect(screen.getByTestId('tx-part-cat-settled-0').textContent).toContain('Reimbursed');
    db.close();
  }, 20_000);
});

describe('SplitEditorSheet via detail (demo tx dm6, -€52.40)', () => {
  beforeEach(async () => {
    // #221: the boot chain runs the bare-row fold EVERY boot now — the
    // previous spec's chain must settle before the db goes away, or its
    // dying writes kill this spec's in-flight puts (the db.close trap)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('#211: split categories spread ONE transaction — no container, features stay, collapse restores', async () => {
    renderApp('/transactions/dm6');
    // the category row opens the split-CATEGORIES editor seeded with a
    // single entry; a second is added explicitly
    fireEvent.click(await screen.findByTestId('tx-detail-category-row'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-add'));

    // shrink the first entry: a remainder appears and blocks saving —
    // Done stays tappable but refuses while the remainder stands (#195)
    fireEvent.change(screen.getByTestId('part-cat-amount-0'), { target: { value: '30,00' } });
    const remainder = await screen.findByTestId('part-cat-remainder');
    expect(remainder.textContent).toContain('€22.40');
    fireEvent.click(screen.getByTestId('part-cat-save'));
    expect(screen.getByTestId('part-cats-editor')).toBeTruthy(); // still open, nothing saved
    expect(screen.getByTestId('part-cat-save').getAttribute('aria-invalid')).toBe('true');

    // give the second entry a category, auto-balance the remainder, save
    fireEvent.click(screen.getByTestId('part-cat-1'));
    fireEvent.click(await screen.findByTestId('catpicker-restaurants'));
    fireEvent.click(screen.getByTestId('part-cat-remainder'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));

    // the categories block shows one row per entry — but the row is
    // still ONE transaction: no container, the pencil and the whole-row
    // features stay, the split door stays a DOOR (not Manage splits)
    const catBlock = await screen.findByTestId('tx-detail-categories');
    await waitFor(() => expect(catBlock.textContent).toContain('€30.00'));
    expect(catBlock.textContent).toContain('€22.40');
    await screen.findByTestId('tx-detail-cat-restaurants');
    expect(screen.getByTestId('tx-detail-cats-edit')).toBeTruthy();
    expect(screen.getByTestId('tx-detail-recurring-row')).toBeTruthy();
    expect(screen.queryByTestId('tx-detail-manage-splits')).toBeNull();

    // stored as the row's own cats — never a split container
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const row = await db.transactions.get('dm6');
      expect(row?.cats).toEqual([
        { catId: 'groceries', amountCents: 3000 },
        { catId: 'restaurants', amountCents: 2240 },
      ]);
      expect(row?.splits ?? undefined).toBeUndefined();
      expect(row?.catId).toBe('groceries');
    }, { timeout: 5000 });

    // collapsing back to one entry clears the spread
    fireEvent.click(screen.getByTestId('tx-detail-cats-edit'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(await screen.findByTestId('part-cat-remove-1'));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.queryByTestId('tx-detail-cat-restaurants')).toBeNull());
    await waitFor(async () => {
      expect((await db.transactions.get('dm6'))?.cats ?? undefined).toBeUndefined();
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('#141: an exact-euros split reaches ONLY same-amount siblings (r2 user rule)', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    // two splitless siblings: one the exact amount, one half of it
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-splitbulk'), { trackOutbox: false });
    const dm6 = await db.transactions.get('dm6');
    await repo.upsert('transaction', DEMO_SPACE_ID, 'sib-exact', {
      accountId: 'demo_main', date: '2020-04-01', amountCents: -5240, currency: 'EUR',
      merchant: dm6?.merchant ?? '', catId: 'groceries', txType: 'expense', needsReview: 0,
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'sib-half', {
      accountId: 'demo_main', date: '2020-04-02', amountCents: -2620, currency: 'EUR',
      merchant: dm6?.merchant ?? '', catId: 'groceries', txType: 'expense', needsReview: 0,
    });

    fireEvent.click(await screen.findByTestId('tx-detail-category-row'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-add'));
    fireEvent.change(screen.getByTestId('part-cat-amount-0'), { target: { value: '30,00' } });
    fireEvent.click(screen.getByTestId('part-cat-1'));
    fireEvent.click(await screen.findByTestId('catpicker-restaurants'));
    fireEvent.click(screen.getByTestId('part-cat-remainder'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));

    // exact-euros spread: the bar arms with the SAME-amount sibling only;
    // apply copies the partition (#211: the sibling's own cats, never a
    // container); the half-size sibling stays untouched
    await screen.findByTestId('tx-detail-bulk-offer', {}, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('tx-detail-bulk-apply'));
    await waitFor(async () => {
      const sib = await db.transactions.get('sib-exact');
      expect(sib?.cats?.map((s) => s.amountCents)).toEqual([3000, 2240]);
      expect(sib?.cats?.[1]?.catId).toBe('restaurants');
      expect(sib?.splits ?? undefined).toBeUndefined();
      expect(sib?.needsReview).toBe(0);
    }, { timeout: 5000 });
    const half = await db.transactions.get('sib-half');
    expect(half?.cats ?? undefined).toBeUndefined();
    db.close();
  }, 15_000);

  it('percentage mode balances to 100 and stores materialized euro amounts', async () => {
    renderApp('/transactions/dm6');
    await screen.findByTestId('screen-tx-detail');
    // #141 r2: a PERCENTAGE split scales, so the bulk offer reaches
    // siblings of a DIFFERENT amount too — seed one to prove it arms
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-pctbulk'), { trackOutbox: false });
    const dm6row = await db.transactions.get('dm6');
    await repo.upsert('transaction', DEMO_SPACE_ID, 'sib-other', {
      accountId: 'demo_main', date: '2020-04-03', amountCents: -1234, currency: 'EUR',
      merchant: dm6row?.merchant ?? '', catId: 'groceries', txType: 'expense', needsReview: 0,
    });
    db.close();
    fireEvent.click(await screen.findByTestId('tx-detail-category-row'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-add'));
    // the gate (user request): the fresh entry must be finished —
    // category AND a value — before another may be added
    expect((screen.getByTestId('part-cat-add') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('part-cat-1'));
    fireEvent.click(await screen.findByTestId('catpicker-restaurants'));
    fireEvent.change(screen.getByTestId('part-cat-amount-1'), { target: { value: '0,01' } });

    // a third entry can be added and removed again
    fireEvent.click(screen.getByTestId('part-cat-add'));
    fireEvent.click(await screen.findByTestId('part-cat-remove-2'));

    // switch to % — the euro shape carries over (100 / 0)
    fireEvent.click(screen.getByTestId('part-cat-mode-pct'));
    expect((screen.getByTestId('part-cat-amount-0') as HTMLInputElement).value).toBe('100');

    // 60% leaves 40% open; auto-balance hands it to the open entry —
    // an eager Done refuses in place until it balances (#195)
    fireEvent.change(screen.getByTestId('part-cat-amount-0'), { target: { value: '60' } });
    const remainder = await screen.findByTestId('part-cat-remainder');
    expect(remainder.textContent).toContain('40%');
    fireEvent.click(screen.getByTestId('part-cat-save'));
    expect(screen.getByTestId('part-cat-save').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByTestId('part-cat-remainder'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));

    // the detail shows euros: 60/40 of €52.40, exactly partitioned
    const catBlock = await screen.findByTestId('tx-detail-categories');
    await waitFor(() => expect(catBlock.textContent).toContain('€31.44'));
    expect(catBlock.textContent).toContain('€20.96');
    // #141 r2: the pct spread's bulk offer armed for the €12.34 sibling
    await screen.findByTestId('tx-detail-bulk-offer', {}, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('tx-detail-bulk-dismiss'));

    // reopening (the pencil — the row is still a whole transaction)
    // restores percentage mode from the stored pct shape
    fireEvent.click(screen.getByTestId('tx-detail-cats-edit'));
    await screen.findByTestId('part-cats-editor');
    await waitFor(() => expect((screen.getByTestId('part-cat-amount-0') as HTMLInputElement).value).toBe('60'));
    expect((screen.getByTestId('part-cat-amount-1') as HTMLInputElement).value).toBe('40');
  });

  it('the detail split flow is drafted until complete, then lands in ONE write (#126 r4/r7)', async () => {
    renderApp('/transactions/dm6');
    // give the row its own note first — splitting must reset it (r7)
    const containerNotes = await screen.findByTestId('tx-detail-notes');
    fireEvent.change(containerNotes, { target: { value: 'pre-split note' } });
    fireEvent.blur(containerNotes);
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => expect((await db.transactions.get('dm6'))?.notes).toBe('pre-split note'), { timeout: 5000 });

    // #211: the category row opens the CATS editor — pure categories,
    // no part labels anywhere near it
    fireEvent.click(await screen.findByTestId('tx-detail-category-row'));
    await screen.findByTestId('part-cats-editor');
    expect(screen.queryByTestId('split-label-0')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' }); // back to the detail

    // the split door WARNS — a filled row resets when it splits (r7)
    fireEvent.click(await screen.findByTestId('tx-detail-split-row'));
    fireEvent.click(await screen.findByTestId('split-reset-continue'));
    await screen.findByTestId('split-label-0');
    const amount0 = (await screen.findByTestId('split-amount-0')) as HTMLInputElement;
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '30,00' } });
    fireEvent.blur(amount0);
    fireEvent.click(screen.getByTestId('split-add-row'));
    // the fresh part seeds the open remainder — the sum stands
    await waitFor(() => expect((screen.getByTestId('split-amount-1') as HTMLInputElement).value).toBe('22,40'));
    await waitFor(() => expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('split-save'));

    // Done STAGES — the completion deck opens, NOTHING is written yet
    await screen.findByTestId('split-complete');
    expect((await db.transactions.get('dm6'))?.splits).toBeUndefined();

    // r7: Apply stays TAPPABLE — the refused tap marks the uncategorized
    // part on its number circle and writes nothing
    expect((screen.getByTestId('split-apply') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('split-apply'));
    await screen.findByTestId('deck-attention');
    await screen.findByTestId('deck-attn-1');
    expect((await db.transactions.get('dm6'))?.splits).toBeUndefined();

    // naming part 2 makes it a real PART; Set aside (◆ pulls the saving
    // type through the part editor) completes it — Apply lands the whole
    // split in one write and RESETS the container's own story
    fireEvent.click(screen.getByTestId('deck-part-1'));
    fireEvent.change(await screen.findByTestId('deck-label-1'), { target: { value: 'Device plan' } });
    fireEvent.click(await screen.findByTestId('deck-cat-1'));
    // the row-level cats editor stays mounted under IS_TEST — the deck's
    // copy is the LAST one
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId('part-cat-0').at(-1)!);
    fireEvent.click((await screen.findAllByTestId('catpicker-savingDeposit')).at(-1)!);
    await waitFor(() => expect((screen.getAllByTestId('part-cat-save').at(-1) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByTestId('part-cat-save').at(-1)!);
    await waitFor(() => expect(screen.queryByTestId('deck-attn-1')).toBeNull());
    fireEvent.click(screen.getByTestId('split-apply'));
    await waitFor(async () => {
      const row = await db.transactions.get('dm6');
      expect(row?.splits).toHaveLength(2);
      expect(row?.splits?.[1]?.txType).toBe('saving');
      expect(row?.splits?.[1]?.label).toBe('Device plan');
      expect(row?.notes ?? '').toBe(''); // the container's note reset (r7)
    }, { timeout: 5000 });

    // the container steps back: the manage door is the arrival signal
    // (#133 D: kind rows are gone everywhere, they anchor nothing now)
    await screen.findByTestId('tx-detail-manage-splits');
    await waitFor(() => expect(screen.queryByTestId('tx-detail-recurring-row')).toBeNull());
    // r9: the parts section says what it lists, and the part-owned
    // blocks (reimbursements, receipt) leave with the notes — while the
    // customize door STAYS (#232: actions/facts are customizable here)
    expect(screen.getByText('Split transactions')).toBeTruthy();
    expect(screen.queryByTestId('reimb-list')).toBeNull();
    expect(screen.queryByTestId('receipt-file')).toBeNull();
    expect(screen.getByTestId('tx-detail-customize')).toBeTruthy();
    // #200: no Edit pencil on a container, and a part row NAVIGATES to
    // its page instead of opening the manage flow
    expect(screen.queryByTestId('tx-detail-cats-edit')).toBeNull();
    fireEvent.click(screen.getByTestId('tx-detail-category-row'));
    await screen.findByTestId('tx-part-amount');
    db.close();
  }, 15_000);

  it('a split row unfolds into its sub-transactions; each part is its own page (#126 r4)', async () => {
    renderApp('/transactions');
    await screen.findByTestId('screen-transactions');

    // a stored, complete split: telecom expense + a typed device-plan part
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-parts'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'tx-parts', {
      accountId: 'demo_main',
      date: '2020-02-01',
      amountCents: -6500,
      currency: 'EUR',
      merchant: 'Vodafone',
      catId: 'telecom',
      txType: 'expense',
      needsReview: 0,
      splits: [
        { id: 'pp1', catId: 'telecom', amountCents: 4000 },
        // linked, not bare — the #221 every-boot fold would otherwise
        // default-link this movement part mid-spec and race the writes
        { id: 'pp2', catId: 'savingDeposit', amountCents: 2500, txType: 'saving', label: 'Device plan', linkedAccountId: 'demo_save' },
      ],
      // r5: a reimbursement that targets ONE part
      reimbursements: [{ txId: 'rcredit', amountCents: 500, partId: 'pp2' }],
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'rcredit', {
      accountId: 'demo_main',
      date: '2020-02-02',
      amountCents: 500,
      currency: 'EUR',
      merchant: 'Sam pays back',
      catId: 'reimbursed',
      txType: 'income',
      needsReview: 0,
    });
    // #228: the boot normalizer settles the part-targeted link into the
    // PART's own cats — let it finish, or its splits write races the
    // note write below (the boot-chain trap)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;

    // r5/r6: the container row is GONE — a compact header band names the
    // original transaction with the NET amount (#228: the reimbursed
    // part shrank the whole) and the part count, and the
    // sub-transactions stand as first-class rows branching off it
    await screen.findByTestId('tx-parts-tx-parts', {}, { timeout: 5000 });
    expect(screen.queryByTestId('tx-row-tx-parts')).toBeNull();
    // #198: the subtle form — parts sit in an inset, each led by a
    // small branch arrow (the accent band/border era is over)
    expect(screen.getByTestId('tx-parts-tx-parts').querySelector('.mdi-subdirectory-arrow-right')).toBeTruthy();
    const head = screen.getByTestId('tx-parts-head-tx-parts');
    expect(head.textContent).toContain('Vodafone');
    expect(head.textContent).toContain('2 split parts');
    await waitFor(() => expect(screen.getByTestId('tx-parts-head-tx-parts').textContent).toMatch(/60\.00/));
    expect(screen.getByTestId('tx-part-row-tx-parts-1').textContent).toContain('Device plan');

    // r6: the chevron folds the parts under the band and back out
    fireEvent.click(screen.getByTestId('tx-parts-toggle-tx-parts'));
    expect(screen.queryByTestId('tx-part-row-tx-parts-1')).toBeNull();
    fireEvent.click(screen.getByTestId('tx-parts-toggle-tx-parts'));
    await screen.findByTestId('tx-part-row-tx-parts-1');

    // tapping a part opens ITS page: what it is WORTH (#228: the €5.00
    // reimbursement nets the €25.00 device part), its own type, its story
    fireEvent.click(screen.getByTestId('tx-part-row-tx-parts-1'));
    await screen.findByTestId('tx-part-amount');
    expect(screen.getByTestId('tx-part-amount').textContent).toContain('20.00');
    // #133 D: no Type row on the part page; #228: the counterparty is
    // the part's own PROPERTY row — present, honest about "none"
    expect(screen.queryByTestId('tx-part-kind-row')).toBeNull();
    // the face waits on the accounts live query
    await waitFor(() => expect(screen.getByTestId('tx-part-counter-row').textContent).toContain('Demo Savings'));

    // r5: its own reimbursements — the part-targeted link row (#231 r2:
    // the card is links-only, no net row)
    await waitFor(() => expect(screen.getByTestId('tx-part-reimbs').textContent).toContain('Sam pays back'), { timeout: 5000 });
    expect(screen.queryByTestId('tx-part-net')).toBeNull();
    // #199: the parent's Details card shows right on the part page
    expect(screen.getByTestId('tx-detail-facts')).toBeTruthy();

    // r5: its own note, saved into the part itself
    const notes = screen.getByTestId('tx-part-notes') as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: 'Device 12 of 24' } });
    fireEvent.blur(notes);
    await waitFor(async () => {
      const row = await db.transactions.get('tx-parts');
      expect(row?.splits?.[1]?.notes).toBe('Device 12 of 24');
    }, { timeout: 5000 });
    // its siblings are one tap away; itself sits inert
    expect(screen.getByTestId('tx-part-siblings').textContent).toContain('Telecom');
    fireEvent.click(screen.getByTestId('tx-part-sibling-0'));
    await waitFor(() => expect(screen.getByTestId('tx-part-amount').textContent).toContain('40.00'));

    // r7: NO kind restriction — pulling 'saving' onto this part lands
    // even though the Device plan is saving too (#217: the category card
    // is per-entry ROWS now; any row opens the part-scoped editor)
    fireEvent.click(screen.getByTestId('tx-part-category-row'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    // #133 D: the ◆ pick opens the part's counterparty ask — walking
    // away keeps the bare story (Escape is sheet-owned now)
    await screen.findByTestId('counter-default');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('tx-part-category').textContent).toContain('Set aside'));

    // an ordinary pick lands too and clears the pulled type
    fireEvent.click(screen.getByTestId('tx-part-category'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-coffee'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('tx-part-category').textContent).toContain('Coffee'));

    // r6/r7: the part spreads its own €40.00 across TWO categories in
    // the same editor — the pill puts the rest on the new row, and the
    // write carries the cats spread
    fireEvent.click(screen.getByTestId('tx-part-category-row'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-add'));
    fireEvent.click(await screen.findByTestId('part-cat-1'));
    fireEvent.click(await screen.findByTestId('catpicker-telecom'));
    const spreadAmount0 = screen.getByTestId('part-cat-amount-0') as HTMLInputElement;
    fireEvent.focus(spreadAmount0);
    fireEvent.change(spreadAmount0, { target: { value: '15,00' } });
    fireEvent.blur(spreadAmount0);
    fireEvent.click(await screen.findByTestId('part-cat-remainder'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(async () => {
      const row = await db.transactions.get('tx-parts');
      expect(row?.splits?.[0]?.cats).toEqual([
        { catId: 'coffee', amountCents: 1500 },
        { catId: 'telecom', amountCents: 2500 },
      ]);
      expect(row?.splits?.[0]?.catId).toBe('telecom');
    }, { timeout: 5000 });
    // #217/#138 (user): the part card lists EACH category as its own
    // row, value included — no joined summary anymore
    await waitFor(() => expect(screen.getByTestId('tx-part-cat-1').textContent).toContain('Telecom'));
    expect(screen.getByTestId('tx-part-category-row').textContent).toMatch(/15\.00/);
    expect(screen.getByTestId('tx-part-cat-1').textContent).toMatch(/25\.00/);

    // r7: the part links a recurring cost right here — detail parity.
    // #251: the picker carries the quick-create door too
    fireEvent.click(screen.getByTestId('tx-part-rec'));
    await screen.findByTestId('tx-part-rec-list');
    expect(screen.getByTestId('tx-part-rec-create')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tx-part-rec-none'));
    expect(screen.getByTestId('tx-part-rec').textContent).toContain('None');

    // the part's event membership edits right here as well
    fireEvent.click(screen.getByTestId('tx-part-event'));
    await screen.findByTestId('tx-part-event-list');
    expect(screen.getByTestId('tx-part-event-create')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tx-part-event-none'));

    // the whole transaction stays one tap away and shows the container
    fireEvent.click(screen.getByTestId('tx-part-whole'));
    await screen.findByTestId('tx-detail-categories');
    expect(screen.queryByTestId('tx-part-amount')).toBeNull();
    // the container carries no type row — the parts do (#126 r4)
    expect(screen.queryByTestId('tx-detail-kind-row')).toBeNull();
    db.close();
  }, 15_000);

  it('r9: the part label renames from its own page — save trims, reset settles to the default', async () => {
    renderApp('/transactions');
    await screen.findByTestId('screen-transactions');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-rename'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'tx-parts', {
      accountId: 'demo_main',
      date: '2020-02-01',
      amountCents: -6500,
      currency: 'EUR',
      merchant: 'Vodafone',
      catId: 'telecom',
      txType: 'expense',
      needsReview: 0,
      splits: [
        { id: 'pp1', catId: 'telecom', amountCents: 4000 },
        // linked, not bare — the #221 every-boot fold would otherwise
        // default-link this movement part mid-spec and race the writes
        { id: 'pp2', catId: 'savingDeposit', amountCents: 2500, txType: 'saving', label: 'Device plan', linkedAccountId: 'demo_save' },
      ],
    });
    await screen.findByTestId('tx-parts-tx-parts', {}, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('tx-part-row-tx-parts-1'));
    await screen.findByTestId('tx-part-amount');

    // the app bar pencil opens the rename sheet primed with the label
    fireEvent.click(screen.getByTestId('tx-part-rename'));
    const input = (await screen.findByTestId('tx-rename-input')) as HTMLInputElement;
    expect(input.value).toBe('Device plan');
    fireEvent.change(input, { target: { value: '  Phone chunk  ' } });
    fireEvent.click(screen.getByTestId('tx-rename-save'));
    await waitFor(async () => {
      const row = await db.transactions.get('tx-parts');
      expect(row?.splits?.[1]?.label).toBe('Phone chunk');
    }, { timeout: 5000 });

    // reset clears the label — the page falls back to the derived name
    fireEvent.click(screen.getByTestId('tx-part-rename'));
    fireEvent.click(await screen.findByTestId('tx-rename-reset'));
    await waitFor(async () => {
      const row = await db.transactions.get('tx-parts');
      expect(row?.splits?.[1]?.label).toBeUndefined();
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('register-style amount entry: digits fill cents from the right (user request)', async () => {
    renderApp('/transactions/dm6');
    fireEvent.click(await screen.findByTestId('tx-detail-category-row'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-add'));

    const amount = screen.getByTestId('part-cat-amount-1') as HTMLInputElement;
    fireEvent.focus(amount); // arms the register; the empty lands a frame later (#134)
    await waitFor(() => expect(amount.value).toBe(''));
    fireEvent.change(amount, { target: { value: '5' } });
    expect(amount.value).toBe('0,05');
    fireEvent.change(amount, { target: { value: '0,055' } });
    expect(amount.value).toBe('0,55');
    fireEvent.change(amount, { target: { value: '0,550' } });
    expect(amount.value).toBe('5,50');
    // a comma promotes typed digits to euros and frees the field
    fireEvent.change(amount, { target: { value: '5,50,' } });
    expect(amount.value).toBe('550,');
  });
});

describe('bulk apply from the detail (user request)', () => {
  beforeEach(async () => {
    // #221: the boot chain runs the bare-row fold EVERY boot now — the
    // previous spec's chain must settle before the db goes away, or its
    // dying writes kill this spec's in-flight puts (the db.close trap)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
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
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-hobby'));
    fireEvent.click(screen.getByTestId('part-cat-save'));

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
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-hobby'));
    fireEvent.click(screen.getByTestId('part-cat-save'));

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
  beforeEach(async () => {
    // #221: the boot chain runs the bare-row fold EVERY boot now — the
    // previous spec's chain must settle before the db goes away, or its
    // dying writes kill this spec's in-flight puts (the db.close trap)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
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
  beforeEach(async () => {
    // #221: the boot chain runs the bare-row fold EVERY boot now — the
    // previous spec's chain must settle before the db goes away, or its
    // dying writes kill this spec's in-flight puts (the db.close trap)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
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

  it('#237: Remove on the unpair question tombstones the generated leg and refunds its balance', async () => {
    // build the pair through the real form (the pot's leg mints at save)
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    const db = new MunniDB('munni_demo');
    let potBefore = 0;
    await waitFor(async () => {
      const pot = await db.accounts.get('demo_save');
      expect(pot).toBeTruthy();
      potBefore = pot!.balanceCents;
    });
    fireEvent.click(screen.getByTestId('tx-add'));
    await screen.findByTestId('txform-save');
    fireEvent.click(await screen.findByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
    fireEvent.change(screen.getByTestId('txform-amount'), { target: { value: '61,00' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Pot removal' } });
    fireEvent.click(screen.getByTestId('txform-counter'));
    await screen.findByTestId('counter-accounts');
    fireEvent.click(screen.getByTestId('counter-pick-demo_save'));
    fireEvent.click(screen.getByTestId('txform-save'));

    let outId = '';
    let mirrorId = '';
    await waitFor(async () => {
      const rows = await db.transactions.filter((r) => r.merchant === 'Pot removal' && r.deleted === 0).toArray();
      expect(rows).toHaveLength(2);
      outId = rows.find((r) => r.amountCents < 0)!.id;
      mirrorId = rows.find((r) => r.amountCents > 0)!.id;
      expect((await db.accounts.get('demo_save'))?.balanceCents).toBe(potBefore + 6100);
    }, { timeout: 5000 });

    cleanup();
    renderApp(`/transactions/${outId}`);
    await screen.findByTestId('screen-tx-detail');
    fireEvent.click(await screen.findByTestId('tx-detail-unpair'));
    fireEvent.click(await screen.findByTestId('tx-unpair-remove'));
    await waitFor(async () => {
      // the generated leg tombstones and its money returns
      expect((await db.transactions.get(mirrorId))?.deleted).toBe(1);
      expect((await db.accounts.get('demo_save'))?.balanceCents).toBe(potBefore);
      // the source keeps its story: category and counterparty stay
      const src = await db.transactions.get(outId);
      expect(src?.transferPeerId).toBeFalsy();
      expect(src?.linkedAccountId).toBe('demo_save');
      expect(src?.catId).toBe('savingDeposit');
    }, { timeout: 5000 });
    db.close();
  }, 20_000);

  it('#237: unlinking a DEFAULT counter asks, then resets the story and removes its leg', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('deflink'), { trackOutbox: false });
    // a bare movement row: the next boot's fold links the space default
    // and mints its leg (#221) — exactly the state the user unlinks
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'r237d', {
      accountId: 'demo_main', date: '2026-07-20', amountCents: -4200, currency: 'EUR',
      merchant: 'Default unlink', catId: 'savingDeposit', txType: 'saving', needsReview: 0,
    });
    seed.close();
    cleanup();
    renderApp('/transactions/r237d');
    await screen.findByTestId('screen-tx-detail');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      expect((await db.transactions.get('r237d'))?.linkedAccountId).toBe('defaultacct_saving_demo_space');
    }, { timeout: 8000 });
    // the unpair gate reads the linked ACCOUNT row — wait for its face,
    // or the ask routes to the generated-leg question instead
    await waitFor(() =>
      expect(screen.getByTestId('tx-detail-linked-account').textContent).toContain('Default savings'), { timeout: 8000 });

    fireEvent.click(await screen.findByTestId('tx-detail-unpair'));
    // #237 (user): "unlinking will reset the category and counterparty"
    await screen.findByTestId('tx-unlink-default-body');
    fireEvent.click(screen.getByTestId('tx-unlink-default-confirm'));
    await waitFor(async () => {
      const src = await db.transactions.get('r237d');
      expect(src?.linkedAccountId).toBeFalsy();
      expect(src?.transferPeerId).toBeFalsy();
      expect(src?.catId).toBe('uncategorized');
      // the default's leg is auto-removed with the link (user rule)
      expect((await db.transactions.get(mirrorTxId('r237d')))?.deleted).toBe(1);
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  it('#237 (a): the awaiting pill grows a pick door — a same-sign wallet pick pairs, the purchase keeps its category', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('wallet'), { trackOutbox: false });
    // a bank-fed wallet: PayPal-style, only debits ever arrive
    await seedRepo.upsert('account', DEMO_SPACE_ID, 'wl', {
      name: 'Wallet PayPal', type: 'checking', source: 'camt053', currency: 'EUR', balanceCents: 0,
    });
    // the bank top-up, already linked to the wallet — Awaiting counterpart
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'bank1', {
      accountId: 'demo_main', date: '2026-07-14', amountCents: -799, currency: 'EUR',
      merchant: 'PayPal top-up', catId: 'transferOut', txType: 'transfer', needsReview: 0, linkedAccountId: 'wl',
    });
    // the real purchase on the wallet — same sign, same size
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'wp1', {
      accountId: 'wl', date: '2026-07-14', amountCents: -799, currency: 'EUR',
      merchant: 'Vueling', catId: 'holiday', txType: 'expense', needsReview: 0,
    });
    seed.close();
    cleanup();
    renderApp('/transactions/bank1');
    await screen.findByTestId('screen-tx-detail');
    await screen.findByTestId('tx-detail-awaiting');
    fireEvent.click(await screen.findByTestId('tx-detail-pick-counter'));

    // the match sheet: the wallet story explained, the purchase offered
    await screen.findByTestId('counter-samesign-hint');
    fireEvent.click((await screen.findByTestId('counter-dup-wp1')).querySelector('button')!);

    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const bank = await db.transactions.get('bank1');
      const purchase = await db.transactions.get('wp1');
      expect(bank?.transferPeerId).toBe('wp1');
      // the purchase pairs WITHOUT becoming a transfer: category, type
      // and the absent link all stay — the overviews keep counting it
      expect(purchase?.transferPeerId).toBe('bank1');
      expect(purchase?.linkedAccountId).toBeFalsy();
      expect(purchase?.catId).toBe('holiday');
    }, { timeout: 8000 });

    // the purchase side shows the pairing too
    cleanup();
    renderApp('/transactions/wp1');
    await screen.findByTestId('screen-tx-detail');
    await screen.findByTestId('tx-detail-peer');
    db.close();
  }, 25_000);

  it('#237 r2: picking a FEED-JOINED row writes the reciprocal into the OVERLAY, never the raw row', async () => {
    // the user's one-way pair: pairWithExistingRow resolved the picked
    // row via store.get → the RAW feed row → writeTxTransform wrote the
    // reciprocal onto data every reader ignores. The purchase kept
    // reading "no counterpart" and the sheet kept offering it.
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('feedpair'), { trackOutbox: false });
    const FEED = 'feed_wl_237';
    // the bank-fed wallet lives in its own FEED space, joined via the link
    await seedRepo.upsert('account', FEED, 'wlacct', {
      name: 'PayPal feed', type: 'checking', source: 'gocardless', currency: 'EUR', balanceCents: 0,
    });
    await seedRepo.upsert('accountLink', DEMO_SPACE_ID, accountLinkId(DEMO_SPACE_ID, FEED), {
      feedSpaceId: FEED, accountId: 'wlacct',
    });
    // the raw purchase, as the ingest writes it (no opinion fields)
    await seedRepo.upsert('transaction', FEED, 'fp1', {
      accountId: 'wlacct', date: '2026-07-14', amountCents: -799, currency: 'EUR', merchant: 'Axosoft, LLC',
    });
    // the bank top-up, already linked to the wallet — Awaiting counterpart
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'bankf', {
      accountId: 'demo_main', date: '2026-07-14', amountCents: -799, currency: 'EUR',
      merchant: 'PayPal top-up', catId: 'transferOut', txType: 'transfer', needsReview: 0, linkedAccountId: 'wlacct',
    });
    seed.close();
    cleanup();
    renderApp('/transactions/bankf');
    await screen.findByTestId('screen-tx-detail');
    await screen.findByTestId('tx-detail-awaiting');
    fireEvent.click(await screen.findByTestId('tx-detail-pick-counter'));
    await screen.findByTestId('counter-samesign-hint');
    fireEvent.click((await screen.findByTestId('counter-dup-fp1')).querySelector('button')!);

    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      expect((await db.transactions.get('bankf'))?.transferPeerId).toBe('fp1');
      // THE fix: the reciprocal lands in the space's overlay…
      expect((await db.txMeta.get(txMetaId(DEMO_SPACE_ID, 'fp1')))?.transferPeerId).toBe('bankf');
      // …and the raw feed row stays raw (per-space transformation rule)
      expect((await db.transactions.get('fp1'))?.transferPeerId).toBeFalsy();
    }, { timeout: 8000 });

    // the joined purchase now RENDERS as peered — the rich card carries
    // the other leg's face — and its pick door is gone
    cleanup();
    renderApp('/transactions/fp1');
    await screen.findByTestId('screen-tx-detail');
    const peerRow = await screen.findByTestId('tx-detail-peer');
    await waitFor(() => expect(peerRow.textContent).toContain('PayPal top-up'));
    expect(peerRow.textContent).toContain('2026-07-14');
    db.close();
  }, 25_000);

  it('#237 r2: re-picking on the SAME counter account still pairs (linkChanged=false path)', async () => {
    // the user's screenshot flow: the row already links Paypal, the
    // property row re-opens the ask and points at a row — the pick used
    // to write NOTHING because only link changes carried the peer
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('samepick'), { trackOutbox: false });
    await seedRepo.upsert('account', DEMO_SPACE_ID, 'wl3', {
      name: 'Wallet 3', type: 'checking', source: 'camt053', currency: 'EUR', balanceCents: 0,
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'rp1', {
      accountId: 'demo_main', date: '2026-07-22', amountCents: -4367, currency: 'EUR',
      merchant: 'PayPal Europe', catId: 'transferOut', txType: 'transfer', needsReview: 0, linkedAccountId: 'wl3',
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'rp2', {
      accountId: 'wl3', date: '2026-07-21', amountCents: -4356, currency: 'EUR',
      merchant: 'Axosoft, LLC', catId: 'consumption', txType: 'expense', needsReview: 0,
    });
    seed.close();
    cleanup();
    renderApp('/transactions/rp1');
    await screen.findByTestId('screen-tx-detail');
    await waitFor(() =>
      expect(screen.getByTestId('tx-detail-linked-account').textContent).toContain('Wallet 3'), { timeout: 8000 });
    // the PROPERTY row re-opens the ask on the already-linked account
    fireEvent.click(screen.getByTestId('tx-detail-counter-row'));
    fireEvent.click(await screen.findByTestId('counter-pick-wl3'));
    await screen.findByTestId('counter-samesign-hint');
    fireEvent.click((await screen.findByTestId('counter-dup-rp2')).querySelector('button')!);

    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      expect((await db.transactions.get('rp1'))?.transferPeerId).toBe('rp2');
      expect((await db.transactions.get('rp2'))?.transferPeerId).toBe('rp1');
      // the purchase keeps its own story (decision "a")
      expect((await db.transactions.get('rp2'))?.catId).toBe('consumption');
    }, { timeout: 8000 });
    db.close();
  }, 25_000);

  it('#237 r2: a ONE-WAY pair renders from the pointed side, heals its reciprocal, and stops being offered', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('oneway'), { trackOutbox: false });
    await seedRepo.upsert('account', DEMO_SPACE_ID, 'wl4', {
      name: 'Wallet 4', type: 'checking', source: 'camt053', currency: 'EUR', balanceCents: 0,
    });
    // the stored one-way state the old bug left behind: the bank leg
    // points at the purchase, the purchase knows nothing
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'owb', {
      accountId: 'demo_main', date: '2026-07-17', amountCents: -4356, currency: 'EUR',
      merchant: 'PayPal Europe', catId: 'transferOut', txType: 'transfer', needsReview: 0,
      linkedAccountId: 'wl4', transferPeerId: 'owp',
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'owp', {
      accountId: 'wl4', date: '2026-07-16', amountCents: -4356, currency: 'EUR',
      merchant: 'Axosoft, LLC', catId: 'consumption', txType: 'expense', needsReview: 0,
    });
    seed.close();
    cleanup();
    // opening the POINTED side shows the pair (reverse read) and heals it
    renderApp('/transactions/owp');
    await screen.findByTestId('screen-tx-detail');
    const peerRow = await screen.findByTestId('tx-detail-peer');
    expect(peerRow.textContent).toContain('PayPal Europe');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      expect((await db.transactions.get('owp'))?.transferPeerId).toBe('owb');
    }, { timeout: 8000 });
    db.close();
  }, 25_000);
});
