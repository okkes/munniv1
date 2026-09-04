import { autoSubFor, specialCatType } from './categories';
import type { AccountType, TxType } from '@/db/types';

export const ALL_TX_TYPES: TxType[] = [
  'expense',
  'income',
  'saving',
  'transfer',
  'debtPayment',
  'investment',
  'funding',
  'adjustment',
];

/**
 * R1 (typed-splits v2, user 2026-08-05): special accounts STAMP every
 * one of their rows' type — a savings account's ledger is all saving,
 * a loan's all debt, a brokerage's all investment; the sign reads the
 * direction. Credit is deliberately NOT stamped: its feed rows are
 * ordinary purchases, its top-up legs stay transfers (2026-07-17
 * ruling), and trackAsDebt keeps the debts screen opt-in.
 */
export function accountStamp(accountType: AccountType | undefined): TxType | undefined {
  switch (accountType) {
    case 'savings':
      return 'saving';
    case 'mortgage':
    case 'loan':
      return 'debtPayment';
    case 'brokerage':
      return 'investment';
    default:
      return undefined;
  }
}

/**
 * R2 (typed-splits v2, user 2026-08-05 — the inversion): a row linked
 * to ANY tracked counter-account is a TRANSFER; the special meaning
 * (saving, debt payment, investment) now lives on the counter leg,
 * stamped by that account's own type. Before this, the source row wore
 * the family member — that made the checking side carry the story and
 * the special account's own ledger stay empty.
 */
export function typeForLinkedAccount(accountType: AccountType): TxType {
  // #152: money to the shared funding pot IS funding — its category
  // family follows the counterparty, like every other special account
  return accountType === 'funding' ? 'funding' : 'transfer';
}

/**
 * #133 r5 (user): a movement category, the counterparty's account type
 * and the money's sign are the SAME fact. This is that bijection's
 * spine: the FAMILY a counter account of this type means, seen from an
 * unstamped row — savings counter = the saving story, loan = debt,
 * brokerage = investment, funding = funding, any regular account = a
 * plain transfer. R2's blanket "linked means transfer" retires here.
 */
export function familyForCounter(accountType: AccountType): TxType {
  return accountStamp(accountType) ?? typeForLinkedAccount(accountType);
}

/**
 * The ONE category an unstamped row files when linked to a counter of
 * this type — the bijection's write side. Cash counters file the ATM
 * pair; everything else is the family's sign-picked movement sub.
 */
export function movementCatFor(accountType: AccountType, amountCents: number): string {
  if (accountType === 'cash') return amountCents < 0 ? 'cashWithdraw' : 'cashDeposit';
  const sub = autoSubFor(familyForCounter(accountType), amountCents);
  return sub ?? (amountCents < 0 ? 'transferOut' : 'transferIn');
}

/**
 * #133 r5: the special subs a row in this context may PICK. Keyed by
 * the row's own account type and the money's side: a regular account's
 * outgoing row can only "Set aside" (never Take out — that money went
 * TO the pot), and Interest/Fees exist only on the pot's own ledger,
 * where the same matrix runs sign-inverted. Movement-family categories
 * outside the set are hidden by context-aware pickers; every other
 * category (reimbursement included) is not this matrix's business.
 */
export function allowedSpecialCats(sourceType: AccountType | undefined, direction: 'debit' | 'credit'): ReadonlySet<string> {
  const out = direction === 'debit';
  switch (sourceType === undefined ? undefined : accountStamp(sourceType)) {
    case 'saving':
      return new Set(out ? ['savingWithdraw', 'savingFees'] : ['savingDeposit', 'savingInterest']);
    case 'debtPayment':
      return new Set(out ? ['debtBorrowed', 'debtInterest', 'debtFees'] : ['loanRepayment']);
    case 'investment':
      // #252 (user, five-category model): the brokerage's own ledger
      // adds Bought (−) and Sold (+) — stocks traded with money already
      // inside — next to the movement pair and the value stories
      return new Set(out ? ['investWithdraw', 'investBuy', 'investFees'] : ['investContribution', 'investSell', 'investDividend']);
    default:
      // #252: bank/cash/credit rows see ONLY the movement pair of each
      // family — Invested/Withdrawn, never Bought/Sold (brokerage-only)
      return new Set(
        out
          ? ['savingDeposit', 'loanRepayment', 'investContribution', 'fundingOut', 'transferOut', 'cashWithdraw']
          : ['savingWithdraw', 'debtBorrowed', 'investWithdraw', 'fundingIn', 'transferIn', 'cashDeposit'],
      );
  }
}

/**
 * The account types a movement FAMILY's counterparty ask may offer —
 * the same bijection read the other way ("Set aside" can only point at
 * a savings account; plain Transfer only at regular accounts, because
 * the special kinds ARE the family categories).
 */
export function counterTypesForFamily(family: TxType): readonly AccountType[] | undefined {
  switch (family) {
    case 'saving':
      return ['savings'];
    case 'debtPayment':
      // #218 (user): a credit card can take a debt payment too — the
      // one counter kind that belongs to TWO families (transfer is the
      // default; the counter-narrowed picker offers the debt reading)
      return ['loan', 'mortgage', 'credit'];
    case 'investment':
      return ['brokerage'];
    case 'funding':
      return ['funding'];
    case 'transfer':
      return ['checking', 'cash', 'credit'];
    default:
      return undefined;
  }
}

/** the per-CATEGORY read of the same table — the ATM pair points at
 *  cash wallets specifically; undefined = no counterparty applies */
export function counterTypesFor(catId: string): readonly AccountType[] | undefined {
  if (catId === 'cashWithdraw' || catId === 'cashDeposit') return ['cash'];
  const family = specialCatType(catId);
  return family ? counterTypesForFamily(family) : undefined;
}

/**
 * #218 (user): with a counterparty already picked, the category list
 * narrows to what that counter's kind can mean — usually one category,
 * a credit card two (transfer OR debt payment). To pick anything else
 * the counterparty detaches first. The set is the unstamped row's
 * matrix cell filtered by the counter's own column.
 */
export function movementCatsForCounter(counterType: AccountType, direction: 'debit' | 'credit'): ReadonlySet<string> {
  const cell = allowedSpecialCats(undefined, direction);
  return new Set([...cell].filter((catId) => counterTypesFor(catId)?.includes(counterType)));
}

/** category supports a type only if it's one of its declared txTypes */
export function categoryConflictsWithType(catTxTypes: TxType[], txType: TxType): boolean {
  return catTxTypes.length > 0 && !catTxTypes.includes(txType);
}

/**
 * Fields to write when the user changes the type or the linked account.
 * A conflicting category falls back to uncategorized (flagged for review)
 * instead of silently lying about what kind of money movement this is —
 * except transfer-family types (arc 2 locked doors): with the money's
 * sign known they file the family's locked sub, which is always truthful,
 * so no review round-trip. needsReview stays untouched on that path: a
 * row already in the deck keeps its confirmation stop, a settled row
 * isn't dragged back.
 */
export function applyTypeChange(options: {
  nextType: TxType;
  linkedAccountId: string | null;
  currentCatId: string | undefined;
  catTxTypes: TxType[];
  amountCents?: number;
}): { txType: TxType; linkedAccountId?: string; catId?: string; needsReview?: 0 | 1 } {
  const conflict = categoryConflictsWithType(options.catTxTypes, options.nextType);
  const familySub = options.amountCents === undefined ? undefined : autoSubFor(options.nextType, options.amountCents);
  const placeholder = !options.currentCatId || options.currentCatId === 'uncategorized';
  if (familySub && (conflict || placeholder)) {
    return { txType: options.nextType, linkedAccountId: options.linkedAccountId ?? undefined, catId: familySub };
  }
  return {
    txType: options.nextType,
    linkedAccountId: options.linkedAccountId ?? undefined,
    ...(conflict ? { catId: 'uncategorized', needsReview: 1 as const } : {}),
  };
}
