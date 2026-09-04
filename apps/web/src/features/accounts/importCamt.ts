import { v5 as uuidv5 } from 'uuid';
import { accountLinkId, canonicalAccountId, feedSpaceId, importAccountId, txMetaId } from '@/domain/feedIds';
import type { ParsedStatement } from '@/lib/statements/parseStatement';
import { predictTx, predictionSkipsReview } from '@/domain/predictCategory';
import { cachedCatalog } from '@/sync/catalogSync';
import type { SpaceMemory } from '@/application/prediction';
import { buildSpaceMerchantMemory } from '@/application/prediction';
import { UNCATEGORIZED_ID, isMovementCat } from '@/domain/categories';
import { defaultFamilyFor } from '@/domain/defaultAccounts';
import { matchCounterAccount } from '@/domain/counterClue';
import type { ClueAccount } from '@/domain/counterClue';
import { familyForCounter, movementCatFor } from '@/domain/txType';
import { ensureDefaultAccount } from '@/application/defaultAccounts';
import { visibleAccounts, writeTxTransform } from '@/db/joined';
import { DEFAULT_HISTORY_MONTHS, isoMonthsAgo } from '@/features/spaces/spaceDefaults';
import type { Repo } from '@/db/repo';
import type { StorageBackend } from '@/db/backend';
import type { TxType } from '@/db/types';

// Fixed namespace so the same bank entry always yields the same tx id —
// importing the same file twice (or on two devices) cannot duplicate.
const IMPORT_NS = '5f3c9a70-0d3e-4e0f-9a57-6d2b3a1c8e42';

export interface ImportPlanAccount {
  iban: string;
  accountId: string;
  accountName: string;
  isNew: boolean;
  /** #204: whether THIS space already carries the account — imports
   *  never attach by themselves; absent on the merged (offline) path,
   *  where the account lives in the space by construction */
  attached?: boolean;
  txCount: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  accounts: ImportPlanAccount[];
}

const normalizeIban = (iban: string) => iban.replace(/\s/g, '').toUpperCase();

/**
 * May this statement's balance overwrite what the account shows?
 * Both statement balances and manual edits are dated; the newer date
 * wins. An undated existing balance (pre-feature rows, GC snapshots)
 * loses to any dated statement balance — bank truth beats unknown age.
 */
export function statementBalanceWins(
  account: { balanceAsOf?: string },
  stmt: { closingBalanceCents: number | null; balanceAsOf?: string | null },
): boolean {
  if (stmt.closingBalanceCents === null) return false;
  if (!account.balanceAsOf) return true;
  return !!stmt.balanceAsOf && stmt.balanceAsOf >= account.balanceAsOf;
}

async function createStatementAccount(
  repo: Repo,
  spaceId: string,
  accountId: string,
  stmt: ParsedStatement,
  iban: string,
): Promise<void> {
  await repo.upsert('account', spaceId, accountId, {
    name: stmt.accountName ?? `Bank · ${iban.slice(-4)}`,
    // ING CSVs know their account kind; CAMT statements default to checking
    type: stmt.accountType ?? 'checking',
    source: 'camt053',
    currency: stmt.currency,
    balanceCents: stmt.closingBalanceCents ?? 0,
    ...(stmt.balanceAsOf ? { balanceAsOf: stmt.balanceAsOf } : {}),
    iban: stmt.iban,
    lastSyncedAt: new Date().toISOString(),
  });
}

/** predicted transformation of one statement entry (history first, keywords after) */
function predictEntry(
  memory: SpaceMemory,
  entry: ParsedStatement['entries'][number],
  keywordRules?: readonly { catId: string; keywords: string[] }[],
): { catId: string; txType: TxType; needsReview: 0 | 1 } {
  const prediction = predictTx({
    memory,
    merchant: entry.counterpartyName ?? entry.description.slice(0, 40),
    description: entry.description,
    amountCents: entry.amountCents,
    keywordRules,
  });
  const fallbackType: TxType = entry.amountCents >= 0 ? 'income' : 'expense';
  return {
    catId: prediction?.catId ?? UNCATEGORIZED_ID,
    txType: prediction?.txType ?? fallbackType,
    // only merchant history the user confirmed twice skips review —
    // keyword hits are guesses and review is the teaching loop
    needsReview: predictionSkipsReview(prediction) ? 0 : 1,
  };
}

/** everything one statement's entries share while importing */
interface EntryContext {
  repo: Repo;
  store: StorageBackend;
  spaceId: string;
  accountId: string;
  iban: string;
  memory: SpaceMemory;
  keywordRules?: readonly { catId: string; keywords: string[] }[];
  /** #228 r3: the space's tracked accounts — the transfer clue-matcher's pool */
  counterCandidates: readonly ClueAccount[];
  /** master plan IB: one id per statement per run — rollback's unit */
  batchId: string;
  /** uploader display name, frozen at import time */
  importedBy?: string;
}

/** the uploader's display name (same source the activity history freezes) */
async function uploaderName(store: StorageBackend): Promise<string | undefined> {
  return ((await store.metaGet('profile'))?.value as { name?: string } | undefined)?.name;
}

/**
 * #221: a movement-category prediction is only VALID with a counterparty
 * — link it to the space's default for that family through the write
 * choke, so the mirror leg mints and a wrong guess later retires it
 * (the ordinary link lifecycle, spec'd by the user). #228 r3: the
 * TRANSFER family never leans on its default — only a clue-matched
 * account links (`matchedId`); the pot families keep their defaults.
 */
async function linkPredictedMovement(
  ctx: EntryContext,
  txId: string,
  predicted: { catId: string; txType: TxType; needsReview: 0 | 1 },
  feedId: string | undefined,
  matchedId?: string,
): Promise<void> {
  if (!isMovementCat(predicted.catId)) return;
  const family = defaultFamilyFor(predicted.catId);
  if (!family) return;
  const targetId =
    matchedId ?? (family === 'transfer' ? null : await ensureDefaultAccount(ctx.store, ctx.repo, ctx.spaceId, family));
  if (!targetId) return;
  await writeTxTransform(
    ctx.repo,
    { id: txId, spaceId: ctx.spaceId, feedSpaceId: feedId, txType: predicted.txType, needsReview: predicted.needsReview },
    { linkedAccountId: targetId },
  ).catch(() => undefined);
}

/** #228 r3 (user rule): a TRANSFER prediction is only real when the
 *  entry's counterparty, IBAN or description names one of the space's
 *  tracked accounts. A match rides as the counterparty (the bijection
 *  files the category from the account's kind); no match stands the
 *  prediction down to Uncategorized — review asks the human. */
function resolveEntryPrediction(
  ctx: EntryContext,
  entry: ParsedStatement['entries'][number],
): { predicted: { catId: string; txType: TxType; needsReview: 0 | 1 }; matchedId?: string } {
  const predicted = predictEntry(ctx.memory, entry, ctx.keywordRules);
  if (defaultFamilyFor(predicted.catId) !== 'transfer') return { predicted };
  const match = matchCounterAccount(
    {
      merchant: entry.counterpartyName ?? entry.description.slice(0, 40),
      description: entry.description,
      ...(entry.counterpartyIban ? { counterIban: normalizeIban(entry.counterpartyIban) } : {}),
    },
    ctx.counterCandidates,
    ctx.accountId,
  );
  if (match) {
    return {
      predicted: {
        catId: movementCatFor(match.type, entry.amountCents),
        txType: familyForCounter(match.type),
        needsReview: predicted.needsReview,
      },
      matchedId: match.id,
    };
  }
  return {
    predicted: { catId: UNCATEGORIZED_ID, txType: entry.amountCents >= 0 ? 'income' : 'expense', needsReview: 1 },
  };
}

/** returns true when the entry was new (imported), false when it already existed */
async function importEntry(ctx: EntryContext, entry: ParsedStatement['entries'][number]): Promise<boolean> {
  const txId = uuidv5(`tx:${ctx.iban}:${entry.ref}`, IMPORT_NS);
  if (await ctx.store.get('transaction', txId)) return false;

  const { predicted, matchedId } = resolveEntryPrediction(ctx, entry);
  await ctx.repo.upsert('transaction', ctx.spaceId, txId, {
    accountId: ctx.accountId,
    date: entry.date,
    amountCents: entry.amountCents,
    currency: entry.currency,
    merchant: entry.counterpartyName ?? entry.description.slice(0, 40),
    description: entry.description,
    ...(entry.counterpartyIban ? { counterIban: normalizeIban(entry.counterpartyIban) } : {}),
    ...predicted,
    importRef: entry.ref,
    importBatchId: ctx.batchId,
    ...(ctx.importedBy ? { importedBy: ctx.importedBy } : {}),
  });
  await linkPredictedMovement(ctx, txId, predicted, undefined, matchedId);
  return true;
}

/**
 * Server round-trips of the feed flow, injected so the importer stays
 * unit-testable and demo/offline identities can pass nothing at all.
 */
export interface FeedGateway {
  /** registers the feed and returns the GRANTED id — the preferred
   *  deterministic one, or the caller's personal fallback when someone
   *  else owns it (S1 squatting defence, never blocks the user) */
  register(preferredFeedId: string, accountRef: string): Promise<string>;
  /** server-authoritative attachment of the feed to the target space */
  attach(spaceId: string, feedSpaceId: string, accountId: string, historyFrom?: string): Promise<void>;
}

/** #184: rows land one by one — the UI narrates `done` of the total */
export type ImportProgress = (done: number) => void;

/** Match statements to existing accounts by IBAN (creating where needed) and import entries idempotently. */
export async function importCamtStatements(
  repo: Repo,
  store: StorageBackend,
  spaceId: string,
  statements: ParsedStatement[],
  feeds?: FeedGateway,
  onProgress?: ImportProgress,
): Promise<ImportResult> {
  // demo/offline identities never sync: raw+transformation stay merged
  // in the current space exactly as before (dual-read handles both)
  return feeds
    ? importIntoFeeds(repo, store, spaceId, statements, feeds, onProgress)
    : importMerged(repo, store, spaceId, statements, onProgress);
}

/** header-only exports (real ING files include one) parse to a ref-less
 *  empty statement — nothing to import, never an account */
const emptyStatement = (stmt: ParsedStatement): boolean =>
  !stmt.iban.trim() || (stmt.entries.length === 0 && stmt.closingBalanceCents === null);

/**
 * The newest date a statement actually covers (yyyy-mm-dd, or null for
 * balance-only files without a date). "When was this exported" is the
 * fact the upload date hides — an export from three weeks ago imports
 * fine and silently leaves a three-week hole after it.
 */
export function statementCoverageEnd(stmt: Pick<ParsedStatement, 'entries' | 'balanceAsOf'>): string | null {
  let end = stmt.balanceAsOf ?? null;
  for (const entry of stmt.entries) {
    if (!end || entry.date > end) end = entry.date;
  }
  return end;
}

/** every import touch refreshes the freshness facts on the account */
async function stampCoverage(
  repo: Repo,
  spaceId: string,
  accountId: string,
  existing: { dataThroughDate?: string } | undefined,
  stmt: ParsedStatement,
): Promise<void> {
  const end = statementCoverageEnd(stmt);
  await repo.upsert('account', spaceId, accountId, {
    lastSyncedAt: new Date().toISOString(),
    // coverage only moves FORWARD: re-importing an old export must not
    // shrink what a newer one already established
    ...(end && (!existing?.dataThroughDate || end > existing.dataThroughDate) ? { dataThroughDate: end } : {}),
  });
}

async function importMerged(
  repo: Repo,
  store: StorageBackend,
  spaceId: string,
  statements: ParsedStatement[],
  onProgress?: ImportProgress,
): Promise<ImportResult> {
  const memory = await buildSpaceMerchantMemory(store, spaceId);
  const importedBy = await uploaderName(store);
  const keywordRules = (await cachedCatalog(store))?.keywords;
  const counterCandidates = await visibleAccounts(store, spaceId);
  const existing = (await store.bySpace('account', spaceId)).filter((a) => a.deleted === 0);
  const byIban = new Map(existing.flatMap((a) => (a.iban ? [[normalizeIban(a.iban), a] as const] : [])));

  let imported = 0;
  let skipped = 0;
  const accounts: ImportPlanAccount[] = [];

  for (const stmt of statements) {
    if (emptyStatement(stmt)) continue;
    const iban = normalizeIban(stmt.iban);
    const match = byIban.get(iban);
    const accountId = match?.id ?? uuidv5(`acct:${iban}`, IMPORT_NS);
    if (!match) await createStatementAccount(repo, spaceId, accountId, stmt, iban);
    else if (statementBalanceWins(match, stmt))
      await repo.upsert('account', spaceId, accountId, {
        balanceCents: stmt.closingBalanceCents!,
        ...(stmt.balanceAsOf ? { balanceAsOf: stmt.balanceAsOf } : {}),
      });
    await stampCoverage(repo, spaceId, accountId, match, stmt);

    let txCount = 0;
    const batchId = crypto.randomUUID();
    for (const entry of stmt.entries) {
      if (await importEntry({ repo, store, spaceId, accountId, iban, memory, keywordRules, counterCandidates, batchId, importedBy }, entry)) {
        imported++;
        txCount++;
      } else {
        skipped++;
      }
      onProgress?.(imported + skipped);
    }

    accounts.push({
      iban: stmt.iban,
      accountId,
      accountName: match?.name ?? `Bank · ${iban.slice(-4)}`,
      isNew: !match,
      txCount,
    });
  }

  return { imported, skipped, accounts };
}

/**
 * #204 (user): importing NEVER attaches by itself — the account is
 * global, and joining a space is an explicit step where the user also
 * picks the type and the history gate. Only an account this space
 * ALREADY attached refreshes its link (a re-import must not silently
 * detach anything). Returns whether the space carries the account.
 */
async function refreshExistingAttachment(
  repo: Repo,
  store: StorageBackend,
  feeds: FeedGateway,
  spaceId: string,
  feedId: string,
  accountId: string,
): Promise<boolean> {
  const linkId = accountLinkId(spaceId, feedId);
  const existingLink = await store.get('accountLink', linkId);
  if (existingLink?.deleted !== 0) return false;
  if (existingLink.archived) return false;
  const historyFrom =
    existingLink.historyFrom ?? (await store.get('space', spaceId))?.historyStartDate ?? isoMonthsAgo(DEFAULT_HISTORY_MONTHS);
  await feeds.attach(spaceId, feedId, accountId, historyFrom);
  await repo.upsert('accountLink', spaceId, linkId, {
    feedSpaceId: feedId,
    accountId,
    historyFrom,
  });
  return true;
}

/** #311 r4 (user): which account row this statement lands in — a
 *  BANK-fed row owning the canonical `acct:{iban}` id means the import
 *  keeps its OWN separate account (never silently consumed; the user
 *  merges explicitly, and the merge runs the reconcile). Without a bank
 *  row the canonical id stays the import's — pure-import users see no
 *  change and no data migrates. (S3776: out of the loop) */
async function importTargetAccountId(store: StorageBackend, feedId: string, iban: string): Promise<string> {
  const canonicalId = canonicalAccountId(iban);
  const canonical = await store.get('account', canonicalId);
  const bankOwnsCanonical = canonical?.spaceId === feedId && canonical.deleted === 0 && canonical.source === 'gocardless';
  return bankOwnsCanonical ? importAccountId(iban) : canonicalId;
}

/**
 * Feed shape (shared-accounts design): raw facts go ONCE into the
 * account's feed space, the current space gets the transformation
 * overlay (txMeta with the predicted category) — and an accountLink
 * only when the space already attached the account (#204).
 */
async function importIntoFeeds(
  repo: Repo,
  store: StorageBackend,
  spaceId: string,
  statements: ParsedStatement[],
  feeds: FeedGateway,
  onProgress?: ImportProgress,
): Promise<ImportResult> {
  const memory = await buildSpaceMerchantMemory(store, spaceId);
  const importedBy = await uploaderName(store);
  const keywordRules = (await cachedCatalog(store))?.keywords;
  const counterCandidates = await visibleAccounts(store, spaceId);
  let imported = 0;
  let skipped = 0;
  const accounts: ImportPlanAccount[] = [];

  for (const stmt of statements) {
    if (emptyStatement(stmt)) continue;
    const iban = normalizeIban(stmt.iban);
    const feedId = await feeds.register(feedSpaceId(iban), iban);
    const accountId = await importTargetAccountId(store, feedId, iban);

    const account = await store.get('account', accountId);
    if (account?.spaceId !== feedId) await createStatementAccount(repo, feedId, accountId, stmt, iban);
    else if (statementBalanceWins(account, stmt))
      await repo.upsert('account', feedId, accountId, {
        balanceCents: stmt.closingBalanceCents!,
        ...(stmt.balanceAsOf ? { balanceAsOf: stmt.balanceAsOf } : {}),
      });
    // coverage only moves forward, so a just-recreated row is safe here
    await stampCoverage(repo, feedId, accountId, account, stmt);

    let txCount = 0;
    const batchId = crypto.randomUUID();
    for (const entry of stmt.entries) {
      if (await importFeedEntry({ repo, store, spaceId, accountId, iban, memory, keywordRules, counterCandidates, batchId, importedBy }, feedId, entry)) {
        imported++;
        txCount++;
      } else {
        skipped++;
      }
      onProgress?.(imported + skipped);
    }

    const attached = await refreshExistingAttachment(repo, store, feeds, spaceId, feedId, accountId);

    accounts.push({
      iban: stmt.iban,
      accountId,
      accountName: account?.name ?? `Bank · ${iban.slice(-4)}`,
      isNew: !account,
      attached,
      txCount,
    });
  }

  return { imported, skipped, accounts };
}

/** raw half into the feed, predicted transformation half into the space's overlay */
async function importFeedEntry(
  ctx: EntryContext,
  feedId: string,
  entry: ParsedStatement['entries'][number],
): Promise<boolean> {
  const txId = uuidv5(`tx:${ctx.iban}:${entry.ref}`, IMPORT_NS);
  if (await ctx.store.get('transaction', txId)) return false;

  await ctx.repo.upsert('transaction', feedId, txId, {
    accountId: ctx.accountId,
    date: entry.date,
    amountCents: entry.amountCents,
    currency: entry.currency,
    merchant: entry.counterpartyName ?? entry.description.slice(0, 40),
    description: entry.description,
    ...(entry.counterpartyIban ? { counterIban: normalizeIban(entry.counterpartyIban) } : {}),
    importRef: entry.ref,
    importBatchId: ctx.batchId,
    ...(ctx.importedBy ? { importedBy: ctx.importedBy } : {}),
  });

  const { predicted, matchedId } = resolveEntryPrediction(ctx, entry);
  await ctx.repo.upsert('txMeta', ctx.spaceId, txMetaId(ctx.spaceId, txId), {
    txId,
    ...predicted,
  });
  await linkPredictedMovement(ctx, txId, predicted, feedId, matchedId);
  return true;
}
