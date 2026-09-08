import { describe, expect, it } from 'vitest';
import { COUNTRIES, COUNTRY_CURRENCY, currencyForCountry } from './countries';

describe('countries data integrity (generated file)', () => {
  it('codes are unique two-letter uppercase', () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) expect(c.code).toMatch(/^[A-Z]{2}$/);
  });

  it('every country has all three display names and a currency', () => {
    for (const c of COUNTRIES) {
      expect(c.en, c.code).toBeTruthy();
      expect(c.nl, c.code).toBeTruthy();
      expect(c.tr, c.code).toBeTruthy();
      expect(COUNTRY_CURRENCY[c.code], c.code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('currencyForCountry resolves and falls back to EUR', () => {
    expect(currencyForCountry('NL')).toBe('EUR');
    expect(currencyForCountry('TR')).toBe('TRY');
    expect(currencyForCountry('GB')).toBe('GBP');
    expect(currencyForCountry('ZZ')).toBe('EUR');
  });
});
