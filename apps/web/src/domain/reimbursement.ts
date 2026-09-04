import type { TransactionRow, TxReimbursement, TxSplit, TxSplitCat } from '@/db/types';
import { EXPECTED_REIMBURSE_ID, RECEIVED_REIMBURSE_ID, REIMBURSED_ID, UNCATEGORIZED_ID, specialCatType } from '@/domain/categories';

/**
 * Reimbursement math. The expense transaction owns the links; amounts are
 * integer cents and always positive. An expense can never be reimbursed
 * beyond its own size, and a credit can never give more than it is worth.
 */

/** total cents already reimbursed against an expense */
export function totalReimbursedCents(tx: Pick<TransactionRow, 'reimbursements'>): number {
  return (tx.reimbursements ?? []).reduce((sum, r) => sum + r.amountCents, 0);
}

/** effective cost after reimbursements (expense stays <= 0) */
export function netAmountCents(tx: Pick<TransactionRow, 'amountCents' | 'reimbursements'>): number {
  if (tx.amountCents >= 0) return tx.amountCents;
  return Math.min(0, tx.amountCents + totalReimbursedCents(tx));
}

/** cents of the expense still open for reimbursement */
export function remainingCents(tx: Pick<TransactionRow, 'amountCents' | 'reimbursements'>): number {
  if (tx.amountCents >= 0) return 0;
  return Math.max(0, Math.abs(tx.amountCents) - totalReimbursedCents(tx));
}

/**
 * Clamp a requested link amount to what is actually possible:
 * bounded by the open remainder of the expense and the size of the credit.
 * Returns 0 when the pair cannot be linked at all.
 */
export function clampReimbursement(
  expense: Pick<TransactionRow, 'amountCents' | 'reimbursements'>,
  creditAmountCents: number,
  requestedCents: number,
): number {
  if (expense.amountCents >= 0 || creditAmountCents <= 0 || requestedCents <= 0) return 0;
  return Math.min(requestedCents, remainingCents(expense), creditAmountCents);
}

/** add or replace the link for one credit tx — keyed per (credit, PART)
 *  since #126 r5: the same credit can pay different parts back */
export function withLink(
  reimbursements: TxReimbursement[] | undefined,
  txId: string,
  amountCents: number,
  partId?: string,
  creditPartId?: string,
): TxReimbursement[] {
  const rest = (reimbursements ?? []).filter((r) => r.txId !== txId || r.partId !== partId || r.creditPartId !== creditPartId);
  return amountCents > 0
    ? [...rest, { txId, amountCents, ...(partId ? { partId } : {}), ...(creditPartId ? { creditPartId } : {}) }]
    : rest;
}

/**
 * Cents a credit has given away as reimbursements. Derived — the
 * expense rows own the links, the credit carries nothing itself.
 */
export function givenCents(
  allTxs: readonly Pick<TransactionRow, 'reimbursements'>[],
  creditId: string,
): number {
  let sum = 0;
  for (const tx of allTxs) {
    for (const link of tx.reimbursements ?? []) {
      if (link.txId === creditId) sum += link.amountCents;
    }
  }
  return sum;
}

/** #197: cents ONE part of a split credit has given away — links that
 *  name the part explicitly (whole-credit links never count here) */
export function creditPartGivenCents(
  allTxs: readonly Pick<TransactionRow, 'reimbursements'>[],
  creditId: string,
  creditPartId: string,
): number {
  let sum = 0;
  for (const tx of allTxs) {
    for (const link of tx.reimbursements ?? []) {
      if (link.txId === creditId && link.creditPartId === creditPartId) sum += link.amountCents;
    }
  }
  return sum;
}

/** what a credit is still worth after refunding elsewhere (income stays >= 0) */
export function netCreditCents(tx: Pick<TransactionRow, 'amountCents'>, given: number): number {
  if (tx.amountCents <= 0) return tx.amountCents;
  return Math.max(0, tx.amountCents - given);
}

/** the categories a settlement consumes FIRST (user rule): the expected
 *  and received reimbursement subs of the locked tree */
export const REIMB_CAT_IDS = [EXPECTED_REIMBURSE_ID, RECEIVED_REIMBURSE_ID];

/**
 * The settlement rewrite for a (split) transaction's own category
 * partition (`cats`) — reimbursement redesign, docs/
 * reimbursement-redesign.md: slices carry the GROSS attribution and the
 * settled value sits in an explicit `reimbursed` slice on BOTH sides of
 * a link — no more categories silently shrinking to €0.
 *
 * Growing the settled amount consumes the other slices in priority
 * order: expected/received reimbursement first, then uncategorized,
 * then the largest slice (ties alphabetically by name). Shrinking it
 * (a link removed/reduced) frees the value onto "uncategorized" —
 * deliberately NOT the original category, per the user's rule.
 *
 * #228 carve-out: when a SPECIAL category owns the subject (it claims
 * the whole (split) transaction — the one counterparty's story), the
 * partition is canonical both ways: the special holds the unsettled
 * remainder and shrinking returns value to IT, never to uncategorized.
 * A special must never end up sharing a spread with anything but
 * `reimbursed` bookkeeping (the ss-reported unlink hole).
 *
 * Legacy rows (pre-redesign) carried NET slices; the shortfall against
 * the gross amount IS their previously settled value, so normalization
 * tops the `reimbursed` slice up first — one pass through here migrates
 * any old row. (#228: entries carry no counterparty — the subject's one
 * link is its own field and settlement never touches it.)
 */
export function settledCats(
  tx: Pick<TransactionRow, 'amountCents' | 'catId' | 'cats'>,
  reimbursedCents: number,
  nameOf: (catId: string) => string,
): TxSplitCat[] {
  const primary = tx.catId ?? UNCATEGORIZED_ID;
  const grossAbs = Math.abs(tx.amountCents);
  const target = Math.min(Math.max(0, reimbursedCents), grossAbs);
  const real = (tx.cats ?? []).filter((c) => c.catId !== REIMBURSED_ID);
  const claimant = real.length <= 1 && specialCatType(real[0]?.catId ?? primary) ? (real[0]?.catId ?? primary) : undefined;
  if (claimant) {
    const rest = grossAbs - target;
    const canonical = [
      ...(rest > 0 ? [{ catId: claimant, amountCents: rest }] : []),
      ...(target > 0 ? [{ catId: REIMBURSED_ID, amountCents: target }] : []),
    ];
    return canonical.length > 0 ? canonical : [{ catId: claimant, amountCents: 0 }];
  }
  const seeded: TxSplitCat[] = tx.cats?.length
    ? tx.cats.map((c) => ({ catId: c.catId, amountCents: c.amountCents }))
    : [{ catId: primary, amountCents: grossAbs }];
  return settlePartition(seeded, primary, grossAbs, reimbursedCents, nameOf);
}

/** the shared settlement rewrite over a flat category partition */
function settlePartition<T extends { catId: string; amountCents: number }>(
  slices: (T | { catId: string; amountCents: number })[],
  primary: string,
  grossAbs: number,
  reimbursedCents: number,
  nameOf: (catId: string) => string,
): T[] {
  const target = Math.min(Math.max(0, reimbursedCents), grossAbs);
  let reimbursed = slices.find((s) => s.catId === REIMBURSED_ID);
  if (!reimbursed) {
    reimbursed = { catId: REIMBURSED_ID, amountCents: 0 };
    slices.push(reimbursed);
  }
  // legacy NET rows: the missing value was settled away before the
  // redesign — restore it as reimbursed so the sum is the gross again
  const sum = slices.reduce((total, s) => total + s.amountCents, 0);
  if (sum < grossAbs) reimbursed.amountCents += grossAbs - sum;

  const delta = target - reimbursed.amountCents;
  if (delta < 0) {
    // settled value coming back: it lands on uncategorized, never the
    // original category (user rule)
    reimbursed.amountCents = target;
    const uncat = slices.find((s) => s.catId === UNCATEGORIZED_ID);
    if (uncat) uncat.amountCents += -delta;
    else slices.push({ catId: UNCATEGORIZED_ID, amountCents: -delta });
  } else if (delta > 0) {
    consumeIntoReimbursed(slices, reimbursed, delta, nameOf);
  }

  const kept = slices.filter((s) => s.amountCents > 0);
  return (kept.length > 0 ? kept : [{ catId: primary, amountCents: 0 }]) as T[];
}

/** move `delta` cents from the other slices into `reimbursed`, in the
 *  user-ruled order: expected/received → uncategorized → largest slice
 *  (ties alphabetically by name) */
type FlatSlice = { catId: string; amountCents: number };
function consumeIntoReimbursed(slices: FlatSlice[], reimbursed: FlatSlice, delta: number, nameOf: (catId: string) => string): void {
  const takeFrom = (slice: FlatSlice | undefined) => {
    if (!slice || delta <= 0) return;
    const taken = Math.min(slice.amountCents, delta);
    slice.amountCents -= taken;
    reimbursed.amountCents += taken;
    delta -= taken;
  };
  for (const id of REIMB_CAT_IDS) takeFrom(slices.find((s) => s.catId === id));
  takeFrom(slices.find((s) => s.catId === UNCATEGORIZED_ID));
  while (delta > 0) {
    const candidates = slices.filter((s) => s.amountCents > 0 && s.catId !== REIMBURSED_ID);
    if (candidates.length === 0) break;
    candidates.sort((a, b) => b.amountCents - a.amountCents || nameOf(a.catId).localeCompare(nameOf(b.catId)));
    takeFrom(candidates[0]);
  }
}

/** cents of the credit not yet promised to any expense */
export function creditRemainingCents(tx: Pick<TransactionRow, 'amountCents'>, given: number): number {
  return Math.max(0, tx.amountCents - given);
}

// ── #228 (user 2026-08-13): reimbursement on a SPLIT transaction stays
// on the split — the settle bookkeeping lives in the PART's own `cats`
// partition, never as a pseudo-part in the container's `splits` (the
// retired shape corrupted sibling amounts: the greedy consume ignored
// which part the link named). The parent is impacted through value math
// only. ──

/** the settled value a (split) transaction's own partition carries */
export function reimbursedInCats(cats: readonly TxSplitCat[] | undefined): number {
  return (cats ?? []).filter((c) => c.catId === REIMBURSED_ID).reduce((sum, c) => sum + c.amountCents, 0);
}

/** the compat-shadow rule: the largest entry represents the partition */
const largestEntry = (entries: readonly TxSplitCat[]): TxSplitCat =>
  entries.reduce((a, b) => (b.amountCents > a.amountCents ? b : a), entries[0]);

/** what one PART is worth after its own settled bookkeeping (positive
 *  magnitude — the container's sign gives the direction) */
export function partNetCents(part: Pick<TxSplit, 'amountCents' | 'cats'>): number {
  return Math.max(0, Math.abs(part.amountCents) - reimbursedInCats(part.cats));
}

/** one waterline step: raise the lowest parts evenly toward the next
 *  level (or spend the last cents one by one, array order) — returns
 *  what is left to give (S3776: out of the loop) */
function fillLowestParts(parts: TxSplit[], left: number): number {
  const min = Math.min(...parts.map((p) => p.amountCents));
  const lowest = parts.filter((p) => p.amountCents === min);
  const others = parts.filter((p) => p.amountCents > min);
  const ceiling = others.length ? Math.min(...others.map((p) => p.amountCents)) : Infinity;
  const room = ceiling === Infinity ? left : Math.min(left, (ceiling - min) * lowest.length);
  const each = Math.floor(room / lowest.length);
  if (each > 0) {
    for (const part of lowest) part.amountCents += each;
    return left - each * lowest.length;
  }
  // cent remainders that cannot level evenly: one by one, array order
  for (const part of lowest.slice(0, left)) part.amountCents += 1;
  return Math.max(0, left - lowest.length);
}

/** legacy repair: give `deficit` cents back to the parts the retired
 *  container-level consume drained — a waterline fill (the smallest
 *  parts rise first, exactly reversing the largest-first drain), stable
 *  by array order so concurrent heals converge byte-identically */
export function restorePartAmounts(parts: TxSplit[], deficit: number): void {
  let left = deficit;
  while (left > 0 && parts.length > 0) {
    left = fillLowestParts(parts, left);
  }
}

/** one part's settle: its own `cats` absorb the links naming it — the
 *  same rules a whole row follows (a special-claimed part keeps the
 *  canonical two-slice shape); an untouched bare part stays bare */
function settledPart(part: TxSplit, settled: number, nameOf: (catId: string) => string): TxSplit {
  if (settled <= 0 && !part.cats?.some((c) => c.catId === REIMBURSED_ID)) return part;
  const next = settledCats({ amountCents: part.amountCents, catId: part.catId, cats: part.cats }, settled, nameOf);
  const real = next.filter((c) => c.catId !== REIMBURSED_ID);
  // a single bare entry needs no partition — the part's catId carries it
  if (next.length === 1 && real.length === 1) return { ...part, catId: real[0].catId, cats: undefined };
  return { ...part, cats: next, ...(real.length ? { catId: largestEntry(real).catId } : {}) };
}

/**
 * A container's settle (#228): every REAL part settles inside its own
 * `cats` by the cents the links NAME it for; legacy `reimbursed`
 * pseudo-parts are stripped and the amounts they drained from siblings
 * are restored (waterline fill). Part amounts always sum back to the
 * container's gross.
 */
export function settleContainerParts(
  tx: Pick<TransactionRow, 'amountCents' | 'splits'>,
  centsByPartId: ReadonlyMap<string, number>,
  nameOf: (catId: string) => string,
): TxSplit[] {
  const parts = (tx.splits ?? []).filter((s) => s.catId !== REIMBURSED_ID).map((s) => ({ ...s }));
  const grossAbs = Math.abs(tx.amountCents);
  const deficit = grossAbs - parts.reduce((sum, p) => sum + p.amountCents, 0);
  if (deficit > 0) restorePartAmounts(parts, deficit);
  return parts.map((part) => settledPart(part, part.id ? (centsByPartId.get(part.id) ?? 0) : 0, nameOf));
}

/** is this row a real CONTAINER for settle purposes? More than one real
 *  part — or typed-v2 parts (they carry ids; the retired container-level
 *  consume could shrink a container to one survivor, and legacy pre-#211
 *  category slices never had ids, so the id is the tiebreaker) */
export function isReimbContainer(tx: Pick<TransactionRow, 'splits'>): boolean {
  const real = (tx.splits ?? []).filter((s) => s.catId !== REIMBURSED_ID);
  return real.length > 1 || real.some((s) => !!s.id);
}

export interface ReimbSettlePatch {
  catId?: string;
  cats?: TxSplitCat[] | null;
  splits?: TxSplit[] | null;
}

/**
 * The settle bookkeeping fields one side of a link pair needs — the ONE
 * builder the write hook and the every-boot normalizer share, so the
 * two can never drift. A container settles per PART (the cents each
 * link names); a whole row settles in its own `cats` with the largest
 * real entry as the catId shadow (single entries collapse the partition
 * away entirely).
 */
export function reimbSettleFields(
  tx: Pick<TransactionRow, 'amountCents' | 'catId' | 'cats' | 'splits'>,
  totalCents: number,
  centsByPartId: ReadonlyMap<string, number>,
  nameOf: (catId: string) => string,
): ReimbSettlePatch {
  if (isReimbContainer(tx)) return { splits: settleContainerParts(tx, centsByPartId, nameOf) };
  const next = settledCats(tx, totalCents, nameOf);
  const real = next.filter((c) => c.catId !== REIMBURSED_ID);
  const clearSplits = tx.splits?.length ? { splits: null } : {};
  if (next.length === 1 && real.length === 1) {
    return { catId: real[0].catId, cats: null, ...clearSplits };
  }
  return {
    cats: next,
    ...(real.length ? { catId: largestEntry(real).catId } : {}),
    ...clearSplits,
  };
}

/** group one side's links by the PART they name; container-level cents
 *  (legacy partId-less links) land on the largest open part */
export function reimbCentsByPart(
  links: readonly TxReimbursement[],
  key: 'partId' | 'creditPartId',
  splits: readonly TxSplit[] | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  let loose = 0;
  for (const link of links) {
    const id = link[key];
    if (id) map.set(id, (map.get(id) ?? 0) + link.amountCents);
    else loose += link.amountCents;
  }
  if (loose > 0) {
    const target = largestOpenPartId(splits, map);
    if (target) map.set(target, (map.get(target) ?? 0) + loose);
  }
  return map;
}

/** #235 (user order): where a container-level link's cents land — the
 *  part still EXPECTING reimbursement first, then an uncategorized one,
 *  then the largest open part. A drained part is last resort only. */
const partPreference = (part: TxSplit): number => {
  const holds = (pred: (catId: string) => boolean): boolean =>
    part.cats?.length ? part.cats.some((c) => pred(c.catId) && c.amountCents > 0) : pred(part.catId);
  if (holds((id) => REIMB_CAT_IDS.includes(id))) return 0;
  if (holds((id) => id === UNCATEGORIZED_ID)) return 1;
  return 2;
};

/** the part a container-level link deterministically lands on: the
 *  user-ruled preference order (#235 — expected/received reimbursement
 *  → uncategorized → largest open), sized by what is still open (gross
 *  minus what links already name it for), ties by array order — both
 *  devices pick the same part */
export function largestOpenPartId(
  splits: readonly TxSplit[] | undefined,
  centsByPartId: ReadonlyMap<string, number>,
): string | undefined {
  let best: { id: string; open: number; pref: number } | undefined;
  for (const part of (splits ?? []).filter((s) => s.catId !== REIMBURSED_ID)) {
    if (!part.id) continue;
    const open = part.amountCents - (centsByPartId.get(part.id) ?? 0);
    // a fully-settled part takes no more, whatever it holds
    const pref = open > 0 ? partPreference(part) : 3;
    if (!best || pref < best.pref || (pref === best.pref && open > best.open)) best = { id: part.id, open, pref };
  }
  return best?.id;
}

/** still waiting on settlement (redesign): an expected/received slice
 *  with value left — settled rows carry only `reimbursed` and drop out.
 *  #211: the partition lives on the row's `cats`; #228: a container
 *  answers through its parts (their catId or their own spreads). */
export function hasUnsettledReimbursement(tx: Pick<TransactionRow, 'amountCents' | 'catId' | 'cats' | 'splits'>): boolean {
  const waiting = (catId: string, cents: number) => REIMB_CAT_IDS.includes(catId) && cents > 0;
  if (tx.splits?.length) {
    return tx.splits.some(
      (part) =>
        (part.cats?.length ? false : waiting(part.catId, part.amountCents)) ||
        part.cats?.some((c) => waiting(c.catId, c.amountCents)),
    );
  }
  if (tx.cats?.length) return tx.cats.some((c) => waiting(c.catId, c.amountCents));
  return !!tx.catId && REIMB_CAT_IDS.includes(tx.catId) && tx.amountCents !== 0;
}
