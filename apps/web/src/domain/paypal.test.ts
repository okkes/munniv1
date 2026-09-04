import { describe, expect, it } from 'vitest';
import { isPaypalAccount, isPaypalFunding, matchPaypalPairs } from './paypal';

const tx = (id: string, date: string, amountCents: number, merchant: string, description?: string) => ({
  id,
  date,
  amountCents,
  merchant,
  description,
});

describe('PayPal detection (PP1)', () => {
  it('recognizes funding debits by creditor name or the shared collection IBAN', () => {
    expect(isPaypalFunding({ merchant: 'PayPal (Europe) S.a.r.l. et Cie, S.C.A.' })).toBe(true);
    expect(isPaypalFunding({ merchant: 'PAY PAL EUROPE' })).toBe(true);
    expect(isPaypalFunding({ merchant: 'Onbekend', counterIban: 'LU89 7510 0013 5104 200E' })).toBe(true);
    expect(isPaypalFunding({ merchant: 'Albert Heijn' })).toBe(false);
    // "paypal" inside another word never matches (word boundary)
    expect(isPaypalFunding({ merchant: 'paypallet bv' })).toBe(false);
  });

  it('recognizes the PayPal feed account by name or institution id', () => {
    expect(isPaypalAccount({ name: 'PayPal' })).toBe(true);
    expect(isPaypalAccount({ name: 'Bank · 9507', bankId: 'PAYPAL_PPLXLULL' })).toBe(true);
    expect(isPaypalAccount({ name: 'Bank · 9507', bankId: 'ING_NL' })).toBe(false);
  });
});

describe('PayPal pair matching (PP1)', () => {
  it('pairs same amount within the window, nearest date first', () => {
    const pairs = matchPaypalPairs(
      [tx('b1', '2026-07-14', -2599, 'PayPal Europe', 'PP.1234 Steam Purchase')],
      [tx('p1', '2026-07-16', -2599, 'Steam'), tx('p2', '2026-07-10', -2599, 'Steam')],
    );
    expect(pairs.get('b1')).toBe('p1'); // 2 days beats 4 (p2 is outside anyway)
  });

  it('breaks same-amount ties only with a merchant token from the remittance', () => {
    const tied = [tx('p1', '2026-07-14', -999, 'Spotify'), tx('p2', '2026-07-14', -999, 'Netflix')];
    // remittance names netflix -> deterministic
    expect(
      matchPaypalPairs([tx('b1', '2026-07-14', -999, 'PayPal Europe', 'PP.5678 NETFLIX payment')], tied).get('b1'),
    ).toBe('p2');
    // no token -> ambiguous -> stays review-gated
    expect(matchPaypalPairs([tx('b1', '2026-07-14', -999, 'PayPal Europe', 'PP.5678')], tied).size).toBe(0);
  });

  it('never pairs one PayPal transaction twice and respects the window', () => {
    const pairs = matchPaypalPairs(
      [
        tx('b1', '2026-07-14', -500, 'PayPal Europe', 'PP.1 bol'),
        tx('b2', '2026-07-14', -500, 'PayPal Europe', 'PP.2 bol'),
        tx('b3', '2026-07-01', -500, 'PayPal Europe', 'PP.3 bol'),
      ],
      [tx('p1', '2026-07-15', -500, 'bol.com')],
    );
    expect([...pairs.values()]).toEqual(['p1']); // exactly one bank debit claimed it
    expect(pairs.has('b3')).toBe(false); // 14 days out of window
  });
});
