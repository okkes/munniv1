import type { TranslationKey } from '@/i18n';
import type { AccountType } from '@/db/types';

/** manual account types (shared by the global and space-level add flows) */
export const ACCOUNT_TYPES: { type: AccountType; labelKey: TranslationKey; icon: string; liability?: boolean }[] = [
  { type: 'checking', labelKey: 'acct.bank', icon: 'bank-outline' },
  { type: 'savings', labelKey: 'acct.saving', icon: 'piggy-bank-outline' },
  { type: 'cash', labelKey: 'acct.cashWallet', icon: 'wallet-outline' },
  { type: 'brokerage', labelKey: 'acct.brokerage', icon: 'chart-line' },
  { type: 'credit', labelKey: 'acct.creditCard', icon: 'credit-card-outline', liability: true },
  { type: 'mortgage', labelKey: 'acct.mortgage', icon: 'home-percent-outline', liability: true },
  { type: 'loan', labelKey: 'acct.loan', icon: 'hand-coin-outline', liability: true },
];
export const typeDef = (type: AccountType) => ACCOUNT_TYPES.find((d) => d.type === type) ?? ACCOUNT_TYPES[0];
export const isLiability = (type: AccountType) => !!typeDef(type).liability;

/** manual balances are statements of "true today" — date them so a
 *  statement import can tell whether its balance is newer (importCamt) */
export const manualBalanceDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
