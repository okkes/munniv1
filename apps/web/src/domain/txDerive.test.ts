import { describe, expect, it } from 'vitest';
import { deriveTxType } from './txDerive';

describe('deriveTxType — the compat txType, computed instead of asked (#133)', () => {
  it('walks the order of truth: adjustment > stamp > vessel > default counter > transfer > ◆ category > sign', () => {
    // manual corrections stay corrections
    expect(deriveTxType({ amountCents: -100, adjustment: true, catId: 'savingDeposit' })).toBe('adjustment');
    // a special account types every one of its rows — link or not
    expect(deriveTxType({ amountCents: -100, stamp: 'saving', linkedAccountId: 'x', catId: 'groceries' })).toBe('saving');
    // a split CONTAINER is a vessel: sign only, whatever its shadow category says
    expect(deriveTxType({ amountCents: -100, multiPart: true, catId: 'savingDeposit' })).toBe('expense');
    expect(deriveTxType({ amountCents: 200, multiPart: true })).toBe('income');
    // the counterparty rule: a DEFAULT pot keeps the row wearing its ◆
    // category; any other counter account makes it a transfer
    expect(
      deriveTxType({ amountCents: -100, linkedAccountId: 'd1', counterDefaultFor: 'saving', catId: 'savingDeposit' }),
    ).toBe('saving');
    expect(deriveTxType({ amountCents: -100, linkedAccountId: 'acc9', catId: 'savingDeposit' })).toBe('transfer');
    // bare ◆ categories pull their family (R3), everything else signs
    expect(deriveTxType({ amountCents: -100, catId: 'savingDeposit' })).toBe('saving');
    expect(deriveTxType({ amountCents: -100, catId: 'loanRepayment' })).toBe('debtPayment');
    expect(deriveTxType({ amountCents: -100, catId: 'investBuy' })).toBe('investment');
    expect(deriveTxType({ amountCents: -100, catId: 'groceries' })).toBe('expense');
    expect(deriveTxType({ amountCents: 100, catId: 'salary' })).toBe('income');
    expect(deriveTxType({ amountCents: 100 })).toBe('income');
  });
});

describe('deriveTxType — funding counterparty (#152)', () => {
  it('a funding pot beats the generic transfer, loses to a default family', () => {
    expect(deriveTxType({ amountCents: -100, linkedAccountId: 'pot', counterFunding: true })).toBe('funding');
    expect(
      deriveTxType({ amountCents: -100, linkedAccountId: 'pot', counterFunding: true, counterDefaultFor: 'saving' }),
    ).toBe('saving');
    expect(deriveTxType({ amountCents: -100, linkedAccountId: 'pot', counterFunding: false })).toBe('transfer');
  });
});
