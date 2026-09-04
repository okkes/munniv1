import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import type { TransactionRow, TxMetaRow, TxReimbursement, TxSplit, TxSplitCat } from '@/db/types';
import { visibleAccounts, writeTxTransform } from '@/db/joined';
import type { SpaceAccount, TxTransformFields } from '@/db/joined';
import { REIMBURSED_ID, UNCATEGORIZED_ID, isMovementCat, specialCatType } from '@/domain/categories';
import { matchCounterAccount } from '@/domain/counterClue';
import type { ClueTx } from '@/domain/counterClue';
import { defaultFamilyFor } from '@/domain/defaultAccounts';
import type { DefaultFamily } from '@/domain/defaultAccounts';
import { catMirrorSourceId, foldPartId, mirrorTxId, partMirrorSourceId } from '@/domain/feedIds';
import { primaryCatId } from '@/domain/splits';
import { standardTypeFor } from '@/domain/txKind';
import { accountStamp, movementCatFor } from '@/domain/txType';
import { planMirrorChange } from './mirrorMint';
import { ensureDefaultAccount } from './defaultAccounts';

/** the row's clue text for the transfer matcher (#228 r3) — the user's
 *  rename counts as a title clue too */
const clueOf = (raw: TransactionRow, meta: TxMetaRow | undefined): ClueTx => ({
  merchant: raw.merchant,
  titleOverride: meta?.titleOverride ?? raw.titleOverride,
  description: raw.description,
  counterIban: raw.counterIban,
});

/** a bare movement part's family, null when the part needs no fold */
const barePartFamily = (s: TxSplit): DefaultFamily | null =>
  isMovementCat(s.catId) && !s.linkedAccountId && !s.transferPeerId ? defaultFamilyFor(s.catId) : null;

/** #228 r3: the row-level bare transfer's outcome — a clue-matched
 *  counterparty (the bijection refiles the category from its kind), or
 *  the stand-down to Uncategorized + review */
function resolveBareTransfer(
  clue: ClueTx,
  candidates: readonly SpaceAccount[],
  accountId: string,
  amountCents: number,
): TxTransformFields {
  const match = matchCounterAccount(clue, candidates, accountId);
  if (match) return { linkedAccountId: match.id, catId: movementCatFor(match.type, amountCents) };
  return { catId: UNCATEGORIZED_ID, txType: standardTypeFor(amountCents), needsReview: 1 };
}

/** the part-level twin: link the matched account, or the part goes
 *  uncategorized (its stale stored txType drops) and the container
 *  returns to review */
function resolveBareTransferPart(
  slice: TxSplit,
  clue: ClueTx,
  candidates: readonly SpaceAccount[],
  accountId: string,
  amountCents: number,
): { part: TxSplit; sendBack?: boolean } {
  const match = matchCounterAccount(clue, candidates, accountId);
  if (match) {
    const catId = movementCatFor(match.type, amountCents);
    return { part: { ...slice, linkedAccountId: match.id, catId, txType: specialCatType(catId) ?? slice.txType } };
  }
  const { txType: _stale, ...rest } = slice;
  return { part: { ...rest, catId: UNCATEGORIZED_ID }, sendBack: true };
}

/** the splits arm of the bare-row fold (S3776: out of migrateRow): pot
 *  families take their default, transfer parts resolve by clue or stand
 *  the container back to review (#228 r3). Null = nothing to fold. */
async function foldBareParts(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  raw: TransactionRow,
  meta: TxMetaRow | undefined,
  candidatesFor: (spaceId: string) => Promise<SpaceAccount[]>,
  splits: readonly TxSplit[] | undefined,
): Promise<(TxTransformFields & { splits: TxSplit[] }) | null> {
  if (!(splits ?? []).some((s) => !!barePartFamily(s))) return null;
  const clue = clueOf(raw, meta);
  const next: TxSplit[] = [];
  let sendBack = false;
  for (const slice of splits ?? []) {
    const family = barePartFamily(slice);
    if (!family) {
      next.push(slice);
      continue;
    }
    if (family === 'transfer') {
      const folded = resolveBareTransferPart(slice, clue, await candidatesFor(spaceId), raw.accountId, raw.amountCents);
      next.push(folded.part);
      sendBack ||= !!folded.sendBack;
      continue;
    }
    next.push({ ...slice, linkedAccountId: await ensureDefaultAccount(store, repo, spaceId, family) });
  }
  return { splits: next, ...(sendBack ? { needsReview: 1 as const } : {}) };
}

/**
 * #133 ruling 3, widened by #221: bare MOVEMENT rows — a ◆ movement
 * category (set aside, loan repayment, cash withdraw, …) with no
 * counterparty — link onto the space's DEFAULT account for that family.
 * The link runs through the ONE write choke, so the mirror lifecycle
 * mints the counter leg and moves real balances, exactly as approved
 * ("migrate… balances then move"). Split PARTS with bare movement
 * categories get the same treatment through the part-mirror machinery.
 *
 * EVERY BOOT now (#221, the marker retired): the server keeps writing
 * keyword-predicted movement categories with no counterparty (GcIngest),
 * so a one-shot migration can never stay ahead — each boot heals what
 * arrived since the last one. Idempotent: already-linked rows skip, and
 * deterministic default-account and mirror ids converge across devices.
 * Interest/fees categories are value stories, not movements — untouched.
 * Rows ON special accounts are the pot's own ledger and never link
 * (their stamp guards them). The ATM pair links the cash wallet, not
 * the default bank account (defaultFamilyFor).
 *
 * #228 r3 (user rule): the TRANSFER family never folds onto its default
 * — the bank text must name a real tracked account (the clue-matcher);
 * without a clue the row stands down to Uncategorized and goes back to
 * review. Its default account remains a manual pick only.
 */
export async function migrateBareSpecialRows(store: StorageBackend, repo: Repo): Promise<number> {
  const accounts = new Map((await store.allRows('account')).map((a) => [a.id, a]));
  const stampOf = (accountId: string) => accountStamp(accounts.get(accountId)?.type);

  // the transfer clue-matcher's pool, per space (lazy — most boots never need it)
  const candidatesBySpace = new Map<string, SpaceAccount[]>();
  const candidatesFor = async (spaceId: string): Promise<SpaceAccount[]> => {
    const cached = candidatesBySpace.get(spaceId);
    if (cached) return cached;
    const fresh = await visibleAccounts(store, spaceId);
    candidatesBySpace.set(spaceId, fresh);
    return fresh;
  };

  let touched = 0;

  const migrateRow = async (
    raw: TransactionRow,
    meta: TxMetaRow | undefined,
    spaceId: string,
    feedSpaceId: string | undefined,
  ): Promise<void> => {
    if (stampOf(raw.accountId)) return; // the pot's own ledger — never links
    const catId = meta?.catId ?? raw.catId;
    const linkedAccountId = meta?.linkedAccountId ?? raw.linkedAccountId;
    const transferPeerId = meta?.transferPeerId ?? raw.transferPeerId;
    const splits = meta?.splits ?? raw.splits;
    const tx = {
      id: raw.id,
      spaceId,
      feedSpaceId,
      txType: meta?.txType ?? raw.txType,
      needsReview: meta?.needsReview ?? raw.needsReview,
      amountCents: raw.amountCents,
      date: raw.date,
      linkedAccountId,
      transferPeerId,
    };

    // split containers migrate PART BY PART (the container is a vessel)
    const parts = (splits ?? []).filter((s) => s.catId !== 'reimbursed');
    if (parts.length > 1) {
      const folded = await foldBareParts(store, repo, spaceId, raw, meta, candidatesFor, splits);
      if (folded) {
        await writeTxTransform(repo, tx, folded);
        touched++;
      }
      return;
    }

    if (!isMovementCat(catId) || linkedAccountId || transferPeerId) return;
    const family = defaultFamilyFor(catId);
    if (!family) return;
    if (family === 'transfer') {
      // #228 r3: clue-matched real account, or Uncategorized + review
      await writeTxTransform(repo, tx, resolveBareTransfer(clueOf(raw, meta), await candidatesFor(spaceId), raw.accountId, raw.amountCents));
      touched++;
      return;
    }
    const targetId = await ensureDefaultAccount(store, repo, spaceId, family);
    // the choke derives the compat txType: a DEFAULT counter keeps the
    // row wearing its special category (the user's counterparty rule)
    await writeTxTransform(repo, tx, { linkedAccountId: targetId });
    touched++;
  };

  // cheap every-boot gate: only rows that could possibly be bare
  // movements (row cat or a split part) reach the merged read
  const candidate = (row: { catId?: string; linkedAccountId?: string; transferPeerId?: string; splits?: TxSplit[] }) =>
    (isMovementCat(row.catId) && !row.linkedAccountId && !row.transferPeerId) ||
    (row.splits ?? []).some((s) => isMovementCat(s.catId) && !s.linkedAccountId && !s.transferPeerId);

  // feed rows live in their FEED space and carry user decisions on txMeta
  // — the raw loop takes only LOCAL rows, the meta loop the feed overlays
  const feedSpaceIds = new Set((await store.allRows('accountLink')).map((link) => link.feedSpaceId));
  for (const raw of await store.allRows('transaction')) {
    if (raw.deleted !== 0 || feedSpaceIds.has(raw.spaceId) || !candidate(raw)) continue;
    await migrateRow(raw, undefined, raw.spaceId, undefined);
  }
  for (const meta of await store.allRows('txMeta')) {
    if (meta.deleted !== 0 || !candidate(meta)) continue;
    const raw = await store.get('transaction', meta.txId);
    if (raw?.deleted !== 0) continue;
    await migrateRow(raw, meta, meta.spaceId, raw.spaceId);
  }

  return touched;
}

// ─── #228: one counterparty per (split) transaction ──────────────────

/** the stored shape the retired #133 r4 model left behind: category
 *  entries carrying their own links. Never written again — this fold
 *  relocates them to the row/part level, or converts a mixed spread
 *  into the real split the user's rule asks for. */
type LegacyCatEntry = TxSplitCat & { linkedAccountId?: string; transferPeerId?: string };

/** the money envelope an old entry mint was keyed on */
interface EntryMintBase {
  baseId: string;
  accountId: string;
  sign: 1 | -1;
  date: string;
  time?: string;
  currency: string;
  merchant: string;
}

/** an entry's peer that is NOT its own old-key mint is a picked real
 *  row — it must ride to the new home instead of being retired */
const foreignEntryPeer = (base: EntryMintBase, entry: LegacyCatEntry): string | undefined =>
  entry.transferPeerId && entry.transferPeerId !== mirrorTxId(catMirrorSourceId(base.baseId, entry.catId))
    ? entry.transferPeerId
    : undefined;

/** retire the old entry-keyed mints of a spread (own mints only — the
 *  engine leaves picked/bank peers alone). Shared with the manual-row
 *  delete, whose row may still carry an unmigrated spread. */
export async function retireLegacyEntryMints(
  store: StorageBackend,
  repo: Repo,
  base: EntryMintBase,
  cats: readonly LegacyCatEntry[] | undefined,
): Promise<void> {
  for (const entry of cats ?? []) {
    if (!entry.linkedAccountId) continue;
    const plan = await planMirrorChange(
      store,
      {
        id: catMirrorSourceId(base.baseId, entry.catId),
        accountId: base.accountId,
        amountCents: base.sign * Math.abs(entry.amountCents),
        date: base.date,
        ...(base.time ? { time: base.time } : {}),
        currency: base.currency,
        merchant: base.merchant,
      },
      entry.linkedAccountId,
      undefined,
      entry.transferPeerId,
      undefined,
    ).catch(() => null);
    await plan?.execute(repo).catch(() => undefined);
  }
}

/** does this spread still speak the retired model? Links on entries, or
 *  a special category sharing a spread (one special per (split) tx and
 *  it spans the whole — settled `reimbursed` entries don't count). */
function offendingCats(cats: readonly LegacyCatEntry[] | undefined): boolean {
  if (!cats?.length) return false;
  if (cats.some((c) => c.linkedAccountId || c.transferPeerId)) return true;
  const real = cats.filter((c) => c.catId !== REIMBURSED_ID);
  return real.length > 1 && real.some((c) => specialCatType(c.catId));
}

const strippedEntry = (entry: LegacyCatEntry): TxSplitCat => ({
  catId: entry.catId,
  amountCents: entry.amountCents,
  ...(entry.pct !== undefined ? { pct: entry.pct } : {}),
});

/** the collapse of a lone real entry: its category and its link move to
 *  the OWNER (row or part); settled entries keep the spread shape */
function collapseSpread(base: EntryMintBase, cats: LegacyCatEntry[]): {
  catId?: string;
  cats: TxSplitCat[] | undefined;
  linkedAccountId?: string;
  transferPeerId?: string;
} {
  const entry = cats.find((c) => c.catId !== REIMBURSED_ID);
  const settled = cats.filter((c) => c.catId === REIMBURSED_ID).map(strippedEntry);
  let kept: TxSplitCat[] | undefined;
  if (settled.length) kept = entry ? [strippedEntry(entry), ...settled] : settled;
  const peer = entry ? foreignEntryPeer(base, entry) : undefined;
  return {
    ...(entry ? { catId: entry.catId } : {}),
    cats: kept,
    ...(entry?.linkedAccountId ? { linkedAccountId: entry.linkedAccountId } : {}),
    ...(peer ? { transferPeerId: peer } : {}),
  };
}

/** a mixed spread becomes REAL PARTS (the user's rule: combining a
 *  special category with others means splitting the transaction) —
 *  deterministic ids so concurrent folds converge */
function spreadToParts(base: EntryMintBase, idBase: string, cats: LegacyCatEntry[], carry?: Pick<TxSplit, 'label' | 'notes' | 'eventId' | 'recurringId'>): TxSplit[] {
  const real = cats.filter((c) => c.catId !== REIMBURSED_ID);
  const settled = cats.filter((c) => c.catId === REIMBURSED_ID);
  const parts: TxSplit[] = real.map((entry, index) => {
    const peer = foreignEntryPeer(base, entry);
    return {
      id: foldPartId(idBase, entry.catId),
      catId: entry.catId,
      amountCents: entry.amountCents,
      ...(entry.pct !== undefined ? { pct: entry.pct } : {}),
      ...(specialCatType(entry.catId) ? { txType: specialCatType(entry.catId) } : {}),
      ...(index === 0 && carry?.label ? { label: carry.label } : {}),
      ...(index === 0 && carry?.notes ? { notes: carry.notes } : {}),
      ...(carry?.eventId ? { eventId: carry.eventId } : {}),
      ...(carry?.recurringId ? { recurringId: carry.recurringId } : {}),
      ...(entry.linkedAccountId ? { linkedAccountId: entry.linkedAccountId } : {}),
      ...(peer ? { transferPeerId: peer } : {}),
    };
  });
  return [...parts, ...settled.map((entry) => ({ catId: REIMBURSED_ID, amountCents: entry.amountCents }))];
}

/**
 * #228 (user decision): ONE counterparty per (split) transaction, and
 * only one special category — which spans the whole. This fold rewrites
 * what the retired per-entry model (#133 r4) stored:
 *
 * - a LONE entry's link moves to the row/part itself (the old
 *   entry-keyed mint retires; the choke re-mints under the owner's key,
 *   net zero on balances);
 * - a spread MIXING a special category with others becomes a real SPLIT
 *   — each entry a part with its own counterparty, deterministic part
 *   ids (foldPartId) so two devices folding concurrently converge;
 * - stray links on regular spreads strip (their mints retire).
 *
 * EVERY boot, like migrateBareSpecialRows: an old offline device may
 * sync the retired shape in at any time (migration-compat rule — both
 * directions stay supported paths). Idempotent by construction.
 */
/** the row-level spread's fold outcome (S3776: out of migrateRow) */
async function foldRowCats(
  store: StorageBackend,
  repo: Repo,
  rowBase: EntryMintBase,
  cats: LegacyCatEntry[],
  rowLinked: string | undefined,
): Promise<TxTransformFields> {
  await retireLegacyEntryMints(store, repo, rowBase, cats);
  const real = cats.filter((c) => c.catId !== REIMBURSED_ID);
  if (real.length <= 1) {
    const collapsed = collapseSpread(rowBase, cats);
    return { ...collapsed, cats: (collapsed.cats ?? null) as never };
  }
  if (real.some((c) => specialCatType(c.catId))) {
    const parts = spreadToParts(rowBase, rowBase.baseId, cats);
    return {
      splits: parts,
      cats: null as never,
      catId: primaryCatId(parts.filter((p) => p.catId !== REIMBURSED_ID)) ?? real[0].catId,
      ...(rowLinked ? { linkedAccountId: null as never } : {}),
    };
  }
  // regular spread with stray links: strip them, keep the shape
  return { cats: cats.map(strippedEntry) };
}

/** one offending PART's fold: collapse into the part, or flatten it
 *  into real parts (S3776: out of migrateRow) */
async function foldOnePart(
  store: StorageBackend,
  repo: Repo,
  rowBase: EntryMintBase,
  part: TxSplit & { cats?: LegacyCatEntry[] },
): Promise<{ parts: TxSplit[]; successor?: string }> {
  const partBase: EntryMintBase = { ...rowBase, baseId: partMirrorSourceId(rowBase.baseId, part.id!) };
  await retireLegacyEntryMints(store, repo, partBase, part.cats);
  const real = (part.cats ?? []).filter((c) => c.catId !== REIMBURSED_ID);
  if (real.length <= 1) {
    const collapsed = collapseSpread(partBase, part.cats ?? []);
    // an entry link RELOCATES onto the part; when it points at the
    // part's existing counter the part's own peer stays put
    const linkMoves = !!collapsed.linkedAccountId && collapsed.linkedAccountId !== part.linkedAccountId;
    return {
      parts: [{
        ...part,
        ...(collapsed.catId ? { catId: collapsed.catId, txType: specialCatType(collapsed.catId) ?? part.txType } : {}),
        cats: collapsed.cats,
        linkedAccountId: collapsed.linkedAccountId ?? part.linkedAccountId,
        transferPeerId: collapsed.transferPeerId ?? (linkMoves ? undefined : part.transferPeerId),
      }],
    };
  }
  const flat = spreadToParts(partBase, `${rowBase.baseId}:${part.id}`, part.cats ?? [], part);
  return { parts: flat, successor: flat.find((p) => p.catId !== REIMBURSED_ID)?.id };
}

/** the splits fold: every offending part collapses or flattens; same-row
 *  reimbursement links naming a flattened part re-point at its first
 *  successor (cross-row creditPartId refs are not chased — the
 *  whole-credit math still holds) (S3776) */
async function foldParts(
  store: StorageBackend,
  repo: Repo,
  rowBase: EntryMintBase,
  splits: (TxSplit & { cats?: LegacyCatEntry[] })[],
  reimbRefs: TxReimbursement[],
): Promise<TxTransformFields> {
  let refs = reimbRefs;
  const nextSplits: TxSplit[] = [];
  for (const part of splits) {
    if (!part.id || !offendingCats(part.cats)) {
      nextSplits.push(part);
      continue;
    }
    const folded = await foldOnePart(store, repo, rowBase, part);
    nextSplits.push(...folded.parts);
    if (folded.successor) refs = refs.map((r) => (r.partId === part.id ? { ...r, partId: folded.successor! } : r));
  }
  const fields: TxTransformFields = { splits: nextSplits };
  const primary = primaryCatId(nextSplits.filter((p) => p.catId !== REIMBURSED_ID));
  if (primary) fields.catId = primary;
  if (refs !== reimbRefs) fields.reimbursements = refs;
  return fields;
}

export async function migrateEntryCounters(store: StorageBackend, repo: Repo): Promise<number> {
  let touched = 0;

  const migrateRow = async (
    raw: TransactionRow,
    meta: TxMetaRow | undefined,
    spaceId: string,
    feedSpaceId: string | undefined,
  ): Promise<void> => {
    const cats = (meta?.cats ?? (feedSpaceId ? undefined : raw.cats)) as LegacyCatEntry[] | undefined;
    const splits = (meta?.splits ?? (feedSpaceId ? undefined : raw.splits)) as
      | (TxSplit & { cats?: LegacyCatEntry[] })[]
      | undefined;
    const rowBase: EntryMintBase = {
      baseId: raw.id,
      accountId: raw.accountId,
      sign: raw.amountCents < 0 ? -1 : 1,
      date: raw.date,
      time: raw.time,
      currency: raw.currency,
      merchant: raw.merchant,
    };
    const tx = {
      id: raw.id,
      spaceId,
      feedSpaceId,
      txType: meta?.txType ?? raw.txType,
      needsReview: meta?.needsReview ?? raw.needsReview,
      amountCents: raw.amountCents,
      date: raw.date,
      linkedAccountId: meta?.linkedAccountId ?? raw.linkedAccountId,
      transferPeerId: meta?.transferPeerId ?? raw.transferPeerId,
    };
    const fields: TxTransformFields = {};

    if (offendingCats(cats)) {
      Object.assign(fields, await foldRowCats(store, repo, rowBase, cats ?? [], tx.linkedAccountId ?? undefined));
    }
    if (splits?.some((part) => offendingCats(part.cats))) {
      const reimbRefs = (meta?.reimbursements ?? raw.reimbursements ?? []) as TxReimbursement[];
      Object.assign(fields, await foldParts(store, repo, rowBase, splits, reimbRefs));
    }

    if (Object.keys(fields).length === 0) return;
    await writeTxTransform(repo, tx, fields);
    touched++;
  };

  const candidate = (row: { cats?: LegacyCatEntry[]; splits?: (TxSplit & { cats?: LegacyCatEntry[] })[] }) =>
    offendingCats(row.cats) || (row.splits ?? []).some((part) => offendingCats(part.cats));

  const feedSpaceIds = new Set((await store.allRows('accountLink')).map((link) => link.feedSpaceId));
  for (const raw of await store.allRows('transaction')) {
    if (raw.deleted !== 0 || feedSpaceIds.has(raw.spaceId) || !candidate(raw)) continue;
    await migrateRow(raw, undefined, raw.spaceId, undefined);
  }
  for (const meta of await store.allRows('txMeta')) {
    if (meta.deleted !== 0 || !candidate(meta)) continue;
    const raw = await store.get('transaction', meta.txId);
    if (raw?.deleted !== 0) continue;
    await migrateRow(raw, meta, meta.spaceId, raw.spaceId);
  }

  return touched;
}
