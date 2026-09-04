import { describe, expect, it } from 'vitest';
import { draftReady, initDraft, withCategory, withLinkedAccount, withSplits, withType } from './reviewDraft';
import type { DraftCatalog } from './reviewDraft';
import type { TxType } from '@/db/types';

// tiny catalog: groceries speaks expense, savingDeposit speaks saving,
// refund speaks income, anything unknown speaks everything (like Other)
const TYPES: Record<string, TxType[]> = {
  groceries: ['expense'],
  entertainment: ['expense'],
  savingDeposit: ['saving'],
  loanRepayment: ['debtPayment'],
  refund: ['income'],
};
const catalog: DraftCatalog = { byId: (id) => ({ txTypes: TYPES[id ?? ''] ?? [] }) };

const expenseTx = { txType: 'expense' as TxType, amountCents: -1000 };

describe('reviewDraft', () => {
  it('initializes from the tx, falling back to the prediction', () => {
    expect(initDraft(expenseTx, 'groceries', catalog)).toMatchObject({ catId: 'groceries', txType: 'expense' });
    expect(initDraft({ ...expenseTx, catId: 'entertainment' }, 'groceries', catalog).catId).toBe('entertainment');
    expect(initDraft({ ...expenseTx, catId: 'uncategorized' }, 'groceries', catalog).catId).toBe('groceries');
    expect(draftReady(initDraft(expenseTx, undefined, catalog))).toBe(false);
  });

  it('Uncategorized never confirms — except as the transfer placeholder (user rule)', () => {
    const uncategorized = { ...initDraft(expenseTx, undefined, catalog), catId: 'uncategorized' };
    expect(draftReady(uncategorized)).toBe(false);
    // transfers carry no spending category, but R2 makes the tracked
    // counterparty mandatory — the placeholder confirms only linked
    expect(draftReady({ ...uncategorized, txType: 'transfer' as TxType })).toBe(false);
    expect(draftReady({ ...uncategorized, txType: 'transfer' as TxType, linkedAccountId: 'a-save' })).toBe(true);
    // #221: a bare MOVEMENT category is one tap from done — Confirm
    // links the space's default in the same write
    expect(draftReady({ ...uncategorized, catId: 'cashWithdraw', txType: 'transfer' as TxType })).toBe(true);
    // #228 r3 (user rule): the TRANSFER family lost that fallback — a
    // bare transfer never confirms; it needs a real counterparty
    expect(draftReady({ ...uncategorized, catId: 'transferOut', txType: 'transfer' as TxType })).toBe(false);
    expect(draftReady({ ...uncategorized, catId: 'transferOut', txType: 'transfer' as TxType, linkedAccountId: 'a-chk' })).toBe(true);
    // a split with an uncategorized slice blocks too
    const withUncatSlice = {
      ...initDraft(expenseTx, 'groceries', catalog),
      splits: [
        { catId: 'groceries', amountCents: 600 },
        { catId: 'uncategorized', amountCents: 400 },
      ],
    };
    expect(draftReady(withUncatSlice)).toBe(false);
  });

  it('a category that does not speak the current type pulls the type along', () => {
    const draft = withCategory(initDraft(expenseTx, undefined, catalog), 'savingDeposit', catalog);
    expect(draft).toMatchObject({ catId: 'savingDeposit', txType: 'saving' });
  });

  it('a type change that invalidates the category clears it — ask again (ruling)', () => {
    const staged = withCategory(initDraft(expenseTx, undefined, catalog), 'entertainment', catalog);
    const flipped = withType(staged, 'saving', catalog);
    expect(flipped.txType).toBe('saving');
    expect(flipped.catId).toBeUndefined(); // never a silently-lying pair
    expect(draftReady(flipped)).toBe(false);
    // a compatible change keeps the category
    expect(withType(staged, 'expense', catalog).catId).toBe('entertainment');
  });

  it('single-type splits clear together with an invalidating type change (ruling)', () => {
    const split = withSplits(initDraft(expenseTx, undefined, catalog), [
      { catId: 'groceries', amountCents: 600 },
      { catId: 'entertainment', amountCents: 400 },
    ]);
    expect(split.catId).toBe('groceries'); // largest slice represents the whole
    const flipped = withType(split, 'income', catalog);
    expect(flipped.splits).toBeUndefined();
    expect(flipped.catId).toBeUndefined();
  });

  it('#133 r5: linking an account names the FAMILY — a savings counter files Set aside, never Transfer out', () => {
    const staged = withCategory(initDraft(expenseTx, undefined, catalog), 'entertainment', catalog);
    const linked = withLinkedAccount(staged, { id: 'a-save', type: 'savings' }, catalog, -1000);
    // the bijection: the counter's kind IS the story — the invalidated
    // spending category refiles under the family's sign-picked sub
    expect(linked).toMatchObject({ linkedAccountId: 'a-save', txType: 'saving', catId: 'savingDeposit' });
    // a regular counter stays the plain transfer pair
    const regular = withLinkedAccount(staged, { id: 'a-chk', type: 'checking' }, catalog, -1000);
    expect(regular).toMatchObject({ linkedAccountId: 'a-chk', txType: 'transfer', catId: 'transferOut' });
    // unlinking keeps the chosen type but frees the account
    expect(withLinkedAccount(linked, null, catalog).linkedAccountId).toBeUndefined();
  });

  it('clearing splits keeps the primary category', () => {
    const split = withSplits(initDraft(expenseTx, 'groceries', catalog), [
      { catId: 'groceries', amountCents: 600 },
      { catId: 'entertainment', amountCents: 400 },
    ]);
    const cleared = withSplits(split, undefined);
    expect(cleared.splits).toBeUndefined();
    expect(cleared.catId).toBe('groceries');
  });
});

describe('withKind (simplified kinds)', () => {
  it('standard resolves by sign and drops the counterparty', async () => {
    const { withKind } = await import('./reviewDraft');
    const linked = withLinkedAccount(initDraft(expenseTx, 'groceries', catalog), { id: 'a-save', type: 'savings' }, catalog);
    expect(linked.txType).toBe('saving'); // #133 r5: the counter's kind names the family
    expect(withKind(linked, 'standard', -1000, catalog)).toMatchObject({ txType: 'expense', linkedAccountId: undefined });
    expect(withKind(linked, 'standard', 1000, catalog).txType).toBe('income');
  });

  it('transfer keeps a linked counterparty (its derived family member survives); unlinked starts plain', async () => {
    const { withKind } = await import('./reviewDraft');
    const linked = withLinkedAccount(initDraft(expenseTx, 'groceries', catalog), { id: 'a-save', type: 'savings' }, catalog);
    // the kind re-pick keeps the DERIVED member — a savings counter
    // means the saving story (#133 r5), not a downgrade to plain
    expect(withKind(linked, 'transfer', -1000, catalog).txType).toBe('saving');
    expect(withKind(initDraft(expenseTx, 'groceries', catalog), 'transfer', -1000, catalog)).toMatchObject({
      txType: 'transfer',
      // arc 2 locked doors: the invalidated spending category files under
      // the family's sign-picked sub instead of asking again
      catId: 'transferOut',
    });
  });

  it('the locked family sub follows the sign; a deliberate category survives', async () => {
    const { withFamilyCategory } = await import('./reviewDraft');
    expect(withFamilyCategory({ txType: 'transfer', catId: undefined }, -1000).catId).toBe('transferOut');
    expect(withFamilyCategory({ txType: 'transfer', catId: undefined }, 2000).catId).toBe('transferIn');
    // a deliberately picked category is never clobbered
    expect(withFamilyCategory({ txType: 'saving', catId: 'savingWithdraw' }, -1000).catId).toBe('savingWithdraw');
  });

  it('a special CATEGORY pick carries the bare story: the type follows (typed-splits v2)', () => {
    // the bare-type exit retired — picking the marked category on a
    // standard row pulls the type through the coherence rules
    const bare = withCategory(initDraft(expenseTx, 'groceries', catalog), 'savingDeposit', catalog);
    expect(bare.txType).toBe('saving');
    expect(bare.catId).toBe('savingDeposit');
    expect(draftReady(bare)).toBe(true);
    const loan = withCategory(initDraft(expenseTx, undefined, catalog), 'loanRepayment', catalog);
    expect(loan.txType).toBe('debtPayment');
  });

  it('adjustment clears the counterparty and confirms without a real category', async () => {
    const { withKind } = await import('./reviewDraft');
    const adjusted = withKind(initDraft(expenseTx, 'groceries', catalog), 'adjustment', -1000, catalog);
    expect(adjusted).toMatchObject({ txType: 'adjustment', linkedAccountId: undefined });
    expect(draftReady({ ...adjusted, catId: 'uncategorized' })).toBe(true);
  });
});
