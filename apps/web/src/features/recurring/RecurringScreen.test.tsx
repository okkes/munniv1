// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { CLIENT_PROTOCOL } from '@/lib/protocol';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_TEST_DB, renderApp, renderAppAsUser } from '@/test/harness';
import { resetApiCapabilitiesCache } from '@/lib/api';
import { DEMO_SPACE_ID } from '@/db/seed';
import { clearRecurringView } from './recurringView';
import { propagateRecurringCategory, reconcileRecurringLinks } from '@/application/recurring';
import { mirrorTxId } from '@/domain/feedIds';
import { HlcClock } from '@/sync/hlc';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthsAgo = (n: number, day = 7) => {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth() - n, day));
};

/** four clean monthly Netflix charges ending this month */
async function seedNetflixPattern(db: MunniDB) {
  const repo = new Repo(new DexieBackend(db), new HlcClock('seed-rec'), { trackOutbox: false });
  for (let i = 0; i < 4; i++) {
    await repo.upsert('transaction', DEMO_SPACE_ID, `nfx_${i}`, {
      accountId: 'demo_main',
      date: monthsAgo(i, Math.min(new Date().getDate(), 28)),
      amountCents: -1399,
      currency: 'EUR',
      merchant: 'NETFLIX.COM',
      catId: 'subs',
      txType: 'expense',
      needsReview: 0,
    });
  }
}

describe('RecurringScreen (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
    clearRecurringView(); // #168 r5: the tab memory outlives renderApp by design
  });

  it('a sustained price change badges the row, the detail and the yearly totals', async () => {
    // seed a recurring with linked charges: 13.99, 13.99, 15.99, 15.99
    const first = renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-price'), { trackOutbox: false });
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec_price', {
      name: 'Streamo',
      kind: 'subscription',
      amountCents: 1599,
      every: 'month',
      dueDay: 7,
      active: 1,
    });
    for (let i = 0; i < 4; i++) {
      await repo.upsert('transaction', DEMO_SPACE_ID, `str_${i}`, {
        accountId: 'demo_main',
        date: monthsAgo(3 - i, Math.min(new Date().getDate(), 28)),
        amountCents: i < 2 ? -1399 : -1599,
        currency: 'EUR',
        merchant: 'STREAMO',
        catId: 'subs',
        txType: 'expense',
        needsReview: 0,
        recurringId: 'rec_price',
      });
    }
    first.unmount();

    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    // the +€2.00 delta wears itself openly on the row (S2)…
    const badge = await screen.findByTestId('recurring-pricechange-rec_price', {}, { timeout: 5000 });
    expect(badge.textContent).toContain('2.00');
    // …the screen carries the honest annual figure (S1)
    expect(screen.getByTestId('recurring-year-total').textContent).toMatch(/year/);

    // the detail tells the whole story with its yearly impact
    fireEvent.click(screen.getByTestId('recurring-row-rec_price'));
    const card = await screen.findByTestId('recdetail-pricechange', {}, { timeout: 5000 });
    expect(card.textContent).toContain('€13.99');
    expect(card.textContent).toContain('€15.99');
    expect(card.textContent).toContain('+€24.00');
    db.close();
  }, 20_000);

  it('creates a recurring cost from the sheet and shows it with period stats', async () => {
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');

    fireEvent.click(screen.getByTestId('recurring-add'));
    fireEvent.change(await screen.findByTestId('recform-name'), { target: { value: 'Rent' } });
    fireEvent.click(screen.getByTestId('recform-kind-fixed'));
    fireEvent.change(screen.getByTestId('recform-amount'), { target: { value: '740' } });
    fireEvent.click(screen.getByTestId('recform-save'));

    await waitFor(() => expect(screen.getByText('Rent')).toBeTruthy(), { timeout: 5000 });
    // summary shows the expected total for this period
    expect(screen.getByTestId('recurring-summary').textContent).toMatch(/740/);
    expect(screen.getByText(/Fixed costs/)).toBeTruthy();
  }, 15_000);

  it('#274: a special category offers the counterparty pick; save persists it', async () => {
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');

    fireEvent.click(screen.getByTestId('recurring-add'));
    fireEvent.change(await screen.findByTestId('recform-name'), { target: { value: 'Pot money' } });
    fireEvent.change(screen.getByTestId('recform-amount'), { target: { value: '100' } });
    // no counter row while the category is regular/unpicked
    expect(screen.queryByTestId('recform-counter')).toBeNull();
    fireEvent.click(screen.getByTestId('recform-cat'));
    fireEvent.click(await screen.findByTestId('catpicker-savingDeposit'));
    // the special pick surfaces the counterparty row; the pot answers it
    fireEvent.click(await screen.findByTestId('recform-counter'));
    fireEvent.click(await screen.findByTestId('recform-counter-acct-demo_save'));
    await waitFor(() => expect(screen.getByTestId('recform-counter').textContent).toContain('Demo Savings'));
    fireEvent.click(screen.getByTestId('recform-save'));

    const db = new MunniDB('munni_demo');
    await waitFor(
      async () => {
        const rec = (await db.recurrings.toArray()).find((r) => r.name === 'Pot money');
        expect(rec?.catId).toBe('savingDeposit');
        expect(rec?.linkedAccountId).toBe('demo_save');
      },
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('#274: propagation carries the counterparty to linked rows — the manual pot leg mints', async () => {
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const db = new MunniDB('munni_demo');
    const backend = new DexieBackend(db);
    const repo = new Repo(backend, new HlcClock('rec-counter'), { trackOutbox: false });
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec-ct', {
      name: 'Pot topup', kind: 'subscription', amountCents: 10_000, every: 'month',
      dueDay: 1, active: 1, catId: 'savingDeposit', linkedAccountId: 'demo_save',
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'rt1', {
      accountId: 'demo_main', date: '2026-03-01', amountCents: -10_000, currency: 'EUR',
      merchant: 'Pot topup', catId: 'uncategorized', txType: 'expense', needsReview: 1, recurringId: 'rec-ct',
    });

    await propagateRecurringCategory(backend, repo, DEMO_SPACE_ID, 'rec-ct', 'savingDeposit', 'demo_save');

    await waitFor(async () => {
      const row = await db.transactions.get('rt1');
      expect(row?.catId).toBe('savingDeposit');
      expect(row?.linkedAccountId).toBe('demo_save');
      expect(row?.needsReview).toBe(0);
      // manual counterparty: the choke minted the pot's own leg
      const mirror = await db.transactions.get(mirrorTxId('rt1'));
      expect(mirror?.accountId).toBe('demo_save');
      expect(mirror?.amountCents).toBe(10_000);
    }, { timeout: 8000 });
    db.close();
  }, 20_000);

  it('luxury subscriptions show the badge and the luxury line', async () => {
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');

    fireEvent.click(screen.getByTestId('recurring-add'));
    fireEvent.change(await screen.findByTestId('recform-name'), { target: { value: 'Spotify' } });
    fireEvent.change(screen.getByTestId('recform-amount'), { target: { value: '9.99' } });
    fireEvent.click(screen.getByTestId('recform-luxury'));
    fireEvent.click(screen.getByTestId('recform-save'));

    await waitFor(() => expect(screen.getByText('Spotify')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByTestId('recurring-luxury-line')).toBeTruthy();
  }, 15_000);

  it('#332: fixed costs hide the luxury flag — and picking fixed clears a set one', async () => {
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');

    fireEvent.click(screen.getByTestId('recurring-add'));
    fireEvent.change(await screen.findByTestId('recform-name'), { target: { value: 'Rent 332' } });
    fireEvent.change(screen.getByTestId('recform-amount'), { target: { value: '740' } });
    // the default (subscription) offers the flag; switch it on
    fireEvent.click(screen.getByTestId('recform-luxury'));
    await waitFor(() => expect(screen.getByTestId('recform-luxury').innerHTML).toContain('justify-end'));

    // fixed: the control disappears (a structural cost is never luxury)…
    fireEvent.click(screen.getByTestId('recform-kind-fixed'));
    await waitFor(() => expect(screen.queryByTestId('recform-luxury')).toBeNull());

    // …and returning shows it again, cleared — no hidden flag lurked
    fireEvent.click(screen.getByTestId('recform-kind-subscription'));
    await waitFor(() => expect(screen.getByTestId('recform-luxury').innerHTML).toContain('justify-start'));

    // set once more, pick fixed, save: the record persists luxury OFF
    fireEvent.click(screen.getByTestId('recform-luxury'));
    fireEvent.click(screen.getByTestId('recform-kind-fixed'));
    fireEvent.click(screen.getByTestId('recform-save'));
    const db = new MunniDB('munni_demo');
    await waitFor(
      async () => {
        const rec = (await db.recurrings.toArray()).find((r) => r.name === 'Rent 332');
        expect(rec?.kind).toBe('fixed');
        expect(rec?.luxury).toBe(0);
      },
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('detects a monthly pattern; the inbox shows its evidence; dismissing removes it for good', async () => {
    const db = new MunniDB('munni_demo');
    // the demo seed only runs once — let the app create it first
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    await seedNetflixPattern(db);

    // notification-style entry on the tab → the suggestions screen
    fireEvent.click(await screen.findByTestId('recurring-suggestions-banner', {}, { timeout: 5000 }));
    await screen.findByTestId('screen-recurring-suggestions');
    const card = await screen.findByTestId('recsuggest-card-netflix com');
    expect(card.textContent).toContain('NETFLIX.COM');
    // the card carries its evidence: all four matched charges
    expect(card.querySelectorAll('[data-testid^="recsuggest-tx-"]')).toHaveLength(4);

    fireEvent.click(screen.getByTestId('recurring-dismiss-netflix com'));
    // the demo data may yield suggestions of its own — only Netflix must go
    await waitFor(() => expect(screen.queryByTestId('recurring-dismiss-netflix com')).toBeNull(), { timeout: 5000 });
    // the dismissal is persisted, not just hidden
    expect(await db.recurringDismissals.count()).toBe(1);
    db.close();
  }, 15_000);

  it('detection reads PAST the space start date — pre-start charges are the evidence', async () => {
    const db = new MunniDB('munni_demo');
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-gate'), { trackOutbox: false });
    // the space starts on the 1st of THIS month — all four charges that
    // make the pattern are display-gated; detection must still see them.
    // Charges ride TODAY's day-of-month (like the Netflix seed): a fixed
    // day-1 cadence went 15+ days overdue mid-month and detection rightly
    // dropped it as lapsed — a run-day flake, not the gate under test.
    await repo.upsert('space', DEMO_SPACE_ID, DEMO_SPACE_ID, { historyStartDate: monthsAgo(0, 1) });
    for (let i = 1; i <= 4; i++) {
      await repo.upsert('transaction', DEMO_SPACE_ID, `gym_${i}`, {
        accountId: 'demo_main',
        date: monthsAgo(i, Math.min(new Date().getDate(), 28)),
        amountCents: -2999,
        currency: 'EUR',
        merchant: 'BASIC-FIT',
        catId: 'subs',
        txType: 'expense',
        needsReview: 0,
      });
    }
    fireEvent.click(await screen.findByTestId('recurring-suggestions-banner', {}, { timeout: 5000 }));
    await screen.findByTestId('screen-recurring-suggestions');
    // the pattern shows although every charge predates the start date
    const card = await screen.findByTestId('recsuggest-card-basic fit', {}, { timeout: 5000 });
    expect(card.querySelectorAll('[data-testid^="recsuggest-tx-"]').length).toBeGreaterThanOrEqual(3);
    db.close();
  }, 15_000);

  it('the brand picker offers vendored icons and picking stores the logo', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('brands/index.json')
        ? new Response(JSON.stringify([{ slug: 'netflix', title: 'Netflix' }]), { status: 200 })
        : new Response('', { status: 404 }),
    );
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');

    fireEvent.click(screen.getByTestId('recurring-add'));
    fireEvent.change(await screen.findByTestId('recform-name'), { target: { value: 'Netflix' } });
    fireEvent.change(screen.getByTestId('recform-amount'), { target: { value: '13.99' } });
    fireEvent.click(screen.getByTestId('recform-logo-open'));
    // the search starts prefilled with the cost's name; a tap clears it
    const search = (await screen.findByTestId('brandpicker-search')) as HTMLInputElement;
    expect(search.value).toBe('Netflix');
    fireEvent.click(await screen.findByTestId('brandpicker-netflix'));
    // the sheet row reflects the chosen brand logo
    expect(screen.getByTestId('recform-logo-open').textContent).toContain('Brand logo');
    fireEvent.click(screen.getByTestId('recform-save'));

    const db = new MunniDB('munni_demo');
    await waitFor(
      async () => {
        const rec = (await db.recurrings.toArray()).find((r) => r.name === 'Netflix');
        expect(rec?.logo).toBe('brands/netflix.svg');
      },
      { timeout: 5000 },
    );
    db.close();
    fetchMock.mockRestore();
  }, 15_000);

  it('accepting a suggestion prefills the sheet, links past payments, detail lists them', async () => {
    const db = new MunniDB('munni_demo');
    const first = renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    await seedNetflixPattern(db);

    fireEvent.click(await screen.findByTestId('recurring-suggestions-banner', {}, { timeout: 5000 }));
    await screen.findByTestId('screen-recurring-suggestions');
    fireEvent.click(await screen.findByTestId('recurring-accept-netflix com'));
    const name = (await screen.findByTestId('recform-name')) as HTMLInputElement;
    expect(name.value).toBe('NETFLIX.COM');
    expect((screen.getByTestId('recform-amount') as HTMLInputElement).value).toBe('13.99');

    fireEvent.click(screen.getByTestId('recform-save'));
    // #257: saving an ACCEPTED suggestion opens the occurrence review with
    // the reconciler's own picks pre-checked (one per month) — nothing is
    // linked until the user applies
    await screen.findByTestId('recmatch-list', {}, { timeout: 5000 });
    await waitFor(() => {
      const checked = document.querySelectorAll('[data-testid^="recmatch-pick-"]:checked');
      expect(checked).toHaveLength(4);
    });
    expect(await db.transactions.filter((t) => !!t.recurringId).count()).toBe(0);
    fireEvent.click(screen.getByTestId('recmatch-apply'));
    await waitFor(
      async () => {
        const linked = await db.transactions.filter((t) => !!t.recurringId).count();
        expect(linked).toBe(4);
      },
      { timeout: 5000 },
    );
    first.unmount();

    // the detail screen shows the full payment history for the new cost
    const rec = (await db.recurrings.toArray()).find((r) => r.name === 'NETFLIX.COM')!;
    renderApp(`/recurring/${rec.id}`);
    await screen.findByTestId('screen-recurring-detail');
    const payments = await screen.findByTestId('recdetail-payments', {}, { timeout: 5000 });
    await waitFor(() => expect(payments.querySelectorAll('[data-testid^="tx-row-"]')).toHaveLength(4));
    // stats carry the annualized figure now (subscription intelligence S1)
    expect(screen.getByTestId('recdetail-stats').textContent).toContain('Per year');
    db.close();
  }, 20_000);

  it('#192 r2: a DUO pattern lives on the DEBTS screen — tracked in place, gone from the recurring inbox', async () => {
    const db = new MunniDB('munni_demo');
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    // four steady monthly DUO charges — a textbook student-loan pattern
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-duo'), { trackOutbox: false });
    for (let i = 0; i < 4; i++) {
      await repo.upsert('transaction', DEMO_SPACE_ID, `duo_${i}`, {
        accountId: 'demo_main', date: monthsAgo(i, Math.min(new Date().getDate(), 28)),
        amountCents: -10_400, currency: 'EUR', merchant: 'Dienst Uitvoering Onderwijs',
        catId: 'extraOther', txType: 'expense', needsReview: 0,
      });
    }
    cleanup();

    // the recurring inbox stays quiet about it: no DUO card there
    renderApp('/recurring/suggestions');
    await screen.findByTestId('screen-recurring-suggestions');
    await waitFor(
      () => {
        const settled =
          document.querySelector('[data-testid^="recsuggest-card-"]') ?? screen.queryByTestId('recsuggest-empty');
        expect(settled).toBeTruthy();
      },
      { timeout: 5000 },
    );
    expect(screen.queryByTestId('recsuggest-card-dienst uitvoering onderwijs')).toBeNull();
    cleanup();

    // the DEBTS screen carries the suggestion card itself
    renderApp('/debts');
    await screen.findByTestId('screen-debts');
    const key = 'dienst uitvoering onderwijs';
    await screen.findByTestId(`debts-suggestion-${key}`, {}, { timeout: 5000 });

    // tracking opens the loan chooser RIGHT HERE, prefilled — no detour
    fireEvent.click(screen.getByTestId(`debts-loan-track-${key}`));
    fireEvent.click(await screen.findByTestId('chooser-accttype-loan'));
    await waitFor(() => expect((screen.getByTestId('chooser-acctform-name') as HTMLInputElement).value).toBe('Dienst Uitvoering Onderwijs'));
    expect((screen.getByTestId('chooser-acctform-payment') as HTMLInputElement).value).toBe('104.00');
    expect((screen.getByTestId('chooser-acctform-payday') as HTMLInputElement).value).toBe(String(Math.min(new Date().getDate(), 28)));
    expect(screen.getByTestId('screen-debts')).toBeTruthy();
    db.close();
  }, 20_000);

  it('#192 r2: dismissing a loan suggestion on the debts screen retires it for good', async () => {
    const db = new MunniDB('munni_demo');
    renderApp('/debts');
    await screen.findByTestId('screen-debts');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-duo2'), { trackOutbox: false });
    for (let i = 0; i < 4; i++) {
      await repo.upsert('transaction', DEMO_SPACE_ID, `duo_${i}`, {
        accountId: 'demo_main', date: monthsAgo(i, Math.min(new Date().getDate(), 28)),
        amountCents: -10_400, currency: 'EUR', merchant: 'Dienst Uitvoering Onderwijs',
        catId: 'extraOther', txType: 'expense', needsReview: 0,
      });
    }
    const key = 'dienst uitvoering onderwijs';
    await screen.findByTestId(`debts-suggestion-${key}`, {}, { timeout: 5000 });
    fireEvent.click(screen.getByTestId(`debts-loan-dismiss-${key}`));
    await waitFor(() => expect(screen.queryByTestId(`debts-suggestion-${key}`)).toBeNull());
    expect(await db.recurringDismissals.count()).toBe(1);
    db.close();
  }, 20_000);
});

describe('RecurringScreen editing (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
    clearRecurringView(); // #168 r5: the tab memory outlives renderApp by design
  });

  it('year view multiplies, editing toggles active, delete needs a second tap', async () => {
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');

    fireEvent.click(screen.getByTestId('recurring-add'));
    fireEvent.change(await screen.findByTestId('recform-name'), { target: { value: 'Gym' } });
    fireEvent.change(screen.getByTestId('recform-amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('recform-notify-7'));
    fireEvent.click(screen.getByTestId('recform-save'));
    const row = await screen.findByText('Gym', {}, { timeout: 5000 });

    // a monthly cost costs 12× per year — and shows up next period too
    fireEvent.click(screen.getByTestId('recurring-view-year'));
    await waitFor(() => expect(screen.getByTestId('recurring-summary').textContent).toMatch(/300/));
    fireEvent.click(screen.getByTestId('recurring-view-next'));
    await waitFor(() => expect(screen.getByTestId('recurring-summary').textContent).toMatch(/25/));
    fireEvent.click(screen.getByTestId('recurring-view-period'));

    // a row now opens the detail screen; editing sits behind the pencil
    fireEvent.click(row.closest('button')!);
    fireEvent.click(await screen.findByTestId('recdetail-edit'));
    fireEvent.click(await screen.findByTestId('recform-active'));
    fireEvent.click(screen.getByTestId('recform-save'));
    await screen.findByTestId('recdetail-inactive', {}, { timeout: 5000 });

    // destructive delete: first tap arms, second removes — then back on the list
    fireEvent.click(screen.getByTestId('recdetail-edit'));
    fireEvent.click(await screen.findByTestId('recform-delete'));
    fireEvent.click(screen.getByTestId('recform-delete'));
    await screen.findByTestId('screen-recurring', {}, { timeout: 5000 });
    await waitFor(() => expect(screen.queryByText('Gym')).toBeNull(), { timeout: 5000 });
  }, 15_000);

  it('#167/#168 r2: future ranges show only the total; the year chart splits at now and dots open their month', async () => {
    const first = renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-167'), { trackOutbox: false });
    const day = Math.min(new Date().getDate(), 28);
    // #168 r4: the chart marker means the SPACE'S START month — pin it
    // to January so the marker lands on a fixed, gate-safe index
    await repo.upsert('space', DEMO_SPACE_ID, DEMO_SPACE_ID, { historyStartDate: `${new Date().getFullYear()}-01-01` });
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec_167', {
      name: 'Gym 167',
      kind: 'fixed',
      amountCents: 2_500,
      every: 'month',
      dueDay: day,
      active: 1,
    });
    // one linked payment THIS month — the paid line's value at "now"
    await repo.upsert('transaction', DEMO_SPACE_ID, 'pay_167', {
      accountId: 'demo_main',
      date: monthsAgo(0, day),
      amountCents: -2_500,
      currency: 'EUR',
      merchant: 'GYM 167',
      catId: 'subs',
      txType: 'expense',
      needsReview: 0,
      recurringId: 'rec_167',
    });
    db.close();
    first.unmount();
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    await screen.findByText('Gym 167', {}, { timeout: 5000 });

    // current period: the full trio (total / paid / remaining) speaks
    expect(screen.getByTestId('recurring-summary').textContent).toContain('Paid');
    expect(screen.queryByTestId('recurring-chart')).toBeNull();

    // next period (#167): payments cannot exist yet — only the total shows
    fireEvent.click(screen.getByTestId('recurring-view-next'));
    await screen.findByTestId('recurring-summary-future');
    expect(screen.getByTestId('recurring-summary').textContent).not.toContain('Paid');

    // the year view (#168 r2): both lines always draw — the chips and the
    // all-off note are gone — smoothed (bezier C commands). #168 r4: the
    // vertical marker sits on the SPACE'S START month (January = x 0),
    // not on "now" — the paid/estimate split marks now by itself
    fireEvent.click(screen.getByTestId('recurring-view-year'));
    const svg = await screen.findByTestId('recurring-chart');
    expect(screen.queryByTestId('recurring-chart-est')).toBeNull();
    expect(screen.queryByTestId('recurring-chart-act')).toBeNull();
    const marker = await screen.findByTestId('recurring-chart-start');
    expect(marker.getAttribute('x1')).toBe('0');
    expect(screen.queryByTestId('recurring-chart-now')).toBeNull();
    const paths = [...svg.querySelectorAll('path')];
    // in Jan/Dec one line is a single point (a lone dot, no path)
    expect(paths.length).toBeGreaterThanOrEqual(1);
    for (const path of paths) expect(path.getAttribute('d')).toContain('C');

    // paid dots run Jan→now; estimate dots only AFTER now — the shared
    // now-point wears ONE dot and paid owns it (#168 r3)
    const nowIdx = new Date().getMonth();
    expect(svg.querySelectorAll('[data-testid^="recurring-chart-dot-0-"]')).toHaveLength(11 - nowIdx);
    expect(svg.querySelectorAll('[data-testid^="recurring-chart-dot-1-"]')).toHaveLength(nowIdx + 1);
    expect(screen.queryByTestId(`recurring-chart-dot-0-${nowIdx}`)).toBeNull();
    expect(screen.getByTestId(`recurring-chart-dot-1-${nowIdx}`)).toBeTruthy();
    if (nowIdx > 0) expect(screen.queryByTestId('recurring-chart-dot-0-0')).toBeNull();
    if (nowIdx < 11) expect(screen.queryByTestId('recurring-chart-dot-1-11')).toBeNull();

    // tapping the paid dot at now surfaces the month's value + the door
    fireEvent.click(screen.getByTestId(`recurring-chart-dot-1-${nowIdx}`));
    const value = await screen.findByTestId('recurring-chart-value');
    expect(value.textContent).toMatch(/€[1-9]/);
    // the same dot again toggles the selection off…
    fireEvent.click(screen.getByTestId(`recurring-chart-dot-1-${nowIdx}`));
    await waitFor(() => expect(screen.queryByTestId('recurring-chart-value')).toBeNull());
    // …and back on; the door names the payments story (#168 r5) and
    // opens the month's linked transactions
    fireEvent.click(screen.getByTestId(`recurring-chart-dot-1-${nowIdx}`));
    const paidDoor = await screen.findByTestId('recurring-chart-txs');
    expect(paidDoor.textContent).toContain('Show transactions');
    fireEvent.click(paidDoor);
    await screen.findByTestId('recurring-period-sheet');
    // #168 r3: the payment wears the standard TxRow face, not a plain row
    const txRow = await screen.findByTestId('recurring-period-tx-pay_167');
    expect(txRow.querySelector('[data-testid="tx-row-pay_167"]')).toBeTruthy();
    expect(txRow.textContent).toMatch(/€[1-9]/);

    // next year is future: total-only summary, estimate on all twelve
    // months, paid on none — and the start marker stands down (the
    // space started THIS year, outside the charted one)
    fireEvent.click(screen.getByTestId('recurring-view-nextyear'));
    await screen.findByTestId('recurring-summary-future');
    const svg2 = await screen.findByTestId('recurring-chart');
    await waitFor(() => expect(screen.queryByTestId('recurring-chart-start')).toBeNull());
    expect(svg2.querySelectorAll('[data-testid^="recurring-chart-dot-0-"]')).toHaveLength(12);
    expect(svg2.querySelectorAll('[data-testid^="recurring-chart-dot-1-"]')).toHaveLength(0);

    // a future ESTIMATE dot's door says so (#168 r5, user) and lists
    // the expected items instead
    fireEvent.click(screen.getByTestId('recurring-chart-dot-0-5'));
    const estDoor = await screen.findByTestId('recurring-chart-txs');
    expect(estDoor.textContent).toContain('Show recurring costs');
    fireEvent.click(estDoor);
    const expRow = await screen.findByTestId('recurring-period-exp-rec_167');
    expect(expRow.textContent).toMatch(/€[1-9]/);
  }, 20_000);

  it('#168 r2: a period with nothing expected or linked says so in the sheet', async () => {
    const first = renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-168b'), { trackOutbox: false });
    // yearly, due January — next year's June has nothing to show
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec_168y', {
      name: 'Insurance 168',
      kind: 'fixed',
      amountCents: 9_900,
      every: 'year',
      dueDay: 15,
      dueMonth: 1,
      active: 1,
    });
    db.close();
    first.unmount();
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    await waitFor(() => expect(screen.getByTestId('recurring-year-total').textContent).toMatch(/99/), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('recurring-view-nextyear'));
    const svg = await screen.findByTestId('recurring-chart');
    expect(svg.querySelectorAll('[data-testid^="recurring-chart-dot-0-"]')).toHaveLength(12);
    // #168 r4: the demo space has no historyStartDate — no start marker
    expect(screen.queryByTestId('recurring-chart-start')).toBeNull();

    // January carries the expected yearly item…
    fireEvent.click(screen.getByTestId('recurring-chart-dot-0-0'));
    const value = await screen.findByTestId('recurring-chart-value');
    expect(value.textContent).toMatch(/€[1-9]/);
    fireEvent.click(screen.getByTestId('recurring-chart-txs'));
    const expRow = await screen.findByTestId('recurring-period-exp-rec_168y');
    // #168 r4 (user): the expected row wears the recurring's icon and
    // reads as a door — a real button with the arrow at its edge
    expect(expRow.tagName).toBe('BUTTON');
    expect(expRow.querySelector('.mdi')).toBeTruthy();

    // …June has neither payments nor occurrences — the sheet says so
    fireEvent.click(screen.getByTestId('recurring-chart-dot-0-5'));
    fireEvent.click(await screen.findByTestId('recurring-chart-txs'));
    await screen.findByTestId('recurring-period-empty');
    expect(screen.queryByTestId('recurring-period-exp-rec_168y')).toBeNull();

    // #168 r4 (user): tapping the expected row closes the sheet and
    // opens that recurring's own detail screen
    fireEvent.click(screen.getByTestId('recurring-chart-dot-0-0'));
    fireEvent.click(await screen.findByTestId('recurring-chart-txs'));
    fireEvent.click(await screen.findByTestId('recurring-period-exp-rec_168y'));
    await screen.findByTestId('screen-recurring-detail', {}, { timeout: 5000 });
  }, 15_000);

  it('#168 r5: a period row travels STRAIGHT to the transaction (chevron on); the tab survives the detour', async () => {
    const first = renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-168r5'), { trackOutbox: false });
    const day = Math.min(new Date().getDate(), 28);
    await repo.upsert('recurring', DEMO_SPACE_ID, 'rec_r5', {
      name: 'Gym r5',
      kind: 'fixed',
      amountCents: 2_500,
      every: 'month',
      dueDay: day,
      active: 1,
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'pay_r5', {
      accountId: 'demo_main',
      date: monthsAgo(0, day),
      amountCents: -2_500,
      currency: 'EUR',
      merchant: 'GYM R5',
      catId: 'subs',
      txType: 'expense',
      needsReview: 0,
      recurringId: 'rec_r5',
    });
    db.close();
    first.unmount();
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    await screen.findByText('Gym r5', {}, { timeout: 5000 });

    fireEvent.click(screen.getByTestId('recurring-view-year'));
    const nowIdx = new Date().getMonth();
    fireEvent.click(await screen.findByTestId(`recurring-chart-dot-1-${nowIdx}`));
    fireEvent.click(await screen.findByTestId('recurring-chart-txs'));
    const wrapper = await screen.findByTestId('recurring-period-tx-pay_r5');
    // #168 r5 (user): the row wears the arrow like the recurring rows…
    expect(wrapper.querySelector('.mdi-chevron-right')).toBeTruthy();
    // …and tapping it lands DIRECTLY on the full page — the in-between
    // peek sheet is gone; below lg the detail owns the screen
    fireEvent.click(wrapper.querySelector<HTMLElement>('[data-testid="tx-row-pay_r5"]')!);
    await screen.findByTestId('screen-tx-detail', {}, { timeout: 5000 });
    expect(screen.queryByTestId('tx-peek')).toBeNull();
    expect(screen.queryByTestId('recurring-period-sheet')).toBeNull();
    expect(screen.queryByTestId('screen-recurring')).toBeNull();

    // #168 r5 (user): the return lands on the SAME tab — the view
    // survives the unmount via the module memory (#140 pattern)
    cleanup();
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    expect(screen.getByTestId('recurring-view-year').className).toContain('font-semibold');
    expect(await screen.findByTestId('recurring-chart')).toBeTruthy();
  }, 20_000);

  it('#168 r5: at lg the transaction opens BESIDE the recurring list; close hands the pane back', async () => {
    const first = renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-168lg'), { trackOutbox: false });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'pay_lg', {
      accountId: 'demo_main',
      date: monthsAgo(0, 7),
      amountCents: -2_500,
      currency: 'EUR',
      merchant: 'GYM LG',
      catId: 'subs',
      txType: 'expense',
      needsReview: 0,
    });
    db.close();
    first.unmount();

    // lg viewport: the /recurring/tx/$txId mount renders the recurring
    // list as the MASTER pane with the tx detail beside it (§4.2)
    const original = window.matchMedia;
    window.matchMedia = (() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      renderApp('/recurring/tx/pay_lg');
      // the !tx branch renders an empty shell first — wait for the
      // LOADED detail (its app bar) before poking the panes
      await screen.findByTestId('tx-detail-back', {}, { timeout: 5000 });
      expect(screen.getByTestId('screen-tx-detail')).toBeTruthy();
      expect(screen.getByTestId('split-pane')).toBeTruthy();
      expect(screen.getByTestId('screen-recurring')).toBeTruthy();
      // the panes close button leaves the detail and keeps recurring
      fireEvent.click(screen.getByTestId('tx-detail-back'));
      await waitFor(() => expect(screen.queryByTestId('screen-tx-detail')).toBeNull());
      expect(screen.getByTestId('screen-recurring')).toBeTruthy();
    } finally {
      window.matchMedia = original;
    }
  }, 20_000);

  it('#188/#189: a recurring lives only in ranges it OCCURS in; pre-start occurrences neither list nor count', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seedDb = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(seedDb), new HlcClock('seed-188'), { trackOutbox: false });
    const Y = new Date().getFullYear();
    // the space started June 1st — March happened before its memory
    await repo.upsert('space', DEMO_SPACE_ID, DEMO_SPACE_ID, { historyStartDate: `${Y}-06-01` });
    const base = { kind: 'fixed' as const, active: 1 as const, every: 'year' as const, dueDay: 15 };
    // starts NEXT January — belongs to "next year" alone (the user's Goudse)
    await repo.upsert('recurring', DEMO_SPACE_ID, 'future-ins', { ...base, name: 'Goudse insurance', amountCents: 20_000, dueMonth: 1, since: `${Y + 1}-01-01` });
    // yearly each March — this year's occurrence is OLDER than the space
    await repo.upsert('recurring', DEMO_SPACE_ID, 'spring-tax', { ...base, name: 'Spring tax', amountCents: 12_000, dueMonth: 3, since: `${Y - 3}-03-10` });
    // a plain monthly lives everywhere
    await repo.upsert('recurring', DEMO_SPACE_ID, 'gym-188', { ...base, every: 'month', name: 'Gym 188', amountCents: 2_500, dueDay: Math.min(new Date().getDate(), 28) });
    seedDb.close();
    cleanup();
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');

    // current period: only the monthly occurs here
    await screen.findByText('Gym 188', {}, { timeout: 5000 });
    expect(screen.queryByText('Goudse insurance')).toBeNull();
    expect(screen.queryByText('Spring tax')).toBeNull();

    // this year: March sits before the space start — still hidden (#189),
    // and its €120 must not read as "remaining"
    fireEvent.click(screen.getByTestId('recurring-view-year'));
    await waitFor(() => expect(screen.getByTestId('recurring-summary').textContent).not.toMatch(/120/));
    expect(screen.queryByText('Spring tax')).toBeNull();
    expect(screen.queryByText('Goudse insurance')).toBeNull();

    // next year: both yearly costs occur — they belong here
    fireEvent.click(screen.getByTestId('recurring-view-nextyear'));
    await screen.findByText('Goudse insurance', {}, { timeout: 5000 });
    await screen.findByText('Spring tax');

    // All: everything, with only the honest annual figure (no range math)
    fireEvent.click(screen.getByTestId('recurring-view-all'));
    await screen.findByText('Goudse insurance');
    await screen.findByText('Spring tax');
    await screen.findByText('Gym 188');
    expect(screen.getByTestId('recurring-year-total')).toBeTruthy();
    expect(screen.queryByTestId('recurring-luxury-line')).toBeNull();
  }, 20_000);

  it('custom cadence: every 2 weeks needs an anchor date and shows its rhythm', async () => {
    renderApp('/recurring');
    await screen.findByTestId('screen-recurring');

    fireEvent.click(screen.getByTestId('recurring-add'));
    fireEvent.change(await screen.findByTestId('recform-name'), { target: { value: 'Cleaner' } });
    fireEvent.change(screen.getByTestId('recform-amount'), { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('recform-every-custom'));
    fireEvent.change(await screen.findByTestId('recform-everyn'), { target: { value: '2' } });
    fireEvent.blur(screen.getByTestId('recform-everyn'));
    fireEvent.change(screen.getByTestId('recform-every-unit'), { target: { value: 'week' } });

    // no first-due date yet → the save tap refuses with the blocker (#195)
    fireEvent.click(screen.getByTestId('recform-save'));
    expect(await screen.findByTestId('recform-save-blocker')).toBeTruthy();
    fireEvent.change(screen.getByTestId('recform-firstdue'), { target: { value: iso(new Date()) } });
    await waitFor(() => expect(screen.queryByTestId('recform-save-blocker')).toBeNull());
    fireEvent.click(screen.getByTestId('recform-save'));

    // the list row says the rhythm instead of a monthly due day
    const row = await screen.findByText('Cleaner', {}, { timeout: 5000 });
    await waitFor(() => expect(row.closest('button')!.textContent).toContain('Every 2 weeks'));

    // reopening the form lands on the custom chip with everything restored
    fireEvent.click(row.closest('button')!);
    fireEvent.click(await screen.findByTestId('recdetail-edit'));
    expect(((await screen.findByTestId('recform-everyn')) as HTMLInputElement).value).toBe('2');
    expect((screen.getByTestId('recform-every-unit') as HTMLSelectElement).value).toBe('week');
    expect((screen.getByTestId('recform-firstdue') as HTMLInputElement).value).toBe(iso(new Date()));
  }, 15_000);

  it('fires a local reminder once when a due date enters the notify window', async () => {
    // arrange the recurring first (its own app instance)
    const first = renderApp('/recurring');
    await screen.findByTestId('screen-recurring');
    fireEvent.click(screen.getByTestId('recurring-add'));
    fireEvent.change(await screen.findByTestId('recform-name'), { target: { value: 'Rent' } });
    fireEvent.change(screen.getByTestId('recform-amount'), { target: { value: '740' } });
    // stay inside the 7-day notify window on EVERY calendar day: clamping
    // to 28 pushed the due date a month out on the 29th-31st, and this
    // test failed only on those days (caught 2026-07-29)
    const today = new Date().getDate();
    fireEvent.change(screen.getByTestId('recform-dueday'), {
      target: { value: String(today <= 28 ? today : 1) },
    });
    fireEvent.blur(screen.getByTestId('recform-dueday')); // draft commits on blur
    fireEvent.click(screen.getByTestId('recform-notify-7'));
    fireEvent.click(screen.getByTestId('recform-save'));
    await screen.findByText('Rent', {}, { timeout: 5000 });
    first.unmount();

    // a fresh app open inside the window fires exactly one notification
    const showNotification = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'granted' } });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ showNotification }) },
    });
    const second = renderApp('/home');
    await waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(showNotification.mock.calls[0][1].body).toContain('Rent');
    second.unmount();

    renderApp('/home'); // same due date -> already notified, stays quiet
    await screen.findByTestId('screen-home');
    await new Promise((r) => setTimeout(r, 150));
    expect(showNotification).toHaveBeenCalledTimes(1);
  }, 20_000);
});

describe('brand picker online search (user identity)', () => {
  const netflixRemote = {
    name: 'Netflix',
    domain: 'netflix.com',
    logoUrl: 'https://img.logo.dev/netflix.com?token=pk',
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
    resetApiCapabilitiesCache(); // each test scripts its own /health
    clearRecurringView(); // #168 r5: the tab memory outlives renderApp by design
  });

  async function openPickerAndSearch(api: Record<string, () => unknown>) {
    renderAppAsUser('/recurring', {
      api: {
        'GET /brands/index.json': () => [{ slug: 'netflix', title: 'Netflix' }],
        ...api,
      },
    });
    await screen.findByTestId('screen-recurring');
    fireEvent.click(screen.getByTestId('recurring-add'));
    await screen.findByTestId('recform-name');
    fireEvent.click(screen.getByTestId('recform-logo-open'));
    fireEvent.change(await screen.findByTestId('brandpicker-search'), { target: { value: 'netflix' } });
  }

  it('keeps the vendored segment first when logo.dev hits arrive below it', async () => {
    await openPickerAndSearch({
      'GET /health': () => ({ capabilities: { gocardless: false, logos: true }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
      'GET /logos/search': () => [netflixRemote],
    });

    const remote = await screen.findByTestId('brandpicker-remote', {}, { timeout: 3000 });
    expect(screen.getByTestId('brandpicker-remote-netflix.com')).toBeTruthy();
    // the local segment leads and its hit SURVIVES the online answer
    // (user bug: local matches vanished the moment logo.dev responded)
    const local = screen.getByTestId('brandpicker-local');
    expect(local.compareDocumentPosition(remote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('brandpicker-netflix')).toBeTruthy();
    expect(screen.queryByTestId('brandpicker-offline-note')).toBeNull();

    // picking a remote hit stores its logo.dev URL
    fireEvent.click(screen.getByTestId('brandpicker-remote-netflix.com'));
    expect(screen.getByTestId('recform-logo-open').textContent).toContain('Brand logo');
  }, 15_000);

  it('says so when online search is unavailable and keeps the vendored set', async () => {
    await openPickerAndSearch({
      'GET /health': () => ({ capabilities: { gocardless: false, logos: false }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
    });

    await screen.findByTestId('brandpicker-offline-note', {}, { timeout: 3000 });
    expect(screen.queryByTestId('brandpicker-remote')).toBeNull();
    expect(screen.getByTestId('brandpicker-netflix')).toBeTruthy();
  }, 15_000);
});

describe('reconcileRecurringLinks', () => {
  it('links matching unlinked expenses at most once per billing cycle', async () => {
    const db = new MunniDB(`munni_test_rec_${Math.random().toString(36).slice(2)}`);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('space', 's1', 's1', { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await repo.upsert('recurring', 's1', 'rec1', {
      name: 'Gym',
      kind: 'subscription',
      amountCents: 2499,
      every: 'month',
      dueDay: 10,
      active: 1,
      merchantKey: 'basic fit',
    });
    // two charges in one month (double-billing) + one the next month + a mismatch
    const rows: [string, string, number][] = [
      ['g1', '2026-06-10', -2499],
      ['g2', '2026-06-24', -2499],
      ['g3', '2026-07-10', -2599], // within 25% tolerance
      ['g4', '2026-07-12', -9900], // way off — not this subscription
    ];
    for (const [id, date, amountCents] of rows) {
      await repo.upsert('transaction', 's1', id, {
        accountId: 'a',
        date,
        amountCents,
        currency: 'EUR',
        merchant: 'Basic-Fit 123',
        txType: 'expense',
        needsReview: 0,
      });
    }

    expect(await reconcileRecurringLinks(new DexieBackend(db), repo, 's1')).toBe(2); // g1 + g3
    expect((await db.transactions.get('g1'))?.recurringId).toBe('rec1');
    expect((await db.transactions.get('g2'))?.recurringId).toBeUndefined();
    expect((await db.transactions.get('g3'))?.recurringId).toBe('rec1');
    expect((await db.transactions.get('g4'))?.recurringId).toBeUndefined();
    // idempotent
    expect(await reconcileRecurringLinks(new DexieBackend(db), repo, 's1')).toBe(0);
    db.close();
  });
});
