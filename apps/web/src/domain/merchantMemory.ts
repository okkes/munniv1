import { UNCATEGORIZED_ID } from './categories';
import { merchantKey } from './merchantKey';
import type { TxSplitCat, TxType } from '@/db/types';

/**
 * History-based prediction: how the user actually handled a merchant
 * before is the strongest signal there is. Only human-confirmed rows
 * count (needsReview must be 0 AND a real category set) — imported
 * keyword guesses must never masquerade as history, or fifty
 * auto-guessed "groceries" would outvote the user's deliberate
 * corrections.
 *
 * #161 (user): decisions carry WEIGHT, not just a timestamp — every
 * occurrence votes with a recency-decayed weight (half-life ~6
 * months), so "almost always groceries" survives one dinner out, and
 * a habit that genuinely shifts flips the winner after a few repeats.
 * The memory also remembers more than the category: a percentage
 * category spread the user keeps confirming, and the event the recent
 * charges joined.
 */

/** recency half-life in days — one occurrence six months old counts half */
const HALF_LIFE_DAYS = 180;
const DAY_MS = 86_400_000;

const decayedWeight = (date: string, today: string): number => {
  const age = (Date.parse(today) - Date.parse(date)) / DAY_MS;
  if (!Number.isFinite(age) || age <= 0) return 1;
  return 0.5 ** (age / HALF_LIFE_DAYS);
};

export interface MerchantStats {
  catId: string;
  txType: TxType;
  /** money direction this stat was learned from (refunds ≠ purchases) */
  sign: 1 | -1;
  count: number;
  /** recency-decayed vote mass (#161) — the winner has the most */
  weight: number;
  lastDate: string;
  /** recent absolute amounts (minor units) — powers the same-amount boost */
  amounts: number[];
  /** #161: occurrences that were a percentage category SPREAD, and the
   *  latest such spread — predicted when spreads dominate this stat */
  spreadCount: number;
  lastSpread?: { catId: string; pct: number }[];
  /** #161: recency-decayed votes for the event the charges joined */
  eventVotes: Map<string, number>;
}

export type MerchantMemory = Map<string, MerchantStats[]>;

export interface MemoryInput {
  merchant: string;
  catId?: string;
  txType: TxType;
  needsReview: 0 | 1;
  date: string;
  amountCents: number;
  /** the row's category spread — only complete pct partitions teach */
  cats?: TxSplitCat[];
  eventId?: string;
}

/** a spread teaches only when EVERY entry is percentage-based — absolute
 *  euro slices never generalize to a different amount */
const teachableSpread = (cats: TxSplitCat[] | undefined): { catId: string; pct: number }[] | undefined => {
  if (!cats || cats.length < 2) return undefined;
  if (!cats.every((c) => c.pct != null)) return undefined;
  return cats.map((c) => ({ catId: c.catId, pct: c.pct! }));
};

/** one confirmed row's votes land on its stat (S3776: out of the loop) */
function absorbRow(entry: MerchantStats, row: MemoryInput, weight: number): void {
  entry.count += 1;
  entry.weight += weight;
  if (row.date >= entry.lastDate) {
    entry.lastDate = row.date;
    entry.txType = row.txType; // the latest opinion also owns the type
  }
  if (entry.amounts.length < 8) entry.amounts.push(Math.abs(row.amountCents));
  const spread = teachableSpread(row.cats);
  if (spread) {
    entry.spreadCount += 1;
    if (!entry.lastSpread || row.date >= entry.lastDate) entry.lastSpread = spread;
  }
  if (row.eventId) entry.eventVotes.set(row.eventId, (entry.eventVotes.get(row.eventId) ?? 0) + weight);
}

export function buildMerchantMemory(rows: readonly MemoryInput[], today?: string): MerchantMemory {
  const now = today ?? rows.reduce((max, r) => (r.date > max ? r.date : max), '1970-01-01');
  const memory: MerchantMemory = new Map();
  for (const row of rows) {
    if (row.needsReview === 1 || !row.catId || row.catId === UNCATEGORIZED_ID) continue;
    const key = merchantKey(row.merchant);
    if (!key) continue;
    const sign: 1 | -1 = row.amountCents >= 0 ? 1 : -1;
    const stats = memory.get(key) ?? [];
    let entry = stats.find((s) => s.catId === row.catId && s.sign === sign);
    if (!entry) {
      entry = { catId: row.catId, txType: row.txType, sign, count: 0, weight: 0, lastDate: row.date, amounts: [], spreadCount: 0, eventVotes: new Map() };
      stats.push(entry);
    }
    absorbRow(entry, row, decayedWeight(row.date, now));
    memory.set(key, stats);
  }
  return memory;
}

/** within 10% (or 50 cents for small amounts) counts as "the same amount" */
const closeAmounts = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(50, a * 0.1);

export interface MemoryHit {
  catId: string;
  txType: TxType;
  /** occurrences backing this prediction */
  evidence: number;
  /** an earlier occurrence had ~this exact amount (subscription-like) */
  amountMatch: boolean;
  /** #161: the pct spread the user keeps confirming for this merchant */
  cats?: { catId: string; pct: number }[];
  /** #161: the event the recent charges joined (own-space memory only) */
  eventId?: string;
}

/** the stat's extras, attached only when they genuinely dominate */
function hitFrom(stat: MerchantStats, amountMatch: boolean): MemoryHit {
  // a spread predicts only when MOST confirmations of this stat were
  // spreads — an occasional split must not fragment every future charge
  const cats = stat.lastSpread && stat.spreadCount * 2 > stat.count ? stat.lastSpread : undefined;
  let eventId: string | undefined;
  let best = 0;
  for (const [id, votes] of stat.eventVotes) {
    if (votes > best) {
      best = votes;
      eventId = id;
    }
  }
  // one long-ago event link is noise; ~two recent ones are a habit
  if (best < 1.2) eventId = undefined;
  return { catId: stat.catId, txType: stat.txType, evidence: stat.count, amountMatch, cats, eventId };
}

export function predictFromMemory(memory: MerchantMemory, merchant: string, amountCents: number): MemoryHit | null {
  const stats = memory.get(merchantKey(merchant));
  if (!stats?.length) return null;
  const sign: 1 | -1 = amountCents >= 0 ? 1 : -1;
  const sameSide = stats.filter((s) => s.sign === sign);
  if (sameSide.length === 0) return null;

  const abs = Math.abs(amountCents);
  const amountHits = sameSide.filter((s) => s.amounts.some((a) => closeAmounts(a, abs)));
  if (amountHits.length > 0) {
    const best = amountHits.reduce((a, b) => (b.weight > a.weight ? b : a), amountHits[0]);
    return hitFrom(best, true);
  }

  // #161 (user rule): the HEAVIEST habit wins — recency-decayed votes,
  // so one dinner never beats years of groceries, while a real habit
  // shift takes the lead after a few recent repeats
  const best = [...sameSide].sort((a, b) => b.weight - a.weight || b.lastDate.localeCompare(a.lastDate))[0];
  return hitFrom(best, false);
}
