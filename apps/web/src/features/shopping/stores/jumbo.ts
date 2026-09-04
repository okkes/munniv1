import type { ReceiptItem } from '@/db/types';
import type { MatchableReceipt } from '@/domain/storeReceipts';
import type { ProxyCall } from './ah';

/**
 * Jumbo adapter (receipts design S3), per the community recipe
 * (python-jumbo-api / jumbo-wrapper): the mobile app's own endpoints
 * behind our pass-through. Login is username/password → a session token
 * in the `x-jumbo-token` response header; credentials are NEVER stored,
 * only the token — an expired token means reconnecting, by design.
 * ⚠ Field shapes follow the community recipe and are parsed defensively;
 * the sync-result line is the live-debug signal for a real account.
 */

const JUMBO_UA = 'Jumbo/10.4.1';
const BASE = '/v17';

export type JumboLoginOutcome =
  | { token: string; outcome: 'ok' }
  /** blocked = Jumbo's bot protection refuses non-app clients (edge 403 / proxy 502/504) */
  | { token: null; outcome: 'blocked' | 'failed' };

export async function jumboLogin(call: ProxyCall, username: string, password: string): Promise<JumboLoginOutcome> {
  const { status, json, headers } = await call('jumbo', `${BASE}/users/login`, {
    method: 'POST',
    body: { username, password },
    userAgent: JUMBO_UA,
  });
  if (status === 200) {
    // primary recipe: the session token rides a response header; some API
    // versions have returned it in the body instead
    const body = json as { token?: string; access_token?: string } | null;
    const token = headers?.jumboToken ?? body?.token ?? body?.access_token ?? null;
    return token ? { token, outcome: 'ok' } : { token: null, outcome: 'failed' };
  }
  return { token: null, outcome: status === 403 || status === 502 || status === 504 ? 'blocked' : 'failed' };
}

interface JumboReceiptRow {
  transactionId?: string;
  id?: string;
  purchaseEndOn?: string;
  purchaseStartOn?: string;
  transactionMoment?: string;
  /** jumbo amounts are integer CENTS in most captures; tolerate euros */
  total?: number | { amount?: number };
}

const toCents = (total: JumboReceiptRow['total']): number => {
  const raw = typeof total === 'number' ? total : (total?.amount ?? 0);
  if (!Number.isFinite(raw)) return 0;
  // heuristics: integer ≥ 1000 or any integer with a fractional sibling
  // pattern — community captures show integer cents; floats are euros
  return Number.isInteger(raw) ? raw : Math.round(raw * 100);
};

export interface JumboListResult {
  status: number;
  receipts: (MatchableReceipt & { storeId: string })[];
}

export async function jumboFetchReceipts(call: ProxyCall, token: string): Promise<JumboListResult> {
  const { status, json } = await call('jumbo', `${BASE}/users/me/receipts`, {
    authorization: `Bearer ${token}`,
    userAgent: JUMBO_UA,
  });
  if (status !== 200) return { status, receipts: [] };
  const rows: JumboReceiptRow[] = Array.isArray(json)
    ? (json as JumboReceiptRow[])
    : ((json as { receipts?: JumboReceiptRow[] } | null)?.receipts ?? []);
  const receipts: (MatchableReceipt & { storeId: string })[] = [];
  for (const row of rows) {
    const id = row.transactionId ?? row.id;
    const moment = row.purchaseEndOn ?? row.purchaseStartOn ?? row.transactionMoment;
    if (!id || !moment) continue;
    receipts.push({ id, storeId: id, source: 'jumbo', date: moment.slice(0, 10), totalCents: toCents(row.total) });
  }
  return { status, receipts };
}

interface JumboItemRow {
  name?: string;
  description?: string;
  quantity?: number | string;
  price?: number | { amount?: number };
  total?: number | { amount?: number };
}

export async function jumboFetchReceiptItems(call: ProxyCall, token: string, receiptId: string): Promise<ReceiptItem[]> {
  const { status, json } = await call('jumbo', `${BASE}/users/me/receipts/${encodeURIComponent(receiptId)}`, {
    authorization: `Bearer ${token}`,
    userAgent: JUMBO_UA,
  });
  if (status !== 200) return [];
  const detail = json as { items?: JumboItemRow[]; products?: JumboItemRow[] } | null;
  const rows = detail?.items ?? detail?.products ?? [];
  const items: ReceiptItem[] = [];
  for (const row of rows) {
    const name = row.name ?? row.description;
    if (!name) continue;
    const qty = typeof row.quantity === 'string' ? Number.parseInt(row.quantity, 10) : row.quantity;
    items.push({
      name,
      qty: qty !== undefined && Number.isFinite(qty) && qty > 1 ? qty : undefined,
      totalCents: toCents(row.total ?? row.price),
    });
  }
  return items;
}
