import type { RecurringRow } from '@/db/types';

/**
 * Recurring-cost math. All date arithmetic is calendar-based (year /
 * month / day), never millisecond diffs — DST already burned us once.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (isoDate: string): [number, number, number] => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return [y, m, d];
};
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

export const addDays = (isoDate: string, n: number): string => {
  const [y, m, d] = parts(isoDate);
  const dt = new Date(y, m - 1, d + n, 12); // noon: immune to DST day-shifts
  return toIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
};

type CadenceFields = Pick<RecurringRow, 'every' | 'everyN' | 'dueDay' | 'dueMonth' | 'since' | 'until'>;

const stepN = (rec: Pick<RecurringRow, 'everyN'>): number => Math.max(1, rec.everyN ?? 1);

/** ISO date strings parse as UTC midnights — day diffs come out exact */
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** the recurring's occurrence in a given calendar month, or null.
 *  every-N cadences (N > 1) anchor their cycle on `since`. */
function occurrenceIn(rec: CadenceFields, y: number, m: number): string | null {
  const n = stepN(rec);
  if (rec.every === 'year') {
    if (m !== (rec.dueMonth ?? 1)) return null;
    if (n > 1 && rec.since && (y - parts(rec.since)[0]) % n !== 0) return null;
  } else if (n > 1 && rec.since) {
    const [sy, sm] = parts(rec.since);
    if (((y - sy) * 12 + (m - sm)) % n !== 0) return null;
  }
  return toIso(y, m, Math.min(rec.dueDay, daysInMonth(y, m)));
}

const withinLifetime = (rec: Pick<RecurringRow, 'since' | 'until'>, date: string): boolean =>
  (!rec.since || date >= rec.since) && (!rec.until || date <= rec.until);

/** weekly cadences step in exact 7×N-day strides from their anchor */
function weeklyOccurrencesBetween(rec: CadenceFields, from: string, to: string): string[] {
  const anchor = rec.since;
  if (!anchor) return [];
  const step = 7 * stepN(rec);
  const k = Math.max(0, Math.ceil(daysBetween(anchor, from) / step));
  const out: string[] = [];
  for (let date = addDays(anchor, k * step); date <= to; date = addDays(date, step)) {
    if (date >= from && withinLifetime(rec, date)) out.push(date);
  }
  return out;
}

/** every occurrence date within [from, to], honoring since/until */
export function occurrencesBetween(rec: CadenceFields, from: string, to: string): string[] {
  if (rec.every === 'week') return weeklyOccurrencesBetween(rec, from, to);
  const [fy, fm] = parts(from);
  const [ty, tm] = parts(to);
  const out: string[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
    const date = occurrenceIn(rec, y, m);
    if (date && date >= from && date <= to && withinLifetime(rec, date)) out.push(date);
  }
  return out;
}

/** the next occurrence on/after today, or null (inactive / ended) */
export function nextDueDate(rec: Pick<RecurringRow, 'active'> & CadenceFields, today: string): string | null {
  if (rec.active !== 1) return null;
  if (rec.every === 'week') {
    const horizon = addDays(today, 7 * stepN(rec) + 7);
    return weeklyOccurrencesBetween(rec, today, horizon)[0] ?? null;
  }
  const [y, m] = parts(today);
  // enough months to reach the next cycle even for every-5-years
  const monthsToScan = Math.max(24, 12 * stepN(rec) + 12);
  for (let i = 0; i < monthsToScan; i++) {
    const mm = ((m - 1 + i) % 12) + 1;
    const yy = y + Math.floor((m - 1 + i) / 12);
    const date = occurrenceIn(rec, yy, mm);
    if (date && date >= today && withinLifetime(rec, date)) return date;
    if (rec.until && toIso(yy, mm, 1) > rec.until) return null;
  }
  return null;
}

/** stable id of the billing cycle containing `date` — caps auto-linking at one payment per cycle */
export function cycleKeyOf(rec: CadenceFields, date: string): string {
  const n = stepN(rec);
  if (rec.every === 'week') {
    if (!rec.since) return date.slice(0, 7); // anchorless weekly can't cycle — degrade to monthly
    return `w${Math.floor(daysBetween(rec.since, date) / (7 * n))}`;
  }
  if (rec.every === 'year') {
    if (n > 1 && rec.since) return `y${Math.floor((parts(date)[0] - parts(rec.since)[0]) / n)}`;
    return date.slice(0, 4);
  }
  if (n > 1 && rec.since) {
    const [sy, sm] = parts(rec.since);
    const [y, m] = parts(date);
    return `m${Math.floor(((y - sy) * 12 + (m - sm)) / n)}`;
  }
  return date.slice(0, 7);
}

/** how many months one billing cycle spans (weekly ≈ 4.345 weeks/month) */
export const cycleMonths = (rec: Pick<RecurringRow, 'every' | 'everyN'>): number => {
  const n = stepN(rec);
  if (rec.every === 'year') return 12 * n;
  if (rec.every === 'week') return n / 4.345;
  return n;
};

/** an actual payment within 25% (or €1 for small amounts) of the estimate */
export const recurringAmountMatches = (rec: Pick<RecurringRow, 'amountCents'>, txAmountCents: number): boolean =>
  Math.abs(Math.abs(txAmountCents) - rec.amountCents) <= Math.max(100, rec.amountCents * 0.25);

export const isDueWithin = (
  rec: Pick<RecurringRow, 'active'> & CadenceFields,
  today: string,
  days: number,
): boolean => {
  const next = nextDueDate(rec, today);
  return next !== null && next <= addDays(today, days);
};

/**
 * The amount is the USER'S hard value (redesign ruling 2026-07-24): the
 * system never rewrites it — it only detects drift (detectPriceChange)
 * and offers a one-tap update on the detail screen. The old behavior
 * silently replaced the value with the 3-payment average.
 */
export function effectiveAmountCents(rec: Pick<RecurringRow, 'amountCents'>): number {
  return Math.abs(rec.amountCents);
}

export interface LinkedTx {
  date: string;
  amountCents: number;
}

export interface RecurringComputed {
  rec: RecurringRow;
  /** occurrences in range × effective amount */
  expectedCents: number;
  /** abs sum of linked transactions inside the range */
  paidCents: number;
  occurrences: number;
  paid: boolean;
  nextDue: string | null;
  effectiveCents: number;
}

/** per-recurring numbers for a date range (a budget period or a year) */
export function computeRange(
  recs: readonly RecurringRow[],
  linkedByRec: ReadonlyMap<string, readonly LinkedTx[]>,
  from: string,
  to: string,
  today: string,
): RecurringComputed[] {
  return recs.map((rec) => {
    const linked = [...(linkedByRec.get(rec.id) ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const effectiveCents = effectiveAmountCents(rec);
    const occurrences = rec.active === 1 ? occurrencesBetween(rec, from, to).length : 0;
    const inRange = linked.filter((t) => t.date >= from && t.date <= to);
    const paidCents = inRange.reduce((s, t) => s + Math.abs(t.amountCents), 0);
    return {
      rec,
      expectedCents: occurrences * effectiveCents,
      paidCents,
      occurrences,
      paid: inRange.length > 0,
      nextDue: nextDueDate(rec, today),
      effectiveCents,
    };
  });
}

export interface RecurringSummary {
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  luxuryCents: number;
}

export function summarize(computed: readonly RecurringComputed[]): RecurringSummary {
  let totalCents = 0;
  let paidCents = 0;
  let remainingCents = 0;
  let luxuryCents = 0;
  for (const c of computed) {
    totalCents += c.expectedCents;
    paidCents += c.paidCents;
    remainingCents += Math.max(0, c.expectedCents - c.paidCents);
    if (c.rec.luxury === 1) luxuryCents += c.expectedCents;
  }
  return { totalCents, paidCents, remainingCents, luxuryCents };
}
