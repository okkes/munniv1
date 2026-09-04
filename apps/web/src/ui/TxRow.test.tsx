// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionRow } from '@/db/types';
import { renderWithData } from '@/test/harness';
import { TxRow } from './TxRow';

const tx = (partial: Partial<TransactionRow>): TransactionRow =>
  ({
    id: 't1',
    spaceId: 'demo_space',
    accountId: 'demo_main',
    date: '2026-07-01',
    amountCents: -1250,
    currency: 'EUR',
    merchant: 'Albert Heijn',
    catId: 'groceries',
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    fieldVersions: {},
    ...partial,
  }) as TransactionRow;

describe('TxRow', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('renders merchant, category name and negative amount', async () => {
    renderWithData(<TxRow tx={tx({})} />);
    expect((await screen.findByTestId('tx-row-t1')).textContent).toContain('Albert Heijn');
    expect(screen.getByTestId('tx-row-t1').textContent).toContain('Grocery');
    expect(screen.getByTestId('tx-row-t1').textContent).toContain('-€12.50');
  });

  it('cleans bank <br> noise and shows the review badge', async () => {
    renderWithData(<TxRow tx={tx({ merchant: 'Incasso<br>ING', needsReview: 1 })} />);
    const row = await screen.findByTestId('tx-row-t1');
    expect(row.textContent).toContain('Incasso · ING');
    expect(row.textContent).not.toContain('<br>');
    expect(row.textContent).toContain('Unreviewed');
  });

  it('positive amounts render with an explicit plus', async () => {
    renderWithData(<TxRow tx={tx({ amountCents: 2000, catId: 'salary', txType: 'income' })} />);
    expect((await screen.findByTestId('tx-row-t1')).textContent).toContain('+€20.00');
  });

  it('unknown categories fall back to Uncategorized', async () => {
    renderWithData(<TxRow tx={tx({ catId: 'deleted-custom-cat' })} />);
    expect((await screen.findByTestId('tx-row-t1')).textContent).toContain('Uncategorized');
  });

  it('propagates clicks', async () => {
    const onClick = vi.fn();
    renderWithData(<TxRow tx={tx({})} onClick={onClick} />);
    fireEvent.click(await screen.findByTestId('tx-row-t1'));
    expect(onClick).toHaveBeenCalled();
  });

  it('#156 r2: the selected tint rounds to the card edge the row sits on', async () => {
    renderWithData(
      <>
        <TxRow tx={tx({ id: 'e-first' })} selected edge="first" />
        <TxRow tx={tx({ id: 'e-mid' })} selected />
        <TxRow tx={tx({ id: 'e-last' })} selected edge="last" />
        <TxRow tx={tx({ id: 'e-both' })} selected edge="both" />
      </>,
    );
    const first = await screen.findByTestId('tx-row-e-first');
    expect(first.className).toContain('bg-accent-soft/50');
    expect(first.className).toContain('rounded-t-card');
    expect(first.className).toContain('rounded-b-none');
    const mid = screen.getByTestId('tx-row-e-mid');
    expect(mid.className).toContain('rounded-none'); // default edge keeps the flat band
    const last = screen.getByTestId('tx-row-e-last');
    expect(last.className).toContain('rounded-b-card');
    expect(last.className).toContain('rounded-t-none');
    expect(screen.getByTestId('tx-row-e-both').className).toContain('rounded-card');
  });

  it('#156 r2: keyboard focus wears the identical tint — background instead of the outline ring', async () => {
    renderWithData(<TxRow tx={tx({})} edge="first" />);
    const row = await screen.findByTestId('tx-row-t1');
    // styles.css skips the global focus ring for quiet-focus rows
    expect(row.hasAttribute('data-quiet-focus')).toBe(true);
    expect(row.className).toContain('focus-visible:bg-accent-soft/50');
    expect(row.className).toContain('focus-visible:outline-none');
    expect(row.className).toContain('focus-visible:-mx-3');
    expect(row.className).toContain('focus-visible:rounded-t-card');
    // the resting row is untouched — no visible change without focus
    expect(row.className).toContain('bg-transparent');
  });

  it('#198 r7: an idle row carries NO radius — divide-y borders curve on rounded elements', async () => {
    renderWithData(<TxRow tx={tx({ id: 'flat1' })} onClick={() => undefined} />);
    const row = await screen.findByTestId('tx-row-flat1');
    expect(row.className).not.toContain('rounded-xl');
    expect(row.className).toContain('focus-visible:rounded-none');
  });
});
