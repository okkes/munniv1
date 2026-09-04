import { specialCatType } from './categories';
import type { AccountRow, AccountType, TxType } from '@/db/types';

/**
 * #221 (user redesign): the DEFAULT accounts stop being lazy — every
 * space mints one per family AT CREATION (existing spaces heal on boot),
 * so a movement category always has a valid counterparty to point at
 * and "a transfer assigned by munni but with no counterparty" becomes
 * unrepresentable. The lazy trio (#133 ruling 1) grows to six: the
 * transfer family gets a default bank account, the ATM pair its cash
 * wallet, funding its shared pot — rulings 4/5 (transfer needs a real
 * account / funding stays counterparty-less) retire here.
 *
 * Deterministic ids make two devices converge by LWW instead of
 * duplicating (the loans-v2 fold lesson). This module is the pure half:
 * ids and family math; the minting lives in application/defaultAccounts.
 */
export type DefaultFamily = NonNullable<AccountRow['defaultFor']>;

export const DEFAULT_FAMILIES: readonly DefaultFamily[] = [
  'saving',
  'debtPayment',
  'investment',
  'transfer',
  'cash',
  'funding',
];

export const FAMILY_ACCOUNT_TYPE: Record<DefaultFamily, AccountType> = {
  saving: 'savings',
  debtPayment: 'loan',
  investment: 'brokerage',
  transfer: 'checking',
  cash: 'cash',
  funding: 'funding',
};

/** what the default MEANS as a counterparty (deriveTxType's vocabulary):
 *  the cash wallet is the transfer family's ATM half, everything else
 *  speaks its own name */
export const FAMILY_TX_TYPE: Record<DefaultFamily, TxType> = {
  saving: 'saving',
  debtPayment: 'debtPayment',
  investment: 'investment',
  transfer: 'transfer',
  cash: 'transfer',
  funding: 'funding',
};

export const defaultAccountId = (spaceId: string, family: DefaultFamily): string =>
  `defaultacct_${family}_${spaceId}`;

/** #133: the counterparty rule's first arm — a DEFAULT pick keeps the
 *  family (the row wears the special category itself); any real account
 *  follows the normal transfer/funding derivation instead */
export const defaultPickFamily = (
  family: DefaultFamily | null | undefined,
  pickedId: string,
  spaceId: string,
): DefaultFamily | null => (family && pickedId === defaultAccountId(spaceId, family) ? family : null);

const FAMILY_SET: ReadonlySet<string> = new Set(DEFAULT_FAMILIES);

/**
 * The default family a CATEGORY's counterparty ask pins — the bijection
 * read toward the pots. The ATM pair wants the cash wallet, not the
 * default bank account; every other special category follows its
 * family. Null for categories outside the special trees.
 */
export function defaultFamilyFor(catId: string | undefined): DefaultFamily | null {
  if (catId === 'cashWithdraw' || catId === 'cashDeposit') return 'cash';
  const family = specialCatType(catId);
  return family && FAMILY_SET.has(family) ? (family as DefaultFamily) : null;
}
