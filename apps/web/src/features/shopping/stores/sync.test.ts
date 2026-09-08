// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { HlcClock } from '@/sync/hlc';
import { receiptLinkId, storeConnLinkId } from '@/domain/feedIds';
import { globalReceiptId, matchReceiptsIntoSpace, reevaluateSpace, syncInstanceReceipts } from './sync';
import type { ProxyCall } from './ah';

// the store feed needs a signed-in identity + server registration —
// pinned here so the sync logic can be tested in isolation
const FEED = 'feed-stores';
vi.mock('@/application/storeFeed', () => ({
  ensureStoreFeed: async () => FEED,
  myStoreFeedId: () => FEED,
}));

const SPACE = 's1';
const AH_ID = 'inst-ah-1';
let counter = 0;
let db: MunniDB;
let repo: Repo;
let backend: DexieBackend;

/** scripts the AH endpoints (GraphQL primary); a token refresh can be demanded */
function fakeAh({ expireFirst = false, refreshWorks = true, graphqlDown = false } = {}) {
  let refreshed = false;
  const calls: string[] = [];
  const call: ProxyCall = async (_store, path, init) => {
    calls.push(path);
    if (path === '/mobile-auth/v1/auth/token/refresh') {
      refreshed = true;
      return refreshWorks
        ? { status: 200, json: { access_token: 'fresh-access', refresh_token: 'fresh-refresh' } }
        : { status: 400, json: null };
    }
    if (path === '/graphql') {
      if (graphqlDown) return { status: 404, json: null };
      if (expireFirst && !refreshed) return { status: 401, json: null };
      expect(init?.authorization).toBe(`Bearer ${expireFirst ? 'fresh-access' : 'old-access'}`);
      const body = init?.body as { query: string; variables: Record<string, unknown> };
      if (body.query.includes('posReceiptsPage')) {
        return {
          status: 200,
          json: {
            data: {
              posReceiptsPage: {
                posReceipts: [
                  { id: 't-100', dateTime: '2026-07-05T17:31:00Z', totalAmount: { amount: 23.5 } },
                  { id: 't-200', dateTime: '2026-07-03T09:00:00Z', totalAmount: { amount: 9.99 } },
                ],
              },
            },
          },
        };
      }
      return { status: 200, json: { data: { posReceiptDetails: { products: [{ name: 'MELK', amount: { amount: 2.58 } }] } } } };
    }
    if (path === '/mobile-services/v2/receipts') {
      // legacy REST — only reachable when GraphQL is down
      expect(graphqlDown).toBe(true);
      return {
        status: 200,
        json: [{ transactionId: 't-100', transactionMoment: '2026-07-05T17:31:00Z', total: { amount: { amount: 23.5 } } }],
      };
    }
    if (path.startsWith('/mobile-services/v2/receipts/')) {
      return {
        status: 200,
        json: {
          receiptUiItems: [
            { type: 'product', description: 'MELK', amount: '2,58' },
            { type: 'payment', description: 'PINNEN Maestro ****1234', amount: '23,50' },
          ],
        },
      };
    }
    throw new Error(`unexpected path ${path}`);
  };
  return { call, calls };
}

const seedTx = (spaceId: string, id: string, merchant: string) =>
  repo.upsert('transaction', spaceId, id, {
    accountId: 'a1',
    date: '2026-07-05',
    amountCents: -2350,
    currency: 'EUR',
    merchant,
    txType: 'expense',
    needsReview: 0,
  });

beforeEach(async () => {
  db = new MunniDB(`store_sync_test_${++counter}`);
  backend = new DexieBackend(db);
  repo = new Repo(backend, new HlcClock('dev'), { trackOutbox: false });
  await repo.upsert('space', SPACE, SPACE, { name: 'One', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
  await db.storeInstances.put({
    id: AH_ID,
    store: 'ah',
    tokens: { access: 'old-access', refresh: 'old-refresh' },
    refreshedAt: '2026-07-01T00:00:00Z',
    status: 'ok',
  });
  await repo.upsert('storeConn', FEED, AH_ID, { store: 'ah', displayName: 'Albert Heijn', connectedAt: '2026-07-01', status: 'ok' });
  await repo.upsert('storeConnLink', SPACE, storeConnLinkId(SPACE, AH_ID), { instanceId: AH_ID, store: 'ah', displayName: 'Albert Heijn' });
});

describe('syncInstanceReceipts (v3: global feed + snapshot links)', () => {
  it('ingests receipts ONCE into the store feed and snapshot-links the clear match', async () => {
    await seedTx(SPACE, 'tx-ah', 'Albert Heijn');

    const { call } = fakeAh();
    const result = await syncInstanceReceipts(call, backend, repo, AH_ID);
    expect(result).toMatchObject({ status: 'ok', added: 2, linked: 1 });

    // the global layer holds the raw rows, keyed by instance
    const global = await db.receipts.get(globalReceiptId('ah', AH_ID, 't-100'));
    expect(global?.spaceId).toBe(FEED);
    expect(global?.instanceId).toBe(AH_ID);
    expect(global?.items).toEqual([{ name: 'MELK', qty: undefined, totalCents: 258 }]);

    // the SPACE holds a snapshot link carrying the payload (ruling 1)
    const link = await db.receiptLinks.get(receiptLinkId(SPACE, global!.id));
    expect(link?.txId).toBe('tx-ah');
    expect(link?.auto).toBe(1);
    expect(link?.totalCents).toBe(2350);
    expect(link?.items).toEqual([{ name: 'MELK', qty: undefined, totalCents: 258 }]);

    // no €9.99 transaction exists → global row stays unlinked
    expect(await db.receiptLinks.get(receiptLinkId(SPACE, globalReceiptId('ah', AH_ID, 't-200')))).toBeUndefined();

    // second pass: nothing new, nothing duplicated
    const again = await syncInstanceReceipts(call, backend, repo, AH_ID);
    expect(again).toMatchObject({ status: 'ok', added: 0 });
  });

  it('two included spaces: one global row, per-space matching, one detail fetch', async () => {
    await repo.upsert('space', 's2', 's2', { name: 'Two', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await repo.upsert('storeConnLink', 's2', storeConnLinkId('s2', AH_ID), { instanceId: AH_ID, store: 'ah', displayName: 'Albert Heijn' });
    // only space One holds the matching transaction
    await seedTx(SPACE, 'tx-ah', 'Albert Heijn');

    const { call, calls } = fakeAh();
    const result = await syncInstanceReceipts(call, backend, repo, AH_ID);
    expect(result).toMatchObject({ status: 'ok', added: 2, linked: 1 });

    expect(await db.receipts.where('spaceId').equals(FEED).toArray()).toHaveLength(2);
    expect((await db.receiptLinks.get(receiptLinkId(SPACE, globalReceiptId('ah', AH_ID, 't-100'))))?.txId).toBe('tx-ah');
    expect(await db.receiptLinks.get(receiptLinkId('s2', globalReceiptId('ah', AH_ID, 't-100')))).toBeUndefined();
    // list + 2 detail calls — details never refetch per space
    expect(calls.filter((p) => p === '/graphql').length).toBeLessThanOrEqual(3);
  });

  it('refreshes an expired token once and stores the fresh pair', async () => {
    const { call } = fakeAh({ expireFirst: true });
    const result = await syncInstanceReceipts(call, backend, repo, AH_ID);
    expect(result.status).toBe('ok');
    const connection = await db.storeInstances.get(AH_ID);
    expect(connection?.tokens.access).toBe('fresh-access');
    expect(connection?.status).toBe('ok');
  });

  it('REST fallback captures the payment line (R5 payment awareness)', async () => {
    const { call, calls } = fakeAh({ graphqlDown: true });
    const result = await syncInstanceReceipts(call, backend, repo, AH_ID);
    expect(result.status).toBe('ok');
    expect(result.added).toBe(1);
    expect(calls).toContain('/mobile-services/v2/receipts');
    const global = await db.receipts.get(globalReceiptId('ah', AH_ID, 't-100'));
    expect(global?.payment).toEqual({ method: 'PINNEN Maestro ****1234', accountTail: '1234' });
  });

  it('a dead refresh token expires the device row AND the synced metadata', async () => {
    const { call } = fakeAh({ expireFirst: true, refreshWorks: false });
    const result = await syncInstanceReceipts(call, backend, repo, AH_ID);
    expect(result.status).toBe('expired');
    expect((await db.storeInstances.get(AH_ID))?.status).toBe('expired');
    expect((await db.storeConns.get(AH_ID))?.status).toBe('expired');
  });
});

describe('reevaluateSpace (R5: a space gains a connection)', () => {
  it('links existing global receipts into the newly included space', async () => {
    const { call } = fakeAh();
    await syncInstanceReceipts(call, backend, repo, AH_ID);

    // a NEW space with the matching transaction joins afterwards
    await repo.upsert('space', 's3', 's3', { name: 'Three', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await seedTx('s3', 'tx-s3', 'Albert Heijn');
    const linked = await reevaluateSpace(backend, repo, 's3', AH_ID);
    expect(linked).toBe(1);
    expect((await db.receiptLinks.get(receiptLinkId('s3', globalReceiptId('ah', AH_ID, 't-100'))))?.txId).toBe('tx-s3');
  });

  it('never double-books a transaction that already carries a receipt', async () => {
    const { call } = fakeAh();
    await syncInstanceReceipts(call, backend, repo, AH_ID);
    await seedTx(SPACE, 'tx-ah', 'Albert Heijn');
    // the tx got its receipt via the first pass or a manual link
    const global = (await db.receipts.get(globalReceiptId('ah', AH_ID, 't-100')))!;
    await matchReceiptsIntoSpace(backend, repo, SPACE, [global]);
    const before = (await db.receiptLinks.where('spaceId').equals(SPACE).toArray()).filter((l) => l.deleted === 0).length;
    await matchReceiptsIntoSpace(backend, repo, SPACE, [global]);
    const after = (await db.receiptLinks.where('spaceId').equals(SPACE).toArray()).filter((l) => l.deleted === 0).length;
    expect(after).toBe(before);
  });
});

/** scripts the Jumbo mobile endpoints */
function fakeJumbo({ authFails = false } = {}) {
  const call: ProxyCall = async (_store, path, init) => {
    if (authFails) return { status: 401, json: null };
    expect(init?.authorization).toBe('Bearer jumbo-token');
    if (path === '/v17/users/me/receipts') {
      return {
        status: 200,
        json: {
          receipts: [
            { transactionId: 'j-1', purchaseEndOn: '2026-07-05T17:31:00Z', total: { amount: 2350 } }, // cents
            { transactionId: 'j-2', purchaseEndOn: '2026-07-03T09:00:00Z', total: { amount: 999 } },
          ],
        },
      };
    }
    if (path.startsWith('/v17/users/me/receipts/')) {
      return { status: 200, json: { items: [{ name: 'MELK', quantity: 2, price: { amount: 258 } }] } };
    }
    throw new Error(`unexpected path ${path}`);
  };
  return { call };
}

describe('syncInstanceReceipts (jumbo)', () => {
  const JUMBO_ID = 'inst-jumbo-1';

  beforeEach(async () => {
    await db.storeInstances.put({
      id: JUMBO_ID,
      store: 'jumbo',
      tokens: { token: 'jumbo-token' },
      refreshedAt: '2026-07-01T00:00:00Z',
      status: 'ok',
    });
    await repo.upsert('storeConn', FEED, JUMBO_ID, { store: 'jumbo', displayName: 'Jumbo', connectedAt: '2026-07-01', status: 'ok' });
    await repo.upsert('storeConnLink', SPACE, storeConnLinkId(SPACE, JUMBO_ID), { instanceId: JUMBO_ID, store: 'jumbo', displayName: 'Jumbo' });
  });

  it('ingests globally with the matcher, cents amounts as-is', async () => {
    await seedTx(SPACE, 'tx-jumbo', 'JUMBO 512 AMSTERDAM');

    const { call } = fakeJumbo();
    const result = await syncInstanceReceipts(call, backend, repo, JUMBO_ID);
    expect(result).toMatchObject({ status: 'ok', added: 2, linked: 1 });

    const global = await db.receipts.get(globalReceiptId('jumbo', JUMBO_ID, 'j-1'));
    expect(global?.merchant).toBe('Jumbo');
    expect(global?.items).toEqual([{ name: 'MELK', qty: 2, totalCents: 258 }]);
    expect((await db.receiptLinks.get(receiptLinkId(SPACE, global!.id)))?.txId).toBe('tx-jumbo');

    // second pass: nothing new, nothing duplicated
    expect(await syncInstanceReceipts(call, backend, repo, JUMBO_ID)).toMatchObject({ status: 'ok', added: 0 });
  });

  it('jumbo sessions do not refresh: an auth failure expires the instance', async () => {
    const { call } = fakeJumbo({ authFails: true });
    const result = await syncInstanceReceipts(call, backend, repo, JUMBO_ID);
    expect(result.status).toBe('expired');
    expect((await db.storeInstances.get(JUMBO_ID))?.status).toBe('expired');
    expect((await db.storeConns.get(JUMBO_ID))?.status).toBe('expired');
  });
});
