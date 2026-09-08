import { describe, expect, it } from 'vitest';
import type { TransactionRow } from '@/db/types';
import {
  affectedByDelete,
  affectedByDirectionChange,
  affectedByTypeChange,
  detachCategoryPatch,
  directionAllows,
  directionOfTx,
  subtreeIds,
} from './categoryRules';

const tx = (partial: Partial<TransactionRow>): TransactionRow =>
  ({
    id: 't',
    spaceId: 's',
    accountId: 'a',
    date: '2026-07-01',
    amountCents: -1000,
    currency: 'EUR',
    merchant: 'M',
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    fieldVersions: {},
    ...partial,
  }) as TransactionRow;

describe('directionOfTx / directionAllows', () => {
  it('sign decides the side', () => {
    expect(directionOfTx(tx({ amountCents: -1 }))).toBe('debit');
    expect(directionOfTx(tx({ amountCents: 1 }))).toBe('credit');
  });

  it('both and undefined allow everything; debit/credit are exclusive', () => {
    expect(directionAllows('both', 'debit')).toBe(true);
    expect(directionAllows(undefined, 'credit')).toBe(true);
    expect(directionAllows('debit', 'debit')).toBe(true);
    expect(directionAllows('debit', 'credit')).toBe(false);
    expect(directionAllows('credit', 'debit')).toBe(false);
  });
});

describe('subtreeIds', () => {
  it('collects the parent and its direct subs', () => {
    const cats = [
      { id: 'p' },
      { id: 'a', parentId: 'p' },
      { id: 'b', parentId: 'p' },
      { id: 'other', parentId: 'q' },
    ];
    expect([...subtreeIds('p', cats)].sort()).toEqual(['a', 'b', 'p']);
  });
});

describe('affectedByTypeChange', () => {
  const ids = new Set(['cat1', 'cat1_sub']);
  it('finds transactions of a different type using the subtree (catId or splits)', () => {
    const txs = [
      tx({ id: '1', catId: 'cat1', txType: 'expense' }),
      tx({ id: '2', catId: 'cat1_sub', txType: 'income' }),
      tx({ id: '3', catId: 'unrelated', txType: 'income' }),
      tx({ id: '4', catId: 'x', splits: [{ catId: 'cat1_sub', amountCents: 500 }], txType: 'income' }),
      tx({ id: '5', catId: 'cat1', txType: 'income', deleted: 1 }),
    ];
    expect(affectedByTypeChange(txs, ids, 'expense').map((t) => t.id)).toEqual(['2', '4']);
  });
});

describe('affectedByDirectionChange', () => {
  it('flags transactions on the now-forbidden side', () => {
    const txs = [
      tx({ id: 'd', catId: 'c', amountCents: -100 }),
      tx({ id: 'c', catId: 'c', amountCents: 100 }),
    ];
    expect(affectedByDirectionChange(txs, 'c', 'debit').map((t) => t.id)).toEqual(['c']);
    expect(affectedByDirectionChange(txs, 'c', 'credit').map((t) => t.id)).toEqual(['d']);
    expect(affectedByDirectionChange(txs, 'c', 'both')).toEqual([]);
  });
});

describe('affectedByDelete + detachCategoryPatch', () => {
  it('every user of the subtree is affected and detached to uncategorized', () => {
    const ids = new Set(['dead']);
    const plain = tx({ id: '1', catId: 'dead' });
    const split = tx({
      id: '2',
      catId: 'kept',
      splits: [
        { catId: 'dead', amountCents: 300 },
        { catId: 'kept', amountCents: 700 },
      ],
    });
    expect(affectedByDelete([plain, split, tx({ id: '3', catId: 'kept' })], ids).map((t) => t.id)).toEqual(['1', '2']);

    expect(detachCategoryPatch(plain, ids)).toEqual({ needsReview: 1, catId: 'uncategorized' });
    const splitPatch = detachCategoryPatch(split, ids);
    expect(splitPatch.catId).toBeUndefined(); // the direct catId was fine
    expect(splitPatch.splits).toEqual([
      { catId: 'uncategorized', amountCents: 300 },
      { catId: 'kept', amountCents: 700 },
    ]);
    expect(splitPatch.needsReview).toBe(1);
  });
});
