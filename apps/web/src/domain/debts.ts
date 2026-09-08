import type { AccountRow, AccountType, RecurringEvery } from '@/db/types';
import { nextDueDate } from './recurring';

/**
 * Loan math (loans v2, 2026-08-01) — all pure, interest informational.
 * The liability ACCOUNT is the debt: its balance is the remaining truth
 * and the story fields (interest, original, payment plan) live on it.
 */

export const DEBT_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set(['loan', 'mortgage', 'credit']);

/**
 * Debts-screen membership: the explicit toggle wins; absent, loans and
 * mortgages are in by nature while a credit card only joins when the
 * user gave it a debt story (mature-app ruling: a card paid off monthly
 * is an account with a balance, not a payoff journey). #221: the
 * space's DEFAULT pot exists from birth — it joins only while it
 * actually holds a debt (a dormant fixture is not a payoff journey).
 */
export function isDebtTracked(
  account: Pick<AccountRow, 'type' | 'trackAsDebt' | 'interestPctYear' | 'originalCents' | 'paymentCents'> &
    Partial<Pick<AccountRow, 'defaultFor' | 'balanceCents'>>,
): boolean {
  if (!DEBT_ACCOUNT_TYPES.has(account.type)) return false;
  if (account.trackAsDebt !== undefined) return account.trackAsDebt === 1;
  if (account.defaultFor && (account.balanceCents ?? 0) === 0) return false;
  if (account.type !== 'credit') return true;
  return account.interestPctYear !== undefined || account.originalCents !== undefined || !!account.paymentCents;
}

/** remaining owed: the account's balance is the truth (stored negative →
 *  owed is its magnitude); an overpaid card sits at 0 owed */
export function loanRemainingCents(account: Pick<AccountRow, 'balanceCents'>): number {
  return Math.max(0, -account.balanceCents);
}

/** 0..1 paid-off share — unknowable without the original size */
export function loanProgress(account: Pick<AccountRow, 'originalCents'>, remainingCents: number): number {
  const original = account.originalCents ?? 0;
  if (original <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remainingCents / original));
}

/** payments per year for a recurring-shaped cadence; absent = monthly */
export function paymentsPerYear(every?: RecurringEvery, everyN?: number): number {
  const base = { week: 52, month: 12, year: 1 }[every ?? 'month'];
  return base / Math.max(1, everyN ?? 1);
}

export interface PayoffProjection {
  months: number;
  /** yyyy-mm of the final payment */
  endMonth: string;
  totalInterestCents: number;
}

const MAX_STEPS = 2600; // 50 years of weekly payments — beyond that the payment isn't working

/**
 * Amortization walk: fixed payment per period against per-period
 * compounding of the (informational) APR — the period follows the
 * loan's cadence (arc 3: a weekly payer is done ~4× sooner than the
 * old monthly assumption claimed). Null when there's no payment or the
 * payment doesn't beat the interest.
 */
export function projectPayoff(
  remainingCents: number,
  paymentCents: number | undefined,
  interestPctYear: number | undefined,
  today: string,
  perYear = 12,
): PayoffProjection | null {
  if (!paymentCents || paymentCents <= 0 || remainingCents <= 0 || perYear <= 0) return null;
  const periodRate = (interestPctYear ?? 0) / 100 / perYear;
  let balance = remainingCents;
  let totalInterest = 0;
  let steps = 0;
  const maxSteps = Math.min(MAX_STEPS, Math.ceil(perYear * 50));
  while (balance > 0 && steps < maxSteps) {
    const interest = Math.round(balance * periodRate);
    if (paymentCents <= interest) return null; // never pays off
    totalInterest += interest;
    balance = balance + interest - paymentCents;
    steps++;
  }
  if (balance > 0) return null;
  const months = Math.max(1, Math.round((steps * 12) / perYear));
  const [y, m] = today.split('-').map(Number);
  const end = new Date(y, m - 1 + months, 1);
  return {
    months,
    endMonth: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`,
    totalInterestCents: totalInterest,
  };
}

export interface PaymentEstimate {
  /** median |amount| of the attached payments */
  paymentCents: number;
  /** median gap between payments, whole days */
  everyDays: number;
  /** payments-per-year equivalent, for the projection */
  perYear: number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const DAY_MS = 86_400_000;

/**
 * "Estimated from payments" (arc 3): median interval and median amount
 * of the attached payments — never stored, used wherever the explicit
 * frequency/value fields are empty. Medians shrug off the odd extra
 * payment or double month; a mirrored pair (both legs in the history)
 * collapses to one event by date+size. Fewer than 3 payments claim
 * nothing.
 */
export function estimatePaymentPlan(payments: readonly { date: string; amountCents: number }[]): PaymentEstimate | null {
  const events = new Map<string, { date: string; abs: number }>();
  for (const p of payments) {
    const abs = Math.abs(p.amountCents);
    events.set(`${p.date}:${abs}`, { date: p.date, abs });
  }
  const unique = [...events.values()];
  const dates = [...new Set(unique.map((p) => p.date))].sort((a, b) => a.localeCompare(b));
  if (unique.length < 3 || dates.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(Math.round((new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / DAY_MS));
  }
  const everyDays = Math.max(1, median(gaps));
  return {
    paymentCents: median(unique.map((p) => p.abs)),
    everyDays,
    perYear: 365.25 / everyDays,
  };
}

/** the loan's explicit payment as a monthly figure (cadence-normalized) */
/** #266: the loan plan's next due date — the payment fields translate
 *  into the recurring cadence shape and ride the same date math.
 *  Anchorless weekly plans have no derivable date → null. */
export function nextDebtPaymentDate(
  loan: Pick<AccountRow, 'paymentCents' | 'paymentEvery' | 'paymentEveryN' | 'paymentDay'>,
  today: string,
): string | null {
  if (!loan.paymentCents || !loan.paymentDay) return null;
  if (loan.paymentEvery === 'week') return null;
  return nextDueDate(
    {
      active: 1,
      every: loan.paymentEvery ?? 'month',
      everyN: loan.paymentEveryN ?? 1,
      dueDay: loan.paymentDay,
      dueMonth: 1,
      since: '',
    },
    today,
  );
}

export function monthlyPaymentCents(loan: Pick<AccountRow, 'paymentCents' | 'paymentEvery' | 'paymentEveryN'>): number {
  if (!loan.paymentCents) return 0;
  return Math.round((loan.paymentCents * paymentsPerYear(loan.paymentEvery, loan.paymentEveryN)) / 12);
}

export interface DebtsOverview {
  totalOwedCents: number;
  totalMonthlyCents: number;
}

export function debtsOverview(loans: readonly AccountRow[]): DebtsOverview {
  const active = loans.filter((a) => a.deleted === 0 && a.archived !== 1 && isDebtTracked(a));
  return {
    totalOwedCents: active.reduce((sum, a) => sum + loanRemainingCents(a), 0),
    totalMonthlyCents: active.reduce((sum, a) => sum + monthlyPaymentCents(a), 0),
  };
}
