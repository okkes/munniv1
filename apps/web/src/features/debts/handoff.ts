/**
 * One-shot handoff into loan creation (user design 2026-07-28; loans
 * v2 2026-08-01: the target is the account chooser now — the account
 * IS the debt): the recurring form's Debt kind — and the auto-detected
 * recurring suggestions — redirect to /debts carrying what they
 * already know. The recurring's amount and rhythm become the loan's
 * PAYMENT plan. Module state, not storage: it only needs to survive
 * the client-side navigation, and a reload starting fresh is correct.
 */
import type { RecurringEvery } from '@/db/types';

export interface DebtHandoff {
  name?: string;
  paymentCents?: number;
  paymentEvery?: RecurringEvery;
  /** #190: the recurring's due day becomes the plan's due day */
  paymentDay?: number;
  merchantKey?: string;
}

let pending: DebtHandoff | null = null;

export const setDebtHandoff = (handoff: DebtHandoff): void => {
  pending = handoff;
};

/** read-and-clear — the handoff fires exactly once */
export const takeDebtHandoff = (): DebtHandoff | null => {
  const handoff = pending;
  pending = null;
  return handoff;
};
