import { describe, expect, it } from 'vitest';
import { detectPriceChange, yearlyCents, yearlyDeltaCents } from './recurringPrice';

const charge = (date: string, cents: number) => ({ date, amountCents: -cents });

describe('detectPriceChange', () => {
  it('fires on a sustained increase and reports since when it started', () => {
    const change = detectPriceChange([
      charge('2026-01-05', 1399),
      charge('2026-02-05', 1399),
      charge('2026-03-05', 1599),
      charge('2026-04-05', 1599),
    ]);
    expect(change).toEqual({ fromCents: 1399, toCents: 1599, sinceDate: '2026-03-05' });
  });

  it('a one-off different charge (proration) stays silent', () => {
    expect(
      detectPriceChange([charge('2026-01-05', 1399), charge('2026-02-05', 899), charge('2026-03-05', 1399)]),
    ).toBeNull();
    // the newest charge alone is not sustained either
    expect(
      detectPriceChange([charge('2026-01-05', 1399), charge('2026-02-05', 1399), charge('2026-03-05', 1599)]),
    ).toBeNull();
  });

  it('needs history: constant prices and short histories stay silent', () => {
    expect(detectPriceChange([charge('2026-01-05', 999), charge('2026-02-05', 999), charge('2026-03-05', 999)])).toBeNull();
    expect(detectPriceChange([charge('2026-01-05', 999), charge('2026-02-05', 1099)])).toBeNull();
  });

  it('detects decreases too and ignores credits/order', () => {
    const change = detectPriceChange([
      charge('2026-03-05', 899),
      { date: '2026-02-20', amountCents: 500 }, // a refund is not a charge
      charge('2026-01-05', 1099),
      charge('2026-04-05', 899),
    ]);
    expect(change).toEqual({ fromCents: 1099, toCents: 899, sinceDate: '2026-03-05' });
  });
});

describe('yearly math', () => {
  it('annualizes monthly, yearly and n-weekly cadences', () => {
    expect(yearlyCents({ amountCents: 1000, every: 'month' })).toBe(12000);
    expect(yearlyCents({ amountCents: 12000, every: 'year' })).toBe(12000);
    expect(yearlyCents({ amountCents: 1000, every: 'month', everyN: 3 })).toBe(4000);
    // weekly ≈ 52.14 charges a year
    expect(yearlyCents({ amountCents: 1000, every: 'week' })).toBe(52140);
  });

  it('expresses a change as yearly impact', () => {
    expect(yearlyDeltaCents({ every: 'month' }, { fromCents: 1399, toCents: 1599, sinceDate: 'x' })).toBe(2400);
    expect(yearlyDeltaCents({ every: 'year' }, { fromCents: 10000, toCents: 9000, sinceDate: 'x' })).toBe(-1000);
  });
});
