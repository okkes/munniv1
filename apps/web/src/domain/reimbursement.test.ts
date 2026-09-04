import { describe, expect, it } from 'vitest';
import {
  clampReimbursement,
  creditRemainingCents,
  givenCents,
  netAmountCents,
  netCreditCents,
  remainingCents,
  settledSplits,
  totalReimbursedCents,
  withLink,
} from './reimbursement';

const expense = (amountCents: number, reimbursements?: { txId: string; amountCents: number }[]) => ({
  amountCents,
  reimbursements,
});

describe('reimbursement math', () => {
  it('sums totals; empty and missing are zero', () => {
    expect(totalReimbursedCents(expense(-1000))).toBe(0);
    expect(totalReimbursedCents(expense(-1000, []))).toBe(0);
    expect(totalReimbursedCents(expense(-1000, [{ txId: 'a', amountCents: 300 }, { txId: 'b', amountCents: 200 }]))).toBe(500);
  });

  it('net amount moves toward zero, never past it', () => {
    expect(netAmountCents(expense(-1000))).toBe(-1000);
    expect(netAmountCents(expense(-1000, [{ txId: 'a', amountCents: 400 }]))).toBe(-600);
    expect(netAmountCents(expense(-1000, [{ txId: 'a', amountCents: 1000 }]))).toBe(0);
    // corrupted over-reimbursement still cannot flip an expense into income
    expect(netAmountCents(expense(-1000, [{ txId: 'a', amountCents: 1500 }]))).toBe(0);
  });

  it('net amount of income/credit rows is untouched', () => {
    expect(netAmountCents(expense(2200))).toBe(2200);
  });

  it('the credit side derives what it gave and what it is still worth', () => {
    const all = [
      expense(-1000, [{ txId: 'credit-1', amountCents: 400 }]),
      expense(-500, [{ txId: 'credit-1', amountCents: 500 }, { txId: 'other', amountCents: 100 }]),
      expense(2200), // credits carry no links themselves
    ];
    expect(givenCents(all, 'credit-1')).toBe(900);
    expect(givenCents(all, 'unknown')).toBe(0);
    // a €10.10 refund that settled €9 of expenses is worth €1.10 now
    expect(netCreditCents(expense(1010), 900)).toBe(110);
    expect(netCreditCents(expense(900), 900)).toBe(0);
    expect(netCreditCents(expense(900), 1200)).toBe(0); // never negative
    expect(netCreditCents(expense(-500), 0)).toBe(-500); // expenses pass through
    expect(creditRemainingCents(expense(1010), 900)).toBe(110);
  });

  it('remaining shrinks with links and never goes negative', () => {
    expect(remainingCents(expense(-1000))).toBe(1000);
    expect(remainingCents(expense(-1000, [{ txId: 'a', amountCents: 999 }]))).toBe(1);
    expect(remainingCents(expense(-1000, [{ txId: 'a', amountCents: 1500 }]))).toBe(0);
    expect(remainingCents(expense(500))).toBe(0);
  });

  it('clamps to the smallest of request, remainder, credit size', () => {
    expect(clampReimbursement(expense(-1000), 400, 999)).toBe(400); // credit caps
    expect(clampReimbursement(expense(-300), 400, 999)).toBe(300); // remainder caps
    expect(clampReimbursement(expense(-1000), 400, 250)).toBe(250); // request caps
    expect(clampReimbursement(expense(-1000, [{ txId: 'a', amountCents: 900 }]), 400, 400)).toBe(100);
  });

  it('refuses impossible links', () => {
    expect(clampReimbursement(expense(500), 400, 400)).toBe(0); // not an expense
    expect(clampReimbursement(expense(-1000), -50, 400)).toBe(0); // not a credit
    expect(clampReimbursement(expense(-1000), 400, 0)).toBe(0); // nothing requested
    expect(clampReimbursement(expense(-1000, [{ txId: 'a', amountCents: 1000 }]), 400, 100)).toBe(0); // fully reimbursed
  });

  it('withLink adds, replaces, and removes', () => {
    const one = withLink(undefined, 'a', 300);
    expect(one).toEqual([{ txId: 'a', amountCents: 300 }]);
    const replaced = withLink(one, 'a', 200);
    expect(replaced).toEqual([{ txId: 'a', amountCents: 200 }]);
    const two = withLink(replaced, 'b', 100);
    expect(two).toHaveLength(2);
    expect(withLink(two, 'a', 0)).toEqual([{ txId: 'b', amountCents: 100 }]);
  });
});

describe('settledSplits (redesign: gross slices + explicit reimbursed)', () => {
  const names: Record<string, string> = { food: 'Food', coffee: 'Coffee', sweets: 'Sweets', eatingOut: 'Eating out', fun: 'Fun', incomeOther: 'Other income', reimburse: 'Received reimbursement', expenseReimburse: 'Expected reimbursement', reimbursed: 'Reimbursed', uncategorized: 'Uncategorized' };
  const nameOf = (id: string) => names[id] ?? id;
  const by = (out: { catId: string; amountCents: number }[]) =>
    Object.fromEntries(out.map((s) => [s.catId, s.amountCents]));

  it('use case 1: plain expense + uncategorized credit, full link', () => {
    // x −100 [food], y +50 [uncat] → x [food 50, reimbursed 50], y [reimbursed 50]
    const x = settledSplits({ amountCents: -10_000, catId: 'food', splits: undefined }, 5_000, nameOf);
    expect(by(x)).toEqual({ food: 5_000, reimbursed: 5_000 });
    const y = settledSplits({ amountCents: 5_000, catId: 'uncategorized', splits: undefined }, 5_000, nameOf);
    expect(by(y)).toEqual({ reimbursed: 5_000 });
  });

  it('use case 2: expected + received sides settle into reimbursed', () => {
    const x = settledSplits(
      { amountCents: -10_000, catId: 'food', splits: [{ catId: 'food', amountCents: 5_000 }, { catId: 'expenseReimburse', amountCents: 5_000 }] },
      6_000,
      nameOf,
    );
    expect(by(x)).toEqual({ food: 4_000, reimbursed: 6_000 });
    const y = settledSplits({ amountCents: 6_000, catId: 'reimburse', splits: undefined }, 6_000, nameOf);
    expect(by(y)).toEqual({ reimbursed: 6_000 });
  });

  it('use case 3: partial settlement leaves the expectation open', () => {
    const x = settledSplits({ amountCents: -10_000, catId: 'expenseReimburse', splits: undefined }, 5_000, nameOf);
    expect(by(x)).toEqual({ expenseReimburse: 5_000, reimbursed: 5_000 });
    const y = settledSplits({ amountCents: 8_000, catId: 'incomeOther', splits: undefined }, 5_000, nameOf);
    expect(by(y)).toEqual({ incomeOther: 3_000, reimbursed: 5_000 });
  });

  it('use case 4: deduction order expected → uncategorized → largest', () => {
    const x = settledSplits(
      {
        amountCents: -10_000,
        catId: 'coffee',
        splits: [
          { catId: 'coffee', amountCents: 3_000 },
          { catId: 'sweets', amountCents: 1_500 },
          { catId: 'uncategorized', amountCents: 500 },
          { catId: 'expenseReimburse', amountCents: 5_000 },
        ],
      },
      5_100,
      nameOf,
    );
    // expected 5000 first, then 100 from uncategorized — coffee/sweets untouched
    expect(by(x)).toEqual({ coffee: 3_000, sweets: 1_500, uncategorized: 400, reimbursed: 5_100 });
  });

  it('largest-first with alphabetical tie-break', () => {
    const out = settledSplits(
      { amountCents: -6_000, catId: 'fun', splits: [{ catId: 'fun', amountCents: 3_000 }, { catId: 'eatingOut', amountCents: 3_000 }] },
      4_000,
      nameOf,
    );
    // tie at 3000: "Eating out" < "Fun" alphabetically → consumed first
    expect(by(out)).toEqual({ fun: 2_000, reimbursed: 4_000 });
  });

  it('a removed settlement frees value onto uncategorized, never the original category', () => {
    const out = settledSplits(
      { amountCents: -10_000, catId: 'food', splits: [{ catId: 'food', amountCents: 5_000 }, { catId: 'reimbursed', amountCents: 5_000 }] },
      0,
      nameOf,
    );
    expect(by(out)).toEqual({ food: 5_000, uncategorized: 5_000 });
  });

  it('legacy NET slices normalize: the shortfall against gross becomes reimbursed', () => {
    // pre-redesign row: −100 gross, 40 linked, slices summed to net 60
    const out = settledSplits(
      { amountCents: -10_000, catId: 'food', splits: [{ catId: 'food', amountCents: 6_000 }] },
      4_000,
      nameOf,
    );
    expect(by(out)).toEqual({ food: 6_000, reimbursed: 4_000 });
  });
});
