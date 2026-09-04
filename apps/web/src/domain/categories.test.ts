import { describe, expect, it } from 'vitest';
import { BUILTIN_CATEGORIES, CATEGORY_BY_ID, UNCATEGORIZED_ID, childrenOf, isSpecialCategory } from './categories';
import { en } from '@/i18n/en';

describe('built-in catalog integrity (generated file)', () => {
  it('ids are unique', () => {
    expect(new Set(BUILTIN_CATEGORIES.map((c) => c.id)).size).toBe(BUILTIN_CATEGORIES.length);
  });

  it('every parentId points at an existing parent category', () => {
    for (const cat of BUILTIN_CATEGORIES) {
      if (!cat.parentId) continue;
      const parent = CATEGORY_BY_ID.get(cat.parentId);
      expect(parent, `${cat.id} -> ${cat.parentId}`).toBeTruthy();
      expect(parent!.isParent).toBe(true);
    }
  });

  it('every nameKey has an English translation', () => {
    for (const cat of BUILTIN_CATEGORIES) {
      expect(en[cat.nameKey as keyof typeof en], cat.nameKey).toBeTruthy();
    }
  });

  it('every category has an icon and at least one txType', () => {
    for (const cat of BUILTIN_CATEGORIES) {
      expect(cat.icon, cat.id).toBeTruthy();
      expect(cat.txTypes.length, cat.id).toBeGreaterThan(0);
      expect(['credit', 'debit', 'both']).toContain(cat.direction);
    }
  });

  it('the uncategorized fallback exists and is hidden', () => {
    const fallback = CATEGORY_BY_ID.get(UNCATEGORIZED_ID);
    expect(fallback).toBeTruthy();
    expect(fallback!.hidden).toBe(true);
  });

  it('childrenOf returns only visible children of that parent', () => {
    const kids = childrenOf('consumption');
    expect(kids.length).toBeGreaterThan(5);
    expect(kids.every((c) => c.parentId === 'consumption' && !c.hidden)).toBe(true);
  });

  it('visible parents all have children (no orphan groups)', () => {
    for (const parent of BUILTIN_CATEGORIES.filter((c) => c.isParent && !c.hidden)) {
      expect(childrenOf(parent.id).length, parent.id).toBeGreaterThan(0);
    }
  });
});

describe('typed-splits v2 special families (approved table 2026-08-05)', () => {
  const sub = (id: string) => CATEGORY_BY_ID.get(id)!;

  it('saving grew Interest (+) and Fees (−) beside the movement pair', () => {
    expect(sub('savingInterest')).toMatchObject({ parentId: 'saving', direction: 'credit', txTypes: ['saving'] });
    expect(sub('savingFees')).toMatchObject({ parentId: 'saving', direction: 'debit', txTypes: ['saving'] });
  });

  it('debt grew Interest and Fees, both on the growing (−) side', () => {
    expect(sub('debtInterest')).toMatchObject({ parentId: 'debt', direction: 'debit', txTypes: ['debtPayment'] });
    expect(sub('debtFees')).toMatchObject({ parentId: 'debt', direction: 'debit', txTypes: ['debtPayment'] });
  });

  it('investment grew Withdrawn (both legs), Dividends (+) and Fees (−)', () => {
    expect(sub('investWithdraw')).toMatchObject({ parentId: 'investment', direction: 'both', txTypes: ['investment'] });
    expect(sub('investDividend')).toMatchObject({ parentId: 'investment', direction: 'credit', txTypes: ['investment'] });
    expect(sub('investFees')).toMatchObject({ parentId: 'investment', direction: 'debit', txTypes: ['investment'] });
  });

  it('isSpecialCategory = the locked family trees, nothing else', () => {
    // #261: balanceAdjustment joined the locked trees — Adjustment is
    // system bookkeeping (balance edits mint it, nobody subs under it)
    for (const id of ['savingDeposit', 'savingInterest', 'transferOut', 'loanRepayment', 'debtFees', 'investDividend', 'fundingIn', 'reimburse', 'balanceAdjustment']) {
      expect(isSpecialCategory(sub(id)), id).toBe(true);
    }
    expect(isSpecialCategory(sub('saving'))).toBe(true); // the locked main itself
    for (const id of ['groceries', 'salary', 'interest']) {
      expect(isSpecialCategory(sub(id)), id).toBe(false);
    }
    // custom categories can never join (locked mains refuse user subs)
    expect(isSpecialCategory({ id: 'custom1', parentId: 'custom_main' })).toBe(false);
  });
});
