import type { StorageBackend, TableScope } from './backend';
import type {
  EntityName,
  EntityRowMap,
  MetaRow,
  OutboxRow,
  QuoteCacheRow,
  StoreConnectionRow,
} from './types';

/**
 * Encryption-at-rest E2: the StorageBackend over a SQL engine. On the
 * native shells the executor is @capacitor-community/sqlite with a
 * SQLCipher key; the parity suite drives the same class with an
 * in-memory sql.js database — the backend itself never knows which.
 *
 * Storage shape: one document table per entity — (id PRIMARY KEY,
 * spaceId indexed, json payload). That mirrors Dexie's row model
 * exactly, which is what makes backend parity a testable property
 * instead of a hope. Queries beyond id/spaceId filter in JS, the same
 * contract the interface already promises.
 */

/** the SQL the backend needs — tiny on purpose, so any engine fits */
export interface SqlExecutor {
  /** DML/DDL, no result rows */
  run(sql: string, params?: (string | number | null)[]): Promise<void>;
  /** SELECT returning rows as plain objects */
  query(sql: string, params?: (string | number | null)[]): Promise<Record<string, unknown>[]>;
  /** BEGIN/COMMIT/ROLLBACK wrapper around `fn` */
  transaction(fn: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
  /** wipe the whole database file (identity destroy) */
  destroy(): Promise<void>;
}

export const ENTITIES: readonly EntityName[] = [
  'space',
  'account',
  'category',
  'transaction',
  'txMeta',
  'accountLink',
  'recurring',
  'recurringDismiss',
  'budget',
  'event',
  'goal',
  'goalContribution',
  'debt',
  'allocation',
  'receipt',
  'receiptLink',
  'storeMarker',
  'storeConn',
  'storeConnLink',
  'holding',
  'lot',
  'insightDismiss',
  'topic',
  'activity',
];

const ENTITY_SET: ReadonlySet<EntityName> = new Set(ENTITIES);

/** entity/table name allowlist keeps interpolated identifiers safe */
const entityTable = (entity: EntityName): string => {
  if (!ENTITY_SET.has(entity)) throw new Error(`unknown entity: ${entity}`);
  return `e_${entity}`;
};

export async function initSqlSchema(sql: SqlExecutor): Promise<void> {
  for (const entity of ENTITIES) {
    const table = entityTable(entity);
    await sql.run(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, spaceId TEXT, json TEXT NOT NULL)`);
    await sql.run(`CREATE INDEX IF NOT EXISTS idx_${table}_space ON ${table} (spaceId)`);
  }
  await sql.run('CREATE TABLE IF NOT EXISTS outbox (opId TEXT PRIMARY KEY, spaceId TEXT, hlc TEXT, json TEXT NOT NULL)');
  await sql.run('CREATE INDEX IF NOT EXISTS idx_outbox_space ON outbox (spaceId)');
  await sql.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
  // receipts v3: instance-keyed connections; a pre-v3 store_conn table
  // migrates once (id = store name, matching the Dexie upgrade)
  await sql.run('CREATE TABLE IF NOT EXISTS store_inst (id TEXT PRIMARY KEY, json TEXT NOT NULL)');
  try {
    const legacy = await sql.query('SELECT store, json FROM store_conn');
    for (const row of legacy) {
      const parsed = JSON.parse(row.json as string) as Record<string, unknown>;
      await sql.run('INSERT OR IGNORE INTO store_inst (id, json) VALUES (?, ?)', [
        row.store as string,
        JSON.stringify({ ...parsed, id: row.store }),
      ]);
    }
    await sql.run('DROP TABLE store_conn');
  } catch {
    // no legacy table — fresh database
  }
  await sql.run('CREATE TABLE IF NOT EXISTS quote_cache (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
}

type Listener = () => void;

export class SqlStorageBackend implements StorageBackend {
  private readonly listeners = new Set<Listener>();
  private inTransaction = false;

  constructor(private readonly sql: SqlExecutor) {}

  /** every write announces itself; subscribers re-run their queries.
   *  Inside `transact` emissions wait for the commit — a live query must
   *  never observe a half-applied write batch. */
  private emit(): void {
    if (this.inTransaction) return; // transact() emits once after commit
    for (const listener of this.listeners) listener();
  }

  private async rowsOf<E extends EntityName>(entity: E, where = '', params: (string | number)[] = []) {
    const rows = await this.sql.query(`SELECT json FROM ${entityTable(entity)} ${where}`, params);
    return rows.map((r) => JSON.parse(r.json as string) as EntityRowMap[E]);
  }

  async get<E extends EntityName>(entity: E, id: string) {
    const rows = await this.rowsOf(entity, 'WHERE id = ?', [id]);
    return rows[0];
  }

  bySpace<E extends Exclude<EntityName, 'space'>>(entity: E, spaceId: string) {
    return this.rowsOf(entity, 'WHERE spaceId = ?', [spaceId]);
  }

  allRows<E extends EntityName>(entity: E) {
    return this.rowsOf(entity);
  }

  async countBySpace(entity: Exclude<EntityName, 'space'>, spaceId: string) {
    const rows = await this.sql.query(`SELECT COUNT(*) AS n FROM ${entityTable(entity)} WHERE spaceId = ?`, [spaceId]);
    return Number(rows[0]?.n ?? 0);
  }

  async put(entity: EntityName, row: Record<string, unknown> & { id: string }) {
    await this.sql.run(`INSERT OR REPLACE INTO ${entityTable(entity)} (id, spaceId, json) VALUES (?, ?, ?)`, [
      row.id,
      (row.spaceId as string) ?? null,
      JSON.stringify(row),
    ]);
    this.emit();
  }

  async deleteBySpace(entity: Exclude<EntityName, 'space'>, spaceId: string) {
    await this.sql.run(`DELETE FROM ${entityTable(entity)} WHERE spaceId = ?`, [spaceId]);
    this.emit();
  }

  async deleteRow(entity: EntityName, id: string) {
    await this.sql.run(`DELETE FROM ${entityTable(entity)} WHERE id = ?`, [id]);
    this.emit();
  }

  async outboxAdd(op: OutboxRow) {
    // INSERT (not REPLACE): op ids are unique, a duplicate is a bug
    await this.sql.run('INSERT INTO outbox (opId, spaceId, hlc, json) VALUES (?, ?, ?, ?)', [
      op.opId,
      op.spaceId,
      op.hlc,
      JSON.stringify(op),
    ]);
    this.emit();
  }

  private async outboxRows(where = '', params: string[] = []) {
    const rows = await this.sql.query(`SELECT json FROM outbox ${where}`, params);
    return rows.map((r) => JSON.parse(r.json as string) as OutboxRow);
  }

  outboxAll() {
    return this.outboxRows();
  }

  outboxBySpace(spaceId: string) {
    return this.outboxRows('WHERE spaceId = ? ORDER BY hlc', [spaceId]);
  }

  async outboxDelete(opIds: string[]) {
    if (opIds.length === 0) return;
    await this.sql.run(`DELETE FROM outbox WHERE opId IN (${opIds.map(() => '?').join(',')})`, opIds);
    this.emit();
  }

  async outboxDeleteBySpace(spaceId: string) {
    await this.sql.run('DELETE FROM outbox WHERE spaceId = ?', [spaceId]);
    this.emit();
  }

  async metaGet(key: string): Promise<MetaRow | undefined> {
    const rows = await this.sql.query('SELECT json FROM meta WHERE key = ?', [key]);
    return rows[0] ? { key, value: JSON.parse(rows[0].json as string) } : undefined;
  }

  async metaPut(key: string, value: unknown) {
    await this.sql.run('INSERT OR REPLACE INTO meta (key, json) VALUES (?, ?)', [key, JSON.stringify(value ?? null)]);
    this.emit();
  }

  async metaDelete(key: string) {
    await this.sql.run('DELETE FROM meta WHERE key = ?', [key]);
    this.emit();
  }

  async storeConnAll() {
    const rows = await this.sql.query('SELECT json FROM store_inst');
    return rows.map((r) => JSON.parse(r.json as string) as StoreConnectionRow);
  }

  async storeConnGet(id: string) {
    const rows = await this.sql.query('SELECT json FROM store_inst WHERE id = ?', [id]);
    return rows[0] ? (JSON.parse(rows[0].json as string) as StoreConnectionRow) : undefined;
  }

  async storeConnPut(row: StoreConnectionRow) {
    await this.sql.run('INSERT OR REPLACE INTO store_inst (id, json) VALUES (?, ?)', [row.id, JSON.stringify(row)]);
    this.emit();
  }

  async storeConnDelete(id: string) {
    await this.sql.run('DELETE FROM store_inst WHERE id = ?', [id]);
    this.emit();
  }

  async quoteCacheAll() {
    const rows = await this.sql.query('SELECT json FROM quote_cache');
    return rows.map((r) => JSON.parse(r.json as string) as QuoteCacheRow);
  }

  async quoteCachePutAll(rows: QuoteCacheRow[]) {
    for (const row of rows) {
      await this.sql.run('INSERT OR REPLACE INTO quote_cache (key, json) VALUES (?, ?)', [row.key, JSON.stringify(row)]);
    }
    this.emit();
  }

  /** transactions are serialized: SQL BEGIN is connection-wide, and two
   *  concurrent Repo writes (e.g. a manual tx + its balance delta, both
   *  fired without awaiting) raced into "cannot start a transaction
   *  within a transaction" on SQLCipher (user GlitchTip report). Dexie
   *  schedules overlapping transactions itself; here the queue does. */
  private txQueue: Promise<void> = Promise.resolve();

  async transact(_tables: TableScope[], fn: () => Promise<void>) {
    // the table list is a Dexie requirement the SQL engine doesn't share
    const run = async () => {
      this.inTransaction = true;
      try {
        await this.sql.transaction(fn);
      } finally {
        this.inTransaction = false;
      }
      this.emit();
    };
    const next = this.txQueue.then(run, run);
    // keep the chain alive when a transaction rejects
    this.txQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  subscribe<T>(query: () => Promise<T>, onNext: (value: T) => void, onError?: (err: unknown) => void) {
    let cancelled = false;
    let running = false;
    let dirty = false;
    const fail = onError ?? ((err: unknown) => console.error('live query failed', err));
    const run = () => {
      if (cancelled) return;
      if (running) {
        dirty = true; // a write landed mid-query — once more after this run
        return;
      }
      running = true;
      query()
        .then((value) => {
          if (!cancelled) onNext(value);
        })
        .catch((err) => {
          if (!cancelled) fail(err);
        })
        .finally(() => {
          running = false;
          if (dirty) {
            dirty = false;
            run();
          }
        });
    };
    this.listeners.add(run);
    run();
    return () => {
      cancelled = true;
      this.listeners.delete(run);
    };
  }

  close() {
    void this.sql.close();
  }

  destroy() {
    return this.sql.destroy();
  }
}
