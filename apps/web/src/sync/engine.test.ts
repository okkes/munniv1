import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_PROTOCOL } from '@/lib/protocol';
import { HlcClock } from './hlc';
import { applyOp } from './merge';
import type { Op, SyncEnvelope } from './merge';
import type { PullResult, PushResult, SyncBackend } from './backend';
import { SyncHttpError } from './backend';
import { SyncEngine } from './engine';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { useEvicted } from '@/app/evicted';
import type { AccountRow } from '@/db/types';

/** Minimal in-memory server with the same semantics as Munni.Api. */
class InMemoryServer implements SyncBackend {
  private ops: (Op & { seq: number })[] = [];
  private state = new Map<string, Record<string, unknown> & SyncEnvelope>();
  private seenOpIds = new Set<string>();
  private lastSeq = 0;
  forbiddenSpaces = new Set<string>();
  /** #306: reader role — push 403s while pull/list stay granted */
  readerSpaces = new Set<string>();
  rejectedSpaces = new Set<string>(); // 400s (a poisoned op) — never 403
  pushCalls: number[] = [];
  /** every push REQUEST that arrived, denied ones included */
  pushAttempts: string[] = [];

  async push(spaceId: string, _clientId: string, ops: Op[]): Promise<PushResult> {
    this.pushAttempts.push(spaceId);
    if (this.forbiddenSpaces.has(spaceId) || this.readerSpaces.has(spaceId)) throw new SyncHttpError(403);
    if (this.rejectedSpaces.has(spaceId)) throw new SyncHttpError(400);
    this.pushCalls.push(ops.length);
    for (const op of ops) {
      if (this.seenOpIds.has(op.opId)) continue;
      this.seenOpIds.add(op.opId);
      const key = `${op.entity}:${op.entityId}`;
      const { row } = applyOp(this.state.get(key) ?? null, op);
      this.state.set(key, row);
      this.ops.push({ ...op, seq: ++this.lastSeq });
    }
    return { lastSeq: this.lastSeq };
  }

  /** page like Munni.Api does (Take(1000)); Infinity = everything */
  pageSize = Number.POSITIVE_INFINITY;
  /** old servers predate the nextSince cursor — the client must survive */
  omitNextSince = false;
  pullCalls = 0;

  async pull(spaceId: string, since: number): Promise<PullResult> {
    if (this.forbiddenSpaces.has(spaceId)) throw new SyncHttpError(403);
    this.pullCalls++;
    const all = this.ops.filter((o) => o.seq > since && o.spaceId === spaceId);
    const page = all.slice(0, this.pageSize);
    const nextSince = page.length > 0 ? page.at(-1)!.seq : since;
    return {
      ops: page,
      latestSeq: this.lastSeq,
      ...(this.omitNextSince ? {} : { nextSince }),
    };
  }

  async listSpaces(): Promise<string[]> {
    return [...new Set(this.ops.map((o) => o.spaceId))].filter((id) => !this.forbiddenSpaces.has(id));
  }
}

let dbCounter = 0;

function device(name: string, wall: () => number, server: InMemoryServer) {
  const db = new MunniDB(`engine_test_${name}_${dbCounter}`);
  const storeBackend = new DexieBackend(db);
  const repo = new Repo(storeBackend, new HlcClock(name, undefined, wall), { trackOutbox: true });
  const engine = new SyncEngine(storeBackend, repo, server, name);
  return { db, repo, engine, storeBackend };
}

describe('SyncEngine', () => {
  let server: InMemoryServer;
  beforeEach(() => {
    dbCounter++;
    server = new InMemoryServer();
    useEvicted.getState().clear();
    // hermetic: syncAll's /health handshake must never reach a REAL
    // server (a running local stack once answered with an older
    // protocol and silently blocked every cycle here)
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  const dbs: MunniDB[] = [];
  afterEach(async () => {
    while (dbs.length) await dbs.pop()!.delete();
  });

  it('two devices editing offline converge regardless of sync order', async () => {
    let wa = 1_000_000;
    let wb = 2_000_000;
    const a = device('devA', () => ++wa, server);
    const b = device('devB', () => ++wb, server);
    dbs.push(a.db, b.db);

    // both edit the same account while "offline"
    await a.repo.upsert('space', 's1', 's1', { name: 'Shared', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await a.repo.upsert('account', 's1', 'acc1', { name: 'From A', balanceCents: 100 });
    await b.repo.upsert('space', 's1', 's1', { name: 'Shared', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await b.repo.upsert('account', 's1', 'acc1', { name: 'From B', color: '#abc' });

    // A syncs first, then B, then A again to receive B's ops
    await a.engine.syncSpace('s1');
    await b.engine.syncSpace('s1');
    await a.engine.syncSpace('s1');

    const rowA = (await a.db.accounts.get('acc1')) as AccountRow;
    const rowB = (await b.db.accounts.get('acc1')) as AccountRow;
    expect(rowA.fieldVersions).toEqual(rowB.fieldVersions);
    expect(rowA.name).toBe('From B'); // B's clock is ahead
    expect(rowA.balanceCents).toBe(100);
    expect(rowA.color).toBe('#abc');

    // outboxes drained, cursors advanced
    expect(await a.db.outbox.count()).toBe(0);
    expect(await b.db.outbox.count()).toBe(0);
  });

  it('pull cursor prevents re-fetch; own ops are no-ops on replay', async () => {
    let w = 1_000_000;
    const a = device('devA', () => ++w, server);
    dbs.push(a.db);

    await a.repo.upsert('space', 's1', 's1', { name: 'Solo', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await a.engine.syncSpace('s1');
    const cursor1 = (await a.db.meta.get('syncCursor_s1'))?.value;
    await a.engine.syncSpace('s1'); // nothing new
    const cursor2 = (await a.db.meta.get('syncCursor_s1'))?.value;
    expect(cursor1).toBe(cursor2);
    const space = await a.db.spaces.get('s1');
    expect(space?.name).toBe('Solo');
  });

  it('403 purges the local copy of the space', async () => {
    let w = 1_000_000;
    const a = device('devA', () => ++w, server);
    dbs.push(a.db);

    await a.repo.upsert('space', 's1', 's1', { name: 'Shared', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await a.repo.upsert('account', 's1', 'acc1', { name: 'Mine', balanceCents: 5 });
    await a.engine.syncSpace('s1');
    expect(await a.db.spaces.get('s1')).toBeTruthy();

    server.forbiddenSpaces.add('s1');
    await a.repo.upsert('account', 's1', 'acc1', { name: 'More' });
    await a.engine.syncSpace('s1');

    expect(await a.db.spaces.get('s1')).toBeUndefined();
    expect(await a.db.accounts.get('acc1')).toBeUndefined();
    expect(await a.db.outbox.count()).toBe(0);
  });

  it('#306: a read-only member (push 403, pull OK) is NOT an eviction — ops park, data stays', async () => {
    let wa = 1_000_000;
    const owner = device('owner', () => ++wa, server);
    dbs.push(owner.db);
    await owner.repo.upsert('space', 's1', 's1', { name: 'Shared', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await owner.repo.upsert('account', 's1', 'acc1', { name: 'Theirs', balanceCents: 7 });
    await owner.engine.syncAll();

    // the reader device discovers and pulls the space fine…
    let wb = 2_000_000;
    const reader = device('reader', () => ++wb, server);
    dbs.push(reader.db);
    server.readerSpaces.add('s1');
    await reader.engine.syncAll();
    expect((await reader.db.spaces.get('s1'))?.name).toBe('Shared');

    // …then writes locally (a boot heal, a tap) — that push is denied
    await reader.repo.upsert('account', 's1', 'acc1', { color: '#abc' });
    await reader.engine.syncAll();

    // no "removed from space" sheet, nothing purged (the old code
    // popped the sheet and wiped the space on every cycle — user4 loop)
    expect(useEvicted.getState().evicted).toBeNull();
    expect((await reader.db.spaces.get('s1'))?.name).toBe('Shared');
    expect((await reader.db.accounts.get('acc1'))?.color).toBe('#abc');
    // the unlandable ops are parked, not retried forever
    expect(await reader.db.outbox.count()).toBe(0);
    expect(((await reader.db.meta.get('parkedOps_s1'))?.value as unknown[]).length).toBeGreaterThan(0);
    const attempts = server.pushAttempts.filter((s) => s === 's1').length;
    await reader.engine.syncAll();
    expect(server.pushAttempts.filter((s) => s === 's1')).toHaveLength(attempts); // quiet now
  });

  it('#306: eviction (push AND pull 403) reports ONCE — stragglers never re-raise or re-push', async () => {
    let w = 1_000_000;
    const a = device('devA', () => ++w, server);
    dbs.push(a.db);
    await a.repo.upsert('space', 's1', 's1', { name: 'Shared', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await a.engine.syncAll();

    server.forbiddenSpaces.add('s1');
    await a.repo.upsert('account', 's1', 'acc1', { name: 'Late edit' });
    await a.engine.syncAll();

    // the one takeover sheet; the local copy is gone
    expect(useEvicted.getState().evicted?.spaceId).toBe('s1');
    expect(await a.db.spaces.get('s1')).toBeUndefined();
    expect(await a.db.outbox.count()).toBe(0);

    // the user confirms; a straggler write races in AFTER the purge
    useEvicted.getState().clear();
    await a.repo.upsert('account', 's1', 'acc2', { name: 'Straggler' });
    const attempts = server.pushAttempts.filter((s) => s === 's1').length;
    await a.engine.syncAll();

    // no second sheet, not one more push request, the straggler is swept
    expect(useEvicted.getState().evicted).toBeNull();
    expect(server.pushAttempts.filter((s) => s === 's1')).toHaveLength(attempts);
    expect(await a.db.outbox.count()).toBe(0);
    expect(await a.db.accounts.get('acc2')).toBeUndefined();
  });

  it('#306: a re-grant clears the tombstone — sync resumes and a LATER eviction reports again', async () => {
    let w = 1_000_000;
    const a = device('devA', () => ++w, server);
    dbs.push(a.db);
    await a.repo.upsert('space', 's1', 's1', { name: 'Shared', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await a.engine.syncAll();
    server.forbiddenSpaces.add('s1');
    await a.repo.upsert('account', 's1', 'acc1', { name: 'Late' });
    await a.engine.syncAll();
    expect(useEvicted.getState().evicted?.spaceId).toBe('s1');
    useEvicted.getState().clear();

    // re-invited: the server lists the space again, history intact
    server.forbiddenSpaces.delete('s1');
    await a.engine.syncAll();
    expect(await a.db.meta.get('evictedSpace_s1')).toBeUndefined();
    expect((await a.db.spaces.get('s1'))?.name).toBe('Shared');

    // kicked AGAIN much later — the new eviction may speak again
    server.forbiddenSpaces.add('s1');
    await a.engine.syncAll();
    expect(useEvicted.getState().evicted?.spaceId).toBe('s1');
  });

  it('#306: eviction clears parked ops with the space', async () => {
    let w = 1_000_000;
    const a = device('devA', () => ++w, server);
    dbs.push(a.db);
    await a.repo.upsert('space', 's1', 's1', { name: 'Shared', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await a.engine.syncAll();
    server.rejectedSpaces.add('s1');
    await a.repo.upsert('receipt', 's1', 'r1', { merchant: 'AH', totalCents: 100 });
    await a.engine.syncAll(); // 400 → parked
    expect(((await a.db.meta.get('parkedOps_s1'))?.value as unknown[]).length).toBeGreaterThan(0);

    server.rejectedSpaces.delete('s1');
    server.forbiddenSpaces.add('s1');
    await a.engine.syncAll(); // eviction — nothing of the space lingers
    expect(await a.db.meta.get('parkedOps_s1')).toBeUndefined();
    expect(await a.db.spaces.get('s1')).toBeUndefined();
  });

  it('feed data of a space the server no longer grants is purged (left-space ghost accounts)', async () => {
    // feed spaces have no local 'space' row — after leaving the space that
    // shared them, they dropped out of the pull loop and their accounts
    // lingered forever as ghost "shared with me" rows (user report)
    let w = 1_000_000;
    const a = device('devA', () => ++w, server);
    dbs.push(a.db);

    await a.repo.upsert('space', 's1', 's1', { name: 'Mine', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    // a shared feed pulled earlier: account row WITHOUT a local space row
    await a.db.accounts.put({ id: 'feed-acc', spaceId: 'feed-1', name: 'Their ING', deleted: 0, fieldVersions: {} } as unknown as AccountRow);
    await a.db.meta.put({ key: 'syncCursor_feed-1', value: 7 });

    await a.engine.syncAll(); // server lists only s1 — access to feed-1 is gone

    expect(await a.db.accounts.get('feed-acc')).toBeUndefined();
    expect(await a.db.meta.get('syncCursor_feed-1')).toBeUndefined();
    // the personal space itself is untouched
    expect((await a.db.spaces.get('s1'))?.name).toBe('Mine');
  });

  it('an import finishing mid-cycle is never swept away (data-loss regression)', async () => {
    // user report: "imported 200 transactions, then everything
    // disappeared" — the orphan-feed sweep at the END of a cycle used
    // the space/outbox snapshots from the START, so a statement import
    // completing while the cycle ran was judged an orphan and purged
    // (rows AND their un-pushed outbox ops)
    let w = 1_000_000;
    const a = device('devA', () => ++w, server);
    dbs.push(a.db);
    await a.repo.upsert('space', 's1', 's1', { name: 'Mine', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await a.engine.syncAll(); // clean baseline

    // the import lands right after the cycle fetched the server's list
    const origList = server.listSpaces.bind(server);
    server.listSpaces = async () => {
      const res = await origList();
      await a.repo.upsert('account', 'feed-1', 'facc', { name: 'ING import', balanceCents: 0 });
      await a.repo.upsert('transaction', 'feed-1', 'ftx', { accountId: 'facc', date: '2026-07-01', amountCents: -100, currency: 'EUR', merchant: 'X', txType: 'expense', needsReview: 1 });
      await a.repo.upsert('accountLink', 's1', 'link1', { feedSpaceId: 'feed-1', accountId: 'facc' });
      return res;
    };
    await a.engine.syncAll();
    server.listSpaces = origList;

    // nothing was purged — the fresh import survived the sweep…
    expect(await a.db.accounts.get('facc')).toBeTruthy();
    expect(await a.db.transactions.get('ftx')).toBeTruthy();
    // …and the next cycle delivers its ops to the server
    await a.engine.syncAll();
    expect(await a.db.outbox.count()).toBe(0);
    expect((await server.pull('feed-1', 0)).ops.some((op) => op.entity === 'transaction')).toBe(true);
  });

  it('big outboxes push in chunks; a poisoned space never starves the others', async () => {
    let w = 1_000_000;
    const a = device('devA', () => ++w, server);
    dbs.push(a.db);

    // 650 queued ops → three chunked pushes (300/300/50), all drained
    await a.repo.upsert('space', 's1', 's1', { name: 'Big', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    for (let i = 0; i < 649; i++) await a.repo.upsert('receipt', 's1', `r${i}`, { merchant: 'AH', totalCents: i });
    await a.engine.syncAll();
    expect(server.pushCalls).toEqual([300, 300, 50]);
    expect(await a.db.outbox.count()).toBe(0);

    // s-poison rejects its push (a bad op) — s2 must still sync fine
    await a.repo.upsert('space', 's-poison', 's-poison', { name: 'Bad', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await a.repo.upsert('space', 's2', 's2', { name: 'Good', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    server.rejectedSpaces.add('s-poison');
    await a.engine.syncAll();
    const s2Outbox = (await a.db.outbox.toArray()).filter((o) => o.spaceId === 's2');
    expect(s2Outbox).toHaveLength(0); // the healthy space drained
    // rejected ops leave the OUTBOX (no eternal 400 wedge — user report:
    // "offline" until reinstall) but are QUARANTINED in meta, never lost
    const poisonOutbox = (await a.db.outbox.toArray()).filter((o) => o.spaceId === 's-poison');
    expect(poisonOutbox).toHaveLength(0);
    const parked = (await a.db.meta.get('parkedOps_s-poison'))?.value as unknown[];
    expect(parked.length).toBeGreaterThan(0);
  });

  it('parked (400-rejected) ops are re-offered and catch up once the server accepts them', async () => {
    let w = 1_000_000;
    const a = device('devA', () => ++w, server);
    dbs.push(a.db);
    await a.repo.upsert('space', 's-heal', 's-heal', { name: 'Heals', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    server.rejectedSpaces.add('s-heal');
    await a.engine.syncAll(); // parks the space row op
    expect(((await a.db.meta.get('parkedOps_s-heal'))?.value as unknown[]).length).toBeGreaterThan(0);

    // the server-side fix ships (validator accepts the op now); a fresh
    // session (new engine instance) re-offers the parked ops exactly once
    server.rejectedSpaces.delete('s-heal');
    const revived = new SyncEngine(a.storeBackend, a.repo, server, 'devA');
    await revived.syncAll();
    expect((await a.db.meta.get('parkedOps_s-heal'))?.value as unknown[]).toHaveLength(0);
    expect((await server.pull('s-heal', 0)).ops.some((op) => op.entity === 'space')).toBe(true);
  });

  it('fresh device discovers and pulls spaces it has never seen', async () => {
    let wa = 1_000_000;
    const a = device('devA', () => ++wa, server);
    dbs.push(a.db);
    await a.repo.upsert('space', 's1', 's1', { name: 'Existing', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await a.repo.upsert('account', 's1', 'acc1', { name: 'Mine', balanceCents: 42 });
    await a.engine.syncAll();

    // brand-new device, empty database
    let wb = 2_000_000;
    const b = device('devB', () => ++wb, server);
    dbs.push(b.db);
    await b.engine.syncAll();

    expect((await b.db.spaces.get('s1'))?.name).toBe('Existing');
    expect((await b.db.accounts.get('acc1'))?.balanceCents).toBe(42);
  });

  it('interrupted push retries safely (idempotent op ids)', async () => {
    let w = 1_000_000;
    const a = device('devA', () => ++w, server);
    dbs.push(a.db);

    await a.repo.upsert('space', 's1', 's1', { name: 'Solo', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });

    // simulate: push reached the server but the response was lost
    const outbox = await a.db.outbox.toArray();
    await server.push('s1', 'devA', outbox);
    // engine retries the full outbox — server dedupes, then pull applies own ops as no-ops
    await a.engine.syncSpace('s1');

    const pull = await server.pull('s1', 0);
    expect(pull.ops).toHaveLength(outbox.length); // no duplicates server-side
    expect(await a.db.outbox.count()).toBe(0);
  });

  it('#305 bug 4: a paged server drains fully — the head cursor never eats the tail', async () => {
    let wa = 1_000_000;
    const a = device('devA', () => ++wa, server);
    dbs.push(a.db);
    for (let i = 0; i < 25; i++) {
      await a.repo.upsert('category', 's-page', `c${i}`, { name: `Cat ${i}` });
    }
    await a.engine.syncAll();

    server.pageSize = 10; // the real server pages at 1000
    let wb = 2_000_000;
    const b = device('devB', () => ++wb, server);
    dbs.push(b.db);
    await b.engine.syncAll();
    expect((await b.db.categories.toArray()).filter((row) => row.deleted === 0)).toHaveLength(25);
    expect(server.pullCalls).toBeGreaterThan(2); // it genuinely paged

    // an OLD server without nextSince: the dense-seq fallback still drains
    server.omitNextSince = true;
    let wc = 3_000_000;
    const c = device('devC', () => ++wc, server);
    dbs.push(c.db);
    await c.engine.syncAll();
    expect((await c.db.categories.toArray()).filter((row) => row.deleted === 0)).toHaveLength(25);
  });
});
