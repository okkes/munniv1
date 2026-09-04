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
});
