import type { AhReceiptSummary, AhReceiptUiItem } from '@/domain/storeReceipts';

/**
 * Albert Heijn adapter (receipts design S2), per the community recipe
 * (appie-go / the receipts gist): the mobile app's own endpoints behind
 * our CORS pass-through. The user logs in at login.ah.nl in their own
 * browser tab; AH redirects to appie://login-exit?code=… which the
 * browser can't open — the user pastes that address back and the code
 * is exchanged for tokens that never leave the device.
 */

export const AH_AUTHORIZE_URL =
  'https://login.ah.nl/secure/oauth/authorize?client_id=appie&redirect_uri=appie%3A%2F%2Flogin-exit&response_type=code';

const CLIENT_ID = 'appie';

/** one proxied call: the server forwards verbatim, stores nothing */
export type ProxyCall = (
  store: 'ah-api' | 'ah-login' | 'jumbo',
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown; authorization?: string; userAgent?: string },
) => Promise<{ status: number; json: unknown; headers?: { jumboToken?: string } }>;

export interface StoreTokens {
  access: string;
  refresh: string;
}

/** the pasted redirect: appie://login-exit?code=XYZ (or just the code) */
export function extractAhCode(pasted: string): string | null {
  const input = pasted.trim();
  if (!input) return null;
  const fromUrl = /[?&]code=([^&\s]+)/.exec(input);
  if (fromUrl) return decodeURIComponent(fromUrl[1]);
  return /^[\w.-]{8,}$/.test(input) ? input : null;
}

interface AhTokenResponse {
  access_token?: string;
  refresh_token?: string;
}

const toTokens = (json: unknown): StoreTokens | null => {
  const body = json as AhTokenResponse | null;
  return body?.access_token && body.refresh_token ? { access: body.access_token, refresh: body.refresh_token } : null;
};

export async function ahExchangeCode(call: ProxyCall, code: string): Promise<StoreTokens | null> {
  const { status, json } = await call('ah-api', '/mobile-auth/v1/auth/token', {
    method: 'POST',
    body: { clientId: CLIENT_ID, code },
  });
  return status === 200 ? toTokens(json) : null;
}

export async function ahRefresh(call: ProxyCall, refreshToken: string): Promise<StoreTokens | null> {
  const { status, json } = await call('ah-api', '/mobile-auth/v1/auth/token/refresh', {
    method: 'POST',
    body: { clientId: CLIENT_ID, refreshToken },
  });
  return status === 200 ? toTokens(json) : null;
}

export interface AhListResult {
  status: number;
  receipts: AhReceiptSummary[];
  /** which recipe actually answered — the robustness signal the UI shows */
  via?: 'graphql' | 'rest';
}

// AH moved receipts to their GraphQL gateway; the mobile-services REST
// path still answers on some accounts, so it stays as the fallback.
const RECEIPTS_QUERY =
  'query FetchPosReceipts($offset: Int!, $limit: Int!) { posReceiptsPage(pagination: {offset: $offset, limit: $limit}) { posReceipts { id dateTime totalAmount { amount } } } }';
const RECEIPT_DETAILS_QUERY =
  'query FetchReceipt($id: String!) { posReceiptDetails(id: $id) { id products { quantity name amount { amount } } } }';

interface GraphqlReceipt {
  id?: string;
  dateTime?: string;
  totalAmount?: { amount?: number };
}

interface GraphqlEnvelope {
  data?: {
    posReceiptsPage?: { posReceipts?: GraphqlReceipt[] };
    posReceiptDetails?: { products?: { quantity?: number | string; name?: string; amount?: { amount?: number } }[] };
  };
}

const graphql = (call: ProxyCall, accessToken: string, query: string, variables: Record<string, unknown>) =>
  call('ah-api', '/graphql', { method: 'POST', body: { query, variables }, authorization: `Bearer ${accessToken}` });

export async function ahFetchReceipts(call: ProxyCall, accessToken: string): Promise<AhListResult> {
  const { status, json } = await graphql(call, accessToken, RECEIPTS_QUERY, { offset: 0, limit: 100 });
  const rows = (json as GraphqlEnvelope | null)?.data?.posReceiptsPage?.posReceipts;
  if (status === 200 && Array.isArray(rows)) {
    return {
      status,
      via: 'graphql',
      receipts: rows
        .filter((r) => r.id && r.dateTime)
        .map((r) => ({ transactionId: r.id!, transactionMoment: r.dateTime!, total: { amount: { amount: r.totalAmount?.amount } } })),
    };
  }
  if (status === 401) return { status, receipts: [] };

  // legacy REST fallback — also tells us which recipe a live account speaks
  const legacy = await call('ah-api', '/mobile-services/v2/receipts', { authorization: `Bearer ${accessToken}` });
  const legacyRows = Array.isArray(legacy.json) ? (legacy.json as AhReceiptSummary[]) : [];
  return { status: legacy.status, via: 'rest', receipts: legacyRows.filter((r) => r.transactionId && r.transactionMoment) };
}

/** the member's stable id — duplicate-connection detection, best-effort */
export async function ahFetchMemberId(call: ProxyCall, accessToken: string): Promise<string | null> {
  const { status, json } = await call('ah-api', '/mobile-services/member/v1/member', {
    authorization: `Bearer ${accessToken}`,
  });
  if (status !== 200) return null;
  const member = json as { memberId?: number | string } | null;
  return member?.memberId == null ? null : String(member.memberId);
}

export async function ahFetchReceiptItems(call: ProxyCall, accessToken: string, transactionId: string): Promise<AhReceiptUiItem[]> {
  const { status, json } = await graphql(call, accessToken, RECEIPT_DETAILS_QUERY, { id: transactionId });
  const products = (json as GraphqlEnvelope | null)?.data?.posReceiptDetails?.products;
  if (status === 200 && Array.isArray(products)) {
    return products
      .filter((p) => p.name)
      .map((p) => ({ type: 'product', description: p.name, quantity: p.quantity, amount: String(p.amount?.amount ?? '') }));
  }

  const legacy = await call('ah-api', `/mobile-services/v2/receipts/${encodeURIComponent(transactionId)}`, {
    authorization: `Bearer ${accessToken}`,
  });
  if (legacy.status !== 200) return [];
  const detail = legacy.json as { receiptUiItems?: AhReceiptUiItem[] } | null;
  return detail?.receiptUiItems ?? [];
}
