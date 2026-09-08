import type { ReceiptItem, ReceiptPayment, ReceiptSource, TransactionRow } from '@/db/types';

/**
 * Store receipts domain (receipts design S2) — all pure: matching
 * fetched receipts to transactions, mapping the AH payload shapes, and
 * parsing OCR text from photo receipts into the same item shape.
 */

// ── matching ────────────────────────────────────────────────────────────

/** merchant fingerprints per store, tested against tx.merchant */
const STORE_MERCHANT: Partial<Record<ReceiptSource, RegExp>> = {
  ah: /albert\s*heijn|\bah\b/i,
  jumbo: /jumbo/i,
  bol: /bol\.com|\bbol\b/i,
  coolblue: /coolblue/i,
  mediamarkt: /media\s*markt/i,
  amazon: /amazon/i,
};

/** operator overrides from the catalog (R9): admin-curated patterns win
 *  over the bundled fingerprints so matching improves without releases */
let catalogStorePatterns: Partial<Record<ReceiptSource, RegExp>> = {};

export function setCatalogStorePatterns(rules: readonly { id: string; patterns: string[] }[]): void {
  const next: Partial<Record<ReceiptSource, RegExp>> = {};
  for (const rule of rules) {
    const parts = rule.patterns.map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    try {
      next[rule.id as ReceiptSource] = new RegExp(parts.join('|'), 'i');
    } catch {
      // a broken operator pattern must never break matching
    }
  }
  catalogStorePatterns = next;
}

export interface MatchableReceipt {
  id: string;
  source: ReceiptSource;
  date: string;
  totalCents: number;
  /** how it was paid, when the store exposes it (R5) */
  payment?: ReceiptPayment;
}

/** resolves a transaction's paying-account IBAN/PAN tail, when known */
export type AccountTailOf = (tx: TransactionRow) => string | undefined;

const dayDiff = (a: string, b: string): number => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));

/**
 * Payment awareness (R5 ruling): when the receipt names the paying
 * account's tail AND at least one candidate's account matches it, the
 * mismatching candidates drop out; when NO candidate matches (store
 * cards vs IBAN tails vary) the tail only downranks via scoring.
 */
function applyPaymentFilter(
  receipt: MatchableReceipt,
  candidates: TransactionRow[],
  tailOf?: AccountTailOf,
): TransactionRow[] {
  const tail = receipt.payment?.accountTail;
  if (!tail || !tailOf) return candidates;
  const hits = candidates.filter((tx) => tailOf(tx)?.endsWith(tail));
  return hits.length > 0 ? hits : candidates;
}

/** design rule: amount ± 2 cents, date ± 2 days, merchant as tiebreaker */
export function matchCandidates(
  receipt: MatchableReceipt,
  txs: readonly TransactionRow[],
  tailOf?: AccountTailOf,
): TransactionRow[] {
  const base = txs
    .filter(
      (tx) =>
        tx.deleted === 0 &&
        tx.txType === 'expense' &&
        Math.abs(-tx.amountCents - receipt.totalCents) <= 2 &&
        dayDiff(tx.date, receipt.date) <= 2,
    )
    .sort((a, b) => scoreOf(receipt, b) - scoreOf(receipt, a));
  return applyPaymentFilter(receipt, base, tailOf);
}

const merchantHit = (source: ReceiptSource, tx: TransactionRow): boolean =>
  (catalogStorePatterns[source] ?? STORE_MERCHANT[source])?.test(tx.merchant ?? '') ?? false;

function scoreOf(receipt: MatchableReceipt, tx: TransactionRow): number {
  const merchant = merchantHit(receipt.source, tx) ? 2 : 0;
  const exact = -tx.amountCents === receipt.totalCents ? 1 : 0;
  return merchant + exact + (2 - dayDiff(tx.date, receipt.date)) * 0.1;
}

/**
 * Auto-attach policy (user ruling: "rung 1 is enough"): only a rung-1
 * SINGLE — exact amount, date ±2d, merchant fingerprint — attaches by
 * itself; everything else stays unlinked for a manual pick.
 */
export function bestMatch(
  receipt: MatchableReceipt,
  txs: readonly TransactionRow[],
  takenTxIds: ReadonlySet<string>,
  tailOf?: AccountTailOf,
): string | null {
  const rung1 = matchCandidates(receipt, txs, tailOf).filter(
    (tx) => !takenTxIds.has(tx.id) && -tx.amountCents === receipt.totalCents && merchantHit(receipt.source, tx),
  );
  return rung1.length === 1 ? rung1[0].id : null;
}

/**
 * The manual picker's ladder (approved receipts v2): start at the
 * near-matches, widen on demand — same price first, then the latest
 * expenses so the picker never dead-ends.
 */
export interface CandidateLadder {
  /** amount ±2c and date ±2d, best first (rungs 1–2) */
  primary: TransactionRow[];
  /** rung 3 (same amount, any date) + rung 4 (latest expenses) behind "show more" */
  more: TransactionRow[];
}

export function candidateLadder(receipt: MatchableReceipt, txs: readonly TransactionRow[]): CandidateLadder {
  const primary = matchCandidates(receipt, txs).slice(0, 8);
  const seen = new Set(primary.map((tx) => tx.id));
  const expenses = txs
    .filter((tx) => tx.deleted === 0 && tx.txType === 'expense' && !seen.has(tx.id))
    .sort((a, b) => b.date.localeCompare(a.date));
  const sameAmount = expenses.filter((tx) => -tx.amountCents === receipt.totalCents);
  const sameAmountIds = new Set(sameAmount.map((tx) => tx.id));
  const latest = expenses.filter((tx) => !sameAmountIds.has(tx.id));
  return { primary, more: [...sameAmount, ...latest].slice(0, 12) };
}

// ── AH payload mapping (mobile-services v2 shapes) ──────────────────────

export interface AhReceiptSummary {
  transactionId: string;
  transactionMoment: string;
  total?: { amount?: { amount?: number } };
}

export interface AhReceiptUiItem {
  type: string;
  quantity?: string | number;
  description?: string;
  amount?: string;
}

const euroToCents = (value: number | string | undefined): number => {
  const n = typeof value === 'string' ? Number.parseFloat(value.replace(',', '.')) : value;
  return Number.isFinite(n) ? Math.round((n as number) * 100) : 0;
};

export function mapAhSummary(row: AhReceiptSummary): MatchableReceipt & { storeId: string } {
  return {
    id: row.transactionId,
    storeId: row.transactionId,
    source: 'ah',
    date: row.transactionMoment.slice(0, 10),
    totalCents: euroToCents(row.total?.amount?.amount),
  };
}

/**
 * Payment line → how the receipt was paid (R5, AH-only per ruling 3).
 * AH prints e.g. "PINNEN" plus a masked card/IBAN ending in a few
 * digits; the tail constrains transaction matching to that account.
 */
const AH_PAYMENT_LINE = /pin|maestro|mastercard|visa|ideal|contactloos/i;
// exactly two mask chars suffice: a longer run still matches at its end
const MASKED_TAIL = /[*Xx•]{2}\s?(\d{3,4})\b/;
const TRAILING_DIGITS = /(\d{4})$/;

export function mapAhPayment(uiItems: readonly AhReceiptUiItem[]): ReceiptPayment | undefined {
  for (const item of uiItems) {
    const text = (item.description ?? '').trim();
    if (!AH_PAYMENT_LINE.test(text)) continue;
    const tail = MASKED_TAIL.exec(text)?.[1] ?? TRAILING_DIGITS.exec(text)?.[1];
    return { method: text.slice(0, 40), accountTail: tail };
  }
  return undefined;
}

/** the detail's receiptUiItems: keep the products, drop dividers/totals */
export function mapAhItems(uiItems: readonly AhReceiptUiItem[]): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  for (const item of uiItems) {
    if (item.type !== 'product' || !item.description) continue;
    const qty = typeof item.quantity === 'string' ? Number.parseInt(item.quantity, 10) : item.quantity;
    items.push({
      name: item.description,
      qty: qty !== undefined && Number.isFinite(qty) && qty > 1 ? qty : undefined,
      totalCents: euroToCents(item.amount),
    });
  }
  return items;
}

// ── OCR text → items (photo receipts) ───────────────────────────────────

/** register noise a Dutch receipt prints around the products */
const OCR_SKIP = /totaal|subtotaal|bonus|korting|te betalen|pinnen|betaald|wisselgeld|btw|koopzegels|airmiles|spaar|statiegeld retour/i;
// input is a single OCR line hard-capped at 60 chars below, so the
// lazy group's backtracking is bounded — not super-linear in practice
const OCR_ITEM = /^(?:(\d{1,2})\s*[x×]\s*)?(.{2,40}?)\s+(\d{1,4}[.,]\d{2})\s*-?$/; // NOSONAR(S5852) bounded input

export function parseReceiptText(text: string): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().slice(0, 60);
    if (!line || OCR_SKIP.test(line)) continue;
    const match = OCR_ITEM.exec(line);
    if (!match) continue;
    const [, qty, name, price] = match;
    const totalCents = Math.round(Number.parseFloat(price.replace(',', '.')) * 100);
    if (totalCents <= 0) continue;
    items.push({
      name: name.trim(),
      qty: qty ? Number.parseInt(qty, 10) : undefined,
      totalCents,
    });
  }
  return items;
}
