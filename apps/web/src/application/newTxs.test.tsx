// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_TEST_DB, USER_TEST_SUB, renderAppAsUser } from '@/test/harness';
import { MunniDB } from '@/db/schema';
import { encodeHlc } from '@/sync/hlc';
import { bornAtMs, txSeenBaseId, txSeenRowId, userStateSpaceId } from '@/domain/userState';

const HOUR = 60 * 60 * 1000;
const hlc = (wallMs: number) => encodeHlc({ wallMs, counter: 0, deviceId: 'seed' });

const seedTx = (db: MunniDB, id: string, bornMs: number, merchant: string) =>
  db.transactions.put({
    id,
    spaceId: 's-user',
    accountId: 'a1',
    date: '2026-08-20',
    amountCents: -1000,
    currency: 'EUR',
    merchant,
    txType: 'expense',
    needsReview: 0,
    deleted: 0,
    fieldVersions: { merchant: hlc(bornMs), amountCents: hlc(bornMs) },
  } as never);

describe('useNewTransactions — the synced 24h clock (#148 r3)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  it('the state-space id is deterministic, private-sub-derived and v8-shaped', () => {
    const id = userStateSpaceId(USER_TEST_SUB);
    expect(id).toBe(userStateSpaceId(USER_TEST_SUB));
    expect(id).not.toBe(userStateSpaceId('someone-else'));
    // version nibble 8: never feed-shaped (v5), still a parseable uuid
    expect(id[14]).toBe('8');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('bornAtMs reads the OLDEST field stamp', () => {
    expect(bornAtMs({ a: hlc(5000), b: hlc(3000) })).toBe(3000);
    expect(bornAtMs(undefined)).toBe(0);
  });

  it('labels only rows born after the baseline; another device’s sight suppresses newness here', async () => {
    const now = Date.now();
    const t0 = now - 12 * HOUR; // the scheme started half a day ago
    const stateId = userStateSpaceId(USER_TEST_SUB);
    const db = new MunniDB(USER_TEST_DB);
    await db.txSeen.put({
      id: txSeenBaseId('s-user'),
      spaceId: stateId,
      forSpaceId: 's-user',
      labeledAt: t0,
      baseline: 1,
      deleted: 0,
      fieldVersions: { labeledAt: hlc(t0) },
    } as never);
    // born BEFORE the baseline: known history, no row needed
    await seedTx(db, 'old-tx', t0 - 5 * HOUR, 'Old History');
    // born after, never seen anywhere: labeled fresh on sight
    await seedTx(db, 'fresh-tx', now - HOUR, 'Fresh Arrival');
    // born after, but ANOTHER DEVICE saw it 25h ago (synced row): expired
    await seedTx(db, 'stale-tx', now - 26 * HOUR, 'Seen Elsewhere');
    await db.txSeen.put({
      id: txSeenRowId('s-user', 'stale-tx'),
      spaceId: stateId,
      forSpaceId: 's-user',
      txId: 'stale-tx',
      labeledAt: now - 25 * HOUR,
      deleted: 0,
      fieldVersions: { labeledAt: hlc(now - 25 * HOUR) },
    } as never);

    renderAppAsUser('/home', {
      api: { 'GET /me': () => ({ userId: 'u-me', displayName: 'Me' }) },
    });
    const block = await screen.findByTestId('home-newtxs', {}, { timeout: 8000 });
    expect(block.querySelector('[data-testid="tx-row-fresh-tx"]')).toBeTruthy();
    expect(block.querySelector('[data-testid="tx-row-old-tx"]')).toBeNull();
    expect(block.querySelector('[data-testid="tx-row-stale-tx"]')).toBeNull();

    // the sighting was recorded as a synced row with a running clock
    await waitFor(async () => {
      const row = await db.txSeen.get(txSeenRowId('s-user', 'fresh-tx'));
      expect(row?.txId).toBe('fresh-tx');
      expect(row?.labeledAt).toBeGreaterThan(now - HOUR);
    }, { timeout: 8000 });
    db.close();
  }, 20_000);
});
