import { MunniDB, identityDbName } from '@/db/schema';
import { DexieBackend } from '@/db/backend';
import { Repo } from '@/db/repo';
import { HlcClock } from './hlc';
import { ApiSyncBackend } from './backend';
import type { SyncBackend } from './backend';

/**
 * Background sync for the service worker (app killed or in the
 * background): a Web Push wakes the worker, which pulls new ops into
 * the same IndexedDB the app reads — so the next open starts hot.
 * On Android the one-shot Background Sync event also flushes the
 * outbox when connectivity returns.
 *
 * The worker cannot read localStorage, so the app mirrors what's needed
 * (API url, identity, current access token + expiry) into the tiny
 * munni_sw IDB store. When the mirrored token has expired the worker
 * simply skips — the app syncs on next open; nothing is ever lost.
 */

const SW_DB = 'munni_sw';

export interface SwSession {
  apiUrl: string;
  identityKey: string;
  /** OIDC bearer + its expiry, or the e2e test subject */
  bearer?: string;
  expiresAt?: number;
  testSub?: string;
}

function kvGet(key: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(SW_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        try {
          const get = open.result.transaction('kv', 'readonly').objectStore('kv').get(key);
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result);
          };
          get.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      };
    } catch {
      resolve(undefined);
    }
  });
}

export async function readSwSession(now = Date.now()): Promise<SwSession | null> {
  const raw = (await kvGet('session')) as SwSession | undefined;
  if (!raw?.apiUrl || !raw.identityKey) return null;
  if (!raw.testSub) {
    if (!raw.bearer) return null;
    // an expired token cannot be refreshed from the worker — skip quietly
    if (raw.expiresAt && raw.expiresAt <= now) return null;
  }
  return raw;
}

const cursorKey = (spaceId: string) => `syncCursor_${spaceId}`;

interface SwSyncDeps {
  /** injectable for tests */
  backend?: SyncBackend;
  session?: SwSession | null;
}

/**
 * Pull new ops for one space (push payload) or every reachable space.
 * Merge-by-LWW makes replays harmless; cursors keep it cheap.
 */
export async function backgroundPull(spaceId?: string, deps: SwSyncDeps = {}): Promise<number> {
  // 'in' on purpose: tests inject an explicit null to mean "no session"
  const session = 'session' in deps ? deps.session : await readSwSession();
  if (!session) return 0;
  const backend =
    deps.backend ??
    new ApiSyncBackend({
      baseUrl: session.apiUrl,
      getAuth: async () => (session.testSub ? { testSub: session.testSub } : { bearer: session.bearer! }),
    });

  const store = new DexieBackend(new MunniDB(identityDbName(session.identityKey)));
  const repo = new Repo(store, new HlcClock('sw'), { trackOutbox: false });
  let applied = 0;
  try {
    const spaces = spaceId ? [spaceId] : await backend.listSpaces();
    for (const id of spaces) {
      const since = ((await store.metaGet(cursorKey(id)))?.value as number | undefined) ?? 0;
      const { ops, latestSeq } = await backend.pull(id, since);
      if (ops.length > 0) await repo.applyRemoteOps(ops);
      if (latestSeq !== since) await store.metaPut(cursorKey(id), latestSeq);
      applied += ops.length;
    }
  } finally {
    store.close();
  }
  return applied;
}

/**
 * Flush queued local ops (Android Background Sync: fires when
 * connectivity returns, even with the app killed). Deterministic op ids
 * make a double-flush with the app harmless.
 */
export async function flushOutbox(deps: SwSyncDeps = {}): Promise<number> {
  // 'in' on purpose: tests inject an explicit null to mean "no session"
  const session = 'session' in deps ? deps.session : await readSwSession();
  if (!session) return 0;
  const backend =
    deps.backend ??
    new ApiSyncBackend({
      baseUrl: session.apiUrl,
      getAuth: async () => (session.testSub ? { testSub: session.testSub } : { bearer: session.bearer! }),
    });

  const store = new DexieBackend(new MunniDB(identityDbName(session.identityKey)));
  let pushed = 0;
  try {
    const outbox = await store.outboxAll();
    const bySpace = new Map<string, typeof outbox>();
    for (const op of outbox) {
      const list = bySpace.get(op.spaceId) ?? [];
      list.push(op);
      bySpace.set(op.spaceId, list);
    }
    for (const [spaceId, ops] of bySpace) {
      ops.sort((a, b) => a.hlc.localeCompare(b.hlc));
      await backend.push(spaceId, 'sw-bgsync', ops);
      await store.outboxDelete(ops.map((o) => o.opId));
      pushed += ops.length;
    }
  } finally {
    store.close();
  }
  return pushed;
}
