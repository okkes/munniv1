import { liveQuery } from 'dexie';
import type { MunniDB } from './schema';
import type {
  EntityName,
  EntityRowMap,
  MetaRow,
  OutboxRow,
  QuoteCacheRow,
  StoreConnectionRow,
} from './types';

/**
 * Encryption-at-rest E1 (approved design): the storage seam. Everything
 * the app knows about persistence goes through this interface — semantic
 * operations, not query-builder chains — so the native shells can swap
 * Dexie/IndexedDB for SQLCipher (E2) without touching callers.
 *
 * Reactivity contract: `subscribe` re-emits the query result whenever
 * underlying data changes, including writes from other contexts (the
 * service worker syncs in the background while the app is open).
 */

/** tables a `transact` scope may name (synced entities + local-only stores) */
export type TableScope = EntityName | 'outbox' | 'meta';

/** spaces are the partition key themselves — every other entity is space-scoped */
export type SpaceScopedEntity = Exclude<EntityName, 'space'>;

export interface StorageBackend {
  // --- synced entities ---
  get<E extends EntityName>(entity: E, id: string): Promise<EntityRowMap[E] | undefined>;
  bySpace<E extends SpaceScopedEntity>(entity: E, spaceId: string): Promise<EntityRowMap[E][]>;
  allRows<E extends EntityName>(entity: E): Promise<EntityRowMap[E][]>;
  countBySpace(entity: SpaceScopedEntity, spaceId: string): Promise<number>;
  /**
   * Raw row write — the LWW merge (Repo/applyOp) is the only caller.
   * Loosely typed on purpose: merged rows are built field-by-field.
   */
  put(entity: EntityName, row: Record<string, unknown> & { id: string }): Promise<void>;
  deleteBySpace(entity: SpaceScopedEntity, spaceId: string): Promise<void>;
  deleteRow(entity: EntityName, id: string): Promise<void>;

  // --- outbox (local-only op queue) ---
  outboxAdd(op: OutboxRow): Promise<void>;
  outboxAll(): Promise<OutboxRow[]>;
  /** ops of one space, ordered by HLC (push order) */
  outboxBySpace(spaceId: string): Promise<OutboxRow[]>;
  outboxDelete(opIds: string[]): Promise<void>;
  outboxDeleteBySpace(spaceId: string): Promise<void>;

  // --- meta (local-only key-value) ---
  metaGet(key: string): Promise<MetaRow | undefined>;
  metaPut(key: string, value: unknown): Promise<void>;
  metaDelete(key: string): Promise<void>;

  // --- device-only stores (never synced) ---
  storeConnAll(): Promise<StoreConnectionRow[]>;
  /** by INSTANCE id (receipts v3; legacy migrated rows use the store name) */
  storeConnGet(id: string): Promise<StoreConnectionRow | undefined>;
  storeConnPut(row: StoreConnectionRow): Promise<void>;
  storeConnDelete(id: string): Promise<void>;
  quoteCacheAll(): Promise<QuoteCacheRow[]>;
  quoteCachePutAll(rows: QuoteCacheRow[]): Promise<void>;

  // --- atomicity, reactivity, lifecycle ---
  /** run `fn` atomically over the named tables (read-modify-write safety) */
  transact(tables: TableScope[], fn: () => Promise<void>): Promise<void>;
  /**
   * live query: emits now and on every relevant change; returns unsubscribe.
   * `query` must read only through this backend.
   */
  subscribe<T>(query: () => Promise<T>, onNext: (value: T) => void, onError?: (err: unknown) => void): () => void;
  close(): void;
  /** wipe the identity's entire database (demo logout, account deletion) */
  destroy(): Promise<void>;
}

/** Today's storage: Dexie/IndexedDB, one database per identity. */
export class DexieBackend implements StorageBackend {
  constructor(readonly db: MunniDB) {}

  get<E extends EntityName>(entity: E, id: string) {
    return this.db.tableFor(entity).get(id) as Promise<EntityRowMap[E] | undefined>;
  }

  bySpace<E extends SpaceScopedEntity>(entity: E, spaceId: string) {
    // dexie's union table narrows to an impossible intersection — bridge it
    return this.db.tableFor(entity).where('spaceId').equals(spaceId).toArray() as unknown as Promise<
      EntityRowMap[E][]
    >;
  }

  allRows<E extends EntityName>(entity: E) {
    // same union-table bridge as bySpace
    return this.db.tableFor(entity).toArray() as unknown as Promise<EntityRowMap[E][]>;
  }

  countBySpace(entity: SpaceScopedEntity, spaceId: string) {
    return this.db.tableFor(entity).where('spaceId').equals(spaceId).count();
  }

  async put(entity: EntityName, row: Record<string, unknown> & { id: string }) {
    // dexie's union table intersects all row types — the cast is required
    await this.db.tableFor(entity).put(row as never); // NOSONAR(S4325)
  }

  async deleteBySpace(entity: SpaceScopedEntity, spaceId: string) {
    await this.db.tableFor(entity).where('spaceId').equals(spaceId).delete();
  }

  async deleteRow(entity: EntityName, id: string) {
    await this.db.tableFor(entity).delete(id);
  }

  async outboxAdd(op: OutboxRow) {
    await this.db.outbox.add(op);
  }

  outboxAll() {
    return this.db.outbox.toArray();
  }

  outboxBySpace(spaceId: string) {
    return this.db.outbox.where('spaceId').equals(spaceId).sortBy('hlc');
  }

  async outboxDelete(opIds: string[]) {
    await this.db.outbox.bulkDelete(opIds);
  }

  async outboxDeleteBySpace(spaceId: string) {
    await this.db.outbox.where('spaceId').equals(spaceId).delete();
  }

  metaGet(key: string) {
    return this.db.meta.get(key);
  }

  async metaPut(key: string, value: unknown) {
    await this.db.meta.put({ key, value });
  }

  async metaDelete(key: string) {
    await this.db.meta.delete(key);
  }

  storeConnAll() {
    return this.db.storeInstances.toArray();
  }

  storeConnGet(id: string) {
    return this.db.storeInstances.get(id);
  }

  async storeConnPut(row: StoreConnectionRow) {
    await this.db.storeInstances.put(row);
  }

  async storeConnDelete(id: string) {
    await this.db.storeInstances.delete(id);
  }

  quoteCacheAll() {
    return this.db.quoteCache.toArray();
  }

  async quoteCachePutAll(rows: QuoteCacheRow[]) {
    await this.db.quoteCache.bulkPut(rows);
  }

  async transact(tables: TableScope[], fn: () => Promise<void>) {
    const dexieTables = tables.map((t) => {
      if (t === 'outbox') return this.db.outbox;
      if (t === 'meta') return this.db.meta;
      return this.db.tableFor(t);
    });
    // dexie's zone makes the backend's own reads/writes inside `fn`
    // participate in this transaction automatically
    await this.db.transaction('rw', dexieTables, fn);
  }

  subscribe<T>(query: () => Promise<T>, onNext: (value: T) => void, onError?: (err: unknown) => void) {
    const sub = liveQuery(query).subscribe({
      next: onNext,
      error: onError ?? ((err) => console.error('live query failed', err)),
    });
    return () => sub.unsubscribe();
  }

  close() {
    this.db.close();
  }

  async destroy() {
    await this.db.delete();
  }
}
