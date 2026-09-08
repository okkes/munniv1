// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import type { PullResult, PushResult, SyncBackend } from '@/sync/backend';
import { SyncHttpError } from '@/sync/backend';
import { SyncEngine } from '@/sync/engine';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { bootstrapUserSpaces } from './data';

/**
 * Regression suite for the bug that stranded devices on an empty
 * duplicate personal space: bootstrap must FAIL CLOSED — no space
 * creation unless the server confirmed the account has none.
 */
class FlakyServer implements SyncBackend {
  failuresLeft = 0;
  serverSpaces: string[] = [];
  async push(): Promise<PushResult> {
    return { lastSeq: 0 };
  }
  async pull(spaceId: string, since: number): Promise<PullResult> {
    // fresh cursor on a server-known space delivers its space row
    if (since === 0 && this.serverSpaces.includes(spaceId)) {
      return {
        ops: [
          {
            opId: `srv-${spaceId}`,
            spaceId,
            entity: 'space',
            entityId: spaceId,
            fields: { name: 'Real', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 },
            hlc: '000000100-0000-server',
          },
        ],
        latestSeq: 1,
      };
    }
    return { ops: [], latestSeq: since };
  }
  async listSpaces(): Promise<string[]> {
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new SyncHttpError(401); // the cold-start signature
    }
    return this.serverSpaces;
  }
}

let counter = 0;
const setup = () => {
  const db = new MunniDB(`bootstrap_test_${++counter}`);
  const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: true });
  const server = new FlakyServer();
  const engine = new SyncEngine(new DexieBackend(db), repo, server, 't');
  return { db, repo, server, engine };
};

// tiny real-timer backoff — fake timers would freeze fake-indexeddb
const FAST_RETRY_MS = 5;

describe('bootstrapUserSpaces (fail closed)', () => {
  it('creates NO space even once confirmed empty — the Mina tutorial owns the first one', async () => {
    const { db, repo, server, engine } = setup();
    server.failuresLeft = 2;

    await bootstrapUserSpaces(new DexieBackend(db), repo, engine, () => false, FAST_RETRY_MS);

    // brand-new user: zero spaces, onboarding + tutorial pending flags set
    expect(await db.spaces.filter((s) => s.deleted === 0).count()).toBe(0);
    expect((await db.meta.get('needsOnboarding'))?.value).toBe(true);
    expect((await db.meta.get('minaTutorialPending'))?.value).toBe(true);

    // re-entrancy: the user finishes onboarding (flags consumed) while a
    // second bootstrap round completes late — it must NOT re-ambush
    await db.meta.delete('needsOnboarding');
    await db.meta.delete('minaTutorialPending');
    await db.meta.put({ key: 'minaTutorialState', value: { active: true, step: 3, ledger: [] } });
    await bootstrapUserSpaces(new DexieBackend(db), repo, engine, () => false, FAST_RETRY_MS);
    expect(await db.meta.get('needsOnboarding')).toBeUndefined();
    db.close();
  });

  it('with existing local data it proceeds offline without creating anything', async () => {
    const { db, repo, server, engine } = setup();
    await repo.upsert('space', 's1', 's1', { name: 'Mine', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    server.failuresLeft = Number.MAX_SAFE_INTEGER; // permanently offline

    await bootstrapUserSpaces(new DexieBackend(db), repo, engine, () => false, FAST_RETRY_MS);

    const spaces = await db.spaces.filter((s) => s.deleted === 0).toArray();
    expect(spaces.map((s) => s.id)).toEqual(['s1']); // untouched, no duplicate
    expect(await db.meta.get('needsOnboarding')).toBeUndefined();
    db.close();
  });

  it('cancellation stops the retry loop without creating a space', async () => {
    const { db, repo, server, engine } = setup();
    server.failuresLeft = Number.MAX_SAFE_INTEGER;
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 30);

    await bootstrapUserSpaces(new DexieBackend(db), repo, engine, () => cancelled, FAST_RETRY_MS);

    expect(await db.spaces.count()).toBe(0);
    db.close();
  });

  it('reports each failed round so the UI can surface an unreachable server', async () => {
    const { db, repo, server, engine } = setup();
    server.failuresLeft = 3;
    const reported: number[] = [];

    await bootstrapUserSpaces(new DexieBackend(db), repo, engine, () => false, FAST_RETRY_MS, (n) => reported.push(n));

    expect(reported).toEqual([1, 2, 3]); // one per failed round, then success
    // confirmed empty → tutorial pending, still no auto-created space
    expect((await db.meta.get('minaTutorialPending'))?.value).toBe(true);
    expect(await db.spaces.filter((s) => s.deleted === 0).count()).toBe(0);
    db.close();
  });

  it('self-heals a pre-fix empty duplicate once the real spaces arrive', async () => {
    const { db, repo, server, engine } = setup();
    // device had auto-created "dup" during an outage (old fail-open bug)
    await repo.upsert('space', 'dup', 'dup', { name: 'Personal', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await db.meta.put({ key: 'bootstrapSpaceId', value: 'dup' });
    // the server knows the real space
    server.serverSpaces = ['real'];

    await bootstrapUserSpaces(new DexieBackend(db), repo, engine, () => false, FAST_RETRY_MS);

    const spaces = await db.spaces.filter((s) => s.deleted === 0).toArray();
    expect(spaces.map((s) => s.id)).toEqual(['real']); // empty duplicate retired
    expect(await db.meta.get('bootstrapSpaceId')).toBeUndefined();
    db.close();
  });
});
