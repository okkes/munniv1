import { describe, expect, it } from 'vitest';
import { DEFAULT_FAMILIES, FAMILY_ACCOUNT_TYPE, FAMILY_TX_TYPE, defaultAccountId, defaultFamilyFor, defaultPickFamily } from './defaultAccounts';

describe('#221 default-account domain', () => {
  it('defaultFamilyFor: the ATM pair pins the cash wallet, families pin their pots, standard cats pin nothing', () => {
    expect(defaultFamilyFor('cashWithdraw')).toBe('cash');
    expect(defaultFamilyFor('cashDeposit')).toBe('cash');
    expect(defaultFamilyFor('savingDeposit')).toBe('saving');
    expect(defaultFamilyFor('loanRepayment')).toBe('debtPayment');
    expect(defaultFamilyFor('investBuy')).toBe('investment');
    expect(defaultFamilyFor('transferOut')).toBe('transfer');
    expect(defaultFamilyFor('transferIn')).toBe('transfer');
    expect(defaultFamilyFor('fundingOut')).toBe('funding');
    expect(defaultFamilyFor('groceries')).toBeNull();
    // the adjustment tree is a correction marker, never a counterparty ask
    expect(defaultFamilyFor('balanceAdjustment')).toBeNull();
    expect(defaultFamilyFor(undefined)).toBeNull();
  });

  it('the six families map to their account types and derivation vocabulary', () => {
    expect(DEFAULT_FAMILIES).toHaveLength(6);
    for (const family of DEFAULT_FAMILIES) {
      expect(FAMILY_ACCOUNT_TYPE[family]).toBeTruthy();
      expect(FAMILY_TX_TYPE[family]).toBeTruthy();
    }
    // the cash wallet is the transfer family's ATM half
    expect(FAMILY_ACCOUNT_TYPE.cash).toBe('cash');
    expect(FAMILY_TX_TYPE.cash).toBe('transfer');
    expect(FAMILY_ACCOUNT_TYPE.transfer).toBe('checking');
  });

  it('defaultPickFamily: only the family default keeps the special story', () => {
    expect(defaultPickFamily('saving', defaultAccountId('s1', 'saving'), 's1')).toBe('saving');
    expect(defaultPickFamily('saving', 'someRealAccount', 's1')).toBeNull();
    expect(defaultPickFamily(null, defaultAccountId('s1', 'saving'), 's1')).toBeNull();
  });
});
