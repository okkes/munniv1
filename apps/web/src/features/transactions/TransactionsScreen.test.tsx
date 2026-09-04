// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';
import { DEMO_SPACE_ID } from '@/db/seed';
import { HlcClock } from '@/sync/hlc';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';

const rows = () => screen.getByTestId('tx-list').querySelectorAll('[data-testid^="tx-row-"]');

describe('TransactionsScreen (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

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
    await waitFor(() => expect(rows().length).toBe(0));
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
    await repo.upsert('transaction', DEMO_SPACE_ID, 'uncat-2', {
      accountId: 'demo_main', date: '2026-06-21', amountCents: -5000, currency: 'EUR',
      merchant: 'OWN SAVINGS', catId: 'uncategorized', txType: 'transfer', needsReview: 0,
    });
    db.close();
    await waitFor(() => expect(screen.queryByText('MYSTERY SHOP')).toBeTruthy(), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('tx-filter-uncat'));
    await waitFor(() => expect(rows().length).toBe(1), { timeout: 5000 });
    expect(screen.getByText('MYSTERY SHOP')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tx-filter-uncat'));
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
  });

  it('the unsettled-reimbursements chip shows only open expected/received value', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));

    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-unsettled'), { trackOutbox: false });
    // open expectation → shows; fully settled → drops out of the filter
    await repo.upsert('transaction', DEMO_SPACE_ID, 'open-1', {
      accountId: 'demo_main', date: '2026-06-22', amountCents: -8000, currency: 'EUR',
      merchant: 'FRONTED DINNER', catId: 'eatingOut', txType: 'expense', needsReview: 0,
      splits: [{ catId: 'eatingOut', amountCents: 3000 }, { catId: 'expenseReimburse', amountCents: 5000 }],
    });
    await repo.upsert('transaction', DEMO_SPACE_ID, 'settled-1', {
      accountId: 'demo_main', date: '2026-06-23', amountCents: 5000, currency: 'EUR',
      merchant: 'PAID BACK', catId: 'reimbursed', txType: 'income', needsReview: 0,
      splits: [{ catId: 'reimbursed', amountCents: 5000 }],
    });
    db.close();
    await waitFor(() => expect(screen.queryByText('FRONTED DINNER')).toBeTruthy(), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('tx-filter-unsettled'));
    await waitFor(() => expect(rows().length).toBe(1), { timeout: 5000 });
    expect(screen.getByText('FRONTED DINNER')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tx-filter-unsettled'));
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
  });

  it('the filter sheet narrows by account and type; clear restores everything', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
    const all = rows().length;

    // the demo savings account has no transactions — filter yields none
    fireEvent.click(screen.getByTestId('tx-filter-open'));
    fireEvent.click(await screen.findByTestId('filter-account-demo_save'));
    fireEvent.click(screen.getByTestId('filter-done'));
    await waitFor(() => expect(rows().length).toBe(0));
    expect(screen.getByTestId('tx-filter-count').textContent).toBe('1');

    // the clear chip resets the sheet filters
    fireEvent.click(screen.getByTestId('tx-filter-clear'));
    await waitFor(() => expect(rows().length).toBe(all));

    // kind filter (user simplification): the Transfer kind selects the
    // whole family, then its detail chips narrow to Saving only
    fireEvent.click(screen.getByTestId('tx-filter-open'));
    fireEvent.click(await screen.findByTestId('filter-kind-transfer'));
    const detail = await screen.findByTestId('filter-transfer-detail');
    expect(detail.textContent).toContain('Saving');
    fireEvent.click(screen.getByTestId('filter-type-transfer'));
    fireEvent.click(screen.getByTestId('filter-type-debtPayment'));
    fireEvent.click(screen.getByTestId('filter-type-investment'));
    fireEvent.click(screen.getByTestId('filter-done'));
    await waitFor(() => {
      expect(rows().length).toBeGreaterThan(0);
      expect(rows().length).toBeLessThan(all);
    });
    // coverage instrumentation pushes this flow past vitest's 5s default
  }, 15_000);
});
