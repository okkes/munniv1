// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMT_FIXTURE } from '@/test/camt-fixture';
import { USER_TEST_DB, renderApp, renderAppAsUser } from '@/test/harness';

describe('AccountsScreen (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('lists the seeded demo accounts', async () => {
    renderApp('/accounts');
    expect(await screen.findByTestId('account-row-demo_main')).toBeTruthy();
    expect(screen.getByTestId('account-row-demo_save')).toBeTruthy();
  });

  it('feed accounts show their attachments and open the attach sheet', async () => {
    // seed a feed-shaped account (its spaceId has no space row) attached
    // to the demo space via a link mirror — the global overview must show
    // "via <space>" and tapping opens attach management, not the editor
    const first = renderApp('/accounts');
    await screen.findByTestId('account-row-demo_main');
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('account', 'feed-1', 'feedacct-1', {
      name: 'ING Betaal',
      type: 'checking',
      source: 'gocardless',
      currency: 'EUR',
      balanceCents: 5000,
      iban: 'NL69INGB0123456789',
      lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    await repo.upsert('accountLink', 'demo_space', 'link-1', {
      feedSpaceId: 'feed-1',
      accountId: 'feedacct-1',
      attachedByName: 'Okkes',
    });
    db.close();
    first.unmount();

    renderApp('/accounts');
    const row = await screen.findByTestId('account-row-feedacct-1');
    expect(screen.getByTestId('account-via-feedacct-1').textContent).toContain('Demo');
    // when the bank last answered (user request)
    expect(screen.getByTestId('account-synced-feedacct-1').textContent).toContain('minutes ago');

    fireEvent.click(row);
    expect(await screen.findByTestId('attach-spaces')).toBeTruthy();
    // the sheet lists ONLY attached spaces now (checkboxes retired)
    expect(screen.getByTestId('attach-space-demo_space')).toBeTruthy();
    expect(screen.getByTestId('attach-detach-demo_space')).toBeTruthy();
    expect(screen.queryByTestId('acctedit-name')).toBeNull(); // not the editor
  });

  it('an icon pick shows up while the attach sheet stays open', async () => {
    // regression: the sheet rendered the entry SNAPSHOT, so a freshly
    // picked icon looked like it did nothing until the screen was reopened
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('brands/index.json')
        ? new Response(JSON.stringify([{ slug: 'netflix', title: 'Netflix' }]), { status: 200 })
        : new Response('', { status: 404 }),
    );
    const first = renderApp('/accounts');
    await screen.findByTestId('account-row-demo_main');
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('account', 'feed-1', 'feedacct-1', {
      name: 'ING Betaal',
      type: 'checking',
      source: 'gocardless',
      currency: 'EUR',
      balanceCents: 5000,
      iban: 'NL69INGB0123456789',
    });
    await repo.upsert('accountLink', 'demo_space', 'link-1', {
      feedSpaceId: 'feed-1',
      accountId: 'feedacct-1',
    });
    db.close();
    first.unmount();

    renderApp('/accounts');
    fireEvent.click(await screen.findByTestId('account-row-feedacct-1'));
    fireEvent.click(await screen.findByTestId('attach-change-icon'));
    fireEvent.change(await screen.findByTestId('brandpicker-search'), { target: { value: 'netflix' } });
    fireEvent.click(await screen.findByTestId('brandpicker-netflix'));
    // no close/reopen: the live account row swaps the button's icon in place
    await waitFor(() => expect(screen.getByTestId('attach-change-icon').querySelector('img')).toBeTruthy());
    fetchMock.mockRestore();
  }, 15_000);

  it('AE2: a feed account attached to no space gets the one-tap attach offer; accept wires it to the active space', async () => {
    indexedDB.deleteDatabase(USER_TEST_DB);
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    // fresh bank connect: the account exists in its feed space, but NO
    // accountLink row anywhere — exactly the "attached nowhere" state
    await repo.upsert('account', 'feed-1', 'feedacct-1', {
      name: 'ING Betaal',
      type: 'checking',
      source: 'gocardless',
      currency: 'EUR',
      balanceCents: 5000,
      iban: 'NL69INGB0123456789',
    });
    db.close();

    let attachBody: { historyFrom?: string } | undefined;
    renderAppAsUser('/accounts', {
      spaces: [{ id: 's-user', name: 'Personal' }],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false } }),
        'GET /me/spaces': () => ['s-user', 'feed-1'],
        'GET /me/feeds': () => [{ feedSpaceId: 'feed-1' }],
        'POST /spaces/s-user/accounts': (body) => {
          attachBody = body as { historyFrom?: string };
          return {};
        },
      },
    });

    const offer = await screen.findByTestId('attach-offer', {}, { timeout: 5000 });
    expect(offer.textContent).toContain('Personal');
    fireEvent.click(screen.getByTestId('attach-offer-accept'));
    // the attach reaches the server with the default history window…
    await waitFor(() => expect(attachBody?.historyFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/), { timeout: 5000 });
    // …and once the link mirror lands the offer resolves itself
    await waitFor(() => expect(screen.queryByTestId('attach-offer')).toBeNull(), { timeout: 5000 });
  }, 15_000);

  it('AE2: "not now" dismisses the offer and it stays dismissed', async () => {
    indexedDB.deleteDatabase(USER_TEST_DB);
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('account', 'feed-1', 'feedacct-1', {
      name: 'ING Betaal',
      type: 'checking',
      source: 'gocardless',
      currency: 'EUR',
      balanceCents: 5000,
      iban: 'NL69INGB0123456789',
    });
    db.close();

    renderAppAsUser('/accounts', {
      spaces: [{ id: 's-user', name: 'Personal' }],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false } }),
        'GET /me/spaces': () => ['s-user', 'feed-1'],
        'GET /me/feeds': () => [{ feedSpaceId: 'feed-1' }],
      },
    });

    fireEvent.click(await screen.findByTestId('attach-offer-dismiss', {}, { timeout: 5000 }));
    await waitFor(() => expect(screen.queryByTestId('attach-offer')).toBeNull());
    // the dismissal is remembered on the device, not just this render
    const db2 = new MunniDB(USER_TEST_DB);
    const dismissed = (await db2.meta.get('attachOfferDismissed'))?.value as string[] | undefined;
    expect(dismissed).toContain('feedacct-1');
    db2.close();
  }, 15_000);

  it('space accounts screen attaches one of my feed accounts with a start date', async () => {
    // redesign: attaching happens on the space's own accounts screen —
    // pick an existing account, choose the history start, import
    indexedDB.deleteDatabase(USER_TEST_DB);
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('account', 'feed-1', 'feedacct-1', {
      name: 'ING Betaal',
      type: 'checking',
      source: 'gocardless',
      currency: 'EUR',
      balanceCents: 5000,
      iban: 'NL69INGB0123456789',
    });
    db.close();

    let attachBody: { historyFrom?: string } | undefined;
    renderAppAsUser('/spaces/s-user/accounts', {
      spaces: [{ id: 's-user', name: 'Personal' }],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false } }),
        // production /me/spaces includes reachable feeds — without feed-1
        // here the engine treats it as lost access and purges the account
        'GET /me/spaces': () => ['s-user', 'feed-1'],
        'GET /me/feeds': () => [{ feedSpaceId: 'feed-1' }],
        'POST /spaces/s-user/accounts': (body) => {
          attachBody = body as { historyFrom?: string };
          return {};
        },
      },
    });

    fireEvent.click(await screen.findByTestId('space-accounts-attach'));
    fireEvent.click(await screen.findByTestId('space-attach-pick-feedacct-1'));
    fireEvent.change(await screen.findByTestId('space-attach-history'), { target: { value: '2026-01-01' } });
    fireEvent.click(screen.getByTestId('space-attach-save'));
    // the chosen start date reaches the server…
    await waitFor(() => expect(attachBody?.historyFrom).toBe('2026-01-01'), { timeout: 5000 });
    // …and the synced mirror renders the attachment as a tappable row
    await waitFor(() => expect(screen.getByTestId('space-accounts-list').textContent).toContain('ING Betaal'), { timeout: 5000 });
  }, 15_000);

  it('space accounts screen detaches through the danger sheet', async () => {
    indexedDB.deleteDatabase(USER_TEST_DB);
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('account', 'feed-1', 'feedacct-1', {
      name: 'ING Betaal',
      type: 'checking',
      source: 'gocardless',
      currency: 'EUR',
      balanceCents: 5000,
      iban: 'NL69INGB0123456789',
    });
    await repo.upsert('accountLink', 's-user', 'link-1', { feedSpaceId: 'feed-1', accountId: 'feedacct-1' });
    db.close();

    let detached = false;
    renderAppAsUser('/spaces/s-user/accounts', {
      spaces: [{ id: 's-user', name: 'Personal' }],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false } }),
        'GET /me/spaces': () => ['s-user', 'feed-1'],
        'GET /me/feeds': () => [{ feedSpaceId: 'feed-1' }],
        'GET /spaces/s-user/accounts': () => [{ id: 'srv-1', feedSpaceId: 'feed-1', accountId: 'feedacct-1' }],
        'DELETE /spaces/s-user/accounts/srv-1': () => {
          detached = true;
          return {};
        },
      },
    });

    // detach moved into the row's info sheet (redesign ss13): tap the
    // row, then the sheet's Detach, then the shared danger confirm
    fireEvent.click(await screen.findByTestId('space-account-link-1'));
    fireEvent.click(await screen.findByTestId('space-account-sheet-detach'));
    fireEvent.click(await screen.findByTestId('space-account-detach-confirm'));
    await waitFor(() => expect(detached).toBe(true), { timeout: 5000 });
    await waitFor(() => expect(screen.queryByTestId('space-account-link-1')).toBeNull(), { timeout: 5000 });
  }, 15_000);

  it('global sheet lists only attached spaces and detaches from there too', async () => {
    indexedDB.deleteDatabase(USER_TEST_DB);
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('account', 'feed-1', 'feedacct-1', {
      name: 'ING Betaal',
      type: 'checking',
      source: 'gocardless',
      currency: 'EUR',
      balanceCents: 5000,
      iban: 'NL69INGB0123456789',
    });
    await repo.upsert('accountLink', 's-user', 'link-1', { feedSpaceId: 'feed-1', accountId: 'feedacct-1' });
    db.close();

    let detached = false;
    renderAppAsUser('/accounts', {
      spaces: [{ id: 's-user', name: 'Personal' }],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false } }),
        'GET /me/spaces': () => ['s-user', 'feed-1'],
        'GET /me/feeds': () => [{ feedSpaceId: 'feed-1' }],
        'GET /spaces/s-user/accounts': () => [{ id: 'srv-1', feedSpaceId: 'feed-1', accountId: 'feedacct-1' }],
        'DELETE /spaces/s-user/accounts/srv-1': () => {
          detached = true;
          return {};
        },
      },
    });

    fireEvent.click(await screen.findByTestId('account-row-feedacct-1'));
    // attached spaces render as plain rows with a detach — no checkboxes
    const row = await screen.findByTestId('attach-space-s-user');
    expect(row.querySelector('.mdi-checkbox-marked, .mdi-checkbox-blank-outline')).toBeNull();
    fireEvent.click(screen.getByTestId('attach-detach-s-user'));
    fireEvent.click(await screen.findByTestId('attach-detach-confirm'));
    await waitFor(() => expect(detached).toBe(true), { timeout: 5000 });
    // the sheet empties: the account no longer feeds any space
    await waitFor(() => expect(screen.getByTestId('attach-none')).toBeTruthy(), { timeout: 5000 });
  }, 15_000);

  it('deleting a connected account confirms, calls the server and purges it locally', async () => {
    indexedDB.deleteDatabase(USER_TEST_DB);
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('account', 'feed-1', 'feedacct-1', {
      name: 'ING Betaal',
      type: 'checking',
      source: 'gocardless',
      currency: 'EUR',
      balanceCents: 5000,
      iban: 'NL69INGB0123456789',
    });
    db.close();

    let deleted = false;
    renderAppAsUser('/accounts', {
      spaces: [{ id: 's-user', name: 'Personal' }],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false } }),
        'GET /me/spaces': () => ['s-user', 'feed-1'],
        'GET /me/feeds': () => [{ feedSpaceId: 'feed-1' }],
        'DELETE /me/feeds/feed-1': () => {
          deleted = true;
          return { erased: true };
        },
      },
    });

    fireEvent.click(await screen.findByTestId('account-row-feedacct-1'));
    fireEvent.click(await screen.findByTestId('attach-delete'));
    // the X-style direct delete never fires — a confirm sheet asks first
    fireEvent.click(await screen.findByTestId('attach-delete-confirm'));
    await waitFor(() => expect(deleted).toBe(true), { timeout: 5000 });
    // the feed's local rows are purged: the account leaves the overview
    await waitFor(() => expect(screen.queryByTestId('account-row-feedacct-1')).toBeNull(), { timeout: 5000 });
  }, 15_000);

  it('adds a manual cash account via the space door (manual is space-scoped now)', async () => {
    renderApp('/accounts');
    await screen.findByTestId('account-row-demo_main');
    fireEvent.click(screen.getByTestId('accounts-add'));
    // the GLOBAL screen offers manual only as a DOOR into the space
    // (user ruling 2026-07-28) — creation happens on the space screen
    fireEvent.click(await screen.findByTestId('chooser-manual-door'));
    // "Add a manual account" opens the type grid directly (redesign ss13)
    fireEvent.click(await screen.findByTestId('space-accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-accttype-cash'));
    fireEvent.change(screen.getByTestId('chooser-acctform-name'), { target: { value: 'Wallet' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-balance'), { target: { value: '25,50' } });
    fireEvent.click(screen.getByTestId('chooser-acctform-save'));
    await waitFor(() => expect(screen.getByText('Wallet')).toBeTruthy());
  }, 15_000);

  it('a credit card account stores its balance as a liability, listed under its space', async () => {
    renderApp('/accounts');
    await screen.findByTestId('account-row-demo_main');
    fireEvent.click(screen.getByTestId('accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-manual-door'));
    fireEvent.click(await screen.findByTestId('space-accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-accttype-credit'));
    fireEvent.change(screen.getByTestId('chooser-acctform-name'), { target: { value: 'Visa' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-balance'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('chooser-acctform-save'));
    await screen.findByText('Visa');
    // the claim is the STORED sign: liabilities keep negative cents
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const rows = await db.accounts.filter((a) => a.name === 'Visa').toArray();
      expect(rows[0]?.balanceCents).toBe(-10_000);
    });
    db.close();
  }, 15_000);

  it('the sign toggle stores an overpaid card POSITIVE; space rows edit in place', async () => {
    renderApp('/accounts');
    await screen.findByTestId('account-row-demo_main');
    fireEvent.click(screen.getByTestId('accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-manual-door'));
    fireEvent.click(await screen.findByTestId('space-accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-accttype-credit'));
    fireEvent.change(screen.getByTestId('chooser-acctform-name'), { target: { value: 'Amex' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-balance'), { target: { value: '100' } });
    // liabilities DEFAULT to −, but the user decides (overpaid card rule)
    fireEvent.click(screen.getByTestId('chooser-acctform-pos'));
    fireEvent.click(screen.getByTestId('chooser-acctform-save'));

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    let id = '';
    await waitFor(async () => {
      const rows = await db.accounts.filter((a) => a.name === 'Amex').toArray();
      expect(rows[0]?.balanceCents).toBe(10_000); // stored POSITIVE
      id = rows[0]?.id ?? '';
    }, { timeout: 5000 });

    // the row opens the info sheet; Edit inside it reaches the SAME
    // edit sheet as the global screen (redesign ss13)
    fireEvent.click(await screen.findByTestId(`space-account-${id}`));
    fireEvent.click(await screen.findByTestId('space-account-sheet-edit'));
    fireEvent.change(await screen.findByTestId('acctedit-name'), { target: { value: 'Amex Gold' } });
    fireEvent.click(screen.getByTestId('acctedit-save'));
    await waitFor(async () => {
      const rows = await db.accounts.filter((a) => a.name === 'Amex Gold').toArray();
      expect(rows).toHaveLength(1);
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('renames and deletes an account from the edit sheet', async () => {
    renderApp('/accounts');
    fireEvent.click(await screen.findByTestId('account-row-demo_save'));
    const nameInput = await screen.findByTestId('acctedit-name');
    fireEvent.change(nameInput, { target: { value: 'Rainy day' } });
    fireEvent.click(screen.getByTestId('acctedit-save'));
    await waitFor(() => expect(screen.getByTestId('account-row-demo_save').textContent).toContain('Rainy day'));

    fireEvent.click(screen.getByTestId('account-row-demo_save'));
    // aligned destructive confirm: delete opens the shared danger sheet
    fireEvent.click(await screen.findByTestId('acctedit-delete'));
    fireEvent.click(await screen.findByTestId('acctedit-remove-confirm'));
    await waitFor(() => expect(screen.queryByTestId('account-row-demo_save')).toBeNull());
  });

  it('imports a CAMT.053 file: preview, run, result, new account appears', async () => {
    renderApp('/accounts');
    await screen.findByTestId('account-row-demo_main');
    const input = screen.getByTestId('accounts-import-input') as HTMLInputElement;
    const file = new File([CAMT_FIXTURE], 'statement.xml', { type: 'text/xml' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    const preview = await screen.findByTestId('import-preview');
    expect(preview.textContent).toContain('NL69INGB0123456789');
    expect(preview.textContent).toContain('2 transactions');

    fireEvent.click(screen.getByTestId('import-run'));
    const result = await screen.findByTestId('import-result');
    expect(result.textContent).toContain('Imported 2 transactions, skipped 0 duplicates');
    fireEvent.click(screen.getByTestId('import-close'));
    // the imported IBAN now exists as an account
    await waitFor(() => expect(screen.getByText('NL69INGB0123456789')).toBeTruthy());
  });

  it('rejects a non-CAMT file with the error banner', async () => {
    renderApp('/accounts');
    await screen.findByTestId('account-row-demo_main');
    const input = screen.getByTestId('accounts-import-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['<html>nope</html>'], 'x.xml')] });
    fireEvent.change(input);
    expect(await screen.findByTestId('import-error')).toBeTruthy();
  });
});

describe('reconcile suggestion (master plan: linked is the truth)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('offers a reconcile pass on a mixed-source account, reviews, and deletes judged imports', async () => {
    const first = renderApp('/accounts');
    await screen.findByTestId('account-row-demo_main');
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('rec-ui'), { trackOutbox: false });
    const raw = { accountId: 'demo_main', currency: 'EUR', txType: 'expense' as const, needsReview: 0 as const };
    // the connection's truth + one matched import, one mismatch, one keeper
    await repo.upsert('transaction', 'demo_space', 'RL1', { ...raw, date: '2026-06-01', amountCents: -5000, merchant: 'EDGE', importRef: 'REF-EDGE' });
    await repo.upsert('transaction', 'demo_space', 'RL2', { ...raw, date: '2026-06-10', amountCents: -1200, merchant: 'SHELL', importRef: 'REF-B' });
    await repo.upsert('transaction', 'demo_space', 'RL3', { ...raw, date: '2026-06-20', amountCents: -300, merchant: 'END', importRef: 'REF-END' });
    await repo.upsert('transaction', 'demo_space', 'RI1', { ...raw, date: '2026-06-10', amountCents: -1200, merchant: 'Shell station', importRef: 'ing:u:1' });
    await repo.upsert('transaction', 'demo_space', 'RI2', { ...raw, date: '2026-06-12', amountCents: -999, merchant: 'GHOST', importRef: 'ing:u:2' });
    await repo.upsert('transaction', 'demo_space', 'RI3', { ...raw, date: '2023-01-05', amountCents: -700, merchant: 'OLD', importRef: 'ing:u:3' });
    db.close();
    first.unmount();

    renderApp('/accounts');
    // the suggestion names the mixed-source account and its import count
    fireEvent.click(await screen.findByTestId('account-reconcile-demo_main', {}, { timeout: 5000 }));

    // full review: the match (checked for migration), the mismatch, the keeper note
    await screen.findByTestId('reconcile-review', {}, { timeout: 5000 });
    expect(screen.getByTestId('reconcile-match-RI1')).toBeTruthy();
    expect((screen.getByTestId('reconcile-migrate-RI1') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('reconcile-mismatch-RI2').textContent).toContain('GHOST');
    expect(screen.getByTestId('reconcile-kept').textContent).toContain('1');

    fireEvent.click(screen.getByTestId('reconcile-confirm'));
    await screen.findByTestId('reconcile-done', {}, { timeout: 5000 });

    const check = new MunniDB('munni_demo');
    expect((await check.transactions.get('RI1'))?.deleted).toBe(1);
    expect((await check.transactions.get('RI2'))?.deleted).toBe(1);
    expect((await check.transactions.get('RI3'))?.deleted).toBe(0);
    check.close();
  }, 20_000);
});

describe('import batches (master plan IB)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('the attach sheet lists statement uploads and rolls one back — only ITS rows fall', async () => {
    const first = renderApp('/accounts');
    await screen.findByTestId('account-row-demo_main');
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('ib-ui'), { trackOutbox: false });
    await repo.upsert('account', 'feed-1', 'feedacct-1', {
      name: 'ING Betaal',
      type: 'checking',
      source: 'camt053',
      currency: 'EUR',
      balanceCents: 5000,
      iban: 'NL69INGB0123456789',
    });
    await repo.upsert('accountLink', 'demo_space', 'link-1', { feedSpaceId: 'feed-1', accountId: 'feedacct-1', attachedByName: 'Okkes' });
    const raw = { accountId: 'feedacct-1', currency: 'EUR', txType: 'expense' as const, needsReview: 0 as const };
    // one two-row batch (with an uploader name) and one row a LATER upload
    // merely re-encountered — it keeps its first batch and must survive
    await repo.upsert('transaction', 'demo_space', 'B1a', { ...raw, date: '2026-06-03', amountCents: -100, merchant: 'A', importRef: 'ing:b:1', importBatchId: 'batch-1', importedBy: 'Okkes' });
    await repo.upsert('transaction', 'demo_space', 'B1b', { ...raw, date: '2026-06-07', amountCents: -200, merchant: 'B', importRef: 'ing:b:2', importBatchId: 'batch-1', importedBy: 'Okkes' });
    await repo.upsert('transaction', 'demo_space', 'B2a', { ...raw, date: '2026-06-09', amountCents: -300, merchant: 'C', importRef: 'ing:b:3', importBatchId: 'batch-2' });
    db.close();
    first.unmount();

    renderApp('/accounts');
    fireEvent.click(await screen.findByTestId('account-row-feedacct-1', {}, { timeout: 5000 }));
    const list = await screen.findByTestId('attach-imports', {}, { timeout: 5000 });
    // batch-1 spans its rows' dates and names its uploader
    expect(list.textContent).toContain('2026-06-03');
    expect(list.textContent).toContain('2026-06-07');
    expect(list.textContent).toContain('Okkes');

    fireEvent.click(screen.getByTestId('attach-rollback-batch-1'));
    fireEvent.click(await screen.findByTestId('attach-rollback-confirm', {}, { timeout: 5000 }));
    // batch-1's rows tombstone; batch-2's row (and its list entry) survive
    await waitFor(() => expect(screen.queryByTestId('attach-rollback-batch-1')).toBeNull(), { timeout: 5000 });
    expect(screen.getByTestId('attach-rollback-batch-2')).toBeTruthy();
    const check = new MunniDB('munni_demo');
    expect((await check.transactions.get('B1a'))?.deleted).toBe(1);
    expect((await check.transactions.get('B1b'))?.deleted).toBe(1);
    expect((await check.transactions.get('B2a'))?.deleted).toBe(0);
    check.close();
  }, 20_000);
});
