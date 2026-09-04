// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';
import { DEMO_SPACE_ID } from '@/db/seed';
import { HlcClock } from '@/sync/hlc';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import { guessCadence } from '@/features/review/ReviewScreen';

/**
 * #326 (user): quick-creating the counterparty account while reviewing
 * prefills the chooser from the transaction — title, currency, the
 * amount as the loan's payment, the date's day as the due day, and a
 * monthly plan guessed from the merchant's similar rows. The Create
 * door mounts the chooser itself (no props reach it), so review stages
 * a one-shot the chooser drinks on open.
 */
describe('AddAccountChooser prefill from review (#326)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('a loan-ish card with monthly siblings prefills the Create door\'s loan form', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const seed = new MunniDB('munni_demo');
    const seedRepo = new Repo(new DexieBackend(seed), new HlcClock('loanpre'), { trackOutbox: false });
    // three same-merchant charges a month apart — 2020 dates lead the
    // oldest-first queue, so duo-1 is the current card and the other two
    // are its similar siblings (the cadence guess's evidence)
    for (const [id, date] of [['duo-1', '2020-01-05'], ['duo-2', '2020-02-04'], ['duo-3', '2020-03-05']] as const) {
      await seedRepo.upsert('transaction', DEMO_SPACE_ID, id, {
        accountId: 'demo_main', date, amountCents: -15000, currency: 'EUR',
        merchant: 'DUO Studiefinanciering', txType: 'expense', needsReview: 1,
      });
    }
    seed.close();
    cleanup();
    renderApp('/review');
    await screen.findByTestId('review-card', undefined, { timeout: 10_000 });
    await screen.findByTestId('review-bulk', undefined, { timeout: 10_000 }); // the siblings arrived

    // Loan payment (◆) → the ask opens on the pick → the one Create door
    fireEvent.click(screen.getByTestId('review-category-chip'));
    fireEvent.click(await screen.findByTestId('part-cat-0', undefined, { timeout: 10_000 }));
    fireEvent.click(await screen.findByTestId('catpicker-loanRepayment', undefined, { timeout: 10_000 }));
    await screen.findByTestId('counter-accounts', undefined, { timeout: 10_000 });
    fireEvent.click(screen.getByTestId('counter-full-setup'));
    fireEvent.click(await screen.findByTestId('chooser-manual', undefined, { timeout: 10_000 }));
    fireEvent.click(await screen.findByTestId('chooser-accttype-loan', undefined, { timeout: 10_000 }));

    // the card's facts landed: the title, the amount as the plan's
    // payment and the date's day-of-month as the due day
    const name = (await screen.findByTestId('chooser-acctform-name', undefined, { timeout: 10_000 })) as HTMLInputElement;
    expect(name.value).toBe('DUO Studiefinanciering');
    expect((screen.getByTestId('chooser-acctform-payment') as HTMLInputElement).value).toBe('150.00');
    expect((screen.getByTestId('chooser-acctform-payday') as HTMLInputElement).value).toBe('5');
  }, 30_000);
});

describe('guessCadence (#326 unit)', () => {
  it('rows a near-month apart (every gap 25–35 days) guess monthly', () => {
    expect(guessCadence(['2026-01-05', '2026-02-04', '2026-03-05'])).toBe('month');
    expect(guessCadence(['2026-01-31', '2026-02-28'])).toBe('month'); // 28 days
  });

  it('anything else stays unguessed — a single row, weekly rhythm, or a broken one', () => {
    expect(guessCadence(['2026-01-05'])).toBeUndefined();
    expect(guessCadence([])).toBeUndefined();
    expect(guessCadence(['2026-01-05', '2026-01-12'])).toBeUndefined(); // weekly-ish
    expect(guessCadence(['2026-01-05', '2026-02-04', '2026-02-10'])).toBeUndefined(); // rhythm breaks
    // same-day duplicates collapse before the gaps are measured
    expect(guessCadence(['2026-01-05', '2026-01-05', '2026-02-04'])).toBe('month');
  });
});
