import type { TxType } from '@/db/types';

/**
 * Simplified transaction kinds (user redesign 2026-07-25; typed-splits
 * v2 2026-08-05): the stored technical types stay the truth every
 * reader consumes — the UI collapses them into the choices a person
 * actually makes:
 *
 * - standard    → income or expense, resolved by the money's sign.
 *                 Special CATEGORIES (marked in every picker) carry the
 *                 bare stories here: set-aside without a tracked pot,
 *                 the flat loan structure, funding to the shared pot.
 * - transfer    → strictly between two accounts munni tracks — the
 *                 counterparty is mandatory (R2) and the categories are
 *                 the locked Transfer out/in pair. The special meaning
 *                 lives on the counter leg, stamped by ITS account.
 * - adjustment  → a manual correction for an unresolvable discrepancy
 *
 * Money leaving to the outside world (a friend's IBAN, a shop) is
 * ALWAYS standard (user ruling). The funding TYPE retired 2026-08-05
 * (Q3): funding is a special category on standard rows now — the
 * stored member below only serves unmigrated rows.
 */
export type TxKind = 'standard' | 'transfer' | 'adjustment';

export const TX_KINDS: readonly TxKind[] = ['standard', 'transfer', 'adjustment'];

/** the transfer family: saving/debt/investment are the STAMPED types of
 *  special-account rows (R1); plain 'transfer' is the regular-side leg */
export const TRANSFER_TYPES: readonly TxType[] = ['transfer', 'saving', 'debtPayment', 'investment'];

export function kindOf(txType: TxType): TxKind {
  if (txType === 'adjustment') return 'adjustment';
  return TRANSFER_TYPES.includes(txType) ? 'transfer' : 'standard';
}

/** standard resolves by sign — negative money is an expense */
export const standardTypeFor = (amountCents: number): TxType => (amountCents < 0 ? 'expense' : 'income');
