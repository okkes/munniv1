import { describe, expect, it } from 'vitest';
import { evalAmountCents } from './money';

describe('evalAmountCents (little arithmetic in amount fields)', () => {
  it('evaluates + − * / with precedence and parentheses', () => {
    expect(evalAmountCents('3*250+100')).toBe(85_000);
    expect(evalAmountCents('(100-25)/2')).toBe(3_750);
    expect(evalAmountCents('100-3*10')).toBe(7_000);
    expect(evalAmountCents('-50+20')).toBe(-3_000);
  });

  it('keeps the EU comma rule: with a comma, dots are thousand separators', () => {
    expect(evalAmountCents('1.250,50+100')).toBe(135_050);
    expect(evalAmountCents('12.5*2')).toBe(2_500);
  });

  it('refuses garbage, unbalanced parens and division by zero', () => {
    expect(evalAmountCents('abc')).toBeNull();
    expect(evalAmountCents('1+(2')).toBeNull();
    expect(evalAmountCents('10/0')).toBeNull();
    expect(evalAmountCents('')).toBeNull();
    expect(evalAmountCents('1+2)')).toBeNull();
  });
});
import { fmtCents, parseCents } from './money';

describe('parseCents (user input -> integer cents)', () => {
  it('parses EU format (comma decimal, dot thousands)', () => {
    expect(parseCents('12,50')).toBe(1250);
    expect(parseCents('1.234,56')).toBe(123456);
    expect(parseCents('0,01')).toBe(1);
    expect(parseCents('1.000.000,00')).toBe(100000000);
  });

  it('parses plain and dot-decimal input', () => {
    expect(parseCents('12.50')).toBe(1250);
    expect(parseCents('1234')).toBe(123400);
    expect(parseCents('0')).toBe(0);
  });

  it('trims whitespace and rejects garbage', () => {
    expect(parseCents(' 12,50 ')).toBe(1250);
    expect(parseCents('')).toBeNull();
    expect(parseCents('abc')).toBeNull();
    expect(parseCents('12,5x')).toBeNull();
    expect(parseCents('1,2,3')).toBeNull();
  });

  it('never produces fractional cents', () => {
    expect(parseCents('0,005')).toBe(1); // rounds, stays integer
    expect(Number.isInteger(parseCents('123,456')!)).toBe(true);
  });
});

describe('fmtCents (integer cents -> localized string)', () => {
  it('formats per language locale', () => {
    expect(fmtCents(123456, 'EUR', 'en')).toBe('€1,234.56');
    expect(fmtCents(123456, 'EUR', 'nl')).toBe('€ 1.234,56');
    expect(fmtCents(-2899, 'EUR', 'en')).toBe('-€28.99');
  });

  it('adds an explicit plus sign only when asked and positive', () => {
    expect(fmtCents(2000, 'EUR', 'en', { sign: true })).toBe('+€20.00');
    expect(fmtCents(-2000, 'EUR', 'en', { sign: true })).toBe('-€20.00');
    expect(fmtCents(0, 'EUR', 'en', { sign: true })).toBe('€0.00');
    expect(fmtCents(2000, 'EUR', 'en')).toBe('€20.00');
  });

  it('handles non-euro currencies', () => {
    expect(fmtCents(123456, 'TRY', 'tr')).toContain('1.234,56');
    expect(fmtCents(100, 'GBP', 'en')).toBe('£1.00');
  });
});
