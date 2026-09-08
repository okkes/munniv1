import { describe, expect, it } from 'vitest';
import { buildCatalog } from './catalog';
import { cashflowSeries, categorySeries, netWorthSeries } from './trends';
import type { TransactionRow } from '@/db/types';

const tx = (over: Partial<TransactionRow>): TransactionRow => ({
  id: Math.random().toString(36).slice(2),
  spaceId: 's1',
  accountId: 'a1',
  date: '2026-06-10',
  amountCents: -1000,
  currency: 'EUR',
  merchant: 'X',
  txType: 'expense',
  needsReview: 0,
  fieldVersions: {},
  deleted: 0,
  ...over,
});

const periods = [
  { start: '2026-05-01', end: '2026-05-31' },
  { start: '2026-06-01', end: '2026-06-30' },
];
const catalog = buildCatalog([], false);

describe('categorySeries', () => {
  it('buckets net expenses per period, all categories by default', () => {
    const txs = [
      tx({ date: '2026-05-05', amountCents: -2000 }),
      tx({ date: '2026-06-05', amountCents: -1000, reimbursements: [{ txId: 'r', amountCents: 400 }] }),
      tx({ date: '2026-06-06', amountCents: 5000, txType: 'income' }), // not an expense
      tx({ date: '2026-06-07', amountCents: -999, pending: 1 }), // reservation noise
    ];
    expect(categorySeries(txs, periods, catalog)).toEqual([2000, 600]);
  });

  it('a main covers its subs; category spreads and parts count toward their own category (#211)', () => {
    const txs = [
      tx({ date: '2026-06-05', catId: 'groceries', amountCents: -1500 }),
      tx({ date: '2026-06-06', catId: 'gym', amountCents: -3000 }), // sport, not consumption
      tx({
        // #211: the row's OWN spread — one transaction, two categories
        date: '2026-06-07',
        catId: 'consumptionOther',
        amountCents: -1000,
        cats: [
          { catId: 'consumptionOther', amountCents: 700 },
          { catId: 'alcohol', amountCents: 300 },
        ],
      }),
      tx({
        // a real split: only the consumption PART counts here
        date: '2026-06-08',
        catId: 'groceries',
        amountCents: -900,
        splits: [
          { id: 'p1', catId: 'groceries', amountCents: 400 },
          { id: 'p2', catId: 'gym', amountCents: 500, label: 'day pass' },
        ],
      }),
    ];
    // consumption = groceries 1500 + spread 700+300 + part 400
    expect(categorySeries(txs, periods, catalog, 'consumption')).toEqual([0, 2900]);
    expect(categorySeries(txs, periods, catalog, 'groceries')).toEqual([0, 1900]);
  });
});

describe('cashflowSeries', () => {
  it('opposes gross income and net expenses per period', () => {
    const txs = [
      tx({ date: '2026-05-15', amountCents: 220_000, txType: 'income' }),
      tx({ date: '2026-05-20', amountCents: -80_000 }),
      tx({ date: '2026-06-20', amountCents: -50_000, reimbursements: [{ txId: 'r', amountCents: 20_000 }] }),
    ];
    expect(cashflowSeries(txs, periods)).toEqual([
      { incomeCents: 220_000, expenseCents: 80_000, netCents: 140_000 },
      { incomeCents: 0, expenseCents: 30_000, netCents: -30_000 },
    ]);
  });
});

describe('netWorthSeries', () => {
  it('walks the current balance backwards through the transactions', () => {
    const accounts = [
      { id: 'a1', balanceCents: 100_000, archived: 0 as const, deleted: 0 as const },
      { id: 'flat', balanceCents: 50_000, archived: 0 as const, deleted: 0 as const }, // no txs → flat
    ];
    const txs = [
      tx({ date: '2026-06-05', amountCents: -20_000 }),
      tx({ date: '2026-06-20', amountCents: 220_000, txType: 'income' }),
    ];
    const series = netWorthSeries(accounts, txs, ['2026-05-31', '2026-06-10', '2026-06-30']);
    // before both: 150000 - (−20000 + 220000) = −50000; between: 150000 − 220000
    expect(series.map((p) => p.cents)).toEqual([-50_000, -70_000, 150_000]);
    // archived accounts never count
    expect(netWorthSeries([{ id: 'a1', balanceCents: 1, archived: 1, deleted: 0 }], [], ['2026-06-30'])[0].cents).toBe(0);
  });
});
