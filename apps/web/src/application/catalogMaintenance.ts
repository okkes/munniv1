import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { visibleTransactions, writeTxTransform } from '@/db/joined';
import { tombstonedIds } from '@/domain/catalogDoc';
import { REIMBURSED_ID, UNCATEGORIZED_ID, autoSubFor, specialCatType } from '@/domain/categories';
import { familyForCounter, movementCatFor } from '@/domain/txType';
import type { AccountType, TxReimbursement, TxSplit, TxSplitCat, TxType } from '@/db/types';
import { isReimbContainer, largestOpenPartId, reimbCentsByPart, reimbSettleFields } from '@/domain/reimbursement';
import { standardTypeFor } from '@/domain/txKind';
import { cachedCatalog } from '@/sync/catalogSync';

/**
 * AC3: apply the catalog document's tombstones locally, once per
 * published version. Retired builtins detach their transactions (raw
 * rows and per-space overlays) to Uncategorized and put them back into
 * review — the same story as deleting a user category. Custom subs the
 * user created under a retired premade parent cascade away with it
 * (user ruling: "in that case we can't do much about it"); custom
 * categories are otherwise never touched by catalog updates.
 */
export async function applyCatalogTombstones(store: StorageBackend, repo: Repo): Promise<number> {
  const doc = await cachedCatalog(store);
  if (!doc) return 0;
  const dead = new Set(tombstonedIds(doc));
  if (dead.size === 0) return 0;
  const markerKey = `catalogDetach_v${doc.version}`;
  if (await store.metaGet(markerKey)) return 0;

  let touched = 0;
  // cascade: custom subs under a retired premade parent
  const orphans = (await store.allRows('category')).filter(
    (c) => c.deleted === 0 && !!c.parentId && dead.has(c.parentId),
  );
  for (const orphan of orphans) {
    await repo.remove('category', orphan.spaceId, orphan.id);
    dead.add(orphan.id); // their transactions detach in the same pass
    touched++;
  }
  for (const tx of await store.allRows('transaction')) {
    if (tx.deleted === 0 && tx.catId && dead.has(tx.catId)) {
      await repo.upsert('transaction', tx.spaceId, tx.id, { catId: UNCATEGORIZED_ID, needsReview: 1 });
      touched++;
    }
  }
  for (const meta of await store.allRows('txMeta')) {
    if (meta.deleted === 0 && meta.catId && dead.has(meta.catId)) {
      await repo.upsert('txMeta', meta.spaceId, meta.id, { catId: UNCATEGORIZED_ID, needsReview: 1 });
      touched++;
    }
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

/**
 * #228 (user 2026-08-13): reimbursement on a SPLIT transaction stays on
 * the split. EVERY boot normalizes the settle bookkeeping — old offline
 * devices can sync the retired shapes in anytime (pre-redesign NET
 * slices, the container-level `reimbursed` pseudo-part that drained the
 * WRONG sibling, container-level links without a part name). Runs
 * through the same reimbSettleFields builder the write hook uses, with
 * ID-based tie-breaks so concurrent heals on two devices write
 * byte-identical rows and LWW converges cleanly.
 */
export async function normalizeReimbursements(store: StorageBackend, repo: Repo): Promise<number> {
  let touched = 0;
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  for (const space of spaces) {
    touched += await normalizeSpaceReimbursements(repo, await visibleTransactions(store, space.id));
  }
  return touched;
}

const hasReimbRemnant = (tx: { cats?: TxSplitCat[]; splits?: TxSplit[] }): boolean =>
  (tx.cats ?? []).some((c) => c.catId === REIMBURSED_ID) ||
  (tx.splits ?? []).some((s) => s.catId === REIMBURSED_ID || s.cats?.some((c) => c.catId === REIMBURSED_ID));

type SpaceRows = Awaited<ReturnType<typeof visibleTransactions>>;

const bump = (map: Map<string, number>, key: string, cents: number): void => {
  map.set(key, (map.get(key) ?? 0) + cents);
};

/** assign one loose link its part name(s) — expense side first, then
 *  the credit side, each landing on the largest open part (S3776) */
function nameLooseLink(
  tx: SpaceRows[number],
  link: TxReimbursement,
  ownNamed: Map<string, number>,
  byId: Map<string, SpaceRows[number]>,
  givenOf: (creditId: string) => Map<string, number>,
): TxReimbursement {
  let next = link;
  if (!next.partId && isReimbContainer(tx)) {
    const partId = largestOpenPartId(tx.splits, ownNamed);
    if (partId) {
      next = { ...next, partId };
      bump(ownNamed, partId, next.amountCents);
    }
  }
  const credit = byId.get(next.txId);
  if (!next.creditPartId && credit && isReimbContainer(credit)) {
    const creditPartId = largestOpenPartId(credit.splits, givenOf(credit.id));
    if (creditPartId) {
      next = { ...next, creditPartId };
      bump(givenOf(credit.id), creditPartId, next.amountCents);
    }
  }
  return next;
}

/** the fixed given-by-part view: every link that already names a credit
 *  part, keyed by the credit it names (S3776) */
function seedNamedGiven(txs: SpaceRows): Map<string, Map<string, number>> {
  const namedGiven = new Map<string, Map<string, number>>();
  for (const tx of txs) {
    for (const link of tx.reimbursements ?? []) {
      if (!link.creditPartId) continue;
      const map = namedGiven.get(link.txId) ?? new Map<string, number>();
      namedGiven.set(link.txId, map);
      bump(map, link.creditPartId, link.amountCents);
    }
  }
  return namedGiven;
}

/** pass A: every link on a split side NAMES its part (#228) — legacy
 *  container-level links land on the largest open part, assigned in
 *  stable row order so two devices converge on the same names */
async function nameReimbursementParts(repo: Repo, txs: SpaceRows): Promise<Map<string, TxReimbursement[]>> {
  const byId = new Map(txs.map((tx) => [tx.id, tx]));
  const namedGiven = seedNamedGiven(txs);
  const givenOf = (creditId: string) => {
    const map = namedGiven.get(creditId) ?? new Map<string, number>();
    namedGiven.set(creditId, map);
    return map;
  };

  const nextLinks = new Map<string, TxReimbursement[]>();
  for (const tx of [...txs].sort((a, b) => a.id.localeCompare(b.id))) {
    const links = tx.reimbursements ?? [];
    if (!links.length) continue;
    const ownNamed = new Map<string, number>();
    for (const link of links) {
      if (link.partId) bump(ownNamed, link.partId, link.amountCents);
    }
    const renamed = links.map((link) => nameLooseLink(tx, link, ownNamed, byId, givenOf));
    if (renamed.some((link, i) => link !== links[i])) {
      await writeTxTransform(repo, tx, { reimbursements: renamed });
      nextLinks.set(tx.id, renamed);
    }
  }
  return nextLinks;
}

/** compare shapes on their STORED essence — the join enriches cats
 *  entries (and parts) with derived view fields, and comparing those
 *  against the rebuilt plain entries would rewrite every boot */
const plainCats = (cats: TxSplitCat[] | null | undefined): { catId: string; amountCents: number; pct?: number }[] | null =>
  cats?.length
    ? cats.map((c) => ({ catId: c.catId, amountCents: c.amountCents, ...(c.pct !== undefined ? { pct: c.pct } : {}) }))
    : null;
const comparableSplits = (splits: TxSplit[] | null | undefined) =>
  splits?.length ? splits.map((p) => ({ ...p, txType: undefined, cats: plainCats(p.cats) ?? undefined })) : null;

async function normalizeSpaceReimbursements(repo: Repo, allRows: SpaceRows): Promise<number> {
  const nameOf = (id: string) => id;
  const txs = allRows.filter((tx) => tx.deleted === 0);
  const renamed = await nameReimbursementParts(repo, txs);
  const linksOf = (tx: SpaceRows[number]) => renamed.get(tx.id) ?? tx.reimbursements ?? [];

  // pass B: recompute each side's settle bookkeeping from the links
  const namedBy = new Map<string, TxReimbursement[]>();
  for (const tx of txs) {
    for (const link of linksOf(tx)) {
      namedBy.set(link.txId, [...(namedBy.get(link.txId) ?? []), link]);
    }
  }
  let touched = 0;
  for (const tx of txs) {
    const own = linksOf(tx);
    const named = namedBy.get(tx.id) ?? [];
    if (!own.length && !named.length && !hasReimbRemnant(tx)) continue;
    const side = tx.amountCents > 0 ? named : own;
    const total = side.reduce((sum, link) => sum + link.amountCents, 0);
    const byPart = reimbCentsByPart(side, tx.amountCents > 0 ? 'creditPartId' : 'partId', tx.splits);
    const fields = settleDiffFields(tx, reimbSettleFields(tx, total, byPart, nameOf));
    if (!Object.keys(fields).length) continue;
    await writeTxTransform(repo, tx, fields);
    touched++;
  }
  return touched;
}

/** only what actually CHANGED, compared on the stored essence (S3776) */
function settleDiffFields(
  tx: SpaceRows[number],
  patch: ReturnType<typeof reimbSettleFields>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (patch.catId !== undefined && patch.catId !== tx.catId) fields.catId = patch.catId;
  if ('cats' in patch && JSON.stringify(plainCats(patch.cats)) !== JSON.stringify(plainCats(tx.cats))) {
    fields.cats = patch.cats;
  }
  if ('splits' in patch && JSON.stringify(comparableSplits(patch.splits)) !== JSON.stringify(comparableSplits(tx.splits))) {
    fields.splits = patch.splits;
  }
  return fields;
}

/**
 * 2026-08-01 (user, ss review): the debt family shrank to exactly the
 * arc-2 pair — Repaid / Borrowed. Rows on the retired lendMoney /
 * creditCardPayment subs refile under the sign-picked family sub, raw
 * rows and per-space overlays alike; review status stays untouched.
 */
const RETIRED_DEBT_SUBS = new Set(['lendMoney', 'creditCardPayment']);

export async function migrateRetiredDebtSubs(store: StorageBackend, repo: Repo): Promise<number> {
  const markerKey = 'debtSubsRetired_v1';
  if (await store.metaGet(markerKey)) return 0;

  let touched = 0;
  for (const tx of await store.allRows('transaction')) {
    if (tx.deleted === 0 && tx.catId && RETIRED_DEBT_SUBS.has(tx.catId)) {
      await repo.upsert('transaction', tx.spaceId, tx.id, { catId: autoSubFor('debtPayment', tx.amountCents) });
      touched++;
    }
  }
  for (const meta of await store.allRows('txMeta')) {
    if (meta.deleted === 0 && meta.catId && RETIRED_DEBT_SUBS.has(meta.catId)) {
      const raw = await store.get('transaction', meta.txId);
      await repo.upsert('txMeta', meta.spaceId, meta.id, { catId: autoSubFor('debtPayment', raw?.amountCents ?? -1) });
      touched++;
    }
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

/**
 * #252 (user 2026-08-16): Bought/Sold became brokerage-internal — the
 * unstamped movement legs file Invested/Withdrawn now. One pass refiles
 * old rows whose OWN account is not a brokerage (raw rows and per-space
 * overlays alike); brokerage-ledger rows keep Bought/Sold, which mean
 * exactly what they say there. Review status stays untouched.
 */
const INVEST_MOVEMENT_REFILE: Record<string, string> = { investBuy: 'investContribution', investSell: 'investWithdraw' };

export async function migrateInvestMovementSubs(store: StorageBackend, repo: Repo): Promise<number> {
  const markerKey = 'investMovementSubs_v1';
  if (await store.metaGet(markerKey)) return 0;

  const brokerages = new Set(
    (await store.allRows('account')).filter((a) => a.type === 'brokerage').map((a) => a.id),
  );
  let touched = 0;
  for (const tx of await store.allRows('transaction')) {
    if (tx.deleted === 0 && tx.catId && INVEST_MOVEMENT_REFILE[tx.catId] && !brokerages.has(tx.accountId)) {
      await repo.upsert('transaction', tx.spaceId, tx.id, { catId: INVEST_MOVEMENT_REFILE[tx.catId] });
      touched++;
    }
  }
  for (const meta of await store.allRows('txMeta')) {
    if (meta.deleted !== 0 || !meta.catId || !INVEST_MOVEMENT_REFILE[meta.catId]) continue;
    const raw = await store.get('transaction', meta.txId);
    if (raw && brokerages.has(raw.accountId)) continue;
    await repo.upsert('txMeta', meta.spaceId, meta.id, { catId: INVEST_MOVEMENT_REFILE[meta.catId] });
    touched++;
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

/**
 * Typed-splits v2, Q3 (user 2026-08-05): the funding TYPE retires —
 * funding is a marked special CATEGORY on standard rows now. Every
 * funding-typed row (raw and overlay alike) re-derives its type by
 * sign and keeps — or gains — its funding category so no meaning is
 * lost. The stored TxType union keeps 'funding' for old devices.
 */
export async function migrateFundingRows(store: StorageBackend, repo: Repo): Promise<number> {
  const markerKey = 'txFundingCat_v1';
  if (await store.metaGet(markerKey)) return 0;

  let touched = 0;
  for (const tx of await store.allRows('transaction')) {
    if (tx.deleted !== 0 || tx.txType !== 'funding') continue;
    await repo.upsert('transaction', tx.spaceId, tx.id, {
      txType: standardTypeFor(tx.amountCents),
      catId: tx.catId && tx.catId !== UNCATEGORIZED_ID ? tx.catId : autoSubFor('funding', tx.amountCents),
    });
    touched++;
  }
  for (const meta of await store.allRows('txMeta')) {
    if (meta.deleted !== 0 || meta.txType !== 'funding') continue;
    const raw = await store.get('transaction', meta.txId);
    const amount = raw?.amountCents ?? -1;
    await repo.upsert('txMeta', meta.spaceId, meta.id, {
      txType: standardTypeFor(amount),
      catId: meta.catId && meta.catId !== UNCATEGORIZED_ID ? meta.catId : autoSubFor('funding', amount),
    });
    touched++;
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

/**
 * #211 split categories: `splits` means PARTS from here on — a plain
 * multi-category assignment lives in the row's own `cats` partition.
 * One pass folds every legacy bare-slice split (no part story on any
 * entry) into `cats`, raw rows and per-space overlays alike. Real
 * splits — any entry with a label, type, link, event, recurring,
 * note or spread — stay containers untouched. A partition that no
 * longer sums to the gross amount (pre-redesign drift) also stays: the
 * readers keep their legacy `splits` fallback for exactly that shape.
 */
const isBareSlice = (s: TxSplit): boolean =>
  s.label === undefined && s.txType === undefined && s.linkedAccountId === undefined
    && s.transferPeerId === undefined && s.eventId === undefined && s.recurringId === undefined
    && s.notes === undefined && !s.cats?.length;

/** the fold's write fields — null when the split must stay a container.
 *  A single plain slice is "no split" (the shadow catId already says
 *  it), so only a real spread or settled bookkeeping materializes cats.
 *  A row that EVER saw a #211-aware write carries a `cats` field
 *  version (split writers stamp an explicit null) — its splits are
 *  REAL parts by definition and never fold, so a fresh device syncing
 *  modern data can run this one-shot safely. */
function catSpreadFold(
  row: { cats?: TxSplitCat[]; splits?: TxSplit[]; deleted: number; fieldVersions?: Record<string, string> },
  grossAbs: number,
): { cats?: TxSplitCat[] } | null {
  if (row.deleted !== 0 || row.cats?.length) return null;
  if (row.fieldVersions && 'cats' in row.fieldVersions) return null;
  const splits = row.splits;
  if (!splits?.length || !splits.every(isBareSlice)) return null;
  if (splits.reduce((total, s) => total + s.amountCents, 0) !== grossAbs) return null;
  const entries = splits.map((s) => ({ catId: s.catId, amountCents: s.amountCents, ...(s.pct !== undefined ? { pct: s.pct } : {}) }));
  const spread = entries.length > 1 || entries.some((e) => e.catId === REIMBURSED_ID);
  return spread ? { cats: entries } : {};
}

export async function migrateCatSpreads(store: StorageBackend, repo: Repo): Promise<number> {
  const markerKey = 'txCatSpreads_v1';
  if (await store.metaGet(markerKey)) return 0;

  let touched = 0;
  for (const tx of await store.allRows('transaction')) {
    const fold = catSpreadFold(tx, Math.abs(tx.amountCents));
    if (!fold) continue;
    await repo.upsert('transaction', tx.spaceId, tx.id, { ...fold, splits: null as never });
    touched++;
  }
  for (const meta of await store.allRows('txMeta')) {
    const raw = await store.get('transaction', meta.txId);
    const fold = raw ? catSpreadFold(meta, Math.abs(raw.amountCents)) : null;
    if (!fold) continue;
    await repo.upsert('txMeta', meta.spaceId, meta.id, { ...fold, splits: null as never });
    touched++;
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

/**
 * #133 r5 (user): Transfer filed toward a SPECIAL counterparty is the
 * family's story wearing the wrong name — "you cannot select transfer
 * out [when the] counterparty is a saving account; you have to use the
 * saving category instead". One marker-gated pass refiles every such
 * row and part by its counter's kind. (#228: spread entries carry no
 * links anymore — migrateEntryCounters runs FIRST and relocates them,
 * so rows and parts are the only places a link can live.)
 */
const TRANSFER_SUBS = new Set(['transferOut', 'transferIn', 'cashWithdraw', 'cashDeposit']);

type CounterRefile = (catId: string | undefined, linkedId: string | undefined, signedCents: number) => string | undefined;

function refileParts(
  tx: { id: string; amountCents: number; splits?: TxSplit[] },
  refiled: CounterRefile,
): TxSplit[] | null {
  let changed = false;
  const sign: 1 | -1 = tx.amountCents < 0 ? -1 : 1;
  const next = (tx.splits ?? []).map((part) => {
    const partCat = refiled(part.catId, part.linkedAccountId, sign * Math.abs(part.amountCents));
    if (!partCat) return part;
    changed = true;
    return { ...part, catId: partCat, txType: specialCatType(partCat) };
  });
  return changed ? next : null;
}

function counterRefileFields(
  tx: { id: string; amountCents: number; catId?: string; linkedAccountId?: string; cats?: TxSplitCat[]; splits?: TxSplit[] },
  refiled: CounterRefile,
): { catId?: string; txType?: TxType; splits?: TxSplit[] } | null {
  const fields: { catId?: string; txType?: TxType; splits?: TxSplit[] } = {};
  const rowCat = refiled(tx.catId, tx.linkedAccountId, tx.amountCents);
  if (rowCat) {
    fields.catId = rowCat;
    fields.txType = specialCatType(rowCat);
  }
  const splits = tx.splits?.length ? refileParts(tx, refiled) : null;
  if (splits) fields.splits = splits;
  return Object.keys(fields).length ? fields : null;
}

export async function migrateCounterFiledTransfers(store: StorageBackend, repo: Repo): Promise<number> {
  const markerKey = 'counterFamilyRefile_v1';
  if (await store.metaGet(markerKey)) return 0;
  const typeOf = new Map<string, AccountType>(
    (await store.allRows('account')).filter((a) => a.deleted === 0).map((a) => [a.id, a.type]),
  );
  const refiled: CounterRefile = (catId, linkedId, signedCents) => {
    if (!catId || !TRANSFER_SUBS.has(catId) || !linkedId) return undefined;
    const counterType = typeOf.get(linkedId);
    if (!counterType || familyForCounter(counterType) === 'transfer') return undefined;
    return movementCatFor(counterType, signedCents);
  };

  let touched = 0;
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  for (const space of spaces) {
    for (const tx of await visibleTransactions(store, space.id)) {
      if (tx.deleted !== 0) continue;
      const fields = counterRefileFields(tx, refiled);
      if (!fields) continue;
      await writeTxTransform(repo, tx, fields);
      touched++;
    }
  }
  await store.metaPut(markerKey, Date.now());
  return touched;
}

