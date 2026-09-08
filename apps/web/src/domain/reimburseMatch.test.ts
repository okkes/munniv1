import { describe, expect, it } from 'vitest';
import { filedAsReimbursement, reimbEarmarkCents, suggestCounterparts } from './reimburseMatch';
import type { TransactionRow } from '@/db/types';

const tx = (over: Partial<TransactionRow>): TransactionRow =>
  ({
    id: over.id ?? 'x',
    spaceId: 's',
    accountId: 'a',
    date: '2026-07-01',
    amountCents: -5_000,
    currency: 'EUR',
    merchant: 'Shop',
    needsReview: 0,
    deleted: 0,
    ...over,
  }) as TransactionRow;

const noGiven = () => 0;

describe('reimbursement suggestions', () => {
  const expense = tx({ id: 'e', amountCents: -8_000, date: '2026-07-01', merchant: 'Restaurant' });

  it('surfaces the credit that repays the expense: wording + timing + size', () => {
    const match = tx({ id: 'c1', amountCents: 4_000, date: '2026-07-03', merchant: 'Tikkie J. Jansen' });
    const noise = tx({ id: 'c2', amountCents: 4_000, date: '2026-03-01', merchant: 'Salary' });
    const scored = suggestCounterparts(expense, [noise, match], noGiven);
    expect(scored.map((s) => s.tx.id)).toEqual(['c1']);
  });

  it('a credit far bigger than the expense never suggests itself on size', () => {
    const oversized = tx({ id: 'big', amountCents: 500_000, date: '2026-07-02', merchant: 'Employer BV' });
    expect(suggestCounterparts(expense, [oversized], noGiven)).toEqual([]);
  });

  it('rows filed under the reimbursement categories qualify on bookkeeping + timing', () => {
    const filed = tx({ id: 'f', amountCents: 8_000, date: '2026-07-05', merchant: 'J Doe', catId: 'reimburse' });
    const scored = suggestCounterparts(expense, [filed], noGiven);
    expect(scored).toHaveLength(1);
    expect(scored[0].tx.id).toBe('f');
  });

  it('caps at the two best candidates', () => {
    const many = [1, 2, 3, 4].map((i) =>
      tx({ id: `c${i}`, amountCents: 8_000, date: '2026-07-02', merchant: `Betaalverzoek ${i}` }),
    );
    expect(suggestCounterparts(expense, many, noGiven)).toHaveLength(2);
  });

  it('a credit anchor looks BACK at expenses', () => {
    const credit = tx({ id: 'c', amountCents: 3_000, date: '2026-07-08', merchant: 'Tikkie terug' });
    const before = tx({ id: 'e1', amountCents: -3_000, date: '2026-07-05', merchant: 'Dinner' });
    const after = tx({ id: 'e2', amountCents: -3_000, date: '2026-08-20', merchant: 'Dinner' });
    const scored = suggestCounterparts(credit, [before, after], noGiven);
    expect(scored.map((s) => s.tx.id)).toEqual(['e1']);
  });
});

describe('reimbursement earmarks', () => {
  it('a split earmarks its expected/received slice value', () => {
    const row = tx({
      splits: [
        { catId: 'groceries', amountCents: 6_000 },
        { catId: 'expenseReimburse', amountCents: 2_000 },
      ],
    });
    expect(filedAsReimbursement(row)).toBe(true);
    expect(reimbEarmarkCents(row)).toBe(2_000);
  });

  it('a whole-category reimbursement row earmarks its net value', () => {
    const row = tx({ id: 'c', amountCents: 4_500, catId: 'reimburse' });
    expect(reimbEarmarkCents(row)).toBe(4_500);
  });

  it('rows without reimbursement bookkeeping earmark nothing', () => {
    const row = tx({ catId: 'groceries' });
    expect(filedAsReimbursement(row)).toBe(false);
    expect(reimbEarmarkCents(row)).toBeNull();
  });
});
