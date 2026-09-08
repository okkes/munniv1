import { describe, expect, it } from 'vitest';
import { buildCatalog } from './catalog';
import { CSV_COLUMNS, delimiterForLang, serializeCsv, toCsvRows } from './exportCsv';
import type { ExportContext } from './exportCsv';
import type { AccountRow, TransactionRow } from '@/db/types';

const account = { id: 'a1', name: 'Main; "Checking"', currency: 'EUR' } as AccountRow;

const tx = (over: Partial<TransactionRow>): TransactionRow => ({
  id: 't1',
  spaceId: 's1',
  accountId: 'a1',
  date: '2026-07-01',
  amountCents: -1250,
  currency: 'EUR',
  merchant: 'Albert Heijn',
  txType: 'expense',
  needsReview: 0,
  fieldVersions: {},
  deleted: 0,
  ...over,
});

const ctx: ExportContext = {
  accounts: [account],
  catalog: buildCatalog([], false),
  catName: (cat) => cat.nameKey ?? cat.name ?? cat.id,
  typeName: (t) => t,
};

describe('toCsvRows', () => {
  it('emits a header plus one row per transaction, oldest first', () => {
    const rows = toCsvRows(
      [tx({ id: 'b', date: '2026-07-02' }), tx({ id: 'a', date: '2026-07-01', time: '09:30' })],
      ctx,
    );
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows[1][0]).toBe('2026-07-01');
    expect(rows[1][1]).toBe('09:30');
    expect(rows[2][0]).toBe('2026-07-02');
    expect(rows).toHaveLength(3);
  });

  it('fills amounts, account, category, status and cleans bank markup', () => {
    const rows = toCsvRows(
      [tx({ catId: 'groceries', needsReview: 1, description: 'AH<br>BONUS', notes: 'x' })],
      ctx,
    );
    const row = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, rows[1][i]]));
    expect(row).toMatchObject({
      account: 'Main; "Checking"',
      amount: '-12.50',
      net_amount: '-12.50',
      category: 'cat.groceries',
      main_category: 'cat.consumption',
      status: 'unreviewed',
      description: 'AH · BONUS',
      notes: 'x',
    });
  });

  it('net amounts reflect reimbursements on both sides', () => {
    const rows = toCsvRows(
      [
        tx({ id: 'exp', amountCents: -1000, reimbursements: [{ txId: 'inc', amountCents: 400 }] }),
        tx({ id: 'inc', amountCents: 400, txType: 'income', date: '2026-07-02' }),
      ],
      ctx,
    );
    expect(rows[1][CSV_COLUMNS.indexOf('net_amount')]).toBe('-6.00'); // expense netted
    expect(rows[2][CSV_COLUMNS.indexOf('net_amount')]).toBe('0.00'); // credit fully given
  });

  it('splits fan out as part rows with the parent sign', () => {
    const rows = toCsvRows(
      [tx({ splits: [{ catId: 'alcohol', amountCents: 500 }, { catId: 'groceries', amountCents: 750 }] })],
      ctx,
    );
    expect(rows).toHaveLength(4);
    expect(rows[2][CSV_COLUMNS.indexOf('split')]).toBe('part');
    expect(rows[2][CSV_COLUMNS.indexOf('amount')]).toBe('-5.00');
    expect(rows[3][CSV_COLUMNS.indexOf('amount')]).toBe('-7.50');
  });

  it('technical mode appends ids', () => {
    const rows = toCsvRows([tx({})], { ...ctx, technical: true });
    expect(rows[0]).toContain('tx_id');
    expect(rows[1]).toContain('t1');
    expect(rows[1]).toContain('a1');
  });

  it('multi-space exports lead with the space column', () => {
    const rows = toCsvRows([tx({})], { ...ctx, spaceName: 'Household' });
    expect(rows[0][0]).toBe('space');
    expect(rows[1][0]).toBe('Household');
  });
});

describe('serializeCsv', () => {
  it('quotes fields containing the delimiter, quotes and newlines', () => {
    const out = serializeCsv([['a;b', 'he said "hi"', 'line\nbreak', 'plain']], ';');
    expect(out).toContain('"a;b";"he said ""hi""";"line\nbreak";plain');
    expect(out.startsWith('﻿')).toBe(true); // BOM for Excel
    expect(out.endsWith('\r\n')).toBe(true);
  });

  it('picks the delimiter by language', () => {
    expect(delimiterForLang('en')).toBe(',');
    expect(delimiterForLang('nl')).toBe(';');
    expect(delimiterForLang('tr')).toBe(';');
  });
});
