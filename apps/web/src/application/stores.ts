import { useEffect, useRef } from 'react';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { readSessionIdentity } from '@/app/session';
import { apiFetch } from '@/lib/api';
import { ahExchangeCode, ahFetchMemberId, extractAhCode } from '@/features/shopping/stores/ah';
import type { ProxyCall } from '@/features/shopping/stores/ah';
import { jumboLogin } from '@/features/shopping/stores/jumbo';
import { reevaluateSpace, syncInstanceReceipts } from '@/features/shopping/stores/sync';
import type { StoreSyncResult } from '@/features/shopping/stores/sync';
import { pullConnections, pushAllConnections, pushConnection, removeConnectionCipher } from './storeSync';
import { ensureStoreFeed, myStoreFeedId } from './storeFeed';
import { writeReceiptLink } from './receiptLinks';
import { logActivity } from './activity';
import { storeConnLinkId } from '@/domain/feedIds';
import type { Repo } from '@/db/repo';
import type { StorageBackend } from '@/db/backend';
import type { ReceiptRow, StoreConnLinkRow, StoreConnRow, StoreConnectionRow, StoreId } from '@/db/types';

/** the real proxy binding — every store call rides the api pass-through */
const proxyCall: ProxyCall = async (store, path, init = {}) => {
  const response = await apiFetch(`/shop/proxy/${store}`, {
    method: 'POST',
    body: JSON.stringify({
      path,
      method: init.method ?? 'GET',
      body: init.body,
      authorization: init.authorization,
      userAgent: init.userAgent,
    }),
  });
  const json = await response.json().catch(() => null);
  // jumbo hands its session token back in a relayed response header
  const jumboToken = response.headers.get('x-jumbo-token') ?? undefined;
  return { status: response.status, json, headers: jumboToken ? { jumboToken } : undefined };
};

/** store connections are a signed-in-user feature: demo/offline make zero network calls */
export const storesAvailable = (): boolean => readSessionIdentity()?.kind === 'user';

/** device-local instances (tokens live here; may lag behind metadata) */
export function useStoreConnections(): StoreConnectionRow[] | undefined {
  const { store } = useData();
  return useQuery(store, async () => store.storeConnAll(), []);
}

/** synced instance METADATA — every device of the owner renders these */
export function useStoreConnMetas(): StoreConnRow[] | undefined {
  const { store } = useData();
  return useQuery(store, async () => (await store.allRows('storeConn')).filter((c) => c.deleted === 0), []);
}

/** connection instances included in the ACTIVE space (members see these) */
export function useSpaceStoreConnLinks(): StoreConnLinkRow[] | undefined {
  const { store, spaceId } = useData();
  return useQuery(
    store,
    async () => (await store.bySpace('storeConnLink', spaceId)).filter((l) => l.deleted === 0),
    [spaceId],
  );
}

/**
 * Owner view: global receipts of instances included in the active space
 * that are not yet linked into it — the manual-attach inventory.
 */
export function useUnmatchedReceipts(): ReceiptRow[] | undefined {
  const { store, spaceId } = useData();
  return useQuery(
    store,
    async () => {
      const feedId = myStoreFeedId();
      if (!feedId) return [];
      const included = new Set(
        (await store.bySpace('storeConnLink', spaceId)).filter((l) => l.deleted === 0).map((l) => l.instanceId),
      );
      const linked = new Set(
        (await store.bySpace('receiptLink', spaceId))
          .filter((l) => l.deleted === 0 && l.receiptId)
          .map((l) => l.receiptId!),
      );
      const rows = (await store.bySpace('receipt', feedId)).filter(
        (r) => r.deleted === 0 && r.instanceId != null && included.has(r.instanceId) && !linked.has(r.id),
      );
      rows.sort((a, b) => b.date.localeCompare(a.date));
      return rows;
    },
    [spaceId],
  );
}

export type ConnectableStore = 'ah' | 'jumbo';

export interface ConnectResult {
  outcome: 'ok' | 'blocked' | 'failed';
  instanceId?: string;
  /** an existing instance looks like the SAME store account (warning) */
  duplicateOf?: string;
}

export interface StoreOps {
  /** paste-the-redirect connect flow (AH); reconnectId refreshes an
   *  existing instance's tokens instead of creating a new one */
  connectAh: (pasted: string, reconnectId?: string) => Promise<ConnectResult>;
  /** username/password login — credentials are exchanged, never stored */
  connectJumbo: (username: string, password: string, reconnectId?: string) => Promise<ConnectResult>;
  rename: (instanceId: string, displayName: string) => Promise<void>;
  setIcon: (instanceId: string, icon: string | null) => Promise<void>;
  /** ruling 2: unmatched receipts die with the instance; links survive */
  removeInstance: (instanceId: string) => Promise<void>;
  syncNow: (instanceId: string) => Promise<StoreSyncResult>;
  /** per-space inclusion (accountLink analogue); added spaces re-match */
  setIncludedSpaces: (instanceId: string, spaceIds: string[]) => Promise<void>;
  /** manual attach from the picker: snapshot-link into the active space */
  linkReceipt: (receipt: ReceiptRow, txId: string) => Promise<void>;
  unlinkReceipt: (linkId: string) => Promise<void>;
  /** delete an unmatched receipt from the owner's global store feed */
  removeGlobalReceipt: (receiptId: string) => Promise<void>;
}

const STORE_LABEL: Record<ConnectableStore, string> = { ah: 'Albert Heijn', jumbo: 'Jumbo' };

const hashIdentity = async (store: StoreId, identity: string): Promise<string> => {
  const bytes = new TextEncoder().encode(`${store}:${identity}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** default display name: the store label, numbered when it exists already */
const defaultName = (metas: readonly StoreConnRow[], store: ConnectableStore): string => {
  const base = STORE_LABEL[store];
  const taken = new Set(metas.filter((m) => m.deleted === 0).map((m) => m.displayName));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }
};

interface CreateArgs {
  storage: StorageBackend;
  repo: Repo;
  spaceId: string;
  store: ConnectableStore;
  tokens: Record<string, string>;
  providerAccountHash?: string;
}

/** shared tail of both connect flows: instance + metadata + inclusion */
async function createInstance({ storage, repo, spaceId, store, tokens, providerAccountHash }: CreateArgs): Promise<ConnectResult> {
  const feedId = await ensureStoreFeed(storage);
  if (!feedId) return { outcome: 'failed' };
  const metas = (await storage.allRows('storeConn')).filter((c) => c.deleted === 0);
  const duplicateOf = providerAccountHash
    ? metas.find((m) => m.store === store && m.providerAccountHash === providerAccountHash)?.id
    : undefined;

  const instanceId = crypto.randomUUID();
  const connection: StoreConnectionRow = {
    id: instanceId,
    store,
    tokens,
    refreshedAt: new Date().toISOString(),
    status: 'ok',
    providerAccountHash,
  };
  await storage.storeConnPut(connection);
  const displayName = defaultName(metas, store);
  await repo.upsert('storeConn', feedId, instanceId, {
    store,
    displayName,
    providerAccountHash,
    connectedAt: new Date().toISOString().slice(0, 10),
    status: 'ok',
  });
  // starts included in the connecting space (v2 behavior, user ruling)
  await repo.upsert('storeConnLink', spaceId, storeConnLinkId(spaceId, instanceId), {
    instanceId,
    store,
    displayName,
  });
  // E2EE sync (opt-in): the fresh tokens travel as ciphertext
  void pushConnection(storage, connection).catch(() => undefined);
  void syncInstanceReceipts(proxyCall, storage, repo, instanceId).catch(() => undefined);
  void logActivity(storage, repo, spaceId, 'storeConnect', displayName);
  return { outcome: 'ok', instanceId, duplicateOf };
}

export function useStoreOps(): StoreOps {
  const { store: storage, repo, spaceId } = useData();

  const allLinksOf = async (instanceId: string) =>
    (await storage.allRows('storeConnLink')).filter((l) => l.deleted === 0 && l.instanceId === instanceId);

  /** fresh tokens land on an EXISTING instance (expired / new device) */
  const reconnect = async (
    instanceId: string,
    store: ConnectableStore,
    tokens: Record<string, string>,
  ): Promise<ConnectResult> => {
    const existing = await storage.storeConnGet(instanceId);
    const connection: StoreConnectionRow = {
      id: instanceId,
      store,
      tokens,
      refreshedAt: new Date().toISOString(),
      status: 'ok',
      providerAccountHash: existing?.providerAccountHash,
      lastReceiptId: existing?.lastReceiptId,
    };
    await storage.storeConnPut(connection);
    const meta = (await storage.allRows('storeConn')).find((c) => c.id === instanceId && c.deleted === 0);
    if (meta) await repo.upsert('storeConn', meta.spaceId, instanceId, { status: 'ok' });
    void pushConnection(storage, connection).catch(() => undefined);
    void syncInstanceReceipts(proxyCall, storage, repo, instanceId).catch(() => undefined);
    return { outcome: 'ok', instanceId };
  };

  return {
    connectAh: async (pasted, reconnectId) => {
      const code = extractAhCode(pasted);
      if (!code) return { outcome: 'failed' };
      const tokens = await ahExchangeCode(proxyCall, code);
      if (!tokens) return { outcome: 'failed' };
      const tokenMap = { access: tokens.access, refresh: tokens.refresh };
      if (reconnectId) return reconnect(reconnectId, 'ah', tokenMap);
      const memberId = await ahFetchMemberId(proxyCall, tokens.access).catch(() => null);
      return createInstance({
        storage,
        repo,
        spaceId,
        store: 'ah',
        tokens: tokenMap,
        providerAccountHash: memberId ? await hashIdentity('ah', memberId) : undefined,
      });
    },
    connectJumbo: async (username, password, reconnectId) => {
      const login = await jumboLogin(proxyCall, username, password);
      if (!login.token) return { outcome: login.outcome };
      if (reconnectId) return reconnect(reconnectId, 'jumbo', { token: login.token });
      return createInstance({
        storage,
        repo,
        spaceId,
        store: 'jumbo',
        tokens: { token: login.token },
        providerAccountHash: await hashIdentity('jumbo', username.trim().toLowerCase()),
      });
    },
    rename: async (instanceId, displayName) => {
      const meta = (await storage.allRows('storeConn')).find((c) => c.id === instanceId && c.deleted === 0);
      if (!meta || !displayName.trim()) return;
      await repo.upsert('storeConn', meta.spaceId, instanceId, { displayName: displayName.trim() });
      // members render the snapshot on the link rows — keep them current
      for (const link of await allLinksOf(instanceId)) {
        await repo.upsert('storeConnLink', link.spaceId, link.id, { displayName: displayName.trim() });
      }
      void logActivity(storage, repo, spaceId, 'storeEdit', displayName.trim());
    },
    setIcon: async (instanceId, icon) => {
      const meta = (await storage.allRows('storeConn')).find((c) => c.id === instanceId && c.deleted === 0);
      if (!meta) return;
      await repo.upsert('storeConn', meta.spaceId, instanceId, { icon: icon ?? (null as never) });
      for (const link of await allLinksOf(instanceId)) {
        await repo.upsert('storeConnLink', link.spaceId, link.id, { icon: icon ?? (null as never) });
      }
      void logActivity(storage, repo, spaceId, 'storeEdit', meta.displayName);
    },
    removeInstance: async (instanceId) => {
      // ruling 2: the instance's global receipts die with it — space
      // snapshots (linked receipts) live on untouched
      const meta = (await storage.allRows('storeConn')).find((c) => c.id === instanceId && c.deleted === 0);
      if (meta) {
        for (const receipt of await storage.bySpace('receipt', meta.spaceId)) {
          if (receipt.deleted === 0 && receipt.instanceId === instanceId) {
            await repo.remove('receipt', meta.spaceId, receipt.id);
          }
        }
        await repo.remove('storeConn', meta.spaceId, instanceId);
      }
      for (const link of await allLinksOf(instanceId)) {
        await repo.remove('storeConnLink', link.spaceId, link.id);
      }
      await storage.storeConnDelete(instanceId);
      void removeConnectionCipher(storage, instanceId).catch(() => undefined);
      void logActivity(storage, repo, spaceId, 'storeRemove', meta?.displayName);
    },
    syncNow: (instanceId) => syncInstanceReceipts(proxyCall, storage, repo, instanceId),
    setIncludedSpaces: async (instanceId, spaceIds) => {
      const meta = (await storage.allRows('storeConn')).find((c) => c.id === instanceId && c.deleted === 0);
      if (!meta) return;
      const current = await allLinksOf(instanceId);
      const currentIds = new Set(current.map((l) => l.spaceId));
      for (const id of spaceIds.filter((id) => !currentIds.has(id))) {
        await repo.upsert('storeConnLink', id, storeConnLinkId(id, instanceId), {
          instanceId,
          store: meta.store,
          displayName: meta.displayName,
          icon: meta.icon,
        });
        // R5: a space gaining a connection re-evaluates its transactions
        await reevaluateSpace(storage, repo, id, instanceId);
        // the history line lands in the space that GAINED the connection
        void logActivity(storage, repo, id, 'storeAttach', meta.displayName);
      }
      for (const link of current.filter((l) => !spaceIds.includes(l.spaceId))) {
        await repo.remove('storeConnLink', link.spaceId, link.id);
        void logActivity(storage, repo, link.spaceId, 'storeDetach', meta.displayName);
      }
    },
    linkReceipt: async (receipt, txId) => {
      await writeReceiptLink(repo, spaceId, receipt, txId, false);
      void logActivity(storage, repo, spaceId, 'receiptAdd', receipt.merchant);
    },
    unlinkReceipt: async (linkId) => {
      await repo.remove('receiptLink', spaceId, linkId);
      void logActivity(storage, repo, spaceId, 'receiptRemove');
    },
    removeGlobalReceipt: async (receiptId) => {
      const feedId = myStoreFeedId();
      if (feedId) {
        const row = await storage.get('receipt', receiptId);
        await repo.remove('receipt', feedId, receiptId);
        void logActivity(storage, repo, spaceId, 'receiptRemove', row?.merchant);
      }
    },
  };
}

const KEEP_ALIVE_MS = 12 * 60 * 60 * 1000;
/** post-tx-sync receipt pull, at most once per instance per interval (R4) */
const AUTO_SYNC_MS = 15 * 60 * 1000;

async function syncDueInstances(storage: StorageBackend, repo: Repo, dueMs: number): Promise<void> {
  for (const connection of await storage.storeConnAll()) {
    if (connection.status !== 'ok') continue;
    if (Date.now() - Date.parse(connection.refreshedAt) < dueMs) continue;
    await syncInstanceReceipts(proxyCall, storage, repo, connection.id);
  }
}

/**
 * Headless (R4): receipts follow the bank. Once per app open the
 * keep-alive refreshes tokens + pulls; afterwards every successful sync
 * cycle (fresh bank transactions just landed) re-pulls due instances so
 * new receipts arrive right next to their transactions.
 */
export function useStoreKeepAlive(): void {
  const { store: storage, repo, engine } = useData();
  const ran = useRef(false);
  const lastAuto = useRef(0);

  useEffect(() => {
    if (ran.current || !storesAvailable() || !navigator.onLine) return;
    ran.current = true;
    void (async () => {
      // E2EE sync (opt-in): adopt fresher tokens from siblings first,
      // publish whatever this device refreshed afterwards
      await pullConnections(storage).catch(() => undefined);
      await syncDueInstances(storage, repo, KEEP_ALIVE_MS);
      await pushAllConnections(storage).catch(() => undefined);
    })().catch(() => undefined); // best-effort: a closed db or offline hop must not throw
  }, [storage, repo]);

  useEffect(() => {
    if (!engine || !storesAvailable()) return;
    return engine.onStatus((status) => {
      // 'idle' = a sync cycle just finished cleanly (fresh bank txs in)
      if (status !== 'idle') return;
      if (Date.now() - lastAuto.current < AUTO_SYNC_MS) return;
      lastAuto.current = Date.now();
      void syncDueInstances(storage, repo, AUTO_SYNC_MS).catch(() => undefined);
    });
  }, [engine, storage, repo]);
}
