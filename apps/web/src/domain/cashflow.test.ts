import { describe, expect, it } from 'vitest';
import { nextPayday, safeToSpend } from './cashflow';
import type { RecurringRow, TransactionRow } from '@/db/types';

const tx = (over: Partial<TransactionRow>): TransactionRow => ({
  id: Math.random().toString(36).slice(2),
  spaceId: 's1',
  accountId: 'a1',
  date: '2026-07-01',
  amountCents: -1000,
  currency: 'EUR',
  merchant: 'X',
  txType: 'expense',
  needsReview: 0,
  fieldVersions: {},
  deleted: 0,
  ...over,
});

const salaryTxs = [
  tx({ merchant: 'Demo Corp BV', amountCents: 220_000, txType: 'income', date: '2026-05-25' }),
  tx({ merchant: 'Demo Corp BV', amountCents: 220_000, txType: 'income', date: '2026-06-25' }),
  // noise: a big one-off refund never counts as salary (single month)
  tx({ merchant: 'Belastingdienst', amountCents: 500_000, txType: 'income', date: '2026-06-02' }),
];

const rec = (over: Partial<RecurringRow>): RecurringRow => ({
  id: 'r1',
  spaceId: 's1',
  name: 'Rent',
  kind: 'fixed',
  amountCents: 85_000,
  every: 'month',
  dueDay: 20,
  active: 1,
  fieldVersions: {},
  deleted: 0,
  ...over,
});

const accounts = [
  { id: 'a1', type: 'checking' as const, balanceCents: 150_000, archived: 0 as const, deleted: 0 as const },
  { id: 'a2', type: 'savings' as const, balanceCents: 999_999, archived: 0 as const, deleted: 0 as const },
];

describe('nextPayday', () => {
  it('projects the repeating largest credit forward, before or after today', () => {
    expect(nextPayday(salaryTxs, '2026-07-10')).toEqual({
      date: '2026-07-25',
      merchant: 'Demo Corp BV',
      amountCents: 220_000,
    });
    // day already passed → next month
    expect(nextPayday(salaryTxs, '2026-07-26')?.date).toBe('2026-08-25');
  });

  it('stays silent without a salary-shaped pattern', () => {
    expect(nextPayday([], '2026-07-10')).toBeNull();
    // one month of history is not a pattern
    expect(nextPayday([tx({ merchant: 'Employer', amountCents: 200_000, date: '2026-07-01' })], '2026-07-10')).toBeNull();
    // repeated small credits (tikkies) don't qualify
    const tikkies = ['2026-05-05', '2026-06-05'].map((date) => tx({ merchant: 'Friend', amountCents: 2_000, date }));
    expect(nextPayday(tikkies, '2026-07-10')).toBeNull();
  });
});

describe('safeToSpend', () => {
  it('liquid balance minus what falls due before payday, per day', () => {
    const result = safeToSpend({
      accounts,
      txs: salaryTxs,
      recurrings: [rec({}), rec({ id: 'r2', name: 'Netflix', amountCents: 1_599, dueDay: 28 })], // 28th is after payday
      today: '2026-07-10',
    })!;
    // savings never count as spendable; rent (due 20th) does, Netflix (28th) doesn't
    expect(result.liquidCents).toBe(150_000);
    expect(result.upcoming.map((u) => u.rec.name)).toEqual(['Rent']);
    expect(result.cents).toBe(150_000 - 85_000);
    expect(result.days).toBe(15);
    expect(result.perDayCents).toBe(Math.floor(65_000 / 15));
  });

  it('allocation promises reduce the safe number (F2)', () => {
    const result = safeToSpend({
      accounts,
      txs: salaryTxs,
      recurrings: [],
      allocations: [
        { id: 'al1', spaceId: 's1', periodStart: '2026-07-01', catId: 'consumption', assignedCents: 40_000, fieldVersions: {}, deleted: 0 },
      ],
      catalog: { byId: (id) => ({ id: id ?? 'uncategorized' }) },
      period: { start: '2026-07-01', end: '2026-07-31' },
      today: '2026-07-10',
    })!;
    expect(result.allocationCents).toBe(40_000);
    expect(result.cents).toBe(150_000 - 40_000);
  });

  it('shows nothing rather than a wrong number', () => {
    expect(safeToSpend({ accounts, txs: [], recurrings: [], today: '2026-07-10' })).toBeNull();
    expect(safeToSpend({ accounts: [], txs: salaryTxs, recurrings: [], today: '2026-07-10' })).toBeNull();
  });
});
