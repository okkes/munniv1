// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { CLIENT_PROTOCOL } from '@/lib/protocol';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';
import { DEMO_SPACE_ID } from '@/db/seed';
import { HlcClock } from '@/sync/hlc';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';

describe('ReviewScreen (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  // #330 r2: the demo cards wear their seeded category, so the split
  // door warns on the FIRST press now — walk through to the editor
  const openSplitEditor = async () => {
    fireEvent.click(await screen.findByTestId('review-split-row'));
    fireEvent.click(await screen.findByTestId('split-reset-continue', {}, { timeout: 10_000 }));
    await screen.findByTestId('split-editor');
  };

  it('walks the queue with progress: confirm clears the flag and advances', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    // demo seed ships 3 flagged transactions, all different merchants
    expect(screen.getByText('1 / 3')).toBeTruthy();

    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(() => expect(screen.getByText('2 / 3')).toBeTruthy(), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(() => expect(screen.getByText('3 / 3')).toBeTruthy(), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    // queue drained — the empty state replaces the card
    expect(await screen.findByTestId('review-empty')).toBeTruthy();
  }, 15_000);

  it('#133 C: no kind row — a ◆ pick asks the counterparty; #228: the card\'s own Counterparty row carries it', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');

    // the kind concept is gone from the card; #228 feedback: the
    // counterparty is the card's OWN row again, empty-faced for now
    expect(screen.queryByTestId('review-kind-row')).toBeNull();
    expect(screen.getByTestId('review-counter-row').textContent).toContain('No counter account');

    // #211: the chip opens the split-CATEGORIES editor — pure categories
    fireEvent.click(screen.getByTestId('review-category-chip'));
    await screen.findByTestId('part-cats-editor');
    expect(screen.queryByTestId('split-counter-row')).toBeNull();
    expect(screen.queryByTestId('split-type-row')).toBeNull();
    fireEvent.click(screen.getByTestId('part-cat-0'));
    await screen.findByTestId('speccat-savingDeposit'); // the diamond mark
    // #133 r5 matrix: a regular account's OUTGOING row sees exactly ONE
    // saving sub — Take out and Fees live on the pot's own ledger (the
    // user's screenshot: "in this use case I was expecting only one")
    expect(screen.queryByTestId('catpicker-savingWithdraw')).toBeNull();
    expect(screen.queryByTestId('catpicker-savingFees')).toBeNull();
    expect(screen.queryByTestId('catpicker-savingInterest')).toBeNull();
    fireEvent.click(screen.getByTestId('catpicker-savingDeposit'));

    // #133 r4: the ◆ pick asks its counterparty ON THE SPOT — Default
    // pinned on top; the pot answers it (#228 feedback: no counter line
    // under the entry anymore — the card row will tell the story)
    await screen.findByTestId('counter-default');
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('demo_save'));
    // Done stages category + link together; the card's Counterparty row
    // names the pot — no "→ account" subline under the category
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('Demo Savings'));
    expect(screen.queryByTestId('review-cat-counter-savingDeposit')).toBeNull();
  }, 15_000);

  it('#268: a row-level pick keeps bulk — confirm walks each sibling through its own counter queue', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('revpick'), { trackOutbox: false });
    // two same-merchant cards (the bulk offer's fuel), dated OLDEST so
    // they lead the queue; each has its own pickable twin on the pot
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'rv1', {
      accountId: 'demo_main', date: '2026-01-02', amountCents: -500, currency: 'EUR',
      merchant: 'Coffee Corner', needsReview: 1,
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'rv2', {
      accountId: 'demo_main', date: '2026-01-03', amountCents: -500, currency: 'EUR',
      merchant: 'Coffee Corner', needsReview: 1,
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'rvc', {
      accountId: 'demo_save', date: '2026-01-02', amountCents: 500, currency: 'EUR',
      merchant: 'Pot side', catId: 'uncategorized', needsReview: 0,
    });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'rvc2', {
      accountId: 'demo_save', date: '2026-01-03', amountCents: 500, currency: 'EUR',
      merchant: 'Pot side two', catId: 'uncategorized', needsReview: 0,
    });
    seed.close();
    cleanup();
    renderApp('/review');
    await screen.findByTestId('review-card');
    await screen.findByTestId('review-bulk'); // the sibling offer is up

    fireEvent.click(screen.getByTestId('review-counter-row'));
    // #237 r3: ONE tap — the sheet closes, no fork; the card's own
    // Counter-transaction row appears with the create default
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('Demo Savings'));
    const counterTxRow = await screen.findByTestId('review-countertx-row');
    expect(counterTxRow.textContent).toContain('created on confirm');
    fireEvent.click(counterTxRow);
    // #268 (user): picking the pot's twin no longer warns or silences
    // the bulk — the siblings will queue for their own counters
    fireEvent.click((await screen.findByTestId('counter-dup-rvc')).querySelector('button')!);
    await waitFor(() => expect(screen.getByTestId('review-countertx-row').textContent).toContain('Pot side'));
    expect(screen.queryByTestId('review-pick-warn')).toBeNull();
    expect(screen.getByTestId('review-bulk')).toBeTruthy();

    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    // the per-sibling queue opens, naming WHICH transaction is matching
    const context = await screen.findByTestId('counter-queue-context', undefined, { timeout: 10_000 });
    expect(context.textContent).toContain('Coffee Corner');
    expect(context.textContent).toContain('1/1');
    // #268 r2 (user): the deck HOLDS behind the queue — the confirmed
    // card stays frozen (no advance, no exit flight) while it runs
    expect(screen.getByTestId('review-card').getAttribute('data-held')).toBe('1');
    const heldMeta = screen.getByTestId('review-card-meta').textContent;
    expect(heldMeta).toContain('2 January'); // rv1's own face, not rv2's
    // #268 r2: the info bulb says WHY every sibling asks again
    fireEvent.click(screen.getByTestId('counter-queue-why-toggle'));
    expect((await screen.findByTestId('counter-queue-why')).textContent).toContain('needs its own');
    fireEvent.click(screen.getByTestId('counter-queue-why-toggle'));
    expect(screen.queryByTestId('counter-queue-why')).toBeNull();
    // the sibling picks ITS OWN twin (rv1's pick is spoken for)
    fireEvent.click((await screen.findByTestId('counter-dup-rvc2')).querySelector('button')!);
    // queue done — the hold releases and the deck moves on
    await waitFor(() => expect(screen.queryByTestId('counter-queue-context')).toBeNull(), { timeout: 10_000 });
    await waitFor(() => {
      expect(screen.getByTestId('review-card').getAttribute('data-held')).toBeNull();
      expect(screen.getByTestId('review-card-meta').textContent).not.toBe(heldMeta);
    }, { timeout: 10_000 });

    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const source = await db.transactions.get('rv1');
      expect(source?.needsReview).toBe(0);
      expect(source?.linkedAccountId).toBe('demo_save');
      expect(source?.transferPeerId).toBe('rvc');
      // the reciprocal landed; nothing was minted
      expect((await db.transactions.get('rvc'))?.transferPeerId).toBe('rv1');
      // #268: the sibling rode along WITH its own picked pair
      const sibling = await db.transactions.get('rv2');
      expect(sibling?.needsReview).toBe(0);
      expect(sibling?.linkedAccountId).toBe('demo_save');
      expect(sibling?.transferPeerId).toBe('rvc2');
      expect((await db.transactions.get('rvc2'))?.transferPeerId).toBe('rv2');
    }, { timeout: 8000 });
    db.close();
  }, 25_000);

  it('#268 r2: the bulk list holds only LATER unreviewed siblings — reviewed, current and skipped rows drop out', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('revwalk'), { trackOutbox: false });
    // the user's "7 paypals" walk in miniature: three same-merchant
    // unreviewed rows, oldest first (categorized so Confirm is live)
    const base = { accountId: 'demo_main', currency: 'EUR', merchant: 'Metro Market', catId: 'groceries', needsReview: 1 as const };
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'rw1', { ...base, date: '2026-01-02', amountCents: -500 });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'rw2', { ...base, date: '2026-01-03', amountCents: -600 });
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'rw3', { ...base, date: '2026-01-04', amountCents: -700 });
    seed.close();
    cleanup();
    renderApp('/review');
    await screen.findByTestId('review-card', undefined, { timeout: 10_000 });

    // card 1 of 3: the offer counts the OTHER two — never itself
    await waitFor(() => expect(screen.getByTestId('review-bulk-toggle').getAttribute('aria-label')).toContain('2 similar'), { timeout: 10_000 });
    fireEvent.click(screen.getByTestId('review-bulk-expand'));
    await screen.findByTestId('review-bulk-list');
    expect(screen.queryByTestId('review-bulk-rw1')).toBeNull(); // the current card itself
    expect(screen.getByTestId('review-bulk-rw2')).toBeTruthy();
    expect(screen.getByTestId('review-bulk-rw3')).toBeTruthy();

    // confirm WITHOUT the bulk (untick all): only this card is written
    fireEvent.click(screen.getByTestId('review-bulk-toggle'));
    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    // card 2: the count dropped by exactly the reviewed one
    await waitFor(() => expect(screen.getByTestId('review-card-meta').textContent).toContain('3 January'), { timeout: 10_000 });
    await waitFor(() => expect(screen.getByTestId('review-bulk-toggle').getAttribute('aria-label')).toContain('1 similar'), { timeout: 10_000 });
    // the sheet remounts with the card — open it again for the list
    fireEvent.click(screen.getByTestId('review-bulk-expand'));
    await screen.findByTestId('review-bulk-list', undefined, { timeout: 10_000 });
    expect(screen.queryByTestId('review-bulk-rw1')).toBeNull(); // reviewed — must never ride again
    expect(screen.queryByTestId('review-bulk-rw2')).toBeNull(); // now the current card
    expect(screen.getByTestId('review-bulk-rw3')).toBeTruthy();

    // skip card 2: a skipped card left the deck on purpose — the last
    // card has nobody left to offer, so the bulk row stands down
    fireEvent.click(screen.getByTestId('review-skip-btn'));
    await waitFor(() => expect(screen.getByTestId('review-card-meta').textContent).toContain('4 January'), { timeout: 10_000 });
    await waitFor(() => expect(screen.queryByTestId('review-bulk')).toBeNull(), { timeout: 10_000 });
  }, 30_000);

  it('#228 feedback: counter-FIRST from the card row — the pick fills the special category by itself', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    // "the user can also first modify the counterparty and the special
    // category will be selected automatically" (user, issue comment)
    fireEvent.click(screen.getByTestId('review-counter-row'));
    // #237 r3: no fork — one tap picks, the Counter-transaction row
    // carries the create default on the card itself
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('Demo Savings'));
    expect(screen.getByTestId('review-category-chip').textContent).toContain('Set aside');
    expect(screen.getByTestId('review-countertx-row').textContent).toContain('created on confirm');
  }, 15_000);

  it('#133 C: a loan-family pick creates its loan through the ask and the debt row takes over', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    expect(screen.getByTestId('review-recurring-row')).toBeTruthy();

    // Loan payment (◆) → the ask opens ON THE PICK (#133 r4) → the
    // Create door (full chooser); the manual loan built in place answers
    fireEvent.click(screen.getByTestId('review-category-chip'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-loanRepayment'));
    await screen.findByTestId('counter-accounts');
    fireEvent.click(screen.getByTestId('counter-full-setup'));
    fireEvent.click(await screen.findByTestId('chooser-manual'));
    fireEvent.click(await screen.findByTestId('chooser-accttype-loan'));
    fireEvent.change(await screen.findByTestId('chooser-acctform-name'), { target: { value: 'Car loan' } });
    // v2: a loan account's current value is required (it IS the debt)
    fireEvent.change(screen.getByTestId('chooser-acctform-balance'), { target: { value: '5000' } });
    fireEvent.click(screen.getByTestId('chooser-acctform-save'));
    // the fresh loan answers the ask; Done stages both
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('Car loan'), { timeout: 5000 });

    // #236: no separate debt row — the Counterparty row above already
    // names the loan (1:1 with its account); a payoff is still not a
    // recurring cost, so that row stands down too
    await waitFor(() => expect(screen.queryByTestId('review-recurring-row')).toBeNull(), { timeout: 5000 });
    expect(screen.queryByTestId('review-debt-row')).toBeNull();
  }, 15_000);

  it('#133 E+r5: a ◆ Transfer pick stages nothing until the mandatory ask answers — pinned Default, REGULAR accounts only', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    const chipBefore = screen.getByTestId('review-category-chip').textContent;

    // pick the locked Transfer sub — the MANDATORY ask opens on the
    // pick itself (#133 r4), NOTHING staged yet. #221: the ask pins the
    // space's Default bank account as the one-tap answer; #133 r5: the
    // savings pot is OFF the real list (that movement IS the saving
    // category), and the demo has no other regular account — empty
    fireEvent.click(screen.getByTestId('review-category-chip'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-transferOut'));
    await screen.findByTestId('counter-accounts');
    expect((await screen.findByTestId('counter-default')).textContent).toContain('Default bank account');
    expect(screen.queryByTestId('counter-pick-demo_save')).toBeNull(); // r5: not a transfer counter
    await screen.findByTestId('counter-empty');
    fireEvent.keyDown(window, { key: 'Escape' });
    // dismissed: the ENTRY rolled back — an unlinked transfer is
    // unrepresentable; Done stages the untouched category
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).toBe(chipBefore));

    // answering it through the one Create door: a fresh REGULAR account
    // satisfies the mandatory ask; Done stages sub + link together
    fireEvent.click(screen.getByTestId('review-category-chip'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click((await screen.findAllByTestId('catpicker-transferOut')).at(-1)!);
    fireEvent.click(await screen.findByTestId('counter-full-setup'));
    fireEvent.click(await screen.findByTestId('chooser-manual'));
    fireEvent.click(await screen.findByTestId('chooser-accttype-checking'));
    fireEvent.change(await screen.findByTestId('chooser-acctform-name'), { target: { value: 'Second checking' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-balance'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('chooser-acctform-save'));
    // the mandatory ask answered: Done arms once the transfer is linked
    await waitFor(() => expect((screen.getAllByTestId('part-cat-save').at(-1)! as HTMLButtonElement).disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(screen.getAllByTestId('part-cat-save').at(-1)!);
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).toContain('Transfer Out'));
    // #228 feedback: the card's Counterparty row reads the link
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('Second checking'));
  }, 15_000);

  it('#133 C/#309: a bare ◆ Confirm REFUSES with the red counterparty field — the ask’s Default is the one-tap answer', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    fireEvent.click(screen.getByTestId('review-category-chip'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    // the ask opens on the pick (#133 r4); walking away keeps the bare
    // story staged — but it can no longer CONFIRM bare (#309)
    await screen.findByTestId('counter-default');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(await screen.findByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).toContain('Set aside'));
    // #228 feedback: the card's Counterparty row shows the bare state
    expect(screen.getByTestId('review-counter-row').textContent).toContain('No counter account');
    expect((screen.getByTestId('review-confirm-btn') as HTMLButtonElement).disabled).toBe(false);

    // #309 (user): "we should not be able to continue" — the click marks
    // the field red instead of silently linking the default
    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    expect((await screen.findByTestId('review-counter-required')).textContent).toContain('Counterparty required');
    expect(screen.getByTestId('review-counter-row').className).toContain('ring-negative');
    // #316 (user): the ring draws INSET — the row spans the card's full
    // inner width, and the card's overflow-hidden clipped a box-edge ring
    expect(screen.getByTestId('review-counter-row').className).toContain('ring-inset');
    expect(screen.getByTestId('review-card')).toBeTruthy(); // still here

    // answering through the field clears the red on the spot: the ask's
    // pinned Default remains the one-tap path to the old behavior
    fireEvent.click(screen.getByTestId('review-counter-row'));
    fireEvent.click(await screen.findByTestId('counter-default'));
    await waitFor(() => expect(screen.queryByTestId('review-counter-required')).toBeNull());

    // the confirm now carries the EXPLICITLY picked default — same write
    // as ever: the link lands and the choke mints the pot's leg
    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const row = await db.transactions
        .filter((t) => t.catId === 'savingDeposit' && t.linkedAccountId === 'defaultacct_saving_demo_space' && t.needsReview === 0)
        .first();
      expect(row).toBeTruthy();
      expect(row?.transferPeerId).toBeTruthy();
      expect((await db.transactions.get(row!.transferPeerId!))?.accountId).toBe('defaultacct_saving_demo_space');
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  const seedR3 = async (over: { id: string; merchant: string; description?: string; counterIban?: string; withPaypalAccount?: boolean }) => {
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('r3-seed'), { trackOutbox: false });
    if (over.withPaypalAccount) {
      await seedRepo.upsert('account', DEMO_SPACE_ID, 'demo_pp', {
        name: 'PayPal o.doker@live.nl', type: 'checking', source: 'camt053', currency: 'EUR', balanceCents: 0,
      });
    }
    // a server-style prediction: Transfer Out stamped, no counterparty,
    // oldest date so the review queue leads with it
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, over.id, {
      accountId: 'demo_main', date: '2026-01-05', amountCents: -799, currency: 'EUR',
      merchant: over.merchant, description: over.description, counterIban: over.counterIban,
      catId: 'transferOut', txType: 'transfer', needsReview: 1,
    });
    seed.close();
  };

  it('#228 r3: a predicted transfer whose text names a tracked account opens LINKED to it — and confirms without the default', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    await seedR3({
      id: 'tx-r3a',
      merchant: 'PayPal Europe S.a.r.l. et Cie S.C.A',
      description: 'Incasso · Naam: PayPal Europe S.a.r.l. et Cie S.C.A Omschrijving: 1051635911097/PAYPAL',
      counterIban: 'LU89751000135104200E',
      withPaypalAccount: true,
    });
    cleanup();
    renderApp('/review');
    await screen.findByTestId('review-card');
    // the clue-matcher pointed the transfer at the PayPal account
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('PayPal'), { timeout: 5000 });
    expect(screen.getByTestId('review-category-chip').textContent).toContain('Transfer Out');
    expect((screen.getByTestId('review-confirm-btn') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const row = await db.transactions.get('tx-r3a');
      expect(row).toMatchObject({ catId: 'transferOut', linkedAccountId: 'demo_pp', needsReview: 0 });
    }, { timeout: 8000 });
    db.close();
  }, 15_000);

  it('#228 r3: a predicted transfer with NO nameable account stands down to Uncategorized — the default is not an answer', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    await seedR3({ id: 'tx-r3b', merchant: 'Verzamelbetaling batch 42' });
    cleanup();
    renderApp('/review');
    await screen.findByTestId('review-card');
    // the card stands down: no transfer without a real counterparty
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).toContain('Uncategorized'), { timeout: 5000 });
    expect(screen.getByTestId('review-counter-row').textContent).toContain('No counter account');
    // and Confirm waits for a human decision — the old one-tap default
    // link for bare transfers is gone (#228 r3)
    expect((screen.getByTestId('review-confirm-btn') as HTMLButtonElement).disabled).toBe(true);
  }, 15_000);

  it('a picked category is staged and written on confirm', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    const db = new MunniDB('munni_demo');
    const current = (await db.transactions.filter((t) => t.needsReview === 1).toArray())
      .sort((a, b) => a.date.localeCompare(b.date))[0]; // oldest first (user rule)

    // the row opens the split-categories editor (#211); a single entry
    // saves as a plain category
    fireEvent.click(screen.getByTestId('review-category-chip'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-coffee'));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    // staged, not yet written — the chip shows the choice
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).toContain('Coffee'));
    expect((await db.transactions.get(current.id))?.catId).not.toBe('coffee');

    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(
      async () => {
        expect(await db.transactions.get(current.id)).toMatchObject({ catId: 'coffee', needsReview: 0 });
      },
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('bulk confirm reaches the other flagged items of the same merchant', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');

    // two more flagged charges from the same merchant as the first card;
    // oldest-first queue: bulk1 (2020) becomes the CURRENT card, bulk2 and
    // the demo row are its "similar" companions
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-rev'), { trackOutbox: false });
    const first = (await db.transactions.filter((t) => t.needsReview === 1).toArray())
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    for (const [id, date] of [['bulk1', '2020-01-15'], ['bulk2', '2020-02-15']] as const) {
      await repo.upsert('transaction', DEMO_SPACE_ID, id, {
        accountId: first.accountId,
        date,
        amountCents: first.amountCents,
        currency: 'EUR',
        merchant: first.merchant,
        catId: first.catId, // bulk1 IS the card — it needs a ready draft
        txType: 'expense',
        needsReview: 1,
      });
    }

    // both extra rows must be visible AND selected before confirming
    await waitFor(
      () => expect(screen.getByTestId('review-bulk').textContent).toContain('2'),
      { timeout: 5000 },
    );
    // "View all" opens the sheet with the internally-scrollable list;
    // each row can expand into a read-only detail with the description
    fireEvent.click(screen.getByTestId('review-bulk-expand'));
    const bulkList = await screen.findByTestId('review-bulk-list');
    expect(bulkList.className).toContain('overflow-y-auto');
    // bulk1 IS the card now; bulk2 sits in the similar list
    expect(screen.getByTestId('review-bulk-bulk2')).toBeTruthy();
    // row tap (TxRow style now) opens the stacked read-only detail sheet
    fireEvent.click(screen.getByTestId('tx-row-bulk2'));
    await screen.findByTestId('review-bulk-detail');
    // select/unselect all lives inside the sheet
    expect(screen.getByTestId('review-bulk-select-all')).toBeTruthy();
    // the async prediction arms the confirm — wait before clicking
    await waitFor(() =>
      expect((screen.getByTestId('review-confirm-btn') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(
      async () => {
        expect((await db.transactions.get('bulk1'))?.needsReview).toBe(0);
        expect((await db.transactions.get('bulk2'))?.needsReview).toBe(0);
      },
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('a matching recurring cost offers itself and confirm links the payment', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');

    // a Netflix subscription + a flagged Netflix charge arrive
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-link'), { trackOutbox: false });
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec-nfx', {
      name: 'Netflix',
      kind: 'subscription',
      amountCents: 1399,
      every: 'month',
      dueDay: 7,
      active: 1,
      merchantKey: 'netflix com',
    });
    const iso = '2020-03-01'; // oldest-first queue: an old date makes this the CURRENT card
    await repo.upsert('transaction', DEMO_SPACE_ID, 'tx-nfx', {
      accountId: 'demo_main',
      date: iso,
      amountCents: -1399,
      currency: 'EUR',
      merchant: 'NETFLIX.COM',
      catId: 'subs',
      txType: 'expense',
      needsReview: 1,
    });

    // the newest card is the Netflix charge; the recurring ROW pre-links it
    await waitFor(() => expect(screen.getByTestId('review-card').textContent).toContain('NETFLIX.COM'), { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId('review-recurring-row').textContent).toContain('Netflix'), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(
      async () => expect((await db.transactions.get('tx-nfx'))?.recurringId).toBe('rec-nfx'),
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('the manual picker clears again via "no link", and ArrowRight skips by keyboard', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');

    // an active recurring with a non-matching merchant arms the manual chip
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-manual-2'), { trackOutbox: false });
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec-spotify', {
      name: 'Spotify',
      kind: 'subscription',
      amountCents: 1099,
      every: 'month',
      dueDay: 5,
      active: 1,
      merchantKey: 'spotify',
    });
    db.close();

    fireEvent.click(await screen.findByTestId('review-recurring-row', {}, { timeout: 5000 }));
    await screen.findByTestId('recpick-list');
    fireEvent.click(await screen.findByTestId('recpick-rec-spotify', {}, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByTestId('review-recurring-row').textContent).toContain('Spotify'), { timeout: 5000 });

    // …and unpick it: the row returns to None
    fireEvent.click(screen.getByTestId('review-recurring-row'));
    fireEvent.click(await screen.findByTestId('recpick-none'));
    await waitFor(() => expect(screen.getByTestId('review-recurring-row').textContent).not.toContain('Spotify'), { timeout: 5000 });
  }, 15_000);

  it('ArrowRight skips the current card from the keyboard', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    const before = screen.getByTestId('review-card').textContent;
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByTestId('review-card').textContent).not.toBe(before), { timeout: 5000 });
  }, 15_000);

  it('an event is staged on the card and confirm carries EVERYTHING to the bulk siblings', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');

    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-event'), { trackOutbox: false });
    await repo.upsert('event', DEMO_SPACE_ID, 'ev-trip', { name: 'Ski trip', icon: 'party-popper' });
    for (const [id, day] of [['evt-a', '01'], ['evt-b', '02']] as const) {
      await repo.upsert('transaction', DEMO_SPACE_ID, id, {
        accountId: 'demo_main', date: `2020-01-${day}`, amountCents: -2000, currency: 'EUR',
        merchant: 'APRES SKI BAR', catId: 'entertainment', txType: 'expense', needsReview: 1,
      });
    }
    await waitFor(() => expect(screen.getByTestId('review-card').textContent).toContain('APRES SKI BAR'), { timeout: 5000 });

    // pick the event on the card (staged, not yet written)
    fireEvent.click(screen.getByTestId('review-event-row'));
    fireEvent.click(await screen.findByTestId('review-event-ev-trip'));
    await waitFor(() => expect(screen.getByTestId('review-event-row').textContent).toContain('Ski trip'));
    expect((await db.transactions.get('evt-a'))?.eventId).toBeUndefined();

    // confirm: the event reaches the card AND the selected sibling (user
    // rule: bulk carries the whole decision, not just the category)
    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(async () => {
      expect((await db.transactions.get('evt-a'))?.eventId).toBe('ev-trip');
      expect((await db.transactions.get('evt-b'))?.eventId).toBe('ev-trip');
      expect((await db.transactions.get('evt-b'))?.needsReview).toBe(0);
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('no auto-match: the manual chip opens the picker and confirm links the choice', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');

    // a gym membership whose merchantKey does NOT match the current card
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-manual'), { trackOutbox: false });
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec-gym', {
      name: 'Gym',
      kind: 'fixed',
      amountCents: 2999,
      every: 'month',
      dueDay: 1,
      active: 1,
      merchantKey: 'basic fit',
    });
    const current = (await db.transactions.filter((t) => t.needsReview === 1).toArray())
      .sort((a, b) => a.date.localeCompare(b.date))[0];

    // the recurring row starts at None (no auto-detected match here)
    fireEvent.click(await screen.findByTestId('review-recurring-row'));
    fireEvent.click(await screen.findByTestId('recpick-rec-gym', {}, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByTestId('review-recurring-row').textContent).toContain('Gym'), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(
      async () => expect((await db.transactions.get(current.id))?.recurringId).toBe('rec-gym'),
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('the split door opens the VALUES editor — pure money, no category rows (#126 v2)', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    // visible row, not hidden under the category pencil
    await openSplitEditor();
    // the split as transactions: label + amount, value/pct modes —
    // categories belong to the deck, not this sheet
    await screen.findByTestId('split-label-0');
    expect(screen.queryByTestId('split-cat-0')).toBeNull();
    expect(screen.getByTestId('split-mode-pct')).toBeTruthy();
  });

  it('the part deck: one card expanded, tap to toggle, per-part category staged in place (#126 v2)', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');

    // stage a 6/4 split through the values door
    await openSplitEditor();
    fireEvent.click(screen.getByTestId('split-add-row'));
    const amount0 = (await screen.findByTestId('split-amount-0')) as HTMLInputElement;
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '6,00' } });
    fireEvent.blur(amount0);
    fireEvent.click(await screen.findByTestId('split-remainder'));
    await waitFor(() => expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('split-save'));

    // the deck: part 0 expanded (its category row is live), part 1 a
    // slim header — tapping it brings it on top
    await screen.findByTestId('review-part-deck');
    await screen.findByTestId('deck-cat-0');
    expect(screen.queryByTestId('deck-cat-1')).toBeNull();
    fireEvent.click(screen.getByTestId('deck-part-1'));
    await screen.findByTestId('deck-cat-1');
    expect(screen.queryByTestId('deck-cat-0')).toBeNull();

    // part 1 takes its categories through the whole-transaction editor
    // (r7 parity): its category row IS the door — one row, pick, Done
    fireEvent.click(screen.getByTestId('deck-cat-1'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-coffee'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('deck-cat-1').textContent).toContain('Coffee'));

    // its label is editable in place and rides the staged draft
    fireEvent.change(screen.getByTestId('deck-label-1'), { target: { value: 'Office snacks' } });
    await waitFor(() => expect((screen.getByTestId('deck-label-1') as HTMLInputElement).value).toBe('Office snacks'));

    // #133 C: no Type row on parts; #228 feedback: the part card's own
    // Counterparty row is BACK — honest about "none"
    expect(screen.queryByTestId('deck-kind-row-1')).toBeNull();
    expect(screen.getByTestId('deck-counter-1').textContent).toContain('No counter account');

    // the part's event row opens its picker; None stages a clean part.
    // #251: the quick-create door is here too (whole-card parity)
    fireEvent.click(screen.getByTestId('deck-event-1'));
    await screen.findByTestId('deck-event-list');
    expect(screen.getByTestId('deck-event-create')).toBeTruthy();
    fireEvent.click(screen.getByTestId('deck-event-none'));

    // r7: the part links recurring costs right on the card — review
    // parity; the deck carries NO notes row (review never had one)
    fireEvent.click(screen.getByTestId('deck-rec-1'));
    await screen.findByTestId('deck-rec-list');
    expect(screen.getByTestId('deck-rec-create')).toBeTruthy();
    fireEvent.click(screen.getByTestId('deck-rec-none'));
    expect(screen.getByTestId('deck-rec-1').textContent).toContain('None');
    expect(screen.queryByTestId('deck-notes-1')).toBeNull();
  }, 15_000);

  it('#251: creating a recurring from a part links THAT part, prefilled from the part', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');

    // a 6/4 split, part 1 labeled — the label must seed the form's name
    await openSplitEditor();
    fireEvent.click(screen.getByTestId('split-add-row'));
    const amount0 = (await screen.findByTestId('split-amount-0')) as HTMLInputElement;
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '6,00' } });
    fireEvent.blur(amount0);
    fireEvent.click(await screen.findByTestId('split-remainder'));
    await waitFor(() => expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('split-save'));
    await screen.findByTestId('review-part-deck');
    fireEvent.click(screen.getByTestId('deck-part-1'));
    fireEvent.change(await screen.findByTestId('deck-label-1'), { target: { value: 'Gym half' } });
    // #331: give the part a category first — it must ride into the form
    fireEvent.click(screen.getByTestId('deck-cat-1'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-coffee'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('deck-cat-1').textContent).toContain('Coffee'));

    // the create door opens the recurring form, prefilled from the part
    fireEvent.click(screen.getByTestId('deck-rec-1'));
    await screen.findByTestId('deck-rec-list');
    fireEvent.click(screen.getByTestId('deck-rec-create'));
    const name = (await screen.findByTestId('recform-name')) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe('Gym half'));
    // #331 (user): the part's picked category came along
    expect(screen.getByTestId('recform-cat').textContent).toContain('Coffee');
    fireEvent.click(screen.getByTestId('recform-save'));

    // the created cost is linked on the part row — create-and-return
    await waitFor(() => expect(screen.getByTestId('deck-rec-1').textContent).toContain('Gym half'));
  }, 15_000);

  it('#331: a category picked upfront rides into the quick-created recurring form', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    // stage Coffee through the chip's cats editor
    fireEvent.click(screen.getByTestId('review-category-chip'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-coffee'));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).toContain('Coffee'));

    // the recurring picker's Create door opens the form WITH the category
    fireEvent.click(screen.getByTestId('review-recurring-row'));
    await screen.findByTestId('recpick-list');
    fireEvent.click(screen.getByTestId('recpick-create'));
    await screen.findByTestId('recform-name');
    await waitFor(() => expect(screen.getByTestId('recform-cat').textContent).toContain('Coffee'));
  }, 15_000);

  it('#333: the picked recurring\'s own visual replaces the generic circle-arrow on the card row', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-recvis'), { trackOutbox: false });
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec-logo', {
      name: 'Spotify', kind: 'subscription', amountCents: 1099, every: 'month', dueDay: 5, active: 1,
      merchantKey: 'spotify', logo: 'data:image/png;base64,abc',
    });
    db.close();
    // nothing linked yet: the generic autorenew icon, no visual
    expect(screen.queryByTestId('review-recurring-visual')).toBeNull();
    fireEvent.click(await screen.findByTestId('review-recurring-row', {}, { timeout: 10_000 }));
    await screen.findByTestId('recpick-list');
    fireEvent.click(await screen.findByTestId('recpick-rec-logo', {}, { timeout: 10_000 }));
    await waitFor(() => expect(screen.getByTestId('review-recurring-row').textContent).toContain('Spotify'), { timeout: 10_000 });
    // the row now leads with the recurring's OWN face — its logo
    const visual = await screen.findByTestId('review-recurring-visual');
    expect(visual.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,abc');
    // …and unpicking restores the generic icon
    fireEvent.click(screen.getByTestId('review-recurring-row'));
    fireEvent.click(await screen.findByTestId('recpick-none'));
    await waitFor(() => expect(screen.queryByTestId('review-recurring-visual')).toBeNull(), { timeout: 10_000 });
  }, 15_000);

  it('#324: a typed note lands with the confirm — and the bulk update carries it to the siblings', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-notes'), { trackOutbox: false });
    // two same-merchant cards, dated oldest so they lead the queue
    for (const [id, day] of [['note-a', '01'], ['note-b', '02']] as const) {
      await repo.upsert('transaction', DEMO_SPACE_ID, id, {
        accountId: 'demo_main', date: `2020-02-${day}`, amountCents: -1500, currency: 'EUR',
        merchant: 'PADEL CLUB', catId: 'entertainment', txType: 'expense', needsReview: 1,
      });
    }
    await waitFor(() => expect(screen.getByTestId('review-card').textContent).toContain('PADEL CLUB'), { timeout: 10_000 });
    await screen.findByTestId('review-bulk'); // the sibling offer is up

    // the card's own notes field — staged only, nothing written yet
    fireEvent.change(screen.getByTestId('review-notes'), { target: { value: 'Court 4, with Jan' } });
    expect((await db.transactions.get('note-a'))?.notes).toBeUndefined();

    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(async () => {
      expect((await db.transactions.get('note-a'))?.notes).toBe('Court 4, with Jan');
      // the selected sibling receives the same note with its decision
      expect((await db.transactions.get('note-b'))?.notes).toBe('Court 4, with Jan');
      expect((await db.transactions.get('note-b'))?.needsReview).toBe(0);
    }, { timeout: 8000 });
    db.close();
  }, 15_000);

  it('#325: unticking every similar row swaps the zero count for the short none-selected line', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-none'), { trackOutbox: false });
    const first = (await db.transactions.filter((t) => t.needsReview === 1).toArray())
      .sort((a, b) => a.date.localeCompare(b.date))[0]; // the current card
    await repo.upsert('transaction', DEMO_SPACE_ID, 'none-1', {
      accountId: first.accountId, date: '2030-01-01', amountCents: first.amountCents, currency: 'EUR',
      merchant: first.merchant, catId: first.catId, txType: 'expense', needsReview: 1,
    });
    db.close();
    await waitFor(() => expect(screen.getByTestId('review-bulk').textContent).toContain('Also apply to 1 similar'), { timeout: 10_000 });

    // untick all: the odd "…to 0 similar" swaps for the short line
    fireEvent.click(screen.getByTestId('review-bulk-toggle'));
    await waitFor(() => expect(screen.getByTestId('review-bulk').textContent).toContain('Similar found — none selected'), { timeout: 10_000 });
    expect(screen.getByTestId('review-bulk').textContent).not.toContain('0 similar');
    // re-tick: the honest count returns
    fireEvent.click(screen.getByTestId('review-bulk-toggle'));
    await waitFor(() => expect(screen.getByTestId('review-bulk').textContent).toContain('Also apply to 1 similar'), { timeout: 10_000 });
  }, 15_000);

  it('NO restrictions on a split: even the same special kind twice lands (#126 r7)', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    await openSplitEditor();
    fireEvent.click(screen.getByTestId('split-add-row'));
    const amount0 = (await screen.findByTestId('split-amount-0')) as HTMLInputElement;
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '6,00' } });
    fireEvent.blur(amount0);
    fireEvent.click(await screen.findByTestId('split-remainder'));
    await waitFor(() => expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('split-save'));

    // part 1 → Set aside (◆ pulls saving through the part editor) —
    // #133 C: the pick opens the per-part counterparty ask (Default
    // pinned); walking away keeps the bare story
    await screen.findByTestId('review-part-deck');
    fireEvent.click(screen.getByTestId('deck-part-1'));
    fireEvent.click(await screen.findByTestId('deck-cat-1'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await screen.findByTestId('counter-default');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('deck-cat-1').textContent).toContain('Set aside'));

    // the SAME pick on part 0: r7 allows the honest repeat — no warning
    // exists anymore, and Confirm arms with both parts categorized
    fireEvent.click(screen.getByTestId('deck-part-0'));
    fireEvent.click(await screen.findByTestId('deck-cat-0'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click((await screen.findAllByTestId('catpicker-savingDeposit')).at(-1)!);
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    fireEvent.keyDown(window, { key: 'Escape' }); // the ask again — still bare, still fine
    await waitFor(() => expect(screen.getByTestId('deck-cat-0').textContent).toContain('Set aside'));
    await waitFor(() => expect((screen.getByTestId('review-confirm-btn') as HTMLButtonElement).disabled).toBe(false));
  }, 15_000);

  it('a split holds MORE than two parts: pct rows seed the leftover, Done stays armed, the stepper walks the stack (#126 r6)', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    await openSplitEditor();
    fireEvent.click(screen.getByTestId('split-mode-pct'));
    const amount0 = (await screen.findByTestId('split-amount-0')) as HTMLInputElement;
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '50' } });
    fireEvent.blur(amount0);
    // every added row seeds the remaining PERCENTAGE (a '0,00' euro text
    // inside a percentage list was the r6 glitch)
    fireEvent.click(screen.getByTestId('split-add-row'));
    await waitFor(() => expect((screen.getByTestId('split-amount-1') as HTMLInputElement).value).toBe('50'));
    const amount1 = screen.getByTestId('split-amount-1') as HTMLInputElement;
    fireEvent.focus(amount1);
    fireEvent.change(amount1, { target: { value: '30' } });
    fireEvent.blur(amount1);
    fireEvent.click(screen.getByTestId('split-add-row'));
    await waitFor(() => expect((screen.getByTestId('split-amount-2') as HTMLInputElement).value).toBe('20'));
    // three parts, two of them still uncategorized — the shared
    // placeholder no longer jams Done (the "can't add past two" report)
    await waitFor(() => expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('split-save'));

    // the deck holds all three; tapping a strip shuffles it on top
    await screen.findByTestId('review-part-deck');
    await screen.findByTestId('deck-label-0');
    fireEvent.click(screen.getByTestId('deck-part-2'));
    await screen.findByTestId('deck-label-2');
    fireEvent.click(screen.getByTestId('deck-part-1'));
    await screen.findByTestId('deck-label-1');

    // r7: Confirm stays TAPPABLE while parts are uncategorized — the tap
    // writes nothing and marks the offenders on their number circles
    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await screen.findByTestId('deck-attention');
    await screen.findByTestId('deck-attn-1');
    await screen.findByTestId('deck-attn-2');
    expect(screen.queryByTestId('deck-attn-0')).toBeNull(); // part 0 has its category
    await screen.findByTestId('review-card'); // nothing was written

    // categorizing clears each badge; three parts — two plain expense —
    // confirm fine (r7: no kind restrictions)
    fireEvent.click(await screen.findByTestId('deck-cat-1'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-coffee'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.queryByTestId('deck-attn-1')).toBeNull());

    fireEvent.click(screen.getByTestId('deck-part-2'));
    await screen.findByTestId('deck-label-2');
    fireEvent.click(screen.getByTestId('deck-cat-2'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect((screen.getByTestId('review-confirm-btn') as HTMLButtonElement).disabled).toBe(false));
  }, 15_000);

  it('a part spreads its own money across several categories from the deck (#126 r6)', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    await openSplitEditor();
    const amount0 = (await screen.findByTestId('split-amount-0')) as HTMLInputElement;
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '6,00' } });
    fireEvent.blur(amount0);
    fireEvent.click(screen.getByTestId('split-add-row'));
    await waitFor(() => expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('split-save'));

    // the category row IS the door to the part-scoped whole-transaction
    // editor (r7) — seeded with the part's category owning its full share
    await screen.findByTestId('review-part-deck');
    fireEvent.click(await screen.findByTestId('deck-cat-0'));
    await screen.findByTestId('part-cats-editor');

    // euros ⇄ percentages, the pre-split editor's two gears (r7): a
    // full-owning row converts round-trip without drift
    fireEvent.click(screen.getByTestId('part-cat-mode-pct'));
    await waitFor(() => expect((screen.getByTestId('part-cat-amount-0') as HTMLInputElement).value).toBe('100'));
    fireEvent.click(screen.getByTestId('part-cat-mode-amount'));
    await waitFor(() => expect((screen.getByTestId('part-cat-amount-0') as HTMLInputElement).value).toBe('6,00'));

    fireEvent.click(screen.getByTestId('part-cat-add'));
    fireEvent.click(await screen.findByTestId('part-cat-1'));
    fireEvent.click(await screen.findByTestId('catpicker-coffee'));
    const spread0 = screen.getByTestId('part-cat-amount-0') as HTMLInputElement;
    fireEvent.focus(spread0);
    fireEvent.change(spread0, { target: { value: '2,00' } });
    fireEvent.blur(spread0);
    // the pill drops the leftover on the still-open entry
    fireEvent.click(await screen.findByTestId('part-cat-remainder'));
    await waitFor(() => expect((screen.getByTestId('part-cat-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('part-cat-save'));

    // #217 (user): the deck shows EACH category as its own row — value
    // included, "the same way as if there no split"
    await waitFor(() => expect(screen.getByTestId('deck-cat-0-1').textContent).toContain('Coffee'));
    expect(screen.getByTestId('deck-cat-0-1').textContent).toMatch(/4[.,]00/);
    expect(screen.getByTestId('deck-cat-0').textContent).toMatch(/2[.,]00/);
  }, 15_000);

  it('#133 r3: a ◆ Transfer pick on a PART stages nothing until its mandatory ask answers; dismissal rolls back', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    await openSplitEditor();
    const amount0 = (await screen.findByTestId('split-amount-0')) as HTMLInputElement;
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '6,00' } });
    fireEvent.blur(amount0);
    fireEvent.click(screen.getByTestId('split-add-row'));
    await waitFor(() => expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('split-save'));
    await screen.findByTestId('review-part-deck');
    const catBefore = screen.getByTestId('deck-cat-0').textContent;

    // pick the locked Transfer sub on part 0 — the MANDATORY ask opens
    // on the pick itself (#133 r4), NOTHING patched yet; #221: the ask
    // pins the Default bank account; #133 r5: the savings pot is OFF
    // the transfer list. Walking away rolls the ENTRY back and Done
    // keeps the part exactly as it was
    fireEvent.click(await screen.findByTestId('deck-cat-0'));
    fireEvent.click((await screen.findAllByTestId('part-cat-0')).at(-1)!);
    fireEvent.click((await screen.findAllByTestId('catpicker-transferOut')).at(-1)!);
    await screen.findByTestId('counter-accounts');
    expect((await screen.findByTestId('counter-default')).textContent).toContain('Default bank account');
    expect(screen.queryByTestId('counter-pick-demo_save')).toBeNull(); // r5: not a transfer counter
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getAllByTestId('part-cat-save').at(-1)!);
    await waitFor(() => expect(screen.getByTestId('deck-cat-0').textContent).toBe(catBefore));

    // answering it through the Create door (the demo has no second
    // regular account): the fresh checking satisfies the mandatory ask
    fireEvent.click(screen.getByTestId('deck-cat-0'));
    fireEvent.click(screen.getAllByTestId('part-cat-0').at(-1)!);
    fireEvent.click((await screen.findAllByTestId('catpicker-transferOut')).at(-1)!);
    fireEvent.click(await screen.findByTestId('counter-full-setup'));
    fireEvent.click(await screen.findByTestId('chooser-manual'));
    fireEvent.click(await screen.findByTestId('chooser-accttype-checking'));
    fireEvent.change(await screen.findByTestId('chooser-acctform-name'), { target: { value: 'Second checking' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-balance'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('chooser-acctform-save'));
    // the mandatory ask answered: Done arms once the transfer is linked
    await waitFor(() => expect((screen.getAllByTestId('part-cat-save').at(-1)! as HTMLButtonElement).disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(screen.getAllByTestId('part-cat-save').at(-1)!);
    await waitFor(() => expect(screen.getByTestId('deck-cat-0').textContent).toContain('Transfer Out'));
    // #228 feedback: the part card's OWN Counterparty row carries the
    // link — no "→ account" subline under the category anymore
    await waitFor(() => expect(screen.getByTestId('deck-counter-0').textContent).toContain('Second checking'));
    expect(screen.queryByTestId('deck-cat-counter-0-0')).toBeNull();
  }, 15_000);

  it('splitting warns first — the reset waits for the editor\'s Done; cancelling keeps the staged picks (#126 r7, #330)', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    // an active recurring so the card can stage a manual link too
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-splitreset'), { trackOutbox: false });
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec-yoga', {
      name: 'Yoga studio', kind: 'subscription', amountCents: 2500, every: 'month', dueDay: 3, active: 1, merchantKey: 'yoga',
    });
    db.close();
    // stage a deliberate category pick through the chip's cats editor
    fireEvent.click(await screen.findByTestId('review-category-chip'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(screen.getByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-coffee'));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).toContain('Coffee'));
    // …and a manual recurring link on top
    fireEvent.click(screen.getByTestId('review-recurring-row'));
    fireEvent.click(await screen.findByTestId('recpick-rec-yoga', {}, { timeout: 10_000 }));
    await waitFor(() => expect(screen.getByTestId('review-recurring-row').textContent).toContain('Yoga studio'));

    // the split door warns; cancelling the WARNING changes nothing
    fireEvent.click(screen.getByTestId('review-split-row'));
    await screen.findByTestId('split-reset-continue');
    fireEvent.click(screen.getByTestId('split-reset-cancel'));
    expect(screen.queryByTestId('split-label-0')).toBeNull();

    // #330 (user): continue opens the VALUES editor with everything
    // still staged — the reset now waits for Done, so Escape-dismissing
    // the editor keeps category and recurring exactly as staged (test
    // sheets stay mounted after close — the CARD's rows are the signal)
    fireEvent.click(screen.getByTestId('review-split-row'));
    fireEvent.click(await screen.findByTestId('split-reset-continue'));
    await screen.findByTestId('split-label-0');
    expect(screen.getByTestId('review-category-chip').textContent).toContain('Coffee');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('review-category-chip').textContent).toContain('Coffee');
    expect(screen.getByTestId('review-recurring-row').textContent).toContain('Yoga studio');
    expect(screen.queryByTestId('review-part-deck')).toBeNull(); // no split landed

    // through the warning again — Done is where the reset finally
    // lands: the single-collapse keeps the seeded category as the
    // split's shape while the staged recurring link is reversed
    fireEvent.click(screen.getByTestId('review-split-row'));
    fireEvent.click(await screen.findByTestId('split-reset-continue'));
    await screen.findByTestId('split-label-0');
    fireEvent.click(screen.getByTestId('split-save'));
    // the seeded category stays as the collapse's shape while the
    // staged recurring link is reversed by the landed reset
    await waitFor(() => expect(screen.getByTestId('review-recurring-row').textContent).not.toContain('Yoga studio'));
    expect(screen.getByTestId('review-category-chip').textContent).toContain('Coffee');

    // a REAL split's Done resets the card to the split shape: the deck
    // (the collapse above left a staged category, so the warning asks
    // once more — the arm rides through to this Done)
    fireEvent.click(screen.getByTestId('review-split-row'));
    fireEvent.click(await screen.findByTestId('split-reset-continue'));
    fireEvent.click(await screen.findByTestId('split-add-row'));
    const amount0 = (await screen.findByTestId('split-amount-0')) as HTMLInputElement;
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '6,00' } });
    fireEvent.blur(amount0);
    fireEvent.click(await screen.findByTestId('split-remainder'));
    await waitFor(() => expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('split-save'));
    await screen.findByTestId('review-part-deck');
  }, 20_000);

  it('#330 r2 (user): the FIRST split press warns when the card only wears its ROW category — and stays silent on a bare card', async () => {
    // the user's real card: the category came with the ROW (an imported/
    // predicted fill — their ATM card wore "Cash Withdraw · Transfer"),
    // NOTHING user-staged. r1 keyed the warning on user staging only, so
    // the first press silently opened the split sheet; only after
    // splitting + removing (which stages) did the warning appear.
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('splitwarn'), { trackOutbox: false });
    // a story-less card dated OLDEST so it leads the queue: uncategorized,
    // no counterparty, no note — the one shape that may open directly
    await seedRepo.upsert('transaction', DEMO_SPACE_ID, 'bare-split', {
      accountId: 'demo_main', date: '2020-01-01', amountCents: -1000, currency: 'EUR',
      merchant: 'Storyless Stall', catId: 'uncategorized', txType: 'expense', needsReview: 1,
    });
    seed.close();
    cleanup();
    renderApp('/review');
    await screen.findByTestId('review-card');

    // card 1 = the bare row: no story to reset — the editor opens directly
    await waitFor(() => expect(screen.getByTestId('review-card').textContent).toContain('Storyless Stall'), { timeout: 10_000 });
    fireEvent.click(await screen.findByTestId('review-split-row'));
    await screen.findByTestId('split-editor');
    expect(screen.queryByTestId('split-reset-continue')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });

    // skip to the demo card that WEARS its seeded row category (Hobby)
    fireEvent.click(screen.getByTestId('review-skip-btn'));
    await waitFor(() => expect(screen.getByTestId('review-card').textContent).not.toContain('Storyless Stall'), { timeout: 10_000 });

    // the FIRST press must warn — no user staging happened at all
    // (the earlier card's editor stays mounted in tests, so the warning
    // sheet's own button is the honest signal here)
    fireEvent.click(screen.getByTestId('review-split-row'));
    await screen.findByTestId('split-reset-continue', {}, { timeout: 10_000 });

    // cancel keeps everything: the row category still stands on the chip
    fireEvent.click(screen.getByTestId('split-reset-cancel'));
    expect(screen.getByTestId('review-category-chip').textContent).toContain('Hobby');
  }, 25_000);

  it('the pill fills the FOCUSED field even though its blur restores the stash first (#130 r2)', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    await openSplitEditor();
    fireEvent.click(screen.getByTestId('split-add-row'));
    fireEvent.click(screen.getByTestId('split-mode-pct'));
    // the report's exact flow: type 50 into the SECOND row…
    const amount1 = (await screen.findByTestId('split-amount-1')) as HTMLInputElement;
    fireEvent.focus(amount1);
    fireEvent.change(amount1, { target: { value: '50' } });
    fireEvent.blur(amount1);
    // …then FOCUS the first row (it empties, stash holds 100) and tap
    // the pill: pointerdown arms the target, blur restores 100, click
    // must still fill THIS row with the open 50 — not zero the other
    const amount0 = screen.getByTestId('split-amount-0') as HTMLInputElement;
    fireEvent.focus(amount0);
    // the empty-for-typing lands one frame after focus (#134 iOS fix)
    await waitFor(() => expect(amount0.value).toBe(''));
    const pill = await screen.findByTestId('split-remainder');
    fireEvent.pointerDown(pill);
    fireEvent.blur(amount0);
    expect(amount0.value).toBe('100'); // the stash restore — the old trap
    fireEvent.click(pill);
    await waitFor(() => expect((screen.getByTestId('split-amount-0') as HTMLInputElement).value).toBe('50'));
    expect((screen.getByTestId('split-amount-1') as HTMLInputElement).value).toBe('50');
  });

  it('the left-to-assign pill fills the EMPTY row, not the last one (#130)', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    await openSplitEditor();
    fireEvent.click(screen.getByTestId('split-add-row'));
    fireEvent.click(screen.getByTestId('split-mode-pct'));
    // the report's shape: TOP row empty, second row 50
    const amount0 = (await screen.findByTestId('split-amount-0')) as HTMLInputElement;
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '0' } });
    fireEvent.blur(amount0);
    const amount1 = (await screen.findByTestId('split-amount-1')) as HTMLInputElement;
    fireEvent.focus(amount1);
    fireEvent.change(amount1, { target: { value: '50' } });
    fireEvent.blur(amount1);
    fireEvent.click(await screen.findByTestId('split-remainder'));
    // the open 50% lands on row 0 — row 1 keeps its value
    await waitFor(() => expect((screen.getByTestId('split-amount-0') as HTMLInputElement).value).toBe('50'));
    expect((screen.getByTestId('split-amount-1') as HTMLInputElement).value).toBe('50');
    expect((screen.getByTestId('split-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a lone 50% row holds Done — the partition must always add up (#126 r3)', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    await openSplitEditor();
    fireEvent.click(screen.getByTestId('split-mode-pct'));
    const amount0 = (await screen.findByTestId('split-amount-0')) as HTMLInputElement;
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '50' } });
    fireEvent.blur(amount0);
    // #195: Done stays tappable — the lone 50% tap refuses in place
    fireEvent.click(screen.getByTestId('split-save'));
    expect(screen.getByTestId('split-editor')).toBeTruthy(); // still open
    expect(screen.getByTestId('split-save').getAttribute('aria-invalid')).toBe('true');
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '100' } });
    fireEvent.blur(amount0);
    await waitFor(() => expect(screen.getByTestId('split-save').getAttribute('aria-invalid')).toBe('false'));
  });

  it('splitting stays on the card; amounts clear on focus and restore on blur', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');

    // a controlled newest card with a long description
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-split'), { trackOutbox: false });
    const iso = '2020-03-01'; // oldest-first queue: an old date makes this the CURRENT card
    await repo.upsert('transaction', DEMO_SPACE_ID, 'tx-split', {
      accountId: 'demo_main',
      date: iso,
      amountCents: -1000,
      currency: 'EUR',
      merchant: 'SPLITCAFE',
      description: 'A very long remittance line that identifies this charge beyond two clamped lines of text',
      catId: 'groceries',
      txType: 'expense',
      needsReview: 1,
    });
    await waitFor(() => expect(screen.getByTestId('review-card').textContent).toContain('SPLITCAFE'), { timeout: 5000 });

    // the full description shows on tap (clamped by default). The clamp
    // lives on the INNER span: display on the button itself killed
    // -webkit-box and the toggle never visually worked
    const desc = screen.getByTestId('review-description');
    expect(screen.getByTestId('review-description-text').className).toContain('line-clamp-2');
    fireEvent.click(desc);
    // waitFor: under coverage instrumentation the expand re-render can lag the click
    await waitFor(() => expect(screen.getByTestId('review-description-text').className).not.toContain('line-clamp-2'));

    // #211: the category chip opens the split-CATEGORIES editor with ONE
    // entry — a second is added explicitly; the row stays ONE transaction
    fireEvent.click(screen.getByTestId('review-category-chip'));
    await screen.findByTestId('part-cats-editor');
    fireEvent.click(await screen.findByTestId('part-cat-add'));
    // the fresh entry is uncategorized + 0 — no THIRD until it's done
    await screen.findByTestId('part-cat-amount-1');
    expect((screen.getByTestId('part-cat-add') as HTMLButtonElement).disabled).toBe(true);
    const amount0 = (await screen.findByTestId('part-cat-amount-0')) as HTMLInputElement;
    expect(amount0.value).toBe('10,00');

    // focus empties the field so typing replaces (one frame later — the
    // #134 iOS fix); blank blur restores
    fireEvent.focus(amount0);
    await waitFor(() => expect(amount0.value).toBe(''));
    fireEvent.blur(amount0);
    expect(amount0.value).toBe('10,00');

    // 6,00 + auto-balanced 4,00 = a valid spread
    fireEvent.focus(amount0);
    fireEvent.change(amount0, { target: { value: '6,00' } });
    fireEvent.blur(amount0);
    fireEvent.click(await screen.findByTestId('part-cat-remainder'));
    // the fresh entry starts Uncategorized — Done holds until it's real
    fireEvent.click(screen.getByTestId('part-cat-1'));
    fireEvent.click(await screen.findByTestId('catpicker-coffee'));
    fireEvent.click(screen.getByTestId('part-cat-save'));

    // draft model: the spread STAGES — the card lists one row per
    // category, NO part deck (this is not a split transaction), and the
    // row keeps its recurring/event affordances (it is still ONE event)
    await waitFor(() => expect(screen.getByTestId('review-cat-coffee')).toBeTruthy());
    expect(screen.getByTestId('review-cat-groceries')).toBeTruthy();
    expect(screen.queryByTestId('review-part-deck')).toBeNull();
    expect(screen.getByTestId('review-event-row')).toBeTruthy();
    expect(screen.getByTestId('review-card').textContent).toContain('SPLITCAFE');
    expect((await db.transactions.get('tx-split'))?.cats).toBeUndefined();

    // Confirm lands the whole draft in one write — the row's own cats,
    // never a split container
    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(async () => {
      const row = await db.transactions.get('tx-split');
      expect(row?.cats).toEqual([
        { catId: 'groceries', amountCents: 600 },
        { catId: 'coffee', amountCents: 400 },
      ]);
      expect(row?.splits ?? undefined).toBeUndefined();
      expect(row?.catId).toBe('groceries');
      expect(row?.needsReview).toBe(0);
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('#133 r4: a ◆ pick answered with a REAL pot keeps its family category — the link tells the movement', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');

    // stage a deliberate category — the chip's cats editor (#211)
    fireEvent.click(screen.getByTestId('review-category-chip'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-coffee'));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).toContain('Coffee'));
    expect((screen.getByTestId('review-confirm-btn') as HTMLButtonElement).disabled).toBe(false);

    // re-pick Set aside (◆) — the ask opens on the pick; the savings
    // pot answers it. The user's category STAYS the story ("we are not
    // bound to transaction type anymore"); the link makes it a movement
    // and the view derives transfer from the real counterparty.
    fireEvent.click(screen.getByTestId('review-category-chip'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    await screen.findByTestId('counter-default');
    fireEvent.click(await screen.findByTestId('counter-pick-demo_save'));
    await waitFor(() => expect(screen.getAllByTestId('part-cats-editor').at(-1)!.getAttribute('data-counter')).toBe('demo_save'));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).toContain('Set aside'));
    // #228 feedback: the card's Counterparty row names the pot
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('Demo Savings'));
    expect((screen.getByTestId('review-confirm-btn') as HTMLButtonElement).disabled).toBe(false);

    // nothing was written mid-flight: the tx still holds its own type
    const db = new MunniDB('munni_demo');
    const current = (await db.transactions.filter((t) => t.needsReview === 1).toArray())
      .sort((a, b) => a.date.localeCompare(b.date))[0]; // oldest first (user rule)
    expect(current.txType).not.toBe('saving');
    db.close();
  }, 15_000);

  it('skip moves on and the skipped pile can be revisited', async () => {
    renderApp('/review');
    await screen.findByTestId('review-card');
    const firstMerchant = screen.getByTestId('review-card').textContent;

    fireEvent.click(screen.getByTestId('review-skip-btn'));
    await waitFor(() => expect(screen.getByTestId('review-card').textContent).not.toBe(firstMerchant));

    fireEvent.click(screen.getByTestId('review-skip-btn'));
    fireEvent.click(screen.getByTestId('review-skip-btn'));
    // everything skipped: the pile note offers a second pass
    const note = await screen.findByTestId('review-skipped-note');
    expect(note.textContent).toContain('3');
    fireEvent.click(screen.getByTestId('review-reset-skipped'));
    expect(await screen.findByTestId('review-card')).toBeTruthy();

    // leaving review and coming back starts the deck from the top again
    // (user ruling 2026-07-19: skips are per-visit, not per-session)
    fireEvent.click(screen.getByTestId('review-skip-btn'));
    cleanup();
    renderApp('/review');
    await waitFor(() => expect(screen.getByTestId('review-card').textContent).toBe(firstMerchant));
  }, 15_000);
});

// eslint-disable-next-line vitest/no-identical-title -- separate identity
describe('ReviewScreen (user identity, split settlements)', () => {
  it('an incoming amount matching an open settlement offers the transfer chip (SP5)', async () => {
    const { USER_TEST_DB, renderAppAsUser } = await import('@/test/harness');
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);

    // my local queue holds an incoming €15.00 needing review
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed'), { trackOutbox: false });
    await repo.upsert('transaction', 's-user', 'tx-in', {
      accountId: 'a1', date: '2026-07-16', amountCents: 1500, currency: 'EUR',
      merchant: 'A. FRIEND', txType: 'income', needsReview: 1,
    });
    db.close();

    const ME = '11111111-1111-1111-1111-111111111111';
    const ANNA = '22222222-2222-2222-2222-222222222222';
    renderAppAsUser('/review', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits': () => [
          { id: 'split-1', name: 'Barcelona', currency: 'EUR', status: 'open', role: 'owner', memberCount: 2, entryCount: 1 },
        ],
        'GET /splits/split-1': () => ({
          id: 'split-1', name: 'Barcelona', currency: 'EUR', status: 'open', role: 'owner',
          members: [
            { userId: ME, role: 'owner', displayName: 'Me', isMe: true },
            { userId: ANNA, role: 'member', displayName: 'Anna', isMe: false },
          ],
          entries: [{
            id: 'e-settle', kind: 'settlement', paidByUserId: ANNA, description: 'Settlement',
            amountCents: 1500, date: '2026-07-16',
            shares: [{ userId: ME, cents: 1500 }], createdBy: ANNA,
          }],
        }),
      },
    });

    const chip = await screen.findByTestId('review-settle-match');
    expect(chip.textContent).toContain('Anna');
    expect(chip.textContent).toContain('Barcelona');

    fireEvent.click(chip);
    // a settlement is money from a PERSON — R2 makes transfer strictly
    // account-to-account, so the chip stages the app's own concept for
    // money-back-from-people: received reimbursement
    await waitFor(() =>
      expect((screen.getByTestId('review-confirm-btn') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(async () => {
      const check = new MunniDB(USER_TEST_DB);
      const tx = await check.transactions.get('tx-in');
      check.close();
      expect(tx).toMatchObject({ txType: 'income', catId: 'reimburse', needsReview: 0 });
    });
  }, 15_000);
});

describe('ReviewScreen (own-account transfers)', () => {
  it('a counterparty IBAN that is MY OWN account pre-marks the card as transfer', async () => {
    const { USER_TEST_DB, renderAppAsUser } = await import('@/test/harness');
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);

    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed'), { trackOutbox: false });
    await repo.upsert('account', 's-user', 'acct-cc', {
      name: 'Credit card', type: 'credit', source: 'manual', currency: 'EUR',
      iban: 'NL91 ABNA 0417 1643 00',
    });
    await repo.upsert('transaction', 's-user', 'tx-topup', {
      accountId: 'acct-main', date: '2026-07-16', amountCents: -50000, currency: 'EUR',
      merchant: 'CREDITCARD TOPUP', txType: 'expense', needsReview: 1,
      counterIban: 'NL91ABNA0417164300', // same IBAN, bank formatting differs
    });
    db.close();

    renderAppAsUser('/review', {
      api: { 'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }) },
    });

    // #219: no chip; #228 feedback: the card's Counterparty row tells
    // the auto-applied link
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('Credit card'));
    expect(screen.queryByTestId('review-own-transfer')).toBeNull();
    expect(screen.queryByTestId('review-cat-counter-transferOut')).toBeNull();

    await waitFor(() =>
      expect((screen.getByTestId('review-confirm-btn') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('review-confirm-btn'));
    await waitFor(async () => {
      const check = new MunniDB(USER_TEST_DB);
      const tx = await check.transactions.get('tx-topup');
      check.close();
      // credit counter-account: a transfer between own accounts (user ruling)
      expect(tx).toMatchObject({ txType: 'transfer', linkedAccountId: 'acct-cc', needsReview: 0 });
    });
  }, 15_000);

  it('#218: the DETACH door opts back out of the auto-transfer — and frees the category choice', async () => {
    const { USER_TEST_DB, renderAppAsUser } = await import('@/test/harness');
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);

    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed'), { trackOutbox: false });
    await repo.upsert('account', 's-user', 'acct-cc', {
      name: 'Credit card', type: 'credit', source: 'manual', currency: 'EUR', iban: 'NL91ABNA0417164300',
    });
    await repo.upsert('transaction', 's-user', 'tx-topup', {
      accountId: 'acct-main', date: '2026-07-16', amountCents: -50000, currency: 'EUR',
      merchant: 'CREDITCARD TOPUP', txType: 'expense', needsReview: 1, counterIban: 'NL91ABNA0417164300',
    });
    db.close();

    renderAppAsUser('/review', {
      api: { 'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }) },
    });

    // the auto-link pre-applied; the card's Counterparty row shows it
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('Credit card'));
    fireEvent.click(screen.getByTestId('review-category-chip'));
    await screen.findByTestId('part-cats-editor');
    // #218: with the credit counter attached the picker narrows to what
    // it can mean — transfer or debt payment, nothing else
    fireEvent.click(screen.getByTestId('part-cat-0'));
    await screen.findByTestId('catpicker-loanRepayment');
    expect(screen.queryByTestId('catpicker-groceries')).toBeNull();
    // …and a pick the counter can ALSO mean keeps the link, no re-ask
    fireEvent.click(screen.getByTestId('catpicker-loanRepayment'));
    await waitFor(() => expect(screen.getByTestId('part-cat-0').textContent).toContain('Repaid'));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('Credit card'));
    // the way out (#228 feedback): the card row's detach door — removal
    // RESETS the category, and the full picker is free again
    fireEvent.click(screen.getByTestId('review-counter-row'));
    fireEvent.click(await screen.findByTestId('counter-detach'));
    await waitFor(() => expect(screen.getByTestId('review-counter-row').textContent).toContain('No counter account'));
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).not.toContain('Repaid'));
    fireEvent.click(screen.getByTestId('review-category-chip'));
    fireEvent.click(await screen.findByTestId('part-cat-0'));
    fireEvent.click(await screen.findByTestId('catpicker-groceries'));
    fireEvent.click(screen.getByTestId('part-cat-save'));
    await waitFor(() => expect(screen.getByTestId('review-category-chip').textContent).toContain('Grocery'));
  }, 15_000);
});

describe('resolveTransferPrediction (unit)', () => {
  const TYPES: Record<string, string[]> = { transferOut: ['transfer'], savingDeposit: ['saving'], groceries: ['expense'] };
  const catalog = { byId: (id: string | undefined) => ({ txTypes: (TYPES[id ?? ''] ?? []) as never }) };
  const paypal = { id: 'a-pp', name: 'PayPal o.doker@live.nl', type: 'checking' as const };
  const tx = {
    accountId: 'a-main', amountCents: -799,
    merchant: 'PayPal Europe S.a.r.l. et Cie S.C.A',
    description: 'Incasso 1051635911097/PAYPAL', counterIban: 'LU89751000135104200E',
  };

  it('links the clue-matched account and keeps the transfer story', async () => {
    const { resolveTransferPrediction } = await import('./ReviewScreen');
    const draft = { catId: 'transferOut', txType: 'transfer' as const };
    const resolved = resolveTransferPrediction(draft, tx, [paypal], catalog);
    expect(resolved).toMatchObject({ linkedAccountId: 'a-pp', catId: 'transferOut', txType: 'transfer' });
  });

  it('stands a clueless transfer down to Uncategorized with a sign-true type', async () => {
    const { resolveTransferPrediction } = await import('./ReviewScreen');
    const draft = { catId: 'transferOut', txType: 'transfer' as const };
    const resolved = resolveTransferPrediction(draft, { ...tx, merchant: 'Onbekend', description: undefined, counterIban: undefined }, [paypal], catalog);
    expect(resolved).toMatchObject({ catId: 'uncategorized', txType: 'expense' });
    expect(resolved?.linkedAccountId).toBeUndefined();
  });

  it('never rewrites linked, partitioned, stamped or non-transfer drafts', async () => {
    const { resolveTransferPrediction } = await import('./ReviewScreen');
    const linked = { catId: 'transferOut', txType: 'transfer' as const, linkedAccountId: 'a-x' };
    expect(resolveTransferPrediction(linked, tx, [paypal], catalog)).toBe(linked);
    const split = { catId: 'transferOut', txType: 'transfer' as const, splits: [{ catId: 'groceries', amountCents: 799 }] };
    expect(resolveTransferPrediction(split, tx, [paypal], catalog)).toBe(split);
    const saving = { catId: 'savingDeposit', txType: 'saving' as const };
    expect(resolveTransferPrediction(saving, tx, [paypal], catalog)).toBe(saving);
    const stamped = { catId: 'transferOut', txType: 'transfer' as const };
    expect(resolveTransferPrediction(stamped, tx, [paypal], catalog, 'saving')).toBe(stamped);
  });
});
