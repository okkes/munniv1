import { UNCATEGORIZED_ID } from './categories';
import { merchantKey } from './merchantKey';
import type { TxType } from '@/db/types';

/**
 * History-based category prediction: how the user actually categorized a
 * merchant before is the strongest signal there is. Only human-confirmed
 * rows count (needsReview must be 0 AND a real category set) — imported
 * keyword guesses must never masquerade as history, or fifty auto-guessed
 * "groceries" would outvote the user's deliberate corrections.
 */

export interface MerchantStats {
  catId: string;
  txType: TxType;
  /** money direction this stat was learned from (refunds ≠ purchases) */
  sign: 1 | -1;
  count: number;
  lastDate: string;
  /** recent absolute amounts (minor units) — powers the same-amount boost */
  amounts: number[];
}

export type MerchantMemory = Map<string, MerchantStats[]>;

export interface MemoryInput {
  merchant: string;
  catId?: string;
  txType: TxType;
  needsReview: 0 | 1;
  date: string;
  amountCents: number;
}

export function buildMerchantMemory(rows: readonly MemoryInput[]): MerchantMemory {
  const memory: MerchantMemory = new Map();
  for (const row of rows) {
    if (row.needsReview === 1 || !row.catId || row.catId === UNCATEGORIZED_ID) continue;
    const key = merchantKey(row.merchant);
    if (!key) continue;
    const sign: 1 | -1 = row.amountCents >= 0 ? 1 : -1;
    const stats = memory.get(key) ?? [];
    let entry = stats.find((s) => s.catId === row.catId && s.sign === sign);
    if (!entry) {
      entry = { catId: row.catId, txType: row.txType, sign, count: 0, lastDate: row.date, amounts: [] };
      stats.push(entry);
    }
    entry.count += 1;
    if (row.date >= entry.lastDate) {
      entry.lastDate = row.date;
      entry.txType = row.txType; // the latest opinion also owns the type
    }
    if (entry.amounts.length < 8) entry.amounts.push(Math.abs(row.amountCents));
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
}

export function predictFromMemory(memory: MerchantMemory, merchant: string, amountCents: number): MemoryHit | null {
  const stats = memory.get(merchantKey(merchant));
  if (!stats?.length) return null;
  const sign: 1 | -1 = amountCents >= 0 ? 1 : -1;
  const sameSide = stats.filter((s) => s.sign === sign);
  if (sameSide.length === 0) return null;

  const abs = Math.abs(amountCents);
  const amountHit = sameSide.find((s) => s.amounts.some((a) => closeAmounts(a, abs)));
  if (amountHit) return { catId: amountHit.catId, txType: amountHit.txType, evidence: amountHit.count, amountMatch: true };

  // the user's LATEST opinion about this merchant wins; frequency breaks ties
  const best = [...sameSide].sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.count - a.count)[0];
  return { catId: best.catId, txType: best.txType, evidence: best.count, amountMatch: false };
}
