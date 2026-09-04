import { afterEach, describe, expect, it } from 'vitest';
import {
  bestMatch,
  candidateLadder,
  mapAhItems,
  mapAhPayment,
  mapAhSummary,
  matchCandidates,
  parseReceiptText,
  setCatalogStorePatterns,
} from './storeReceipts';
import type { MatchableReceipt } from './storeReceipts';
import type { TransactionRow } from '@/db/types';

const tx = (partial: Partial<TransactionRow>): TransactionRow =>
  ({
    id: Math.random().toString(36).slice(2),
    spaceId: 's1',
    accountId: 'a1',
    date: '2026-07-05',
    amountCents: -2350,
    currency: 'EUR',
    merchant: 'Albert Heijn',
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    ...partial,
  }) as TransactionRow;

const receipt: MatchableReceipt = { id: 'r1', source: 'ah', date: '2026-07-05', totalCents: 2350 };

describe('receipt ↔ transaction matching', () => {
  afterEach(() => setCatalogStorePatterns([])); // catalog overrides never leak between tests

  it('amount ±2c and date ±2d bound the candidates', () => {
    const txs = [
      tx({ id: 'hit' }),
      tx({ id: 'wrong-amount', amountCents: -2500 }),
      tx({ id: 'wrong-date', date: '2026-07-01' }),
      tx({ id: 'near-amount', amountCents: -2351 }),
    ];
    const ids = matchCandidates(receipt, txs).map((t) => t.id);
    expect(ids).toContain('hit');
    expect(ids).toContain('near-amount');
    expect(ids).not.toContain('wrong-amount');
    expect(ids).not.toContain('wrong-date');
  });

  it('auto-attaches only an unambiguous winner', () => {
    const clear = [tx({ id: 'only' })];
    expect(bestMatch(receipt, clear, new Set())).toBe('only');

    // two equal candidates → ambiguous → manual
    const twins = [tx({ id: 'a' }), tx({ id: 'b' })];
    expect(bestMatch(receipt, twins, new Set())).toBeNull();

    // merchant hit breaks the tie
    const tied = [tx({ id: 'ah-one' }), tx({ id: 'other', merchant: 'Snackbar' })];
    expect(bestMatch(receipt, tied, new Set())).toBe('ah-one');

    // already-taken transactions stay out of it
    expect(bestMatch(receipt, clear, new Set(['only']))).toBeNull();

    // rung-1 only (user ruling): a near-but-not-exact amount, or a
    // merchant that doesn't fingerprint, never auto-attaches
    expect(bestMatch(receipt, [tx({ id: 'near', amountCents: -2351 })], new Set())).toBeNull();
    expect(bestMatch(receipt, [tx({ id: 'foreign', merchant: 'Snackbar' })], new Set())).toBeNull();
  });

  it('payment tails constrain matching when a candidate account matches (R5)', () => {
    const paid: MatchableReceipt = { ...receipt, payment: { method: 'PINNEN', accountTail: '4321' } };
    const txs = [tx({ id: 'right-card' }), tx({ id: 'other-card' })];
    const tails: Record<string, string> = { 'right-card': 'NL0012344321', 'other-card': 'NL0099998888' };
    const tailOf = (row: TransactionRow) => tails[row.id];
    // twins would be ambiguous — the tail disambiguates
    expect(bestMatch(paid, txs, new Set(), tailOf)).toBe('right-card');
    // no candidate matches the tail (store card ≠ IBAN): nobody is excluded
    const strangers = [tx({ id: 'only' })];
    expect(bestMatch({ ...receipt, payment: { accountTail: '0000' } }, strangers, new Set(), tailOf)).toBe('only');
  });

  it('operator store patterns from the catalog override the bundled fingerprint (R9)', () => {
    setCatalogStorePatterns([{ id: 'ah', patterns: ['appie market'] }]);
    const custom = [tx({ id: 'custom', merchant: 'APPIE MARKET AMSTERDAM' }), tx({ id: 'other', merchant: 'Snackbar' })];
    expect(bestMatch(receipt, custom, new Set())).toBe('custom');
    // a broken operator regex never breaks matching — bundled rules return
    setCatalogStorePatterns([{ id: 'ah', patterns: ['('] }]);
    expect(bestMatch(receipt, [tx({ id: 'ah-again' })], new Set())).toBe('ah-again');
  });

  it('the picker ladder widens on demand: near matches, same price, latest', () => {
    const txs = [
      tx({ id: 'near', date: '2026-07-05' }),
      tx({ id: 'same-price-far', date: '2026-06-01' }),
      tx({ id: 'other-latest', date: '2026-07-04', amountCents: -999 }),
      tx({ id: 'income', txType: 'income', amountCents: 2350 }),
    ];
    const ladder = candidateLadder(receipt, txs);
    expect(ladder.primary.map((t) => t.id)).toEqual(['near']);
    // rung 3 (same amount, any date) before rung 4 (latest expenses)
    expect(ladder.more.map((t) => t.id)).toEqual(['same-price-far', 'other-latest']);
  });
});

describe('AH payload mapping', () => {
  it('payment lines yield method + masked tail; product lines never do', () => {
    const items = [
      { type: 'product', description: 'MELK', amount: '2,58' },
      { type: 'payment', description: 'PINNEN Maestro ****1234', amount: '23,50' },
    ];
    expect(mapAhPayment(items)).toEqual({ method: 'PINNEN Maestro ****1234', accountTail: '1234' });
    expect(mapAhPayment([{ type: 'product', description: 'MELK', amount: '2,58' }])).toBeUndefined();
  });

  it('summary rows become matchable receipts (euros → cents)', () => {
    const mapped = mapAhSummary({
      transactionId: 'tid-1',
      transactionMoment: '2026-07-05T17:31:00Z',
      total: { amount: { amount: 23.5 } },
    });
    expect(mapped).toMatchObject({ id: 'tid-1', source: 'ah', date: '2026-07-05', totalCents: 2350 });
  });

  it('receiptUiItems keep products and drop chrome', () => {
    const items = mapAhItems([
      { type: 'product', quantity: '2', description: 'HALFVOLLE MELK', amount: '2,58' },
      { type: 'product', description: 'BROOD', amount: '1.99' },
      { type: 'divider' },
      { type: 'total', amount: '4,57' },
    ]);
    expect(items).toEqual([
      { name: 'HALFVOLLE MELK', qty: 2, totalCents: 258 },
      { name: 'BROOD', qty: undefined, totalCents: 199 },
    ]);
  });
});

describe('OCR text parsing', () => {
  it('extracts item lines and skips register noise', () => {
    const items = parseReceiptText(
      ['AH BANANEN 1,89', '2 x KAAS JONG 7,98', 'SUBTOTAAL 9,87', 'BONUSKAART 0,50-', 'TOTAAL 9,37', 'PINNEN 9,37'].join('\n'),
    );
    expect(items).toEqual([
      { name: 'AH BANANEN', qty: undefined, totalCents: 189 },
      { name: 'KAAS JONG', qty: 2, totalCents: 798 },
    ]);
  });

  it('garbage in, nothing out', () => {
    expect(parseReceiptText('')).toEqual([]);
    expect(parseReceiptText('welkom bij albert heijn\nfijne dag')).toEqual([]);
  });
});
