import { describe, expect, it } from 'vitest';
import { matchCounterAccount } from './counterClue';
import type { ClueAccount, ClueTx } from './counterClue';

/** #228 r3: the transfer clue-reader — a predicted transfer must point
 *  at a real tracked account or stand down to uncategorized. */

const paypalRow: ClueTx = {
  // the user's exact report: a PayPal incasso predicted "Transfer Out"
  // while the PayPal account sat unmatched in the picker
  merchant: 'PayPal Europe S.a.r.l. et Cie S.C.A',
  description:
    'Incasso · Naam: PayPal Europe S.a.r.l. et Cie S.C.A Omschrijving: 1051635911097/PAYPAL IBAN: LU89751000135104200E Kenmerk: 1051635911097',
  counterIban: 'LU89751000135104200E',
};

const account = (over: Partial<ClueAccount> & Pick<ClueAccount, 'id' | 'name'>): ClueAccount => ({
  type: 'checking',
  ...over,
});

describe('matchCounterAccount', () => {
  it('finds the PayPal account from the funding row (name token + brand signal)', () => {
    const accounts = [
      account({ id: 'a-bank', name: 'Bank · 9507', iban: 'NL02INGB0009999507' }),
      account({ id: 'a-paypal', name: 'PayPal o.doker@live.nl' }),
    ];
    expect(matchCounterAccount(paypalRow, accounts, 'a-bank')?.id).toBe('a-paypal');
  });

  it('the PayPal collection IBAN alone is enough — the brand signal reads accounts by bankId too', () => {
    const bare: ClueTx = { merchant: 'Incasso 1051635911097', counterIban: 'LU89751000135104200E' };
    const accounts = [account({ id: 'a-wallet', name: 'Wallet', bankId: 'PAYPAL_PPLXLULL' })];
    expect(matchCounterAccount(bare, accounts)?.id).toBe('a-wallet');
  });

  it('an exact counter-IBAN equality beats every name clue', () => {
    const tx: ClueTx = { merchant: 'J. Doe', counterIban: 'NL91ABNA0417164300' };
    const accounts = [
      account({ id: 'a-paypal', name: 'PayPal spending' }),
      account({ id: 'a-save', name: 'Vakantiepot', iban: 'nl91 abna 0417 1643 00' }),
    ];
    expect(matchCounterAccount(tx, accounts)?.id).toBe('a-save');
  });

  it('generic banking words and email hosts never identify an account', () => {
    const tx: ClueTx = { merchant: 'Overboeking savings via live.nl', description: 'naar spaarrekening' };
    const accounts = [
      account({ id: 'a-save', name: 'Savings account' }),
      account({ id: 'a-mail', name: 'Rekening o.doker@live.nl' }),
    ];
    expect(matchCounterAccount(tx, accounts)).toBeUndefined();
  });

  it('defaults, archived rows and the row own account never match', () => {
    const tx: ClueTx = { merchant: 'Naar Vakantiepot' };
    const accounts = [
      account({ id: 'a-default', name: 'Vakantiepot', defaultFor: 'transfer' }),
      account({ id: 'a-archived', name: 'Vakantiepot oud', archived: 1 }),
      account({ id: 'a-self', name: 'Vakantiepot' }),
    ];
    expect(matchCounterAccount(tx, accounts, 'a-self')).toBeUndefined();
  });

  it('short and letterless tokens carry no signal', () => {
    const tx: ClueTx = { merchant: 'Kenmerk 9507', description: 'ref 9507 ING' };
    const accounts = [account({ id: 'a-bank', name: 'ING 9507' })];
    expect(matchCounterAccount(tx, accounts)).toBeUndefined();
  });

  it('the longest matched token wins; equal strength falls to the lowest id (deterministic)', () => {
    const tx: ClueTx = { merchant: 'Overboeking naar Vakantiepot Brazilie' };
    const longer = matchCounterAccount(tx, [
      account({ id: 'a-1', name: 'Vakantiepot' }),
      account({ id: 'a-2', name: 'Brazilie vakantiepot spaardoel' }),
    ]);
    expect(longer?.id).toBe('a-1'); // both carry 'vakantiepot' (11) — the tie breaks by id
    const tie = matchCounterAccount(tx, [
      account({ id: 'b-2', name: 'Vakantiepot twee' }),
      account({ id: 'b-1', name: 'Vakantiepot een' }),
    ]);
    expect(tie?.id).toBe('b-1');
  });

  it('no clue at all → undefined (the caller stands down to uncategorized)', () => {
    const tx: ClueTx = { merchant: 'Albert Heijn 1403', description: 'Betaalautomaat' };
    expect(matchCounterAccount(tx, [account({ id: 'a-paypal', name: 'PayPal o.doker@live.nl' })])).toBeUndefined();
  });

  it('the user rename counts as a clue too', () => {
    const tx: ClueTx = { merchant: 'SEPA 2210', titleOverride: 'Naar Vakantiepot' };
    expect(matchCounterAccount(tx, [account({ id: 'a-save', name: 'Vakantiepot' })])?.id).toBe('a-save');
  });
});
