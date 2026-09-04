import { describe, expect, it } from 'vitest';
import {
  ALL_TX_TYPES,
  accountStamp,
  allowedSpecialCats,
  applyTypeChange,
  categoryConflictsWithType,
  counterTypesFor,
  counterTypesForFamily,
  familyForCounter,
  movementCatFor,
  movementCatsForCounter,
  typeForLinkedAccount,
} from './txType';
import type { AccountType, TxType } from '@/db/types';

describe('typeForLinkedAccount (R2 inversion, 2026-08-05)', () => {
  // ANY tracked counterparty makes the source leg a plain transfer —
  // the special meaning lives on the counter account's own ledger now
  const cases: AccountType[] = ['savings', 'credit', 'mortgage', 'loan', 'brokerage', 'checking', 'cash'];
  it.each(cases)('%s account -> transfer', (accountType) => {
    expect(typeForLinkedAccount(accountType)).toBe('transfer');
  });
});

describe('accountStamp (R1)', () => {
  const cases: [AccountType, TxType | undefined][] = [
    ['savings', 'saving'],
    ['mortgage', 'debtPayment'],
    ['loan', 'debtPayment'],
    ['brokerage', 'investment'],
    // credit deliberately unstamped: its feed rows are purchases
    ['credit', undefined],
    ['checking', undefined],
    ['cash', undefined],
  ];
  it.each(cases)('%s account -> %s', (accountType, expected) => {
    expect(accountStamp(accountType)).toBe(expected);
  });
  it('no account, no stamp', () => {
    expect(accountStamp(undefined)).toBeUndefined();
  });
});

describe('#133 r5 — the bijection: category ⟺ counter kind ⟺ sign', () => {
  describe('familyForCounter', () => {
    const cases: [AccountType, TxType][] = [
      ['savings', 'saving'],
      ['loan', 'debtPayment'],
      ['mortgage', 'debtPayment'],
      ['brokerage', 'investment'],
      ['funding', 'funding'],
      ['checking', 'transfer'],
      ['cash', 'transfer'],
      ['credit', 'transfer'],
    ];
    it.each(cases)('%s counter -> %s', (accountType, family) => {
      expect(familyForCounter(accountType)).toBe(family);
    });
  });

  describe('movementCatFor — the write side', () => {
    const out: [AccountType, string][] = [
      ['savings', 'savingDeposit'],
      ['loan', 'loanRepayment'],
      ['mortgage', 'loanRepayment'],
      // #252: the movement pair — Bought/Sold are brokerage-internal now
      ['brokerage', 'investContribution'],
      ['funding', 'fundingOut'],
      ['checking', 'transferOut'],
      ['credit', 'transferOut'],
      ['cash', 'cashWithdraw'],
    ];
    it.each(out)('money out to a %s account files %s', (accountType, catId) => {
      expect(movementCatFor(accountType, -1200)).toBe(catId);
    });
    const inn: [AccountType, string][] = [
      ['savings', 'savingWithdraw'],
      ['loan', 'debtBorrowed'],
      ['brokerage', 'investWithdraw'],
      ['funding', 'fundingIn'],
      ['checking', 'transferIn'],
      ['cash', 'cashDeposit'],
    ];
    it.each(inn)('money in from a %s account files %s', (accountType, catId) => {
      expect(movementCatFor(accountType, 1200)).toBe(catId);
    });
  });

  describe('allowedSpecialCats — what the picker may offer', () => {
    it('a regular account offers exactly ONE sub per family and side (#252: the movement pair, never Bought/Sold)', () => {
      expect([...allowedSpecialCats('checking', 'debit')].sort()).toEqual(
        ['cashWithdraw', 'fundingOut', 'investContribution', 'loanRepayment', 'savingDeposit', 'transferOut'].sort(),
      );
      expect([...allowedSpecialCats('checking', 'credit')].sort()).toEqual(
        ['cashDeposit', 'fundingIn', 'investWithdraw', 'debtBorrowed', 'savingWithdraw', 'transferIn'].sort(),
      );
    });
    it('Take out, Interest, Fees and the broker-internal picks never appear on a regular row (#252 user ss)', () => {
      const debit = allowedSpecialCats('checking', 'debit');
      for (const hidden of ['savingWithdraw', 'savingInterest', 'savingFees', 'debtInterest', 'debtFees', 'investDividend', 'investFees', 'investBuy', 'investSell']) {
        expect(debit.has(hidden)).toBe(false);
      }
    });
    it('the savings ledger runs sign-inverted: money in = Set aside or Interest', () => {
      expect([...allowedSpecialCats('savings', 'credit')].sort()).toEqual(['savingDeposit', 'savingInterest']);
      expect([...allowedSpecialCats('savings', 'debit')].sort()).toEqual(['savingFees', 'savingWithdraw']);
    });
    it('the loan ledger: + is the repayment arriving, − grows the debt', () => {
      expect([...allowedSpecialCats('loan', 'credit')]).toEqual(['loanRepayment']);
      expect([...allowedSpecialCats('loan', 'debit')].sort()).toEqual(['debtBorrowed', 'debtFees', 'debtInterest']);
    });
    it('the brokerage ledger (#252): Invested/Sold/Dividends land, Withdrawn/Bought/Fees drain', () => {
      expect([...allowedSpecialCats('brokerage', 'credit')].sort()).toEqual(['investContribution', 'investDividend', 'investSell']);
      expect([...allowedSpecialCats('brokerage', 'debit')].sort()).toEqual(['investBuy', 'investFees', 'investWithdraw']);
    });
    it('the generic Invest sub is in NO cell — hidden wherever context filters', () => {
      for (const type of ['checking', 'savings', 'brokerage'] as AccountType[]) {
        expect(allowedSpecialCats(type, 'debit').has('invest')).toBe(false);
        expect(allowedSpecialCats(type, 'credit').has('invest')).toBe(false);
      }
    });
  });

  describe('counterTypesFor — which accounts an ask may list', () => {
    it('Set aside points only at savings accounts', () => {
      expect(counterTypesFor('savingDeposit')).toEqual(['savings']);
      expect(counterTypesFor('savingWithdraw')).toEqual(['savings']);
    });
    it('the debt movements point at loan-backing accounts — credit cards included (#218)', () => {
      expect(counterTypesFor('loanRepayment')).toEqual(['loan', 'mortgage', 'credit']);
    });
    it('#218: a credit counter can mean TWO things — transfer or debt payment', () => {
      expect([...movementCatsForCounter('credit', 'debit')].sort()).toEqual(['loanRepayment', 'transferOut']);
      expect([...movementCatsForCounter('credit', 'credit')].sort()).toEqual(['debtBorrowed', 'transferIn']);
      // single-meaning counters narrow to exactly one category
      expect([...movementCatsForCounter('savings', 'debit')]).toEqual(['savingDeposit']);
      expect([...movementCatsForCounter('cash', 'debit')].sort()).toEqual(['cashWithdraw', 'transferOut']);
    });
    it('plain Transfer lists REGULAR accounts only — the special kinds ARE the family categories (user rule)', () => {
      expect(counterTypesFor('transferOut')).toEqual(['checking', 'cash', 'credit']);
      expect(counterTypesFor('transferIn')).toEqual(['checking', 'cash', 'credit']);
    });
    it('the ATM pair points at cash wallets; funding at funding attachments', () => {
      expect(counterTypesFor('cashWithdraw')).toEqual(['cash']);
      expect(counterTypesFor('fundingOut')).toEqual(['funding']);
    });
    it('a plain category asks nothing', () => {
      expect(counterTypesFor('groceries')).toBeUndefined();
    });
    it('the family read agrees with the per-category read', () => {
      expect(counterTypesForFamily('saving')).toEqual(counterTypesFor('savingDeposit'));
      expect(counterTypesForFamily('investment')).toEqual(counterTypesFor('investBuy'));
    });
  });
});

describe('categoryConflictsWithType', () => {
  it('flags a category that does not support the type', () => {
    expect(categoryConflictsWithType(['expense'], 'saving')).toBe(true);
    expect(categoryConflictsWithType(['expense'], 'expense')).toBe(false);
    expect(categoryConflictsWithType(['saving'], 'saving')).toBe(false);
  });
  it('multi-type and typeless categories never conflict with a matching type', () => {
    expect(categoryConflictsWithType(['income', 'expense'], 'expense')).toBe(false);
    expect(categoryConflictsWithType([], 'transfer')).toBe(false); // universal fallback
  });
});

describe('applyTypeChange', () => {
  it('keeps a compatible category', () => {
    const fields = applyTypeChange({
      nextType: 'expense',
      linkedAccountId: null,
      currentCatId: 'groceries',
      catTxTypes: ['expense'],
    });
    expect(fields).toEqual({ txType: 'expense', linkedAccountId: undefined });
  });

  it('resets a conflicting category to uncategorized and flags review', () => {
    const fields = applyTypeChange({
      nextType: 'transfer',
      linkedAccountId: 'acc-2',
      currentCatId: 'groceries',
      catTxTypes: ['expense'],
    });
    expect(fields).toEqual({
      txType: 'transfer',
      linkedAccountId: 'acc-2',
      catId: 'uncategorized',
      needsReview: 1,
    });
  });

  it('covers every type in the catalog list', () => {
    expect(ALL_TX_TYPES).toHaveLength(8); // + funding (2026-08-01)
    for (const type of ALL_TX_TYPES) {
      expect(applyTypeChange({ nextType: type, linkedAccountId: null, currentCatId: undefined, catTxTypes: [] }).txType).toBe(type);
    }
  });

  describe('the locked family sub at the write edge (arc 2)', () => {
    it('a conflicting category files the sign-picked sub instead of review', () => {
      const fields = applyTypeChange({
        nextType: 'transfer',
        linkedAccountId: 'acc-2',
        currentCatId: 'groceries',
        catTxTypes: ['expense'],
        amountCents: -5000,
      });
      expect(fields).toEqual({ txType: 'transfer', linkedAccountId: 'acc-2', catId: 'transferOut' });
    });

    it('a placeholder category files too — both signs', () => {
      const bare = { linkedAccountId: null, catTxTypes: [] as TxType[] };
      expect(applyTypeChange({ ...bare, nextType: 'saving', currentCatId: undefined, amountCents: -100 }).catId).toBe('savingDeposit');
      expect(applyTypeChange({ ...bare, nextType: 'saving', currentCatId: 'uncategorized', amountCents: 100 }).catId).toBe('savingWithdraw');
      expect(applyTypeChange({ ...bare, nextType: 'debtPayment', currentCatId: undefined, amountCents: -100 }).catId).toBe('loanRepayment');
    });

    it('a deliberate compatible category survives; standard types never file', () => {
      const kept = applyTypeChange({
        nextType: 'saving',
        linkedAccountId: 'acc-2',
        currentCatId: 'savingWithdraw',
        catTxTypes: ['saving'],
        amountCents: -100,
      });
      expect(kept.catId).toBeUndefined();
      const standard = applyTypeChange({
        nextType: 'expense',
        linkedAccountId: null,
        currentCatId: undefined,
        catTxTypes: [],
        amountCents: -100,
      });
      expect(standard.catId).toBeUndefined();
    });

    it('without the sign the old review fallback stands', () => {
      const fields = applyTypeChange({
        nextType: 'transfer',
        linkedAccountId: 'acc-2',
        currentCatId: 'groceries',
        catTxTypes: ['expense'],
      });
      expect(fields.catId).toBe('uncategorized');
      expect(fields.needsReview).toBe(1);
    });
  });
});
