import { merchantKey } from './merchantKey';
import type { RecurringEvery, TxType } from '@/db/types';

/**
 * Pattern detection for recurring costs: the same merchant charging at
 * a steady monthly/yearly rhythm with a stable amount. Suggestions are
 * offered once — accepted ones become recurring rows, dismissed ones
 * are remembered (synced) and never resurface.
 *
 * #345/#346 redesign (user):
 * - patterns are found PER ACCOUNT — a rhythm never mixes accounts;
 * - one merchant may charge several STEADY amounts (tiers, split
 *   plans): amounts cluster first, each cluster gets its own rhythm —
 *   mixed amounts used to poison the single median and detect nothing;
 * - the same pattern echoing on TWO accounts (a transfer leg beside the
 *   real expense) suggests ONCE — the stronger series wins.
 */

export interface DetectInput {
  /** present when the caller wants the suggestion to carry its evidence */
  id?: string;
  /** #345: the rhythm lives on ONE account */
  accountId?: string;
  merchant: string;
  date: string; // yyyy-mm-dd
  amountCents: number;
  txType: TxType;
  recurringId?: string;
}

export interface RecurringSuggestion {
  merchantKey: string;
  /** dismissal identity: merchant plus the cluster's amount — one
   *  merchant can carry several suggestions now (#346) */
  key: string;
  /** #345: the account the pattern was found on */
  accountId?: string;
  /** display name from the most recent occurrence */
  name: string;
  /** median absolute amount of the CLUSTER */
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

/** the stability band around an amount: €1 or 20%, whichever is wider */
const amountBand = (cents: number): number => Math.max(100, Math.abs(cents) * 0.2);

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

/** #346: split one merchant-account series into steady-amount clusters
 *  (greedy over the sorted absolute amounts, band-joined) */
function amountClusters(group: DetectInput[]): DetectInput[][] {
  const sorted = [...group].sort((a, b) => Math.abs(a.amountCents) - Math.abs(b.amountCents));
  const clusters: DetectInput[][] = [];
  for (const tx of sorted) {
    const current = clusters.at(-1);
    if (current && Math.abs(Math.abs(tx.amountCents) - Math.abs(current[0].amountCents)) <= amountBand(current[0].amountCents)) {
      current.push(tx);
    } else {
      clusters.push([tx]);
    }
  }
  return clusters;
}

function suggestionFor(key: string, accountId: string | undefined, group: DetectInput[], today: string): RecurringSuggestion | null {
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
  // by cluster construction the amounts sit inside one band — the term
  // stays in the score so future band changes keep an honest confidence
  const stable = amounts.every((a) => Math.abs(a - amountMedian) <= amountBand(amountMedian));

  const confidence = Math.min(95, 55 + Math.min(byDate.length, 8) * 3 + (stable ? 12 : 0) + (cadence.regular ? 10 : 0));
  if (confidence < 65) return null;

  const last = byDate.at(-1)!;
  return {
    merchantKey: key,
    key: `${key}@${amountMedian}`,
    accountId,
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

/** dismissal/exclusion match: a bare merchant key suppresses the whole
 *  merchant (legacy dismissals + accepted recurrings); a `key@cents`
 *  entry suppresses that amount band only — the cluster median may
 *  drift a little between runs, so the band decides, not equality */
function excluded(suggestion: RecurringSuggestion, keys: ReadonlySet<string> | undefined): boolean {
  if (!keys) return false;
  if (keys.has(suggestion.merchantKey)) return true;
  for (const key of keys) {
    const at = key.lastIndexOf('@');
    if (at <= 0 || key.slice(0, at) !== suggestion.merchantKey) continue;
    const cents = Number(key.slice(at + 1));
    if (Number.isFinite(cents) && Math.abs(cents - suggestion.amountCents) <= amountBand(cents)) return true;
  }
  return false;
}

export function detectRecurring(
  txs: readonly DetectInput[],
  opts: { excludeKeys?: ReadonlySet<string>; today: string },
): RecurringSuggestion[] {
  // #345: the group key carries the ACCOUNT — rhythms never mix accounts
  const groups = new Map<string, { accountId?: string; merchantKey: string; rows: DetectInput[] }>();
  for (const tx of txs) {
    if (tx.amountCents >= 0 || tx.txType !== 'expense' || tx.recurringId) continue;
    const mk = merchantKey(tx.merchant);
    if (!mk) continue;
    const groupKey = `${tx.accountId ?? ''}|${mk}`;
    const group = groups.get(groupKey) ?? { accountId: tx.accountId, merchantKey: mk, rows: [] };
    group.rows.push(tx);
    groups.set(groupKey, group);
  }

  const candidates: RecurringSuggestion[] = [];
  for (const group of groups.values()) {
    for (const cluster of amountClusters(group.rows)) {
      const suggestion = suggestionFor(group.merchantKey, group.accountId, cluster, opts.today);
      if (suggestion && !excluded(suggestion, opts.excludeKeys)) candidates.push(suggestion);
    }
  }

  // #345: the same pattern on TWO accounts (a counterless transfer leg
  // beside the real expense) suggests once — more occurrences win, then
  // the fresher series
  const suggestions: RecurringSuggestion[] = [];
  const ranked = [...candidates].sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
  for (const s of ranked) {
    const echo = suggestions.some(
      (kept) =>
        kept.merchantKey === s.merchantKey &&
        kept.accountId !== s.accountId &&
        Math.abs(kept.amountCents - s.amountCents) <= amountBand(Math.max(kept.amountCents, s.amountCents)),
    );
    if (!echo) suggestions.push(s);
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence);
}
