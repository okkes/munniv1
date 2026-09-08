// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { DexieBackend } from './backend';
import type { StorageBackend } from './backend';
import { visibleTransactions, writeTxTransform } from './joined';
import { Repo } from './repo';
import { MunniDB } from './schema';
import { SqlStorageBackend, initSqlSchema } from './sqlBackend';
import type { SqlExecutor } from './sqlBackend';

/**
 * E2 parity suite: the SQL backend must be indistinguishable from the
 * Dexie backend through the StorageBackend interface — every scenario
 * runs against BOTH and asserts the same observable results. The
 * executor here is sql.js in memory; on device it is SQLCipher, but the
 * backend code under test is identical.
 */

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => {
  SQL = await initSqlJs();
});

/** sql.js bridge — the same shape the capacitor executor implements */
function sqlJsExecutor(db: Database): SqlExecutor {
  return {
    async run(sql, params = []) {
      db.run(sql, params);
    },
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    async transaction(fn) {
      db.run('BEGIN');
      try {
        await fn();
        db.run('COMMIT');
      } catch (err) {
        db.run('ROLLBACK');
        throw err;
      }
    },
    async close() {
      db.close();
    },
    async destroy() {
      db.close();
    },
  };
}

interface Ctx {
  name: string;
  store: StorageBackend;
  repo: Repo;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

let dbSeq = 0;
async function bothBackends(): Promise<Ctx[]> {
  const dexie = new DexieBackend(new MunniDB(`munni_parity_${++dbSeq}`));
  const sqlDb = new SQL.Database();
  const executor = sqlJsExecutor(sqlDb);
  await initSqlSchema(executor);
  const sql = new SqlStorageBackend(executor);
  cleanups.push(() => void dexie.destroy(), () => sql.close());
  return [
    { name: 'dexie', store: dexie, repo: new Repo(dexie, new HlcClock('parity-d'), { trackOutbox: true }) },
    { name: 'sql', store: sql, repo: new Repo(sql, new HlcClock('parity-s'), { trackOutbox: true }) },
  ];
}

const SPACE = 's1';

describe('SqlStorageBackend parity with DexieBackend', () => {
  it('repo upsert/merge/tombstone reads back identically', async () => {
    for (const { name, store, repo } of await bothBackends()) {
      await repo.upsert('account', SPACE, 'a1', { name: 'Checking', type: 'checking', balanceCents: 1000 });
      await repo.upsert('account', SPACE, 'a1', { balanceCents: 2500 });
      await repo.upsert('account', SPACE, 'a2', { name: 'Savings', type: 'savings', balanceCents: 9000 });
      await repo.remove('account', SPACE, 'a2');

      const a1 = await store.get('account', 'a1');
      expect(a1, name).toMatchObject({ name: 'Checking', balanceCents: 2500, deleted: 0 });
      const a2 = await store.get('account', 'a2');
      expect(a2?.deleted, name).toBe(1); // tombstoned, not gone
      expect((await store.bySpace('account', SPACE)).length, name).toBe(2);
      expect(await store.countBySpace('account', SPACE), name).toBe(2);
      // outbox carries all four ops in HLC order
      const outbox = await store.outboxBySpace(SPACE);
      expect(outbox.length, name).toBe(4);
      expect([...outbox].sort((x, y) => x.hlc.localeCompare(y.hlc)), name).toEqual(outbox);
    }
  });

  it('#296: txSeen rows round-trip on BOTH backends — the native list forgot the entity and user login crashed', async () => {
    for (const { name, store, repo } of await bothBackends()) {
      await repo.upsert('txSeen', SPACE, 'seen-1', { forSpaceId: 's-x', txId: 't1', labeledAt: 123 });
      const rows = await store.bySpace('txSeen', SPACE);
      expect(rows, name).toHaveLength(1);
      expect(rows[0], name).toMatchObject({ forSpaceId: 's-x', txId: 't1', labeledAt: 123, deleted: 0 });
    }
  });

  it('the joined read model works unchanged on both backends', async () => {
    for (const { name, store, repo } of await bothBackends()) {
      // a feed space raw row + this space's overlay + an attachment
      await repo.upsert('transaction', 'feed1', 'raw1', {
        accountId: 'acc1',
        date: '2026-01-15',
        amountCents: -2999,
        currency: 'EUR',
        merchant: 'Bol.com',
        txType: 'expense',
        needsReview: 1,
      });
      await repo.upsert('accountLink', SPACE, 'link1', { feedSpaceId: 'feed1', accountId: 'acc1' });
      const [joined] = await visibleTransactions(store, SPACE);
      expect(joined, name).toMatchObject({ id: 'raw1', feedSpaceId: 'feed1', needsReview: 1 });

      await writeTxTransform(repo, joined, { catId: 'groceries', needsReview: 0 });
      const [after] = await visibleTransactions(store, SPACE);
      expect(after, name).toMatchObject({ catId: 'groceries', needsReview: 0 });
      // the raw row itself is untouched (transformation lives in the overlay)
      expect((await store.get('transaction', 'raw1'))?.catId, name).toBeUndefined();
    }
  });

  it('meta, outbox drain and purge behave identically', async () => {
    for (const { name, store, repo } of await bothBackends()) {
      await store.metaPut('cursor', 42);
      expect((await store.metaGet('cursor'))?.value, name).toBe(42);
      await store.metaPut('cursor', { deep: ['ok', 1] });
      expect((await store.metaGet('cursor'))?.value, name).toEqual({ deep: ['ok', 1] });

      await repo.upsert('space', SPACE, SPACE, { name: 'Home', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
      await repo.upsert('category', SPACE, 'c1', { name: 'Padel', icon: 'tennis', color: '#123', txType: 'expense', sortOrder: 1, builtin: 0 });
      const ops = await store.outboxAll();
      await store.outboxDelete(ops.map((o) => o.opId));
      expect((await store.outboxAll()).length, name).toBe(0);

      // purge (engine 403 path): entity rows by space + meta key
      await store.transact(['category', 'space', 'meta'], async () => {
        await store.deleteBySpace('category', SPACE);
        await store.deleteRow('space', SPACE);
        await store.metaDelete('cursor');
      });
      expect(await store.get('space', SPACE), name).toBeUndefined();
      expect((await store.bySpace('category', SPACE)).length, name).toBe(0);
      expect(await store.metaGet('cursor'), name).toBeUndefined();
    }
  });

  it('device-only stores round-trip', async () => {
    for (const { name, store } of await bothBackends()) {
      await store.storeConnPut({ id: 'ah', store: 'ah', tokens: { access: 'x' }, refreshedAt: '2026-01-01', status: 'ok' });
      expect((await store.storeConnGet('ah'))?.status, name).toBe('ok');
      expect((await store.storeConnAll()).length, name).toBe(1);
      await store.storeConnDelete('ah');
      expect(await store.storeConnGet('ah'), name).toBeUndefined();

      await store.quoteCachePutAll([{ key: 'yahoo:ASML', price: 700, currency: 'EUR', at: '2026-01-01' }]);
      await store.quoteCachePutAll([{ key: 'yahoo:ASML', price: 710, currency: 'EUR', at: '2026-01-02' }]);
      const quotes = await store.quoteCacheAll();
      expect(quotes, name).toHaveLength(1);
      expect(quotes[0].price, name).toBe(710);
    }
  });

  it('subscribe emits the initial result and every relevant change', async () => {
    for (const { name, store, repo } of await bothBackends()) {
      const seen: number[] = [];
      let resolveSettled: (() => void) | null = null;
      const unsubscribe = store.subscribe(
        async () => (await store.bySpace('budget', SPACE)).filter((b) => b.deleted === 0).length,
        (n) => {
          seen.push(n);
          resolveSettled?.();
        },
      );
      const nextEmit = () =>
        new Promise<void>((resolve) => {
          resolveSettled = resolve;
        });

      let settled = nextEmit();
      await settled; // initial emission (0 rows)
      settled = nextEmit();
      await repo.upsert('budget', SPACE, 'b1', { name: 'Food', amountCents: 100, every: 'month', anchor: '2026-01-01', catIds: [], active: 1 });
      await settled;
      expect(seen[0], name).toBe(0);
      expect(seen.at(-1), name).toBe(1);

      unsubscribe();
      const count = seen.length;
      await repo.upsert('budget', SPACE, 'b2', { name: 'Fun', amountCents: 200, every: 'month', anchor: '2026-01-01', catIds: [], active: 1 });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(seen.length, name).toBe(count); // unsubscribed: no more emissions
    }
  });

  it('a failed transaction leaves nothing behind (atomicity)', async () => {
    for (const { name, store } of await bothBackends()) {
      await expect(
        store.transact(['event', 'outbox'], async () => {
          await store.put('event', { id: 'e1', spaceId: SPACE, name: 'Trip' });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await store.get('event', 'e1'), name).toBeUndefined();
    }
  });
});

describe('transaction serialization (SQLCipher regression)', () => {
  it('concurrent un-awaited transactions serialize instead of nesting', async () => {
    // the real bug: a manual tx + its balance delta both fired without
    // awaiting → connection-wide BEGIN inside BEGIN on SQLCipher
    const backend = (await bothBackends())[1].store;
    const writes = Array.from({ length: 6 }, (_, i) =>
      backend.transact(['account'], async () => {
        await backend.put('account', { id: `acc-${i}`, spaceId: 's1', name: `A${i}`, deleted: 0, fieldVersions: {} } as never);
      }),
    );
    await Promise.all(writes);
    const rows = await backend.bySpace('account', 's1');
    expect(rows).toHaveLength(6);
  });

  it('a rejecting transaction does not wedge the queue', async () => {
    const backend = (await bothBackends())[1].store;
    await expect(
      backend.transact(['account'], async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await backend.transact(['account'], async () => {
      await backend.put('account', { id: 'after', spaceId: 's1', name: 'After', deleted: 0, fieldVersions: {} } as never);
    });
    expect((await backend.bySpace('account', 's1')).map((r) => r.id)).toContain('after');
  });
});
