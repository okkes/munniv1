import type { TransactionRow } from '@/db/types';
import { cleanBankText } from '@/lib/text';

/**
 * Imported-vs-linked reconciliation (financial-accounts master plan,
 * user requirement x): when a bank connection covers an account that
 * statement uploads already fed, THE CONNECTION IS THE TRUTH. Imported
 * rows inside the connection's coverage either match a linked row (the
 * user's edits migrate — with a per-match opt-out) or they are
 * mismatches, shown in full before deletion. Rows OUTSIDE the coverage
 * are history the connection cannot see and always survive ("mismatch
 * is based on in-between dates, not the edges").
 *
 * Provenance without an evidence table (v1): statement parsers write
 * SYNTHETIC references ('ing:…', 'paypal:…'); provider rows carry the
 * bank's own reference. CAMT files carry real references too — those
 * collide with the provider rows by deterministic id and never surface
 * here as duplicates.
 */

const SYNTHETIC_REF = /^(ing|paypal):/;

/** a row whose reference the parser invented — statement-fed evidence */
export const isImportedRow = (tx: Pick<TransactionRow, 'importRef'>): boolean =>
  !!tx.importRef && SYNTHETIC_REF.test(tx.importRef);

/** a row vouched for by a provider or a reference-carrying statement */
export const isLinkedRow = (tx: Pick<TransactionRow, 'importRef'>): boolean =>
  !!tx.importRef && !SYNTHETIC_REF.test(tx.importRef);

export interface ReconcileMatch {
  imported: TransactionRow;
  linked: TransactionRow;
}

export interface ReconcilePlan {
  /** linked coverage, exclusive edges (yyyy-mm-dd) — null when no linked rows */
  coverage: { from: string; to: string } | null;
  /** imported rows the truth confirms — edits migrate unless opted out */
  matches: ReconcileMatch[];
  /** imported rows INSIDE the coverage with no counterpart — deleted after review */
  mismatched: TransactionRow[];
  /** imported rows outside the coverage — history that survives untouched */
  kept: TransactionRow[];
}

const fingerprint = (tx: TransactionRow) => `${tx.date}:${tx.amountCents}`;
const normName = (raw: string | undefined) => (cleanBankText(raw ?? '') ?? '').toLowerCase().replaceAll(/[^a-z0-9]/g, '');

/**
 * Build the plan for ONE account's raw rows (any mix of sources).
 * Matching is deliberately strict-then-fuzzy: same day + same amount is
 * a candidate; when several linked rows share that shape, the closest
 * counterparty name wins. A linked row vouches for at most one import.
 */
export function reconcilePlan(rows: readonly TransactionRow[]): ReconcilePlan {
  const live = rows.filter((r) => r.deleted === 0);
  const linked = live.filter(isLinkedRow);
  const imported = live.filter(isImportedRow);
  if (linked.length === 0 || imported.length === 0) {
    return { coverage: null, matches: [], mismatched: [], kept: imported };
  }

  const dates = linked.map((r) => r.date).sort((a, b) => a.localeCompare(b));
  const coverage = { from: dates[0], to: dates.at(-1)! };

  const byShape = new Map<string, TransactionRow[]>();
  for (const row of linked) {
    const key = fingerprint(row);
    byShape.set(key, [...(byShape.get(key) ?? []), row]);
  }

  const claimed = new Set<string>();
  const matches: ReconcileMatch[] = [];
  const mismatched: TransactionRow[] = [];
  const kept: TransactionRow[] = [];

  for (const row of imported) {
    // edges are uncertain (a statement's partial first/last day) — only
    // rows STRICTLY inside the linked coverage are judged
    const inRange = row.date > coverage.from && row.date < coverage.to;
    if (!inRange) {
      kept.push(row);
      continue;
    }
    const candidates = (byShape.get(fingerprint(row)) ?? []).filter((c) => !claimed.has(c.id));
    if (candidates.length === 0) {
      mismatched.push(row);
      continue;
    }
    const name = normName(row.merchant);
    candidates.sort((a, b) => {
      const aHit = normName(a.merchant).includes(name) || name.includes(normName(a.merchant)) ? 0 : 1;
      const bHit = normName(b.merchant).includes(name) || name.includes(normName(b.merchant)) ? 0 : 1;
      return aHit - bHit;
    });
    claimed.add(candidates[0].id);
    matches.push({ imported: row, linked: candidates[0] });
  }

  return { coverage, matches, mismatched, kept };
}
