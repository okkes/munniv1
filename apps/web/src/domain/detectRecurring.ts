import { merchantKey } from './merchantKey';
import type { RecurringEvery, TxType } from '@/db/types';

/**
 * Pattern detection for recurring costs: the same merchant charging at
 * a steady monthly/yearly rhythm with a stable amount. Suggestions are
 * offered once — accepted ones become recurring rows, dismissed ones
 * are remembered (synced) and never resurface.
 */

export interface DetectInput {
  /** present when the caller wants the suggestion to carry its evidence */
  id?: string;
  merchant: string;
  date: string; // yyyy-mm-dd
  amountCents: number;
  txType: TxType;
  recurringId?: string;
}

export interface RecurringSuggestion {
  merchantKey: string;
  /** display name from the most recent occurrence */
  name: string;
  /** median absolute amount */
  amountCents: number;
  every: RecurringEvery;
  dueDay: number;
  count: number;
  confidence: number; // 65..95
  lastDate: string;
  /** the charges that formed the pattern, oldest → newest */
  txIds: string[];
}

const DAY_MS = 86_400_000;
const dayNumber = (isoDate: string): number => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

interface Cadence {
  every: RecurringEvery;
  regular: boolean;
}

/** monthly ≈ 30-day gaps, yearly ≈ 365-day gaps; anything else is noise */
function cadenceOf(gaps: number[]): Cadence | null {
  const mid = median(gaps);
  if (mid >= 25 && mid <= 35) {
    return { every: 'month', regular: gaps.every((g) => Math.abs(g - mid) <= 5) };
  }
  if (mid >= 330 && mid <= 400) {
    return { every: 'year', regular: gaps.every((g) => Math.abs(g - mid) <= 20) };
  }
  return null;
}

function suggestionFor(key: string, group: DetectInput[], today: string): RecurringSuggestion | null {
  const byDate = [...group].sort((a, b) => a.date.localeCompare(b.date));
  if (byDate.length < 3) return null;

  const days = byDate.map((t) => dayNumber(t.date));
  const gaps = days.slice(1).map((d, i) => d - days[i]).filter((g) => g > 0);
  if (gaps.length < 2) return null;
  const cadence = cadenceOf(gaps);
  if (!cadence) return null;

  // a dead subscription (no charge for ~1.5 cycles) is not a suggestion
  const gapToToday = dayNumber(today) - days.at(-1)!;
  if (gapToToday > median(gaps) * 1.5) return null;

  const amounts = byDate.map((t) => Math.abs(t.amountCents));
  const amountMedian = median(amounts);
  const stable = amounts.every((a) => Math.abs(a - amountMedian) <= Math.max(100, amountMedian * 0.2));

  const confidence = Math.min(95, 55 + Math.min(byDate.length, 8) * 3 + (stable ? 12 : 0) + (cadence.regular ? 10 : 0));
  if (confidence < 65) return null;

  const last = byDate.at(-1)!;
  return {
    merchantKey: key,
    name: last.merchant,
    amountCents: amountMedian,
    every: cadence.every,
    dueDay: Number(last.date.slice(8, 10)), // recent charge day — subscriptions drift
    count: byDate.length,
    confidence,
    lastDate: last.date,
    txIds: byDate.flatMap((t) => (t.id ? [t.id] : [])),
  };
}

export function detectRecurring(
  txs: readonly DetectInput[],
  opts: { excludeKeys?: ReadonlySet<string>; today: string },
): RecurringSuggestion[] {
  const groups = new Map<string, DetectInput[]>();
  for (const tx of txs) {
    if (tx.amountCents >= 0 || tx.txType !== 'expense' || tx.recurringId) continue;
    const key = merchantKey(tx.merchant);
    if (!key || opts.excludeKeys?.has(key)) continue;
    const group = groups.get(key) ?? [];
    group.push(tx);
    groups.set(key, group);
  }

  const suggestions: RecurringSuggestion[] = [];
  for (const [key, group] of groups) {
    const suggestion = suggestionFor(key, group, opts.today);
    if (suggestion) suggestions.push(suggestion);
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence);
}
