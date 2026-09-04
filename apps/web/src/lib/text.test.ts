import { describe, expect, it } from 'vitest';
import { cleanBankText, fmtTimeAgo, humanizeBankKeys } from './text';

describe('fmtTimeAgo', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  it('scales from minutes to months, localized', () => {
    expect(fmtTimeAgo('2026-07-15T11:55:00Z', 'en', now)).toBe('5 minutes ago');
    expect(fmtTimeAgo('2026-07-15T09:00:00Z', 'en', now)).toBe('3 hours ago');
    expect(fmtTimeAgo('2026-07-13T12:00:00Z', 'nl', now)).toBe('eergisteren');
    expect(fmtTimeAgo('2026-05-10T12:00:00Z', 'tr', now)).toBe('2 ay önce');
  });
  it('handles garbage and future clock skew gracefully', () => {
    expect(fmtTimeAgo('not-a-date', 'en', now)).toBe('');
    // a slightly-ahead server timestamp must not say "in 2 minutes"
    expect(fmtTimeAgo('2026-07-15T12:02:00Z', 'en', now)).toBe('this minute');
  });
});

describe('cleanBankText', () => {
  it('replaces <br> variants with a separator', () => {
    expect(cleanBankText('Incasso ING creditcard<br>Apple Pay')).toBe('Incasso ING creditcard · Apple Pay');
    expect(cleanBankText('a<BR>b<br/>c<br />d')).toBe('a · b · c · d');
  });

  it('strips other markup and collapses whitespace', () => {
    expect(cleanBankText('<b>Rente</b>   ING  Rood')).toBe('Rente ING Rood');
    expect(cleanBankText('  spaced   out  ')).toBe('spaced out');
  });

  it('keeps innocent text intact (incl. < in amounts)', () => {
    expect(cleanBankText('Albert Heijn 1842')).toBe('Albert Heijn 1842');
    expect(cleanBankText('a < b')).toBe('a < b'); // not a tag
  });

  it('handles empty and missing input', () => {
    expect(cleanBankText('')).toBe('');
    expect(cleanBankText(undefined)).toBe('');
  });
});

describe('humanizeBankKeys', () => {
  it('humanizes snake_case keys, leaves values and free text alone', () => {
    expect(humanizeBankKeys('invoice_number: 475257069427523919')).toBe('Invoice number: 475257069427523919');
    expect(humanizeBankKeys('a · mandate_reference: X1 · creditor_id: NL99ZZZ')).toBe(
      'a · Mandate reference: X1 · Creditor id: NL99ZZZ',
    );
    // plain words with a colon are not keys (no underscore) — untouched
    expect(humanizeBankKeys('PAY PAY >3512 MCC:6012 Apple Pay betaling')).toBe('PAY PAY >3512 MCC:6012 Apple Pay betaling');
  });
});
