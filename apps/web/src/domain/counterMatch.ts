import type { TransactionRow } from '@/db/types';
import { REIMBURSED_ID } from './categories';

/** every row (and split part) some OTHER row already points at — a
 *  pointed-at row is spoken for even when its own reciprocal is missing
 *  (#237 r2: one-way pairs kept being offered as "available") */
export function pointedAtIds(rows: readonly TransactionRow[]): ReadonlySet<string> {
  const pointed = new Set<string>();
  for (const row of rows) {
    if (row.deleted !== 0) continue;
    if (row.transferPeerId) pointed.add(row.transferPeerId);
    for (const part of row.splits ?? []) {
      if (part.transferPeerId) pointed.add(part.transferPeerId);
    }
  }
  return pointed;
}

/** a row that could still become someone's other leg: not linked, not
 *  paired (in EITHER direction), never a split container (#237) */
const openRow = (
  row: TransactionRow,
  counterAccountId: string,
  anchorId: string,
  pointed: ReadonlySet<string>,
): boolean =>
  row.deleted === 0 &&
  row.id !== anchorId &&
  row.accountId === counterAccountId &&
  !row.linkedAccountId &&
  !row.transferPeerId &&
  !pointed.has(row.id) &&
  (row.splits ?? []).filter((s) => s.catId !== REIMBURSED_ID).length <= 1;

function nearMatches(
  rows: readonly TransactionRow[],
  counterAccountId: string,
  anchor: { id: string; amountCents: number; date: string },
  sign: 1 | -1,
  limit: number,
): TransactionRow[] {
  const anchorAbs = Math.abs(anchor.amountCents);
  const anchorTime = Date.parse(anchor.date);
  const tolerance = Math.max(100, Math.round(anchorAbs * 0.02));
  const pointed = pointedAtIds(rows);
  return rows
    .filter((row) => openRow(row, counterAccountId, anchor.id, pointed) && Math.sign(row.amountCents) === sign)
    .map((row) => ({
      row,
      amountDiff: Math.abs(Math.abs(row.amountCents) - anchorAbs),
      dayDiff: Math.abs(Date.parse(row.date) - anchorTime) / 86_400_000,
    }))
    .filter((entry) => entry.amountDiff <= tolerance && entry.dayDiff <= 7)
    .sort((a, b) => a.amountDiff - b.amountDiff || a.dayDiff - b.dayDiff)
    .slice(0, limit)
    .map((entry) => entry.row);
}

/**
 * #133 step B — the pick-existing "duplicate" door: rows already living
 * on the counter account that could BE the other leg of the anchor.
 * Opposite sign, close in amount (±2% with a €1 floor) and date (±7
 * days), not already paired or linked, never a split container. Sorted
 * best-first: exact amounts before near ones, then by date distance.
 */
export function counterDuplicates(
  rows: readonly TransactionRow[],
  counterAccountId: string,
  anchor: { id: string; amountCents: number; date: string },
  limit = 5,
): TransactionRow[] {
  return nearMatches(rows, counterAccountId, anchor, (Math.sign(anchor.amountCents) * -1) as 1 | -1, limit);
}

/**
 * #237 (user decision "a"): the WALLET story — PayPal-style feeds show
 * both halves of one purchase as debits (the top-up income legs never
 * arrive), so the other leg of a bank debit can be a SAME-SIGN row on
 * the wallet account. Same nearness rules as counterDuplicates; the
 * caller offers these only when no opposite-sign twin exists.
 */
export function counterSameSignCandidates(
  rows: readonly TransactionRow[],
  counterAccountId: string,
  anchor: { id: string; amountCents: number; date: string },
  limit = 5,
): TransactionRow[] {
  return nearMatches(rows, counterAccountId, anchor, Math.sign(anchor.amountCents) as 1 | -1, limit);
}

/**
 * #237: the fork's "show all" list — every row on the counter account
 * that could still be pointed at (open: unlinked, unpaired either way,
 * not a split container), newest first. The near candidates above are
 * its head; this is the browse view behind them.
 */
export function counterOpenRows(
  rows: readonly TransactionRow[],
  counterAccountId: string,
  anchorId: string,
  limit = 30,
): TransactionRow[] {
  const pointed = pointedAtIds(rows);
  return rows
    .filter((row) => openRow(row, counterAccountId, anchorId, pointed))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}
