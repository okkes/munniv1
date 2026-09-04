import { getApiCapabilities, getProtocolIssue, resetApiCapabilitiesCache } from '@/lib/api';
import { reportError } from '@/lib/report';
import { reportEviction } from '@/app/evicted';
import type { StorageBackend } from '@/db/backend';
import type { OutboxRow } from '@/db/types';
import type { Repo } from '@/db/repo';
import type { SyncBackend } from './backend';
import { SyncHttpError } from './backend';

const cursorKey = (spaceId: string) => `syncCursor_${spaceId}`;
const parkedKey = (spaceId: string) => `parkedOps_${spaceId}`;
/** #306: durable per-identity eviction tombstone — mirrored in swSync.ts */
const evictedKey = (spaceId: string) => `evictedSpace_${spaceId}`;

/** ops per push request — the server caps at 1000, proxies cap body size */
const PUSH_CHUNK = 300;
export const LAST_SYNC_KEY = 'lastSyncAt';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives sync for one identity: flush the outbox, then pull and merge
 * remote ops, per space. Any interleaving is safe — pushes are idempotent
 * (op ids), pulls are cursor-based, and the merge is commutative. A 403 on
 * a space means we lost membership: local copy of that space is purged.
 *
 * Freshness comes from three layers: a server-sent-events stream (near
 * real-time while open), a 10s visible poll as fallback, and wake-ups on
 * focus/online. Web push covers the closed-app case.
 */
export class SyncEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private status: SyncStatus = 'idle';
  private eventsAbort: AbortController | null = null;
  private eventDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: StorageBackend,
    private readonly repo: Repo,
    private readonly backend: SyncBackend,
    private readonly clientId: string,
  ) {}

  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: SyncStatus) {
    this.status = status;
    for (const l of this.listeners) l(status);
  }

  /** the most recent sync failure, for diagnostics UI */
  lastError: string | null = null;

  getStatus(): SyncStatus {
    return this.status;
  }

  /** start background loop: SSE stream + wake on focus/online + 10s visible poll */
  start(): void {
    void this.syncAll();
    window.addEventListener('online', this.handleWake);
    document.addEventListener('visibilitychange', this.handleWake);
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.syncAll();
    }, 10_000);
    void this.listenEvents();
  }

  stop(): void {
    window.removeEventListener('online', this.handleWake);
    document.removeEventListener('visibilitychange', this.handleWake);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.eventsAbort?.abort();
    this.eventsAbort = null;
  }

  /** near-real-time: the server announces changed spaces over SSE */
  private async listenEvents(): Promise<void> {
    if (!this.backend.events) return;
    this.eventsAbort = new AbortController();
    const { signal } = this.eventsAbort;
    let retryMs = 1_000;
    while (!signal.aborted) {
      try {
        await this.backend.events(signal, () => {
          // coalesce event bursts into one sync pass
          if (this.eventDebounce) clearTimeout(this.eventDebounce);
          this.eventDebounce = setTimeout(() => void this.syncAll(), 300);
        });
        retryMs = 1_000; // stream ended cleanly — reconnect promptly
      } catch {
        // connection lost/refused — the poll keeps us fresh meanwhile
      }
      if (signal.aborted) return;
      await sleep(retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    }
  }

  private readonly handleWake = () => {
    if (document.visibilityState === 'visible') void this.syncAll();
  };

  /** debounce hook for repositories: call after local writes */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  nudge(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.syncAll(), 2_000);
  }

  async syncAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.setStatus('syncing');
    try {
      // version handshake FIRST (lib/protocol.ts): native apps and the
      // API deploy separately — a contract mismatch must refuse to sync
      // instead of exchanging ops both sides half-understand. Fresh
      // check each cycle: an updated server lifts the block by itself.
      resetApiCapabilitiesCache();
      await getApiCapabilities();
      if (getProtocolIssue()) {
        this.lastError = `protocol mismatch: ${getProtocolIssue()}`;
        this.setStatus('error');
        return;
      }
      const spaces = (await this.store.allRows('space')).filter((s) => s.deleted === 0);
      // also flush outbox ops for spaces we no longer have rows for
      const outboxSpaces = (await this.store.outboxAll()).map((o) => o.spaceId);
      // and pull spaces the server knows us to be in (fresh device / new invite)
      const serverSpaces = await this.backend.listSpaces();
      const spaceIds = [...new Set([...spaces.map((s) => s.id), ...outboxSpaces, ...serverSpaces])];
      // one space's failure must not starve the rest: a single poisoned
      // outbox (one rejected op) used to abort the whole loop, so nothing
      // else on the device synced anymore (user report: store receipts +
      // "offline" while the server was fine)
      let firstError: unknown = null;
      const serverSet = new Set(serverSpaces);
      for (const spaceId of spaceIds) {
        try {
          // #306 (user): a space we KNOW evicted us stays untouched until
          // the server re-grants it — no request may leave for it
          if (await this.skipKnownEvicted(spaceId, serverSet)) continue;
          await this.syncSpace(spaceId);
        } catch (err) {
          firstError ??= err;
        }
      }
      await this.purgeOrphanFeeds(serverSpaces);
      if (firstError) throw firstError;
      await this.store.metaPut(LAST_SYNC_KEY, Date.now());
      this.setStatus('idle');
    } catch (err) {
      this.lastError = String(err); // surfaced on the connecting screen
      const offline = err instanceof TypeError; // fetch network errors are TypeError
      // 401/403 are identity states (the auth path reports + recovers
      // those itself) — report only genuine sync faults
      const authState = err instanceof SyncHttpError && (err.status === 401 || err.status === 403);
      if (!offline && !authState) reportError('sync', err);
      this.setStatus(offline ? 'offline' : 'error');
    } finally {
      this.running = false;
    }
  }

  /**
   * Push one chunk; a 400 means the server REJECTS an op in it — and
   * endless retries wedge the space as "offline" until reinstall (user
   * report: a stale outbox left behind by the encrypted-store switch).
   * Bisect to the guilty op(s), QUARANTINE them in meta (preserved, not
   * destroyed — a later server fix can still rescue them, like the
   * topic-whitelist outage did) and report them, so everything queued
   * behind keeps syncing.
   */
  private async pushChunk(spaceId: string, chunk: OutboxRow[]): Promise<void> {
    try {
      await this.backend.push(spaceId, this.clientId, chunk);
      await this.store.outboxDelete(chunk.map((o) => o.opId));
    } catch (err) {
      if (!(err instanceof SyncHttpError) || err.status !== 400) throw err;
      if (chunk.length === 1) {
        const op = chunk[0];
        const parked = ((await this.store.metaGet(parkedKey(spaceId)))?.value as OutboxRow[] | undefined) ?? [];
        await this.store.metaPut(parkedKey(spaceId), [...parked, op].slice(-500));
        await this.store.outboxDelete([op.opId]);
        reportError('sync', new Error(`server rejected op (400), parked: entity=${op.entity} entityId=${String(op.entityId).slice(0, 140)} space=${spaceId}`));
        return;
      }
      const mid = Math.ceil(chunk.length / 2);
      await this.pushChunk(spaceId, chunk.slice(0, mid));
      await this.pushChunk(spaceId, chunk.slice(mid));
    }
  }

  /** once per app session, offer parked ops back to the server — a fixed
   *  validator accepts them and the data catches up */
  private readonly parkedRetried = new Set<string>();
  private async retryParked(spaceId: string): Promise<void> {
    if (this.parkedRetried.has(spaceId)) return;
    this.parkedRetried.add(spaceId);
    const parked = ((await this.store.metaGet(parkedKey(spaceId)))?.value as OutboxRow[] | undefined) ?? [];
    if (!parked.length) return;
    const stillParked: OutboxRow[] = [];
    for (const [i, op] of parked.entries()) {
      try {
        await this.backend.push(spaceId, this.clientId, [op]);
      } catch (err) {
        stillParked.push(op);
        // #306: 403 = the space denies us as a whole (read-only role or
        // lost membership) — the rest would fail identically, stop here
        if (err instanceof SyncHttpError && err.status === 403) {
          stillParked.push(...parked.slice(i + 1));
          break;
        }
      }
    }
    if (stillParked.length !== parked.length) await this.store.metaPut(parkedKey(spaceId), stillParked);
  }

  /** #305 bug 4: the server PAGES at 1000 ops while reporting the
   *  space-head LatestSeq — stamping the cursor at the head after a
   *  partial page skipped every op in between FOREVER (a consumer
   *  joining a mature shared feed lost its whole recent window). Page
   *  until drained: prefer the server's explicit nextSince, fall back
   *  on dense per-space seqs for servers predating it. */
  private async drainPull(spaceId: string, initialSince: number): Promise<void> {
    let since = initialSince;
    for (;;) {
      const { ops, latestSeq, nextSince } = await this.backend.pull(spaceId, since);
      if (ops.length === 0) {
        if (latestSeq > since) await this.store.metaPut(cursorKey(spaceId), latestSeq);
        return;
      }
      await this.repo.applyRemoteOps(ops);
      const next = nextSince ?? since + ops.length;
      if (next <= since) return; // defensive: never spin without progress
      await this.store.metaPut(cursorKey(spaceId), next);
      since = next;
      if (since >= latestSeq) return;
    }
  }

  async syncSpace(spaceId: string): Promise<void> {
    try {
      // 1. push queued local ops (ordered by HLC), CHUNKED: the server
      // caps a push at 1000 ops and proxies cap body size — a store-
      // receipt sync alone can queue hundreds of fat ops, and each chunk
      // that lands is deleted immediately so progress survives a failure
      await this.retryParked(spaceId);
      // #306 (user): a push-403 alone is AMBIGUOUS — a reader role may
      // pull but never push. The pull below is the judge: succeeding
      // means we are still a member (read-only: park the unlandable
      // ops); only a denied pull is a true eviction. Before this, every
      // push-403 raised the "removed from space" sheet and purged — and
      // the still-granted pull resurrected the space, looping forever.
      let writeDenied = false;
      try {
        const outbox = await this.store.outboxBySpace(spaceId);
        for (let i = 0; i < outbox.length; i += PUSH_CHUNK) {
          const chunk = outbox.slice(i, i + PUSH_CHUNK);
          await this.pushChunk(spaceId, chunk);
        }
      } catch (err) {
        if (!(err instanceof SyncHttpError) || err.status !== 403) throw err;
        writeDenied = true;
      }

      // 2. pull everything after our cursor and merge (own ops no-op) —
      // paged until drained (#305 bug 4; the loop lives in drainPull)
      const since = ((await this.store.metaGet(cursorKey(spaceId)))?.value as number | undefined) ?? 0;
      await this.drainPull(spaceId, since);
      if (writeDenied) await this.parkReadOnlyOps(spaceId);
    } catch (err) {
      if (err instanceof SyncHttpError && err.status === 403) {
        // #173: a 403 on a MEMBER space is an eviction (feed sweeps stay
        // silent: they route through purgeOrphanFeeds, not this catch)
        await this.evictSpace(spaceId);
        return;
      }
      throw err;
    }
  }

  /** #306: read-only member — local ops the server will never take are
   *  parked (kept: a role upgrade re-offers them via retryParked), so
   *  the outbox stops re-pushing into a guaranteed 403 every cycle */
  private async parkReadOnlyOps(spaceId: string): Promise<void> {
    const ops = await this.store.outboxBySpace(spaceId);
    if (ops.length === 0) return;
    const parked = ((await this.store.metaGet(parkedKey(spaceId)))?.value as OutboxRow[] | undefined) ?? [];
    await this.store.metaPut(parkedKey(spaceId), [...parked, ...ops].slice(-500));
    await this.store.outboxDelete(ops.map((o) => o.opId));
  }

  /** #173/#306: membership truly revoked — ONE durable notice, then purge.
   *  The tombstone survives boots/logins, so late straggler ops or a
   *  half-done purge can never re-raise the sheet; syncAll clears it
   *  when the server lists the space again (re-invite). */
  private async evictSpace(spaceId: string): Promise<void> {
    const seen = await this.store.metaGet(evictedKey(spaceId));
    await this.store.metaPut(evictedKey(spaceId), Date.now());
    if (!seen) {
      // tell the app before the purge erases the name
      const name = (await this.store.get('space', spaceId))?.name;
      if (name) reportEviction({ spaceId, spaceName: name });
    }
    await this.purgeSpace(spaceId);
  }

  /** #306: evicted tombstone gate — while the server does not grant the
   *  space, no sync request leaves for it and stray local ops (writers
   *  that raced the purge) are swept; a re-grant clears the tombstone. */
  private async skipKnownEvicted(spaceId: string, serverSpaces: ReadonlySet<string>): Promise<boolean> {
    if (!(await this.store.metaGet(evictedKey(spaceId)))) return false;
    if (serverSpaces.has(spaceId)) {
      await this.store.metaDelete(evictedKey(spaceId)); // re-invited — sync (and a future eviction) proceed
      return false;
    }
    await this.purgeSpace(spaceId);
    return true;
  }

  /**
   * Feed spaces carry no local 'space' row, so after leaving (or being
   * removed from) the space that shared them, they drop out of the pull
   * loop without ever hitting the 403 that purges member spaces — their
   * accounts lingered forever as ghost "shared with me" rows (user
   * report). Any local account data in a space the server no longer
   * grants is removed here; the owner's own feeds stay reachable
   * (owned), so only genuinely lost access is purged.
   *
   * DATA-LOSS regression (user report: "imported 200 transactions, then
   * everything disappeared"): this sweep used the space/outbox snapshots
   * taken at the START of the cycle, but read accounts LIVE — a
   * statement import finishing while a cycle was mid-flight created its
   * feed after the snapshot, so the sweep purged the fresh account, all
   * its transactions AND their un-pushed outbox ops. Everything local is
   * therefore re-read at sweep time, and any feed a live accountLink
   * mirror points at is protected even when the server's space list was
   * fetched before that feed existed.
   */
  private async purgeOrphanFeeds(serverSpaces: string[]): Promise<void> {
    const [spaces, outbox, links] = await Promise.all([
      this.store.allRows('space'),
      this.store.outboxAll(),
      this.store.allRows('accountLink'),
    ]);
    const known = new Set([
      ...spaces.filter((s) => s.deleted === 0).map((s) => s.id),
      ...outbox.map((o) => o.spaceId),
      ...links.filter((l) => l.deleted === 0).map((l) => l.feedSpaceId),
      ...serverSpaces,
    ]);
    const orphans = new Set(
      (await this.store.allRows('account'))
        .map((a) => a.spaceId)
        .filter((id) => !known.has(id)),
    );
    for (const id of orphans) await this.purgeSpace(id);
  }

  /** membership revoked (403) or explicitly left: remove all local data of the space */
  async purgeSpace(spaceId: string): Promise<void> {
    // every space-scoped entity — the original five left receipts,
    // budgets, goals & co. behind as ghosts after leaving a space
    const scoped = [
      'account', 'category', 'transaction', 'txMeta', 'accountLink',
      'recurring', 'recurringDismiss', 'budget', 'event', 'goal', 'goalContribution',
      'debt', 'allocation', 'receipt', 'receiptLink', 'storeMarker', 'storeConn', 'storeConnLink',
      'holding', 'lot', 'insightDismiss', 'topic', 'activity',
    ] as const;
    await this.store.transact(['space', ...scoped, 'outbox', 'meta'], async () => {
      await this.store.deleteRow('space', spaceId);
      for (const entity of scoped) {
        await this.store.deleteBySpace(entity, spaceId);
      }
      await this.store.outboxDeleteBySpace(spaceId);
      await this.store.metaDelete(cursorKey(spaceId));
      // #306: parked ops died with the space (they were re-offered every
      // session — a lingering 403 POST per boot); the eviction tombstone
      // deliberately survives this purge
      await this.store.metaDelete(parkedKey(spaceId));
    });
  }
}
