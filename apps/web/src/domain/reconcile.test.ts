import { describe, expect, it } from 'vitest';
import { isImportedRow, isLinkedRow, reconcilePlan } from './reconcile';
import type { TransactionRow } from '@/db/types';

let n = 0;
const row = (over: Partial<TransactionRow>): TransactionRow =>
  ({
    id: `t${++n}`,
    spaceId: 'feed',
    accountId: 'a1',
    date: '2026-06-01',
    amountCents: -1000,
    currency: 'EUR',
    merchant: 'SHOP',
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    ...over,
  }) as TransactionRow;

describe('reconcilePlan (linked is the truth, in-between dates only)', () => {
  it('classifies provenance by reference shape', () => {
    expect(isImportedRow(row({ importRef: 'ing:2026:abc:1' }))).toBe(true);
    expect(isImportedRow(row({ importRef: 'paypal:TX1' }))).toBe(true);
    expect(isLinkedRow(row({ importRef: 'BANKREF123' }))).toBe(true);
    expect(isLinkedRow(row({ importRef: 'ing:2026:abc:1' }))).toBe(false);
    expect(isImportedRow(row({ importRef: undefined }))).toBe(false);
  });

  it('matches same-day same-amount rows, judges only inside the coverage, keeps older history', () => {
    const linked = [
      row({ importRef: 'REF-A', date: '2026-06-01', amountCents: -2500, merchant: 'ALBERT HEIJN' }),
      row({ importRef: 'REF-B', date: '2026-06-10', amountCents: -1200, merchant: 'SHELL' }),
      row({ importRef: 'REF-C', date: '2026-06-20', amountCents: 90_000, merchant: 'EMPLOYER' }),
    ];
    const imported = [
      // matches REF-B (inside coverage, same day+amount)
      row({ importRef: 'ing:x:1', date: '2026-06-10', amountCents: -1200, merchant: 'Shell Station' }),
      // inside coverage, nothing vouches for it → mismatched
      row({ importRef: 'ing:x:2', date: '2026-06-12', amountCents: -999, merchant: 'GHOST' }),
      // 2023 history the connection never saw → kept (in-between rule)
      row({ importRef: 'ing:x:3', date: '2023-01-05', amountCents: -700, merchant: 'OLD SHOP' }),
      // ON the coverage edge → not judged, kept
      row({ importRef: 'ing:x:4', date: '2026-06-01', amountCents: -2500, merchant: 'ALBERT HEIJN' }),
    ];
    const plan = reconcilePlan([...linked, ...imported]);

    expect(plan.coverage).toEqual({ from: '2026-06-01', to: '2026-06-20' });
    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0].imported.importRef).toBe('ing:x:1');
    expect(plan.matches[0].linked.importRef).toBe('REF-B');
    expect(plan.mismatched.map((r) => r.importRef)).toEqual(['ing:x:2']);
    expect(plan.kept.map((r) => r.importRef)).toEqual(['ing:x:3', 'ing:x:4']);
  });

  it('a linked row vouches for at most one import; the closer name wins', () => {
    const plan = reconcilePlan([
      row({ importRef: 'REF-1', date: '2026-05-01', amountCents: -100 }),
      row({ importRef: 'REF-2', date: '2026-06-05', amountCents: -1500, merchant: 'JUMBO UTRECHT' }),
      row({ importRef: 'REF-3', date: '2026-07-01', amountCents: -100 }),
      row({ importRef: 'ing:a', date: '2026-06-05', amountCents: -1500, merchant: 'Jumbo' }),
      row({ importRef: 'ing:b', date: '2026-06-05', amountCents: -1500, merchant: 'UNRELATED' }),
    ]);
    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0].imported.importRef).toBe('ing:a'); // name similarity claimed the truth row
    expect(plan.mismatched.map((r) => r.importRef)).toEqual(['ing:b']);
  });

  it('no linked rows → nothing is judged, everything imported is kept', () => {
    const plan = reconcilePlan([row({ importRef: 'ing:only', date: '2026-06-01' })]);
    expect(plan.coverage).toBeNull();
    expect(plan.kept).toHaveLength(1);
    expect(plan.mismatched).toHaveLength(0);
  });
});
