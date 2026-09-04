import { isNativeApp } from '@/lib/platform';
import { DexieBackend } from './backend';
import type { StorageBackend } from './backend';
import { MunniDB } from './schema';
import { sqliteAvailable } from './capacitorSql';

/**
 * E4 (user ruling 2026-07-24): the native shells run on the encrypted
 * SQLCipher store, ALWAYS — no toggle, no verify UI. Existing installs
 * with Dexie data are migrated by COPY on first encrypted open (all
 * entities, the outbox with any unpushed ops, meta, store connections,
 * quote cache), so no identity kind loses anything — offline profiles
 * included. The Dexie database is kept untouched as a safety net; the
 * only path back to it is the never-brick fallback below.
 */
export const FLAG_KEY = 'munni_encrypted_store';

/** what actually opened — the truth signal: encrypted is intent, this is fact */
export type ActiveStoreBackend = 'sqlcipher' | 'dexie';
let activeBackend: ActiveStoreBackend = 'dexie';
export const activeStoreBackend = (): ActiveStoreBackend => activeBackend;

// '0' is written ONLY by the never-brick fallback after a failed
// encrypted open — everything else on native is always-on
export const encryptedStoreEnabled = (): boolean =>
  isNativeApp() && sqliteAvailable() && localStorage.getItem(FLAG_KEY) !== '0';

const MIGRATED_KEY = 'dexieMigrated';

/** one-time Dexie → SQLCipher copy; returns true when data was copied */
export async function migrateDexieToSql(name: string, sql: StorageBackend): Promise<boolean> {
  if ((await sql.metaGet(MIGRATED_KEY))?.value) return false;
  let hasDexie = false;
  try {
    hasDexie = (await indexedDB.databases()).some((d) => d.name === name);
  } catch {
    // databases() unavailable — nothing detectable to migrate
  }
  if (!hasDexie) {
    await sql.metaPut(MIGRATED_KEY, true);
    return false;
  }
  const { ENTITIES } = await import('./sqlBackend');
  const db = new MunniDB(name);
  const dexie = new DexieBackend(db);
  try {
    for (const entity of ENTITIES) {
      for (const row of await dexie.allRows(entity)) {
        await sql.put(entity, row as unknown as Record<string, unknown> & { id: string });
      }
    }
    // the outbox travels too: unpushed local ops must survive the switch
    for (const op of await dexie.outboxAll()) await sql.outboxAdd(op);
    for (const row of await db.meta.toArray()) await sql.metaPut(row.key, row.value);
    for (const conn of await dexie.storeConnAll()) await sql.storeConnPut(conn);
    await sql.quoteCachePutAll(await dexie.quoteCacheAll());
    // set LAST (after the meta copy, which must not overwrite it)
    await sql.metaPut(MIGRATED_KEY, true);
    return true;
  } finally {
    db.close();
  }
}

export async function openStorageBackend(name: string): Promise<StorageBackend> {
  if (encryptedStoreEnabled()) {
    // NEVER brick the app on the encrypted path (user report: a plugin
    // config error left the shell stuck on the connecting screen until
    // reinstall): any failure reports itself, marks the flag and falls
    // back to Dexie — where the un-migrated data still lives.
    try {
      const [{ openEncryptedExecutor }, { SqlStorageBackend, initSqlSchema }] = await Promise.all([
        import('./capacitorSql'),
        import('./sqlBackend'),
      ]);
      const executor = await openEncryptedExecutor(name);
      await initSqlSchema(executor);
      const backend = new SqlStorageBackend(executor);
      await migrateDexieToSql(name, backend);
      activeBackend = 'sqlcipher';
      return backend;
    } catch (err) {
      console.error('encrypted store failed to open — falling back to Dexie', err);
      const { captureException } = await import('@sentry/react').catch(() => ({ captureException: () => undefined }));
      captureException(err);
      // '0': remember the failure so the fallback is stable across launches
      localStorage.setItem(FLAG_KEY, '0');
    }
  }
  activeBackend = 'dexie';
  return new DexieBackend(new MunniDB(name));
}

/** wipe an identity's data wherever it lives (demo logout, account deletion) */
export async function destroyStorage(name: string): Promise<void> {
  if (encryptedStoreEnabled()) {
    const { openEncryptedExecutor } = await import('./capacitorSql');
    const executor = await openEncryptedExecutor(name);
    await executor.destroy();
  }
  await new DexieBackend(new MunniDB(name)).destroy();
}
