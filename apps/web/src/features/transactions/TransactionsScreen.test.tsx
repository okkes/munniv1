// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';
import { clearTxFilters, presetTxFilters } from './txFilters';
import { DEMO_SPACE_ID } from '@/db/seed';
import { HlcClock } from '@/sync/hlc';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';

const rows = () => screen.getByTestId('tx-list').querySelectorAll('[data-testid^="tx-row-"]');

describe('TransactionsScreen (demo identity)', () => {
  beforeEach(async () => {
    // the previous spec's boot chain must settle before the db goes
    // away, or its dying writes race this spec's seeds (the db.close
    // trap — the heavier every-boot chain widened the window)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
    // #140: the lens survives remounts by design — specs are fresh apps
    clearTxFilters();
  });

  it('a filter that matches only SOME parts shows exactly those, aligned as normal rows (#126 r8)', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-partfilter'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'pf1', {
      accountId: 'demo_main', date: '2020-03-01', amountCents: -3000, currency: 'EUR',
      merchant: 'PartFilter Shop', catId: 'groceries', txType: 'expense', needsReview: 0,
      splits: [
        { id: 'pfa', catId: 'groceries', amountCents: 2000, label: 'Food half' },
        { id: 'pfb', catId: 'uncategorized', amountCents: 1000, label: 'Mystery half' },
      ],
    });
    // unfiltered: the band with both branches stands
    await screen.findByTestId('tx-parts-pf1', {}, { timeout: 5000 });

    // the Uncategorized quick filter matches ONE part — the band gives
    // way to that part standing alone with the split glyph
    fireEvent.click(screen.getByTestId('tx-filter-uncat'));
    await screen.findByTestId('tx-part-solo-pf1-1');
    expect(screen.getByTestId('tx-part-solo-pf1-1').textContent).toContain('Mystery half');
    expect(screen.queryByTestId('tx-parts-pf1')).toBeNull();
    expect(screen.queryByTestId('tx-part-solo-pf1-0')).toBeNull();

    // filter off: the full band returns
    fireEvent.click(screen.getByTestId('tx-filter-uncat'));
    await screen.findByTestId('tx-parts-pf1');
    db.close();
  }, 15_000);

  it('#140/#148 r2: the lens survives a remount (detail detour); the new-only preset shows first-seen arrivals', async () => {
    const first = renderApp('/transactions');
    await screen.findByTestId('tx-list');
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
    const fullCount = rows().length;
    // turn a lens on — search text
    fireEvent.change(screen.getByTestId('tx-search'), { target: { value: 'heijn' } });
    await waitFor(() => expect(rows().length).toBeLessThan(fullCount));
    // mobile unmounts the list for the detail page — simulate the detour
    first.unmount();
    cleanup();
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    // #140: the lens came back with the remount
    expect((screen.getByTestId('tx-search') as HTMLInputElement).value).toBe('heijn');
    await waitFor(() => expect(rows().length).toBeLessThan(fullCount));
    cleanup();
    // #148 r2: home's "see all" arrives with ONLY the new lens preset.
    // NEW = first seen by this device within 24h — the whole demo seed
    // was present on the first render, so the lens starts EMPTY…
    presetTxFilters({ newOnly: true });
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    expect((screen.getByTestId('tx-search') as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(rows()).toHaveLength(0));
    // …and a row arriving AFTER that first sight gets labeled and shows
    const db2 = new MunniDB('munni_demo');
    const repo2 = new Repo(new DexieBackend(db2), new HlcClock('seed-newlens'), { trackOutbox: false });
    await repo2.upsert('transaction', DEMO_SPACE_ID, 'fresh1', {
      accountId: 'demo_main', date: '2020-04-01', amountCents: -1234, currency: 'EUR',
      merchant: 'Fresh Arrival', catId: 'groceries', txType: 'expense', needsReview: 0,
    });
    await screen.findByTestId('tx-row-fresh1', {}, { timeout: 5000 });
    expect(rows()).toHaveLength(1);
    db2.close();
    // and a tab-switch style reset clears it again (full list = the
    // demo seed plus the fresh arrival)
    clearTxFilters();
    cleanup();
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    await waitFor(() => expect(rows()).toHaveLength(fullCount + 1));
  }, 15_000);

  it('#243 r2: the linked chip keeps EVERY row and uncollapses the pairs', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-pairlens'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'leg-out', {
      accountId: 'demo_main', date: '2020-05-01', amountCents: -7000, currency: 'EUR',
      merchant: 'To savings', catId: 'savingDeposit', txType: 'saving', needsReview: 0,
      linkedAccountId: 'demo_save', transferPeerId: 'leg-in',
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'leg-in', {
      accountId: 'demo_save', date: '2020-05-01', amountCents: 7000, currency: 'EUR',
      merchant: 'From checking', catId: 'savingDeposit', txType: 'saving', needsReview: 0,
      linkedAccountId: 'demo_main', transferPeerId: 'leg-out',
    });
    // collapsed by default: the outgoing leg speaks for the pair
    await screen.findByTestId('tx-row-leg-out', {}, { timeout: 5000 });
    expect(screen.queryByTestId('tx-row-leg-in')).toBeNull();
    // set-based asserts — background mirror mints keep exact counts racy
    const snap = () => new Set([...rows()].map((r) => r.getAttribute('data-testid')));
    const collapsed = snap();
    // chip on: the incoming leg joins WITHOUT narrowing — every row of
    // the collapsed view is still there (the old lens filtered to
    // linked-only, which the user rejected)
    fireEvent.click(screen.getByTestId('tx-filter-counter'));
    await screen.findByTestId('tx-row-leg-in');
    const uncollapsed = snap();
    for (const id of collapsed) expect(uncollapsed.has(id), `${id} vanished`).toBe(true);
    // chip off: the pair collapses back — nothing new appears either
    fireEvent.click(screen.getByTestId('tx-filter-counter'));
    await waitFor(() => expect(screen.queryByTestId('tx-row-leg-in')).toBeNull());
    expect(screen.getByTestId('tx-row-leg-out')).toBeTruthy();
    for (const id of snap()) expect(uncollapsed.has(id), `${id} appeared from nowhere`).toBe(true);
    db.close();
  }, 15_000);

  it('search narrows the list to matching merchants', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
    const before = rows().length;

    fireEvent.change(screen.getByTestId('tx-search'), { target: { value: 'Albert Heijn' } });
    await waitFor(() => {
      const after = rows().length;
      expect(after).toBeGreaterThan(0);
      expect(after).toBeLessThan(before);
    });
    for (const row of rows()) {
      expect(row.textContent).toContain('Albert Heijn');
      // the match itself is marked in the row
      expect(row.querySelector('mark')?.textContent).toBe('Albert Heijn');
    }

    fireEvent.change(screen.getByTestId('tx-search'), { target: { value: 'zzz-no-such-merchant' } });
    await waitFor(() => expect(rows()).toHaveLength(0));
  });

  it('the quick chip narrows to uncategorized transactions (user request: unreviewed lives on Home)', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));

    // one uncategorized expense + one categoryless transfer (excluded by design)
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-uncat'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'uncat-1', {
      accountId: 'demo_main', date: '2026-06-20', amountCents: -1250, currency: 'EUR',
      merchant: 'MYSTERY SHOP', catId: 'uncategorized', txType: 'expense', needsReview: 0,
    });
    // #133: the view DERIVES the type — a categoryless row reads as a
    // transfer through its LINK (the stored txType is legacy-only), so
    // the exclusion needs the link to be explicit here
    await repo.upsert('transaction', DEMO_SPACE_ID, 'uncat-2', {
      accountId: 'demo_main', date: '2026-06-21', amountCents: -5000, currency: 'EUR',
      merchant: 'OWN SAVINGS', catId: 'uncategorized', txType: 'transfer', needsReview: 0,
      linkedAccountId: 'demo_save',
    });
    db.close();
    await waitFor(() => expect(screen.queryByText('MYSTERY SHOP')).toBeTruthy(), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('tx-filter-uncat'));
    await waitFor(() => expect(rows()).toHaveLength(1), { timeout: 5000 });
    expect(screen.getByText('MYSTERY SHOP')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tx-filter-uncat'));
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
    // coverage instrumentation pushes this flow past vitest's 5s default
  }, 15_000);

  it('the unsettled-reimbursements chip shows only open expected/received value', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));

    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-unsettled'), { trackOutbox: false });
    // open expectation → shows; fully settled → drops out of the filter
    // #211: modern split seeds version-stamp with an explicit cats null —
    // the boot fold must read them as PARTS, not legacy slices
    await repo.upsert('transaction', DEMO_SPACE_ID, 'open-1', {
      accountId: 'demo_main', date: '2026-06-22', amountCents: -8000, currency: 'EUR',
      merchant: 'FRONTED DINNER', catId: 'eatingOut', txType: 'expense', needsReview: 0, cats: null as never,
      splits: [{ catId: 'eatingOut', amountCents: 3000 }, { catId: 'expenseReimburse', amountCents: 5000 }],
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'settled-1', {
      accountId: 'demo_main', date: '2026-06-23', amountCents: 5000, currency: 'EUR',
      merchant: 'PAID BACK', catId: 'reimbursed', txType: 'income', needsReview: 0, cats: null as never,
      splits: [{ catId: 'reimbursed', amountCents: 5000 }],
    });
    db.close();
    await waitFor(() => expect(screen.queryByText('FRONTED DINNER')).toBeTruthy(), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('tx-filter-unsettled'));
    // #149: the fronted dinner is a flat two-part spread — it stands as
    // the branch group now, not a plain row
    await screen.findByTestId('tx-parts-open-1', {}, { timeout: 5000 });
    await waitFor(() => expect(rows()).toHaveLength(0), { timeout: 5000 });
    expect(screen.getByText('FRONTED DINNER')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tx-filter-unsettled'));
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
  });

  it('#320: the filter sheet narrows by account, splits defaults into their own group, type chips gone', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
    const all = rows().length;

    fireEvent.click(screen.getByTestId('tx-filter-open'));
    // #320 (user): the space's default pots sit in their OWN labeled
    // group, apart from the accounts people actually made
    const defaultsGroup = await screen.findByTestId('filter-defaults-group');
    expect(within(defaultsGroup).getByTestId('filter-account-defaultacct_saving_demo_space')).toBeTruthy();
    expect(within(defaultsGroup).queryByTestId('filter-account-demo_main')).toBeNull();
    // every chip wears the account's face (type icon here — no logo seeded)
    expect(screen.getByTestId('filter-account-demo_main').querySelector('.mdi')).toBeTruthy();
    // …and the type/kind chips are gone for good
    expect(screen.queryByTestId('filter-kind-standard')).toBeNull();
    expect(screen.queryByTestId('filter-kind-transfer')).toBeNull();
    expect(screen.queryByTestId('filter-transfer-detail')).toBeNull();

    // the demo savings account has no transactions — filter yields none
    fireEvent.click(screen.getByTestId('filter-account-demo_save'));
    fireEvent.click(screen.getByTestId('filter-done'));
    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(screen.getByTestId('tx-filter-count').textContent).toBe('1');

    // the clear chip resets the sheet filters
    fireEvent.click(screen.getByTestId('tx-filter-clear'));
    await waitFor(() => expect(rows()).toHaveLength(all));
    // coverage instrumentation pushes this flow past vitest's 5s default
  }, 15_000);

  it('#237 (a): a same-sign wallet pair collapses to the PURCHASE, wearing the funding note', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-wallet'), { trackOutbox: false });
    await repo.upsert('account', DEMO_SPACE_ID, 'wl', {
      name: 'Wallet PayPal', type: 'checking', source: 'camt053', currency: 'EUR', balanceCents: 0,
    });
    // the paired wallet story: the bank top-up is the transfer leg, the
    // purchase keeps its category — both debits
    await repo.upsert('transaction', DEMO_SPACE_ID, 'wbank', {
      accountId: 'demo_main', date: '2020-04-01', amountCents: -799, currency: 'EUR',
      merchant: 'PayPal top-up', catId: 'transferOut', txType: 'transfer', needsReview: 0,
      linkedAccountId: 'wl', transferPeerId: 'wpur',
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'wpur', {
      accountId: 'wl', date: '2020-04-01', amountCents: -799, currency: 'EUR',
      merchant: 'Vueling Wallet', catId: 'holiday', txType: 'expense', needsReview: 0,
      transferPeerId: 'wbank',
    });

    // the purchase stands, the funding leg hides behind it — one event
    await screen.findByTestId('tx-row-wpur', {}, { timeout: 5000 });
    expect(screen.queryByTestId('tx-row-wbank')).toBeNull();
    // …and the surviving row says where the money came from
    expect(screen.getByTestId('tx-row-wpur').textContent).toContain('→ Wallet PayPal');
    db.close();
  }, 15_000);

  it('#198 r3: a split group and its neighbours are direct siblings of the divide-y card', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-divide'), { trackOutbox: false });
    // [tx, split-tx, tx] on one far-past day — an isolated date card
    await repo.upsert('transaction', DEMO_SPACE_ID, 'dv1', {
      accountId: 'demo_main', date: '2020-05-02', amountCents: -1000, currency: 'EUR',
      merchant: 'Before Split', catId: 'groceries', txType: 'expense', needsReview: 0,
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'dvs', {
      accountId: 'demo_main', date: '2020-05-02', amountCents: -3000, currency: 'EUR',
      merchant: 'Split Shop', catId: 'groceries', txType: 'expense', needsReview: 0, cats: null as never,
      splits: [
        { id: 'dvsa', catId: 'groceries', amountCents: 2000 },
        { id: 'dvsb', catId: 'eatingOut', amountCents: 1000 },
      ],
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'dv2', {
      accountId: 'demo_main', date: '2020-05-02', amountCents: -2000, currency: 'EUR',
      merchant: 'After Split', catId: 'eatingOut', txType: 'expense', needsReview: 0,
    });

    const group = await screen.findByTestId('tx-parts-dvs', {}, { timeout: 5000 });
    await screen.findByTestId('tx-row-dv1');
    await screen.findByTestId('tx-row-dv2');
    // the divide-y card draws a hairline between DIRECT siblings — the
    // group wrapper and both plain rows must all sit at that level for
    // the group's boundaries to get their lines (the paint itself is
    // restored in styles.css, above border-none's reach)
    const card = group.parentElement!;
    expect(card.className).toContain('divide-y');
    expect(screen.getByTestId('tx-row-dv1').parentElement).toBe(card);
    expect(screen.getByTestId('tx-row-dv2').parentElement).toBe(card);
    // #198 r2 rule: the parts INSIDE the inset stay nested — no hairlines
    // between the parts of one transaction
    expect(screen.getByTestId('tx-part-row-dvs-0').parentElement).not.toBe(card);
    db.close();
  }, 15_000);

  it('#156 r2: the card-rim rows carry the edge rounding for their selection/focus tint', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-edge'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'er1', {
      accountId: 'demo_main', date: '2020-05-03', amountCents: -1000, currency: 'EUR',
      merchant: 'Edge One', catId: 'groceries', txType: 'expense', needsReview: 0,
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'er2', {
      accountId: 'demo_main', date: '2020-05-03', amountCents: -2000, currency: 'EUR',
      merchant: 'Edge Two', catId: 'groceries', txType: 'expense', needsReview: 0,
    });
    const first = await screen.findByTestId('tx-row-er1', {}, { timeout: 5000 });
    await screen.findByTestId('tx-row-er2');
    const card = first.parentElement!;
    const rowEls = [...card.querySelectorAll('[data-testid^="tx-row-"]')];
    expect(rowEls).toHaveLength(2);
    // first row rounds its tint to the card's top radius, last to the bottom
    expect(rowEls[0].className).toContain('focus-visible:rounded-t-card');
    expect(rowEls[0].className).not.toContain('focus-visible:rounded-b-card');
    expect(rowEls[1].className).toContain('focus-visible:rounded-b-card');
    expect(rowEls[1].className).not.toContain('focus-visible:rounded-t-card');
    db.close();
  }, 15_000);
});
