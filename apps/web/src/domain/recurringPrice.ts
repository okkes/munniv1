import type { RecurringRow } from '@/db/types';
import { cycleMonths } from './recurring';

/**
 * Subscription intelligence (design S1/S2): derived, never stored —
 * the linked transactions are the price history.
 */

export interface PriceChange {
  fromCents: number;
  toCents: number;
  /** date of the first charge at the new amount */
  sinceDate: string;
}

/**
 * A SUSTAINED price change: the two newest charges agree on an amount
 * that differs from what was charged before. One-off deltas (proration,
 * a partial refund month) never trigger.
 */
export function detectPriceChange(
  charges: readonly { date: string; amountCents: number }[],
): PriceChange | null {
  const paid = charges
    .filter((charge) => charge.amountCents < 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (paid.length < 3) return null;
  const amounts = paid.map((charge) => -charge.amountCents);
  const newAmount = amounts.at(-1)!;
  if (amounts.at(-2) !== newAmount) return null; // not sustained yet

  // the start of the trailing run at the new amount
  let start = amounts.length - 2;
  while (start > 0 && amounts[start - 1] === newAmount) start--;
  if (start === 0) return null; // it always cost this much
  const fromCents = amounts[start - 1];
  if (fromCents === newAmount) return null;
  return { fromCents, toCents: newAmount, sinceDate: paid[start].date };
}

/** what a recurring cost adds up to per year */
export const yearlyCents = (rec: Pick<RecurringRow, 'amountCents' | 'every' | 'everyN'>): number =>
  Math.round((rec.amountCents * 12) / cycleMonths(rec));

/** a sustained change expressed as yearly impact (positive = pricier) */
export const yearlyDeltaCents = (
  rec: Pick<RecurringRow, 'every' | 'everyN'>,
  change: PriceChange,
): number => Math.round(((change.toCents - change.fromCents) * 12) / cycleMonths(rec));
