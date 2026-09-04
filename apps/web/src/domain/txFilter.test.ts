import { describe, expect, it } from 'vitest';
import { filterTxs, hasActiveFilter } from './txFilter';
import type { TransactionRow } from '@/db/types';

const tx = (partial: Partial<TransactionRow>): TransactionRow =>
  ({
    id: 'x',
    spaceId: 's',
    accountId: 'a1',
    date: '2026-07-01',
    amountCents: -100,
    currency: 'EUR',
    merchant: 'Albert Heijn',
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    fieldVersions: {},
    ...partial,
  }) as TransactionRow;

describe('filterTxs', () => {
  const rows = [
    tx({ id: '1', merchant: 'Albert Heijn 1842', description: 'AH AMSTERDAM' }),
    tx({ id: '2', merchant: 'Spotify', accountId: 'a2' }),
    tx({ id: '3', merchant: 'Incasso<br>ING', description: 'RENTE<br>PERIODE', needsReview: 1 }),
  ];

  it('no filter returns everything', () => {
    expect(filterTxs(rows, {})).toHaveLength(3);
  });

  it('query matches merchant and description, case-insensitive', () => {
    expect(filterTxs(rows, { query: 'albert' }).map((t) => t.id)).toEqual(['1']);
    expect(filterTxs(rows, { query: 'AMSTERDAM' }).map((t) => t.id)).toEqual(['1']);
    expect(filterTxs(rows, { query: '  spoti ' }).map((t) => t.id)).toEqual(['2']);
    expect(filterTxs(rows, { query: 'nomatch' })).toHaveLength(0);
  });

  it('a numeric query matches amounts by digit substring (user request)', () => {
    const priced = [
      tx({ id: 'p1', merchant: 'Cafe', amountCents: -1099 }), // 10,99
      tx({ id: 'p2', merchant: 'Store', amountCents: -21015 }), // 210,15
      tx({ id: 'p3', merchant: 'Bakery', amountCents: -525 }), // 5,25
      tx({ id: 'p4', merchant: 'Shop 10', amountCents: -300 }), // text hit only
    ];
    expect(filterTxs(priced, { query: '10' }).map((t) => t.id)).toEqual(['p1', 'p2', 'p4']);
    expect(filterTxs(priced, { query: '10,99' }).map((t) => t.id)).toEqual(['p1']);
    expect(filterTxs(priced, { query: '10.99' }).map((t) => t.id)).toEqual(['p1']);
    expect(filterTxs(priced, { query: '5,25' }).map((t) => t.id)).toEqual(['p3']);
    // pure text queries never trip the amount branch
    expect(filterTxs(priced, { query: 'bakery' }).map((t) => t.id)).toEqual(['p3']);
  });

  it('query sees through bank <br> noise', () => {
    // raw text contains "Incasso<br>ING"; users search the cleaned form
    expect(filterTxs(rows, { query: 'incasso · ing' }).map((t) => t.id)).toEqual(['3']);
    expect(filterTxs(rows, { query: 'rente' }).map((t) => t.id)).toEqual(['3']);
  });

  it('account and review filters combine with query', () => {
    expect(filterTxs(rows, { accountIds: new Set(['a2']) }).map((t) => t.id)).toEqual(['2']);
    expect(filterTxs(rows, { onlyNeedsReview: true }).map((t) => t.id)).toEqual(['3']);
    expect(
      filterTxs(rows, { accountIds: new Set(['a1']), onlyNeedsReview: true, query: 'rente' }).map((t) => t.id),
    ).toEqual(['3']);
    expect(filterTxs(rows, { accountIds: new Set(['a2']), onlyNeedsReview: true })).toHaveLength(0);
    // multi-account: union
    expect(filterTxs(rows, { accountIds: new Set(['a1', 'a2']) })).toHaveLength(3);
  });

  it('type, category and date-range filters (filter sheet + overview drill)', () => {
    const typed = [
      tx({ id: 't1', txType: 'expense', catId: 'groceries', date: '2026-07-05' }),
      tx({ id: 't2', txType: 'saving', catId: 'savingDeposit', date: '2026-07-10' }),
      tx({ id: 't3', txType: 'income', catId: undefined, date: '2026-08-01' }),
    ];
    expect(filterTxs(typed, { txTypes: new Set(['saving']) }).map((t) => t.id)).toEqual(['t2']);
    expect(filterTxs(typed, { catIds: new Set(['groceries']) }).map((t) => t.id)).toEqual(['t1']);
    expect(filterTxs(typed, { from: '2026-07-06', to: '2026-07-31' }).map((t) => t.id)).toEqual(['t2']);
    // empty sets mean "no restriction"
    expect(filterTxs(typed, { txTypes: new Set(), catIds: new Set(), accountIds: new Set() })).toHaveLength(3);
  });

  it('hasActiveFilter ignores whitespace-only queries and empty sets', () => {
    expect(hasActiveFilter({})).toBe(false);
    expect(hasActiveFilter({ query: '   ' })).toBe(false);
    expect(hasActiveFilter({ accountIds: new Set(), txTypes: new Set(), catIds: new Set() })).toBe(false);
    expect(hasActiveFilter({ query: 'a' })).toBe(true);
    expect(hasActiveFilter({ accountIds: new Set(['a1']) })).toBe(true);
    expect(hasActiveFilter({ onlyNeedsReview: true })).toBe(true);
    expect(hasActiveFilter({ from: '2026-01-01' })).toBe(true);
  });
});
