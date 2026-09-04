import { describe, expect, it } from 'vitest';
import { counterDuplicates, counterOpenRows, counterSameSignCandidates } from './counterMatch';
import type { TransactionRow } from '@/db/types';

const base = (over: Partial<TransactionRow>): TransactionRow =>
  ({
    id: 'x', accountId: 'counter', date: '2026-03-10', amountCents: 5240, currency: 'EUR',
    merchant: 'M', catId: 'uncategorized', txType: 'income', needsReview: 0, deleted: 0,
    ...over,
  }) as TransactionRow;

const anchor = { id: 'src', amountCents: -5240, date: '2026-03-10' };

describe('counterDuplicates (#133 B pick-existing)', () => {
  it('offers only opposite-sign, unlinked, close-in-amount-and-date rows on the counter account', () => {
    const rows: TransactionRow[] = [
      base({ id: 'hit-exact' }),
      base({ id: 'hit-near', amountCents: 5300, date: '2026-03-12' }), // 60 cents off — inside the 2% tolerance
      base({ id: 'wrong-sign', amountCents: -5240 }),
      base({ id: 'other-account', accountId: 'elsewhere' }),
      base({ id: 'linked', linkedAccountId: 'somewhere' }),
      base({ id: 'peered', transferPeerId: 'p' }),
      base({ id: 'far-amount', amountCents: 9000 }),
      base({ id: 'far-date', date: '2026-05-01' }),
      base({ id: 'container', splits: [{ catId: 'a', amountCents: 3000 }, { catId: 'b', amountCents: 2240 }] }),
      base({ id: 'tombstone', deleted: 1 }),
      base({ id: anchor.id }), // the anchor itself never offers
    ];
    const found = counterDuplicates(rows, 'counter', anchor);
    expect(found.map((row) => row.id)).toEqual(['hit-exact', 'hit-near']);
  });

  it('sorts exact amounts first, then by date distance, and honors the limit', () => {
    const rows = [
      base({ id: 'near-amount', amountCents: 5290, date: '2026-03-10' }),
      base({ id: 'exact-far', date: '2026-03-16' }),
      base({ id: 'exact-close', date: '2026-03-11' }),
    ];
    expect(counterDuplicates(rows, 'counter', anchor).map((row) => row.id)).toEqual([
      'exact-close', 'exact-far', 'near-amount',
    ]);
    expect(counterDuplicates(rows, 'counter', anchor, 2)).toHaveLength(2);
  });
});

describe('#237: the wallet story + the browse-all door', () => {
  it('counterSameSignCandidates offers SAME-sign near rows — the wallet purchase behind a bank debit', () => {
    const rows: TransactionRow[] = [
      base({ id: 'purchase', amountCents: -5240 }),
      base({ id: 'opposite' }),
      base({ id: 'linked-out', amountCents: -5240, linkedAccountId: 'x' }),
      base({ id: 'far', amountCents: -9000 }),
    ];
    expect(counterSameSignCandidates(rows, 'counter', anchor).map((row) => row.id)).toEqual(['purchase']);
  });

  it('counterOpenRows lists every open row newest first — linked, peered and containers filtered out', () => {
    const rows: TransactionRow[] = [
      base({ id: 'old', date: '2026-01-05', amountCents: -100 }),
      base({ id: 'new', date: '2026-03-01', amountCents: 900 }),
      base({ id: 'linked', linkedAccountId: 'x' }),
      base({ id: 'peered', transferPeerId: 'p' }),
      base({ id: 'container', splits: [{ catId: 'a', amountCents: 100 }, { catId: 'b', amountCents: 5140 }] }),
      base({ id: anchor.id }),
    ];
    expect(counterOpenRows(rows, 'counter', anchor.id).map((row) => row.id)).toEqual(['new', 'old']);
  });

  it('#237 r2: a row some OTHER row (or split part) points at is never offered — one-way pairs are spoken for', () => {
    // the user's screenshot: the sheet offered a transaction that was
    // already the other half of a one-way pair (its own reciprocal was
    // missing) — being POINTED AT must disqualify it everywhere
    const rows: TransactionRow[] = [
      base({ id: 'free', amountCents: -5240 }),
      base({ id: 'taken', amountCents: -5240 }),
      base({ id: 'taken-by-part', amountCents: -5240 }),
      // the pointing rows live on ANOTHER account (the bank side)
      base({ id: 'bank-leg', accountId: 'bank', amountCents: -5240, transferPeerId: 'taken' }),
      base({
        id: 'bank-container', accountId: 'bank', amountCents: -5240,
        splits: [{ id: 'p1', catId: 'a', amountCents: 5240, transferPeerId: 'taken-by-part' } as never],
      }),
    ];
    expect(counterSameSignCandidates(rows, 'counter', anchor).map((row) => row.id)).toEqual(['free']);
    expect(counterOpenRows(rows, 'counter', anchor.id).map((row) => row.id)).toEqual(['free']);
    expect(counterDuplicates(rows, 'counter', { ...anchor, amountCents: 5240 }).map((row) => row.id)).toEqual(['free']);
  });
});
