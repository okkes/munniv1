import { describe, expect, it } from 'vitest';
import { filterTxs, hasActiveFilter, matchingPartIndexes } from './txFilter';
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

  it('matchingPartIndexes partitions a split by the part-level filters (#126 r8)', () => {
    const split = tx({
      id: 's1',
      txType: 'expense',
      catId: 'groceries',
      splits: [
        { id: 'p0', catId: 'groceries', amountCents: 900 },
        { id: 'p1', catId: 'housing', amountCents: 500, txType: 'saving' },
        { id: 'p2', catId: 'uncategorized', amountCents: 300, cats: undefined },
        { id: 'p3', catId: 'gifts', amountCents: 200, cats: [{ catId: 'gifts', amountCents: 150 }, { catId: 'coffee', amountCents: 50 }] },
      ],
    });
    // no partitioning filter → every part shows (the full band)
    expect(matchingPartIndexes(split, {})).toEqual([0, 1, 2, 3]);
    expect(matchingPartIndexes(split, { catIds: new Set() })).toEqual([0, 1, 2, 3]);
    // category filters pick the matching parts — spreads match per entry
    expect(matchingPartIndexes(split, { catIds: new Set(['groceries']) })).toEqual([0]);
    expect(matchingPartIndexes(split, { catIds: new Set(['coffee']) })).toEqual([3]);
    // type filters read the part's own type, inheriting the row's
    expect(matchingPartIndexes(split, { txTypes: new Set(['saving']) })).toEqual([1]);
    expect(matchingPartIndexes(split, { txTypes: new Set(['expense']) })).toEqual([0, 2, 3]);
    // the uncategorized quick filter finds the unfinished part
    expect(matchingPartIndexes(split, { onlyUncategorized: true })).toEqual([2]);
    // the settled Reimbursed slice is bookkeeping, never a part
    const settled = tx({ id: 's2', txType: 'expense', splits: [{ catId: 'groceries', amountCents: 100 }, { catId: 'reimbursed', amountCents: 50 }] });
    expect(matchingPartIndexes(settled, { catIds: new Set(['groceries']) })).toEqual([0]);
  });

  it('#267 r2: a leading +/- constrains the sign, magnitude stays a substring hit', () => {
    const signed = [
      tx({ id: 'in1', merchant: 'Refund A', amountCents: 1391 }),
      tx({ id: 'in2', merchant: 'Refund B', amountCents: 1391 }),
      tx({ id: 'out1', merchant: 'Shop', amountCents: -1391 }),
      tx({ id: 'out2', merchant: 'Shop big', amountCents: -21391 }),
    ];
    expect(filterTxs(signed, { query: '+13,91' }).map((r) => r.id)).toEqual(['in1', 'in2']);
    expect(filterTxs(signed, { query: '-13,91' }).map((r) => r.id)).toEqual(['out1', 'out2']);
    // unsigned keeps matching both directions
    expect(filterTxs(signed, { query: '13,91' })).toHaveLength(4);
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
