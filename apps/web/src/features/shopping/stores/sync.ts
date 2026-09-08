import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import type { ReceiptItem, ReceiptPayment, ReceiptRow, StoreConnectionRow, TransactionRow } from '@/db/types';
import { bestMatch, mapAhItems, mapAhPayment, mapAhSummary } from '@/domain/storeReceipts';
import type { AccountTailOf, MatchableReceipt } from '@/domain/storeReceipts';
import { receiptLinkId } from '@/domain/feedIds';
import { ensureStoreFeed } from '@/application/storeFeed';
import { writeReceiptLink } from '@/application/receiptLinks';
import { ahFetchReceiptItems, ahFetchReceipts, ahRefresh } from './ah';
import type { ProxyCall, StoreTokens } from './ah';
import { jumboFetchReceiptItems, jumboFetchReceipts } from './jumbo';

/**
 * Receipts v3 sync (approved redesign): receipts are pulled ONCE into
 * the owner's personal STORE FEED (global layer), then the matcher runs
 * per INCLUDED space (storeConnLink rows) and links rung-1 singles by
 * writing snapshot receiptLink rows. One detail fetch per receipt no
 * matter how many spaces it matches into.
 */

/** global receipt row id — one per receipt per connection instance */
export const globalReceiptId = (store: string, instanceId: string, externalId: string): string =>
  `rcpt:${store}:${instanceId}:${externalId}`;

export const storeRefOf = (store: string, externalId: string): string => `${store}:${externalId}`;

export interface StoreSyncResult {
  status: 'ok' | 'expired' | 'error';
  added: number;
  /** how many receipts auto-linked to transactions across all spaces */
  linked?: number;
  /** upstream HTTP status when the read failed — the live-debug signal */
  httpStatus?: number;
  /** which recipe answered (AH: GraphQL primary vs legacy REST fallback) */
  via?: 'graphql' | 'rest';
}

type IngestableReceipt = MatchableReceipt & { storeId: string };

interface ReceiptDetail {
  items: ReceiptItem[];
  payment?: ReceiptPayment;
}

/** one detail fetch per receipt, however many spaces receive it */
function memoizeDetail(fetch: (externalId: string) => Promise<ReceiptDetail>): (externalId: string) => Promise<ReceiptDetail> {
  const cache = new Map<string, ReceiptDetail>();
  return async (externalId) => {
    const cached = cache.get(externalId);
    if (cached) return cached;
    const detail = await fetch(externalId);
    cache.set(externalId, detail);
    return detail;
  };
}

/** the spaces an instance is included in (storeConnLink, deleted spaces drop) */
async function includedSpaces(store: StorageBackend, instanceId: string): Promise<string[]> {
  const localSpaceIds = new Set((await store.allRows('space')).filter((s) => s.deleted === 0).map((s) => s.id));
  return (await store.allRows('storeConnLink'))
    .filter((l) => l.deleted === 0 && l.instanceId === instanceId && localSpaceIds.has(l.spaceId))
    .map((l) => l.spaceId);
}

/** IBAN tails of the space's accounts — payment-aware matching (R5) */
async function accountTailResolver(store: StorageBackend): Promise<AccountTailOf> {
  const accounts = await store.allRows('account');
  const ibanByAccount = new Map(accounts.filter((a) => a.iban).map((a) => [a.id, a.iban!.replaceAll(/\D/g, '')]));
  return (tx: TransactionRow) => ibanByAccount.get(tx.accountId);
}

/**
 * Match the given global receipts into ONE space: rung-1 singles get an
 * auto snapshot link; receipts already present in the space are skipped,
 * as are transactions that already carry a receipt.
 */
export async function matchReceiptsIntoSpace(
  storage: StorageBackend,
  repo: Repo,
  spaceId: string,
  receipts: readonly ReceiptRow[],
): Promise<number> {
  const [allTxs, links, legacyRows] = await Promise.all([
    storage.bySpace('transaction', spaceId),
    storage.bySpace('receiptLink', spaceId),
    storage.bySpace('receipt', spaceId),
  ]);
  const txs = allTxs.filter((t) => t.deleted === 0);
  const present = new Set(links.filter((l) => l.deleted === 0).map((l) => l.id));
  const taken = new Set([
    ...links.filter((l) => l.deleted === 0 && l.txId).map((l) => l.txId!),
    ...legacyRows.filter((r) => r.deleted === 0 && r.txId).map((r) => r.txId!),
  ]);
  const tailOf = await accountTailResolver(storage);

  let linked = 0;
  for (const receipt of receipts) {
    if (receipt.deleted !== 0) continue;
    if (present.has(receiptLinkId(spaceId, receipt.id))) continue;
    const txId = bestMatch(receipt, txs, taken, tailOf);
    if (!txId) continue;
    taken.add(txId);
    await writeReceiptLink(repo, spaceId, receipt, txId, true);
    linked += 1;
  }
  return linked;
}

/**
 * Re-evaluate a whole space against every global receipt (R5: runs when
 * a connection instance is added to the space). instanceId narrows the
 * pass to one connection; omitted = all store receipts.
 */
export async function reevaluateSpace(
  storage: StorageBackend,
  repo: Repo,
  spaceId: string,
  instanceId?: string,
): Promise<number> {
  const feeds = new Set((await storage.allRows('storeConn')).filter((c) => c.deleted === 0).map((c) => c.spaceId));
  const receipts: ReceiptRow[] = [];
  for (const feedId of feeds) {
    receipts.push(...(await storage.bySpace('receipt', feedId)));
  }
  const scoped = instanceId ? receipts.filter((r) => r.instanceId === instanceId) : receipts;
  return matchReceiptsIntoSpace(storage, repo, spaceId, scoped);
}

/** ingest the fetched list into the GLOBAL layer; returns the new rows */
async function ingestGlobal(
  storage: StorageBackend,
  repo: Repo,
  feedId: string,
  connection: StoreConnectionRow,
  receipts: readonly IngestableReceipt[],
  fetchDetail: (externalId: string) => Promise<ReceiptDetail>,
): Promise<ReceiptRow[]> {
  const existing = await storage.bySpace('receipt', feedId);
  const seen = new Set(existing.map((r) => r.storeRef));
  const fresh: ReceiptRow[] = [];
  for (const summary of receipts) {
    const ref = storeRefOf(connection.store, summary.storeId);
    if (seen.has(ref)) continue;
    const detail = await fetchDetail(summary.storeId);
    const id = globalReceiptId(connection.store, connection.id, summary.storeId);
    await repo.upsert('receipt', feedId, id, {
      source: connection.store,
      date: summary.date,
      totalCents: summary.totalCents,
      merchant: connection.store === 'jumbo' ? 'Jumbo' : 'Albert Heijn',
      items: detail.items.length > 0 ? detail.items : undefined,
      storeRef: ref,
      instanceId: connection.id,
      payment: detail.payment,
    });
    const row = await storage.get('receipt', id);
    if (row) fresh.push(row);
  }
  return fresh;
}

/** flag the synced instance metadata when a connection expires */
async function markExpired(storage: StorageBackend, repo: Repo, connection: StoreConnectionRow): Promise<void> {
  await storage.storeConnPut({ ...connection, status: 'expired' });
  const meta = (await storage.allRows('storeConn')).find((c) => c.id === connection.id && c.deleted === 0);
  if (meta) await repo.upsert('storeConn', meta.spaceId, meta.id, { status: 'expired' });
}

interface FetchedList {
  status: number;
  receipts: IngestableReceipt[];
  via?: 'graphql' | 'rest';
  tokens?: StoreTokens;
  expired?: boolean;
}

async function fetchAhList(call: ProxyCall, connection: StoreConnectionRow): Promise<FetchedList> {
  let tokens: StoreTokens = { access: connection.tokens.access, refresh: connection.tokens.refresh };
  let list = await ahFetchReceipts(call, tokens.access);
  if (list.status === 401) {
    const refreshed = await ahRefresh(call, tokens.refresh);
    if (!refreshed) return { status: 401, receipts: [], expired: true };
    tokens = refreshed;
    list = await ahFetchReceipts(call, tokens.access);
  }
  return { status: list.status, receipts: list.receipts.map(mapAhSummary), via: list.via, tokens };
}

async function fetchJumboList(call: ProxyCall, connection: StoreConnectionRow): Promise<FetchedList> {
  const list = await jumboFetchReceipts(call, connection.tokens.token);
  // jumbo sessions don't refresh — an auth failure means reconnect
  if (list.status === 401 || list.status === 403) return { status: list.status, receipts: [], expired: true };
  return { status: list.status, receipts: list.receipts };
}

/**
 * One full sync pass for one connection instance: global ingest, then
 * per-included-space matching. The cross-store entry point everything
 * (connect, manual sync, keep-alive, post-tx-sync trigger) calls.
 */
export async function syncInstanceReceipts(
  call: ProxyCall,
  storage: StorageBackend,
  repo: Repo,
  instanceId: string,
): Promise<StoreSyncResult> {
  const connection = await storage.storeConnGet(instanceId);
  if (connection?.status !== 'ok') return { status: 'error', added: 0 };
  const feedId = await ensureStoreFeed(storage);
  if (!feedId) return { status: 'error', added: 0 };

  const list =
    connection.store === 'jumbo' ? await fetchJumboList(call, connection) : await fetchAhList(call, connection);
  if (list.expired) {
    await markExpired(storage, repo, connection);
    return { status: 'expired', added: 0 };
  }
  if (list.status !== 200) return { status: 'error', added: 0, httpStatus: list.status };

  const fetchDetail = memoizeDetail(async (externalId) => {
    if (connection.store === 'jumbo') {
      return { items: await jumboFetchReceiptItems(call, connection.tokens.token, externalId) };
    }
    const access = list.tokens?.access ?? connection.tokens.access;
    const uiItems = await ahFetchReceiptItems(call, access, externalId);
    return { items: mapAhItems(uiItems), payment: mapAhPayment(uiItems) };
  });

  const fresh = await ingestGlobal(storage, repo, feedId, connection, list.receipts, fetchDetail);

  let linked = 0;
  for (const spaceId of await includedSpaces(storage, instanceId)) {
    linked += await matchReceiptsIntoSpace(storage, repo, spaceId, fresh);
  }

  await storage.storeConnPut({
    ...connection,
    tokens: list.tokens ? { access: list.tokens.access, refresh: list.tokens.refresh } : connection.tokens,
    refreshedAt: new Date().toISOString(),
    status: 'ok',
    lastReceiptId: list.receipts[0]?.storeId ?? connection.lastReceiptId,
  });
  return { status: 'ok', added: fresh.length, linked, via: list.via };
}
