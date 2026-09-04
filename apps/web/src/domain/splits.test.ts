import { describe, expect, it } from 'vitest';
import { balanceLastRow, pctRemainder, primaryCatId, resolveSplitsFor, splitRemainderCents, splitsArePct, splitsTotalCents, validatePctSplits, validateSplits } from './splits';

const split = (catId: string, amountCents: number) => ({ catId, amountCents });
const pct = (catId: string, value: number) => ({ catId, amountCents: 0, pct: value });

describe('split math', () => {
  it('totals and remainder (works for negative expense amounts)', () => {
    expect(splitsTotalCents([])).toBe(0);
    expect(splitsTotalCents([split('a', 300), split('b', 700)])).toBe(1000);
    expect(splitRemainderCents(-1000, [split('a', 300)])).toBe(700);
    expect(splitRemainderCents(-1000, [split('a', 300), split('b', 900)])).toBe(-200); // over-assigned
    expect(splitRemainderCents(1000, [split('a', 1000)])).toBe(0); // income splits too
  });

  it('validates: needs 2+, positive, unique categories, exact balance', () => {
    expect(validateSplits(-1000, [split('a', 1000)])).toBe('tooFew');
    expect(validateSplits(-1000, [split('a', 1000), split('b', 0)])).toBe('emptyAmount');
    expect(validateSplits(-1000, [split('a', 500), split('a', 500)])).toBe('duplicateCategory');
    expect(validateSplits(-1000, [split('a', 500), split('b', 400)])).toBe('notBalanced');
    expect(validateSplits(-1000, [split('a', 500), split('b', 501)])).toBe('notBalanced');
    expect(validateSplits(-1000, [split('a', 500), split('b', 500)])).toBeNull();
    expect(validateSplits(-1000, [split('a', 1), split('b', 1), split('c', 998)])).toBeNull();
  });

  it('primary category is the largest slice', () => {
    expect(primaryCatId([])).toBeUndefined();
    expect(primaryCatId([split('small', 100), split('big', 900)])).toBe('big');
  });

  it('balanceLastRow fills exactly the open remainder, floored at zero', () => {
    expect(balanceLastRow(-1000, [split('a', 300), split('b', 0)])).toEqual([split('a', 300), split('b', 700)]);
    expect(balanceLastRow(-1000, [split('a', 1200), split('b', 500)])).toEqual([split('a', 1200), split('b', 0)]);
    expect(balanceLastRow(-1000, [])).toEqual([]);
    // a balanced result validates
    const balanced = balanceLastRow(-1000, [split('a', 250), split('b', 1)]);
    expect(validateSplits(-1000, balanced)).toBeNull();
  });
});

describe('percentage splits', () => {
  it('detects pct mode only when every slice carries one', () => {
    expect(splitsArePct([pct('a', 60), pct('b', 40)])).toBe(true);
    expect(splitsArePct([pct('a', 60), split('b', 400)])).toBe(false);
    expect(splitsArePct([])).toBe(false);
    expect(splitsArePct(undefined)).toBe(false);
  });

  it('materializes exactly against any amount, remainder to the big slices', () => {
    const resolved = resolveSplitsFor(-1001, [pct('a', 50), pct('b', 50)]);
    expect(resolved.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1001);
    expect(Math.max(...resolved.map((s) => s.amountCents))).toBe(501);
    // thirds never lose a cent either
    const thirds = resolveSplitsFor(-1000, [pct('a', 34), pct('b', 33), pct('c', 33)]);
    expect(thirds.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1000);
    // absolute splits pass through untouched
    expect(resolveSplitsFor(-1000, [split('a', 400), split('b', 600)])).toEqual([split('a', 400), split('b', 600)]);
  });

  it('validates pct: 2+, positive, unique, exactly 100', () => {
    expect(validatePctSplits([pct('a', 100)])).toBe('tooFew');
    expect(validatePctSplits([pct('a', 100), pct('b', 0)])).toBe('emptyAmount');
    expect(validatePctSplits([pct('a', 50), pct('a', 50)])).toBe('duplicateCategory');
    expect(validatePctSplits([pct('a', 50), pct('b', 40)])).toBe('notBalanced');
    expect(validatePctSplits([pct('a', 60), pct('b', 40)])).toBeNull();
    expect(pctRemainder([pct('a', 60), pct('b', 15)])).toBe(25);
  });
});
