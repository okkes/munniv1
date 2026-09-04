import { describe, expect, it } from 'vitest';
import { looksLikeDebtCreditor } from './detectDebts';

describe('#192: known-lender matching', () => {
  it('recognizes DUO in its bank-feed spellings', () => {
    expect(looksLikeDebtCreditor('DUO')).toBe(true);
    expect(looksLikeDebtCreditor('duo (hoofdrekening)')).toBe(true);
    expect(looksLikeDebtCreditor('Dienst Uitvoering Onderwijs')).toBe(true);
  });

  it('never mistakes lookalikes for student debt', () => {
    expect(looksLikeDebtCreditor('Duolingo')).toBe(false);
    expect(looksLikeDebtCreditor('Albert Heijn')).toBe(false);
  });
});
