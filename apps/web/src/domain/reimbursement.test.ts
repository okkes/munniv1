import { describe, expect, it } from 'vitest';
import {
  clampReimbursement,
  creditPartGivenCents,
  creditRemainingCents,
  givenCents,
  hasUnsettledReimbursement,
  largestOpenPartId,
  netAmountCents,
  netCreditCents,
  partNetCents,
  reimbCentsByPart,
  reimbSettleFields,
  remainingCents,
  settleContainerParts,
  settledCats,
  totalReimbursedCents,
  withLink,
} from './reimbursement';

const expense = (amountCents: number, reimbursements?: { txId: string; amountCents: number }[]) => ({
  amountCents,
  reimbursements,
});

describe('#197: credit-part links', () => {
  it('withLink keys on (txId, partId, creditPartId) and stores the credit part', () => {
    const links = withLink(undefined, 'c1', 1000, undefined, 'cp1');
    expect(links).toEqual([{ txId: 'c1', amountCents: 1000, creditPartId: 'cp1' }]);
    // a link to ANOTHER part of the same credit coexists…
    const both = withLink(links, 'c1', 500, undefined, 'cp2');
    expect(both).toHaveLength(2);
    // …while re-linking the SAME part replaces its value
    expect(withLink(both, 'c1', 700, undefined, 'cp1').find((l) => l.creditPartId === 'cp1')?.amountCents).toBe(700);
  });

  it('creditPartGivenCents counts only the links naming the part; whole-credit math is unchanged', () => {
    const txs = [
      { reimbursements: [{ txId: 'c1', amountCents: 1000, creditPartId: 'cp1' }] },
      { reimbursements: [{ txId: 'c1', amountCents: 400 }] }, // whole-credit link
      { reimbursements: [{ txId: 'c2', amountCents: 900, creditPartId: 'cp1' }] },
    ];
    expect(creditPartGivenCents(txs, 'c1', 'cp1')).toBe(1000);
    expect(givenCents(txs, 'c1')).toBe(1400);
  });
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

describe('settledCats (redesign: gross slices + explicit reimbursed)', () => {
  const names: Record<string, string> = { food: 'Food', coffee: 'Coffee', sweets: 'Sweets', eatingOut: 'Eating out', fun: 'Fun', incomeOther: 'Other income', reimburse: 'Received reimbursement', expenseReimburse: 'Expected reimbursement', reimbursed: 'Reimbursed', uncategorized: 'Uncategorized' };
  const nameOf = (id: string) => names[id] ?? id;
  const by = (out: { catId: string; amountCents: number }[]) =>
    Object.fromEntries(out.map((s) => [s.catId, s.amountCents]));

  it('use case 1: plain expense + uncategorized credit, full link', () => {
    // x −100 [food], y +50 [uncat] → x [food 50, reimbursed 50], y [reimbursed 50]
    const x = settledCats({ amountCents: -10_000, catId: 'food', cats: undefined }, 5_000, nameOf);
    expect(by(x)).toEqual({ food: 5_000, reimbursed: 5_000 });
    const y = settledCats({ amountCents: 5_000, catId: 'uncategorized', cats: undefined }, 5_000, nameOf);
    expect(by(y)).toEqual({ reimbursed: 5_000 });
  });

  it('use case 2: expected + received sides settle into reimbursed', () => {
    const x = settledCats(
      { amountCents: -10_000, catId: 'food', cats: [{ catId: 'food', amountCents: 5_000 }, { catId: 'expenseReimburse', amountCents: 5_000 }] },
      6_000,
      nameOf,
    );
    expect(by(x)).toEqual({ food: 4_000, reimbursed: 6_000 });
    const y = settledCats({ amountCents: 6_000, catId: 'reimburse', cats: undefined }, 6_000, nameOf);
    expect(by(y)).toEqual({ reimbursed: 6_000 });
  });

  it('use case 3: partial settlement leaves the expectation open', () => {
    const x = settledCats({ amountCents: -10_000, catId: 'expenseReimburse', cats: undefined }, 5_000, nameOf);
    expect(by(x)).toEqual({ expenseReimburse: 5_000, reimbursed: 5_000 });
    const y = settledCats({ amountCents: 8_000, catId: 'incomeOther', cats: undefined }, 5_000, nameOf);
    expect(by(y)).toEqual({ incomeOther: 3_000, reimbursed: 5_000 });
  });

  it('use case 4: deduction order expected → uncategorized → largest', () => {
    const x = settledCats(
      {
        amountCents: -10_000,
        catId: 'coffee',
        cats: [
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
    const out = settledCats(
      { amountCents: -6_000, catId: 'fun', cats: [{ catId: 'fun', amountCents: 3_000 }, { catId: 'eatingOut', amountCents: 3_000 }] },
      4_000,
      nameOf,
    );
    // tie at 3000: "Eating out" < "Fun" alphabetically → consumed first
    expect(by(out)).toEqual({ fun: 2_000, reimbursed: 4_000 });
  });

  it('a removed settlement frees value onto uncategorized, never the original category', () => {
    const out = settledCats(
      { amountCents: -10_000, catId: 'food', cats: [{ catId: 'food', amountCents: 5_000 }, { catId: 'reimbursed', amountCents: 5_000 }] },
      0,
      nameOf,
    );
    expect(by(out)).toEqual({ food: 5_000, uncategorized: 5_000 });
  });

  it('legacy NET slices normalize: the shortfall against gross becomes reimbursed', () => {
    // pre-redesign row: −100 gross, 40 linked, slices summed to net 60
    const out = settledCats(
      { amountCents: -10_000, catId: 'food', cats: [{ catId: 'food', amountCents: 6_000 }] },
      4_000,
      nameOf,
    );
    expect(by(out)).toEqual({ food: 6_000, reimbursed: 4_000 });
  });

  it('#228: a SPECIAL category claims the whole — settle is canonical and unlink returns to IT, never uncategorized', () => {
    // the ss-reported hole: [Set aside, Uncategorized] after an unlink
    const settled = settledCats({ amountCents: -10_000, catId: 'savingDeposit', cats: undefined }, 4_000, nameOf);
    expect(by(settled)).toEqual({ savingDeposit: 6_000, reimbursed: 4_000 });
    const freed = settledCats(
      { amountCents: -10_000, catId: 'savingDeposit', cats: [{ catId: 'savingDeposit', amountCents: 6_000 }, { catId: 'reimbursed', amountCents: 4_000 }] },
      0,
      nameOf,
    );
    expect(by(freed)).toEqual({ savingDeposit: 10_000 });
  });

  it('#211 settledCats: a WHOLE row settles inside its own category partition, same rules', () => {
    // no spread yet: the primary category seeds the gross
    const plain = settledCats({ amountCents: -10_000, catId: 'food', cats: undefined }, 3_000, nameOf);
    expect(by(plain)).toEqual({ food: 7_000, reimbursed: 3_000 });
    // an existing spread keeps its attribution; the largest entry pays
    const spread = settledCats(
      {
        amountCents: -10_000,
        catId: 'food',
        cats: [
          { catId: 'food', amountCents: 6_000, pct: 60 },
          { catId: 'fun', amountCents: 4_000, pct: 40 },
        ],
      },
      2_000,
      nameOf,
    );
    expect(by(spread)).toEqual({ food: 4_000, fun: 4_000, reimbursed: 2_000 });
    // settlement breaks the user's % shape — entries come out plain cents
    expect(spread.every((c) => c.pct === undefined)).toBe(true);
    // a removed settlement frees onto uncategorized, never the original
    const freed = settledCats(
      { amountCents: -10_000, catId: 'food', cats: [{ catId: 'food', amountCents: 7_000 }, { catId: 'reimbursed', amountCents: 3_000 }] },
      0,
      nameOf,
    );
    expect(by(freed)).toEqual({ food: 7_000, uncategorized: 3_000 });
  });

  it('#211 hasUnsettledReimbursement reads the partition wherever it lives', () => {
    expect(hasUnsettledReimbursement({ amountCents: -100, catId: 'expenseReimburse', cats: undefined, splits: undefined })).toBe(true);
    expect(
      hasUnsettledReimbursement({
        amountCents: -100,
        catId: 'food',
        cats: [{ catId: 'expenseReimburse', amountCents: 40 }, { catId: 'food', amountCents: 60 }],
        splits: undefined,
      }),
    ).toBe(true);
    expect(
      hasUnsettledReimbursement({
        amountCents: -100,
        catId: 'food',
        cats: [{ catId: 'food', amountCents: 60 }, { catId: 'reimbursed', amountCents: 40 }],
        splits: undefined,
      }),
    ).toBe(false);
    // #228: a container answers through its parts — their catId or spread
    expect(
      hasUnsettledReimbursement({
        amountCents: -100,
        catId: 'food',
        cats: undefined,
        splits: [
          { id: 'p1', catId: 'food', amountCents: 60 },
          { id: 'p2', catId: 'food', amountCents: 40, cats: [{ catId: 'expenseReimburse', amountCents: 40 }] },
        ],
      }),
    ).toBe(true);
    expect(
      hasUnsettledReimbursement({
        amountCents: -100,
        catId: 'food',
        cats: undefined,
        splits: [{ id: 'p1', catId: 'food', amountCents: 60 }, { id: 'p2', catId: 'fun', amountCents: 40 }],
      }),
    ).toBe(false);
  });
});

describe('#228: reimbursement stays ON the split (user ss)', () => {
  const nameOf = (id: string) => id;
  const by = (out: { catId: string; amountCents: number }[]) =>
    Object.fromEntries(out.map((s) => [s.catId, s.amountCents]));

  it('settleContainerParts: the named part settles inside its OWN cats; siblings untouched', () => {
    const out = settleContainerParts(
      {
        amountCents: 240_000,
        splits: [
          { id: 'p1', catId: 'salary', amountCents: 120_000 },
          { id: 'p2', catId: 'other', amountCents: 120_000 },
        ],
      },
      new Map([['p1', 420]]),
      nameOf,
    );
    expect(out).toHaveLength(2);
    expect(out[0].amountCents).toBe(120_000);
    expect(by(out[0].cats!)).toEqual({ salary: 119_580, reimbursed: 420 });
    expect(out[1].amountCents).toBe(120_000);
    expect(out[1].cats).toBeUndefined();
  });

  it('strips the retired pseudo-part and restores the drained sibling (the wrong-part ss bug)', () => {
    // the stored corruption: the container-level consume drained split 2
    // even though the link named split 1
    const out = settleContainerParts(
      {
        amountCents: 240_000,
        splits: [
          { id: 'p1', catId: 'salary', amountCents: 120_000 },
          { id: 'p2', catId: 'other', amountCents: 119_580 },
          { catId: 'reimbursed', amountCents: 420 },
        ],
      },
      new Map([['p1', 420]]),
      nameOf,
    );
    expect(out).toHaveLength(2);
    // split 2's amount waterline-restored, split 1 carries the bookkeeping
    expect(out.map((p) => p.amountCents)).toEqual([120_000, 120_000]);
    expect(by(out[0].cats!)).toEqual({ salary: 119_580, reimbursed: 420 });
    expect(out[1].cats).toBeUndefined();
  });

  it('a fully reimbursed part STAYS a part (user rule: we keep it splitted)', () => {
    const out = settleContainerParts(
      {
        amountCents: -10_000,
        splits: [
          { id: 'p1', catId: 'food', amountCents: 6_000 },
          { id: 'p2', catId: 'fun', amountCents: 4_000 },
        ],
      },
      new Map([['p2', 4_000]]),
      nameOf,
    );
    expect(out).toHaveLength(2);
    expect(by(out[1].cats!)).toEqual({ reimbursed: 4_000 });
    expect(partNetCents(out[1])).toBe(0);
    expect(partNetCents(out[0])).toBe(6_000);
  });

  it('unlinking frees the part\'s settled value onto uncategorized (the whole-row rule)', () => {
    const settledPartShape = {
      id: 'p1',
      catId: 'food',
      amountCents: 6_000,
      cats: [{ catId: 'food', amountCents: 5_000 }, { catId: 'reimbursed', amountCents: 1_000 }],
    };
    const out = settleContainerParts(
      { amountCents: -10_000, splits: [settledPartShape, { id: 'p2', catId: 'fun', amountCents: 4_000 }] },
      new Map(),
      nameOf,
    );
    // freed value follows the whole-row rule (onto uncategorized)
    expect(by(out[0].cats!)).toEqual({ food: 5_000, uncategorized: 1_000 });
  });

  it('reimbCentsByPart groups by name and lands loose legacy cents on the largest open part', () => {
    const splits = [
      { id: 'p1', catId: 'food', amountCents: 3_000 },
      { id: 'p2', catId: 'fun', amountCents: 7_000 },
    ];
    const map = reimbCentsByPart(
      [
        { txId: 'c1', amountCents: 500, partId: 'p1' },
        { txId: 'c2', amountCents: 800 }, // container-level legacy link
      ],
      'partId',
      splits,
    );
    expect(map.get('p1')).toBe(500);
    expect(map.get('p2')).toBe(800); // largest open part takes the loose cents
    expect(largestOpenPartId(splits, new Map([['p2', 7_000]]))).toBe('p1');
  });

  it('#235 (user order): loose cents land on the expecting part first, then uncategorized, then size', () => {
    // the SMALLEST part expects reimbursement — it still takes the link
    const splits = [
      { id: 'p1', catId: 'fun', amountCents: 7_000 },
      { id: 'p2', catId: 'expenseReimburse', amountCents: 1_500 },
      { id: 'p3', catId: 'uncategorized', amountCents: 1_500 },
    ];
    expect(largestOpenPartId(splits, new Map())).toBe('p2');
    // the expecting part fully settled → uncategorized is next
    expect(largestOpenPartId(splits, new Map([['p2', 1_500]]))).toBe('p3');
    // both consumed → the largest open regular part
    expect(largestOpenPartId(splits, new Map([['p2', 1_500], ['p3', 1_500]]))).toBe('p1');
    // a part whose SPREAD holds a live expected slice counts as expecting
    const spread = [
      { id: 'q1', catId: 'fun', amountCents: 7_000 },
      { id: 'q2', catId: 'food', amountCents: 2_000, cats: [{ catId: 'food', amountCents: 500 }, { catId: 'expenseReimburse', amountCents: 1_500 }] },
    ];
    expect(largestOpenPartId(spread, new Map())).toBe('q2');
  });

  it('reimbSettleFields: whole rows collapse a bare single partition and clear legacy splits', () => {
    const cleared = reimbSettleFields(
      { amountCents: -10_000, catId: 'food', cats: [{ catId: 'food', amountCents: 6_000 }, { catId: 'reimbursed', amountCents: 4_000 }], splits: [{ catId: 'food', amountCents: 6_000 }, { catId: 'reimbursed', amountCents: 4_000 }] },
      0,
      new Map(),
      nameOf,
    );
    // freed onto uncategorized → still a spread, splits gone
    expect(by(cleared.cats!)).toEqual({ food: 6_000, uncategorized: 4_000 });
    expect(cleared.splits).toBeNull();
    // a special claimant collapses all the way back to the bare category
    const special = reimbSettleFields(
      { amountCents: -10_000, catId: 'savingDeposit', cats: [{ catId: 'savingDeposit', amountCents: 6_000 }, { catId: 'reimbursed', amountCents: 4_000 }], splits: undefined },
      0,
      new Map(),
      nameOf,
    );
    expect(special.cats).toBeNull();
    expect(special.catId).toBe('savingDeposit');
  });
});
