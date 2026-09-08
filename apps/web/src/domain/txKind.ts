import type { TxType } from '@/db/types';

/**
 * Simplified transaction kinds (user redesign 2026-07-25): the stored
 * technical types stay the truth every reader consumes — the UI
 * collapses them into the choices a person actually makes:
 *
 * - standard    → income or expense, resolved by the money's sign
 * - transfer    → between two accounts munni tracks; the counterparty's
 *                 account type derives saving / debt payment / investment.
 *                 Funding is a transfer-family MEMBER (user correction
 *                 2026-08-01): money to a shared bank account held with
 *                 family or friends — the account isn't yours alone, so
 *                 there is no counterparty to link; picked by name via
 *                 the "no counter account" exit.
 * - adjustment  → a manual correction for an unresolvable discrepancy
 *
 * Money leaving to the outside world (a friend's IBAN, a shop) is
 * ALWAYS standard (user ruling): transfer is strictly between accounts
 * munni knows about — funding being the deliberate exception for the
 * shared pot you co-own.
 */
export type TxKind = 'standard' | 'transfer' | 'adjustment';

export const TX_KINDS: readonly TxKind[] = ['standard', 'transfer', 'adjustment'];

/** the transfer family: which member is decided by the counterparty —
 *  funding has no counterparty and is only ever picked by name */
export const TRANSFER_TYPES: readonly TxType[] = ['transfer', 'saving', 'debtPayment', 'investment', 'funding'];

export function kindOf(txType: TxType): TxKind {
  if (txType === 'adjustment') return 'adjustment';
  return TRANSFER_TYPES.includes(txType) ? 'transfer' : 'standard';
}

/** standard resolves by sign — negative money is an expense */
export const standardTypeFor = (amountCents: number): TxType => (amountCents < 0 ? 'expense' : 'income');
