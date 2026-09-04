import type { SqlExecutor } from './sqlBackend';

/**
 * E2: the SQLCipher executor for the native shells, speaking to
 * @capacitor-community/sqlite through the injected Capacitor global —
 * the web bundle never imports native code (platform.ts rule).
 *
 * Key lifecycle (approved design): a random passphrase is minted on
 * first use and handed to the plugin, which keeps it in the iOS
 * Keychain / Android Keystore-backed storage. It never syncs and never
 * lands in a backup — a restored device gets a fresh key and re-syncs
 * (decision 2: key loss = forced re-sync).
 */

interface SqliteQueryResult {
  values?: Record<string, unknown>[];
}

interface CapacitorSqlitePlugin {
  isSecretStored(): Promise<{ result?: boolean }>;
  setEncryptionSecret(options: { passphrase: string }): Promise<void>;
  createConnection(options: {
    database: string;
    version: number;
    encrypted: boolean;
    mode: string;
    readonly: boolean;
  }): Promise<void>;
  open(options: { database: string }): Promise<void>;
  run(options: { database: string; statement: string; values: unknown[]; transaction: boolean }): Promise<unknown>;
  query(options: { database: string; statement: string; values: unknown[] }): Promise<SqliteQueryResult>;
  beginTransaction(options: { database: string }): Promise<void>;
  commitTransaction(options: { database: string }): Promise<void>;
  rollbackTransaction(options: { database: string }): Promise<void>;
  closeConnection(options: { database: string; readonly: boolean }): Promise<void>;
  deleteDatabase(options: { database: string }): Promise<void>;
}

const sqlitePlugin = (): CapacitorSqlitePlugin | undefined =>
  (globalThis as { Capacitor?: { Plugins?: { CapacitorSQLite?: CapacitorSqlitePlugin } } }).Capacitor?.Plugins
    ?.CapacitorSQLite;

export const sqliteAvailable = (): boolean => !!sqlitePlugin();

/** E3a: what `PRAGMA cipher_version` reported at open — plugin-reported
 *  proof, not inference. Plain (unencrypted) SQLite answers EMPTY, so
 *  null here means the store is NOT actually SQLCipher. */
let cipherVersion: string | null = null;
export const sqlCipherVersion = (): string | null => cipherVersion;

/** 32 random bytes as hex — the SQLCipher passphrase (minted exactly once) */
const mintPassphrase = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** open (creating if needed) the identity's encrypted database */
export async function openEncryptedExecutor(database: string): Promise<SqlExecutor> {
  const plugin = sqlitePlugin();
  if (!plugin) throw new Error('CapacitorSQLite plugin not available');

  const stored = await plugin.isSecretStored();
  if (!stored.result) await plugin.setEncryptionSecret({ passphrase: mintPassphrase() });

  // the NATIVE side outlives webview reloads: after toggling the store
  // off and on, its registry still holds the old connection and
  // createConnection threw "Connection … already exists" — which the
  // never-brick guard read as a broken store and silently cleared the
  // flag (user bug). A pre-emptive close makes open idempotent.
  await plugin.closeConnection({ database, readonly: false }).catch(() => undefined);
  await plugin.createConnection({ database, version: 1, encrypted: true, mode: 'secret', readonly: false });
  await plugin.open({ database });

  // E3a: capture the cipher proof once per open; a failure to answer is
  // recorded as null (= no proof), never an open failure
  try {
    const result = await plugin.query({ database, statement: 'PRAGMA cipher_version;', values: [] });
    const rows = result.values ?? [];
    const clean = rows[0] && 'ios_columns' in rows[0] ? rows.slice(1) : rows;
    const value = Object.values(clean[0] ?? {})[0];
    cipherVersion = typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    cipherVersion = null;
  }

  return {
    async run(statement, params = []) {
      // transaction:false — explicit BEGIN/COMMIT drives batches instead
      await plugin.run({ database, statement, values: params, transaction: false });
    },
    async query(statement, params = []) {
      const result = await plugin.query({ database, statement, values: params });
      const rows = result.values ?? [];
      // raw-plugin quirk: on iOS the FIRST row is {"ios_columns":[...]}.
      // The plugin's JS wrapper strips it; we talk to the plugin directly,
      // so strip it here — reading .json off it gave undefined and
      // JSON.parse(undefined) broke the whole first sync ("Unexpected
      // identifier 'undefined'", the E2 connect loop).
      return rows[0] && 'ios_columns' in rows[0] ? rows.slice(1) : rows;
    },
    async transaction(fn) {
      await plugin.beginTransaction({ database });
      try {
        await fn();
        await plugin.commitTransaction({ database });
      } catch (err) {
        await plugin.rollbackTransaction({ database }).catch(() => undefined);
        throw err;
      }
    },
    async close() {
      await plugin.closeConnection({ database, readonly: false }).catch(() => undefined);
    },
    async destroy() {
      await plugin.deleteDatabase({ database }).catch(() => undefined);
      await plugin.closeConnection({ database, readonly: false }).catch(() => undefined);
    },
  };
}
