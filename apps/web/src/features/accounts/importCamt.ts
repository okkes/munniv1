import { v5 as uuidv5 } from 'uuid';
import { accountLinkId, feedSpaceId, txMetaId } from '@/domain/feedIds';
import type { ParsedStatement } from '@/lib/statements/parseStatement';
import { predictTx, predictionSkipsReview } from '@/domain/predictCategory';
import { cachedCatalog } from '@/sync/catalogSync';
import type { MerchantMemory } from '@/domain/merchantMemory';
import { buildSpaceMerchantMemory } from '@/application/prediction';
import { UNCATEGORIZED_ID } from '@/domain/categories';
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
  memory: MerchantMemory,
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
  memory: MerchantMemory;
  keywordRules?: readonly { catId: string; keywords: string[] }[];
  /** master plan IB: one id per statement per run — rollback's unit */
  batchId: string;
  /** uploader display name, frozen at import time */
  importedBy?: string;
}

/** the uploader's display name (same source the activity history freezes) */
async function uploaderName(store: StorageBackend): Promise<string | undefined> {
  return ((await store.metaGet('profile'))?.value as { name?: string } | undefined)?.name;
}

/** returns true when the entry was new (imported), false when it already existed */
async function importEntry(ctx: EntryContext, entry: ParsedStatement['entries'][number]): Promise<boolean> {
  const txId = uuidv5(`tx:${ctx.iban}:${entry.ref}`, IMPORT_NS);
  if (await ctx.store.get('transaction', txId)) return false;

  await ctx.repo.upsert('transaction', ctx.spaceId, txId, {
    accountId: ctx.accountId,
    date: entry.date,
    amountCents: entry.amountCents,
    currency: entry.currency,
    merchant: entry.counterpartyName ?? entry.description.slice(0, 40),
    description: entry.description,
    ...(entry.counterpartyIban ? { counterIban: normalizeIban(entry.counterpartyIban) } : {}),
    ...predictEntry(ctx.memory, entry, ctx.keywordRules),
    importRef: entry.ref,
    importBatchId: ctx.batchId,
    ...(ctx.importedBy ? { importedBy: ctx.importedBy } : {}),
  });
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

/** Match statements to existing accounts by IBAN (creating where needed) and import entries idempotently. */
export async function importCamtStatements(
  repo: Repo,
  store: StorageBackend,
  spaceId: string,
  statements: ParsedStatement[],
  feeds?: FeedGateway,
): Promise<ImportResult> {
  // demo/offline identities never sync: raw+transformation stay merged
  // in the current space exactly as before (dual-read handles both)
  return feeds
    ? importIntoFeeds(repo, store, spaceId, statements, feeds)
    : importMerged(repo, store, spaceId, statements);
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
): Promise<ImportResult> {
  const memory = await buildSpaceMerchantMemory(store, spaceId);
  const importedBy = await uploaderName(store);
  const keywordRules = (await cachedCatalog(store))?.keywords;
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
      if (await importEntry({ repo, store, spaceId, accountId, iban, memory, keywordRules, batchId, importedBy }, entry)) {
        imported++;
        txCount++;
      } else {
        skipped++;
      }
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
 * Feed shape (shared-accounts design): raw facts go ONCE into the
 * account's feed space, the current space gets the transformation
 * overlay (txMeta with the predicted category) plus an accountLink, and
 * the server records the attachment so members derive read access.
 */
async function importIntoFeeds(
  repo: Repo,
  store: StorageBackend,
  spaceId: string,
  statements: ParsedStatement[],
  feeds: FeedGateway,
): Promise<ImportResult> {
  const memory = await buildSpaceMerchantMemory(store, spaceId);
  const importedBy = await uploaderName(store);
  const keywordRules = (await cachedCatalog(store))?.keywords;
  let imported = 0;
  let skipped = 0;
  const accounts: ImportPlanAccount[] = [];

  for (const stmt of statements) {
    if (emptyStatement(stmt)) continue;
    const iban = normalizeIban(stmt.iban);
    const feedId = await feeds.register(feedSpaceId(iban), iban);
    const accountId = uuidv5(`acct:${iban}`, IMPORT_NS);

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
      if (await importFeedEntry({ repo, store, spaceId, accountId, iban, memory, keywordRules, batchId, importedBy }, feedId, entry)) {
        imported++;
        txCount++;
      } else {
        skipped++;
      }
    }

    // attach to the space the user imported from (server first — the
    // synced link row is the offline mirror of that authoritative fact).
    // The link CARRIES the history gate (bug: it used to attach without
    // one, so imported rows ignored the space's start date entirely);
    // an existing link keeps whatever gate the user already chose.
    const linkId = accountLinkId(spaceId, feedId);
    const existingLink = await store.get('accountLink', linkId);
    const historyFrom =
      existingLink?.historyFrom ?? (await store.get('space', spaceId))?.historyStartDate ?? isoMonthsAgo(DEFAULT_HISTORY_MONTHS);
    await feeds.attach(spaceId, feedId, accountId, historyFrom);
    await repo.upsert('accountLink', spaceId, linkId, {
      feedSpaceId: feedId,
      accountId,
      historyFrom,
    });

    accounts.push({
      iban: stmt.iban,
      accountId,
      accountName: account?.name ?? `Bank · ${iban.slice(-4)}`,
      isNew: !account,
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

  await ctx.repo.upsert('txMeta', ctx.spaceId, txMetaId(ctx.spaceId, txId), {
    txId,
    ...predictEntry(ctx.memory, entry, ctx.keywordRules),
  });
  return true;
}
