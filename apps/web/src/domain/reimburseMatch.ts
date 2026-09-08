import type { TransactionRow } from '@/db/types';
import { EXPECTED_REIMBURSE_ID, RECEIVED_REIMBURSE_ID } from '@/domain/categories';
import { creditRemainingCents, netAmountCents, remainingCents } from '@/domain/reimbursement';

/**
 * Candidate scoring for the reimbursement link screen (user design
 * 2026-07-28): a small "suggested" segment surfaces the 1–2 rows most
 * likely to be the counterpart the user came looking for, from timing
 * (repayments follow the expense within days), wording (Dutch P2P
 * repayment vocabulary), bookkeeping (rows already filed under the
 * reimbursement categories) and size (a repayment is never much more
 * than what it repays).
 */

/** P2P repayment vocabulary Dutch banks stamp on transfers (user list) */
const REPAY_WORDS = /tikkie|betaalverzoek|payment request|terugbetaling|terugstorting/i;

const DAY_MS = 86_400_000;
const dayDiff = (fromIso: string, toIso: string): number => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);

const REIMB_CAT_IDS = new Set<string>([EXPECTED_REIMBURSE_ID, RECEIVED_REIMBURSE_ID]);

/** does the row book itself as reimbursement money (category or slice)? */
export function filedAsReimbursement(tx: Pick<TransactionRow, 'catId' | 'splits'>): boolean {
  if (tx.catId && REIMB_CAT_IDS.has(tx.catId)) return true;
  return (tx.splits ?? []).some((s) => REIMB_CAT_IDS.has(s.catId));
}

/**
 * What the row's reimbursement CATEGORY earmarks, in cents — the slice
 * value when split, the whole net value when the row itself is filed as
 * expected/received reimbursement, and null when it carries no
 * reimbursement bookkeeping at all (the caller falls back to the net
 * value, today's behavior).
 */
export function reimbEarmarkCents(tx: Pick<TransactionRow, 'catId' | 'splits' | 'amountCents' | 'reimbursements'>): number | null {
  const slices = (tx.splits ?? []).filter((s) => REIMB_CAT_IDS.has(s.catId));
  if (slices.length > 0) return slices.reduce((sum, s) => sum + Math.abs(s.amountCents), 0);
  if (tx.catId && REIMB_CAT_IDS.has(tx.catId)) return Math.abs(netAmountCents(tx));
  return null;
}

function amountScore(candidateCents: number, neededCents: number): number {
  if (candidateCents <= 0 || neededCents <= 0) return 0;
  if (candidateCents === neededCents) return 3;
  if (candidateCents <= neededCents) return 2;
  if (candidateCents <= neededCents * 1.25) return 1;
  return 0; // a repayment far bigger than the expense is a different story
}

function timingScore(days: number): number {
  if (days >= 0 && days <= 7) return 2; // same day … a week later (user rule)
  if (days >= -2 && days <= 14) return 1;
  return 0;
}

export interface ScoredCandidate<T extends TransactionRow> {
  tx: T;
  score: number;
}

/**
 * Rank counterpart candidates for `anchor`. Direction follows the
 * anchor's sign: an expense looks forward in time at credits, a credit
 * looks back at expenses. Only rows scoring at least 4 qualify — one
 * weak signal alone never makes a suggestion.
 */
export function suggestCounterparts<T extends TransactionRow>(
  anchor: TransactionRow,
  candidates: readonly T[],
  givenOf: (id: string) => number,
): ScoredCandidate<T>[] {
  const anchorIsExpense = anchor.amountCents < 0;
  const needed = anchorIsExpense ? remainingCents(anchor) : creditRemainingCents(anchor, givenOf(anchor.id));
  const scored = candidates.map((tx) => {
    const filed = filedAsReimbursement(tx) ? 3 : 0;
    const worded = REPAY_WORDS.test(tx.merchant) ? 2 : 0;
    const days = anchorIsExpense ? dayDiff(anchor.date, tx.date) : dayDiff(tx.date, anchor.date);
    const size = anchorIsExpense
      ? amountScore(creditRemainingCents(tx, givenOf(tx.id)), needed)
      : amountScore(needed, remainingCents(tx));
    return { tx, score: filed + worded + timingScore(days) + size };
  });
  return scored
    .filter((entry) => entry.score >= 4)
    .sort((a, b) => b.score - a.score || b.tx.date.localeCompare(a.tx.date))
    .slice(0, 2);
}
