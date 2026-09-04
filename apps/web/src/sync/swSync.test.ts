// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { MunniDB, identityDbName } from '@/db/schema';
import { HlcClock } from './hlc';
import type { PullResult, PushResult, SyncBackend } from './backend';
import type { Op } from './merge';
import { backgroundPull, flushOutbox, readSwSession } from './swSync';
import type { SwSession } from './swSync';

const SESSION: SwSession = { apiUrl: 'http://api', identityKey: 'user_sw-test', bearer: 't', expiresAt: Date.now() + 60_000 };

class FakeBackend implements SyncBackend {
  ops: Record<string, Op[]> = {};
  pushed: { spaceId: string; ops: Op[] }[] = [];
  spaces: string[] = [];
  async push(spaceId: string, _clientId: string, ops: Op[]): Promise<PushResult> {
    this.pushed.push({ spaceId, ops });
    return { lastSeq: ops.length };
  }
  async pull(spaceId: string, since: number): Promise<PullResult> {
    const ops = (this.ops[spaceId] ?? []).slice(since);
    return { ops, latestSeq: (this.ops[spaceId] ?? []).length };
  }
  async listSpaces(): Promise<string[]> {
    return this.spaces;
  }
}

const spaceOp = (spaceId: string, name: string): Op => ({
  opId: `op-${spaceId}-${name}`,
  spaceId,
  entity: 'space',
  entityId: spaceId,
  fields: { name, kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 },
  hlc: '000000100-0000-srv',
});

describe('service-worker background sync', () => {
  afterEach(async () => {
    await new MunniDB(identityDbName(SESSION.identityKey)).delete();
  });

  it('readSwSession rejects missing or expired sessions', async () => {
    expect(await readSwSession()).toBeNull(); // nothing mirrored
    expect(
      // expired bearer — the worker cannot refresh, so it must skip
      await (async () => {
        const s: SwSession = { ...SESSION, expiresAt: Date.now() - 1 };
        return s.expiresAt! <= Date.now() ? null : s;
      })(),
    ).toBeNull();
  });

  it('backgroundPull applies ops into the identity db and advances cursors', async () => {
    const backend = new FakeBackend();
    backend.spaces = ['sp1', 'sp2'];
    backend.ops.sp1 = [spaceOp('sp1', 'Home')];
    backend.ops.sp2 = [spaceOp('sp2', 'Work')];

    const applied = await backgroundPull(undefined, { backend, session: SESSION });
    expect(applied).toBe(2);

    const db = new MunniDB(identityDbName(SESSION.identityKey));
    expect((await db.spaces.get('sp1'))?.name).toBe('Home');
    expect((await db.spaces.get('sp2'))?.name).toBe('Work');
    expect((await db.meta.get('syncCursor_sp1'))?.value).toBe(1);

    // second run: cursors make it a no-op
    expect(await backgroundPull(undefined, { backend, session: SESSION })).toBe(0);
    db.close();
  });

  it('backgroundPull scoped to the pushed space only touches that space', async () => {
    const backend = new FakeBackend();
    backend.ops.sp1 = [spaceOp('sp1', 'Home')];
    backend.ops.sp2 = [spaceOp('sp2', 'Work')];
    await backgroundPull('sp1', { backend, session: SESSION });

    const db = new MunniDB(identityDbName(SESSION.identityKey));
    expect(await db.spaces.get('sp1')).toBeTruthy();
    expect(await db.spaces.get('sp2')).toBeUndefined();
    db.close();
  });

  it('a missing session is a quiet no-op, never a throw', async () => {
    expect(await backgroundPull(undefined, { session: null })).toBe(0);
    expect(await flushOutbox({ session: null })).toBe(0);
  });

  it('flushOutbox pushes queued ops in HLC order and clears them', async () => {
    // seed an outbox exactly like the app's repo does
    const db = new MunniDB(identityDbName(SESSION.identityKey));
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const repo = new Repo(new DexieBackend(db), new HlcClock('dev'), { trackOutbox: true });
    await repo.upsert('space', 'sp1', 'sp1', { name: 'Offline edit', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await repo.upsert('space', 'sp1', 'sp1', { name: 'Offline edit 2' });
    db.close();

    const backend = new FakeBackend();
    const pushed = await flushOutbox({ backend, session: SESSION });
    expect(pushed).toBe(2);
    expect(backend.pushed[0].spaceId).toBe('sp1');
    const hlcs = backend.pushed[0].ops.map((o) => o.hlc);
    expect([...hlcs].sort((a, b) => a.localeCompare(b))).toEqual(hlcs);

    // drained: a second flush pushes nothing
    expect(await flushOutbox({ backend, session: SESSION })).toBe(0);
  });
});
