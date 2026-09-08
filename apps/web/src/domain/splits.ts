import type { TxSplit } from '@/db/types';

/**
 * Split math: when a transaction is split, the split amounts must exactly
 * partition the (absolute) transaction amount — no orphan cents, ever.
 */

export function splitsTotalCents(splits: TxSplit[]): number {
  return splits.reduce((sum, s) => sum + s.amountCents, 0);
}

/** cents not yet assigned while editing (negative = over-assigned) */
export function splitRemainderCents(amountCents: number, splits: TxSplit[]): number {
  return Math.abs(amountCents) - splitsTotalCents(splits);
}

export type SplitError = 'tooFew' | 'emptyAmount' | 'duplicateCategory' | 'notBalanced';

export function validateSplits(amountCents: number, splits: TxSplit[]): SplitError | null {
  if (splits.length < 2) return 'tooFew';
  if (splits.some((s) => s.amountCents <= 0)) return 'emptyAmount';
  if (new Set(splits.map((s) => s.catId)).size !== splits.length) return 'duplicateCategory';
  if (splitRemainderCents(amountCents, splits) !== 0) return 'notBalanced';
  return null;
}

/** the category that represents the transaction as a whole: its largest slice */
export function primaryCatId(splits: TxSplit[]): string | undefined {
  return [...splits].sort((a, b) => b.amountCents - a.amountCents)[0]?.catId;
}

/** the row auto-balance should fill: the first EMPTY one — the row the
 *  user is working on — else the last as the correction slot (#130:
 *  always writing the LAST row clobbered a filled value whenever an
 *  earlier row was the open one) */
export const balanceTargetIndex = (values: readonly number[]): number => {
  const empty = values.indexOf(0);
  return empty === -1 ? values.length - 1 : empty;
};

/** fill the still-open remainder into the balance target (never below
 *  zero); a forced index — the field the user balanced FROM — wins */
export function balanceOpenRow(amountCents: number, splits: TxSplit[], forcedIndex?: number): TxSplit[] {
  if (splits.length === 0) return splits;
  const target = forcedIndex ?? balanceTargetIndex(splits.map((s) => s.amountCents));
  const others = splits.reduce((sum, s, i) => (i === target ? sum : sum + s.amountCents), 0);
  const open = Math.max(0, Math.abs(amountCents) - others);
  return splits.map((s, i) => (i === target ? { ...s, amountCents: open } : s));
}

// ── percentage splits (user feature): scale to any amount ───────────────

export const splitsArePct = (splits: readonly TxSplit[] | undefined): boolean =>
  !!splits && splits.length > 0 && splits.every((s) => s.pct !== undefined);

/** pct splits materialized against an amount — remainder cents go to the
 *  largest slices so the partition stays exact for every charge */
export function resolveSplitsFor(amountCents: number, splits: readonly TxSplit[]): TxSplit[] {
  if (!splitsArePct(splits)) return [...splits];
  const abs = Math.abs(amountCents);
  const out = splits.map((s) => ({ ...s, amountCents: Math.floor((abs * s.pct!) / 100) }));
  let leftover = abs - out.reduce((sum, s) => sum + s.amountCents, 0);
  const bySize = [...out].sort((a, b) => b.pct! - a.pct!);
  for (const slice of bySize) {
    if (leftover <= 0) break;
    slice.amountCents += 1;
    leftover -= 1;
  }
  return out;
}

export function validatePctSplits(splits: readonly TxSplit[]): SplitError | null {
  if (splits.length < 2) return 'tooFew';
  if (splits.some((s) => (s.pct ?? 0) <= 0)) return 'emptyAmount';
  if (new Set(splits.map((s) => s.catId)).size !== splits.length) return 'duplicateCategory';
  if (splits.reduce((sum, s) => sum + (s.pct ?? 0), 0) !== 100) return 'notBalanced';
  return null;
}

/** the remaining percentage while editing in % mode */
export const pctRemainder = (splits: readonly TxSplit[]): number =>
  100 - splits.reduce((sum, s) => sum + (s.pct ?? 0), 0);
