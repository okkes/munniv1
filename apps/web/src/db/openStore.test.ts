// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLAG_KEY, activeStoreBackend, openStorageBackend } from './openStore';

vi.mock('@/lib/platform', () => ({ isNativeApp: () => true }));

/** the same fake raw plugin the executor tests use — `run` is recorded
 *  so the migration's INSERTs are observable */
const makePlugin = () => ({
  isSecretStored: vi.fn().mockResolvedValue({ result: true }),
  setEncryptionSecret: vi.fn().mockResolvedValue(undefined),
  createConnection: vi.fn().mockResolvedValue(undefined),
  open: vi.fn().mockResolvedValue(undefined),
  run: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue({ values: [] }),
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  commitTransaction: vi.fn().mockResolvedValue(undefined),
  rollbackTransaction: vi.fn().mockResolvedValue(undefined),
  closeConnection: vi.fn().mockResolvedValue(undefined),
  deleteDatabase: vi.fn().mockResolvedValue(undefined),
});

const setPlugin = (plugin: unknown) => {
  (globalThis as { Capacitor?: unknown }).Capacitor = plugin ? { Plugins: { CapacitorSQLite: plugin } } : undefined;
};

const wipeIndexedDb = async () => {
  for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name);
};

describe('E4: native always opens the encrypted store (with Dexie copy migration)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await wipeIndexedDb();
  });
  afterEach(() => setPlugin(undefined));

  it('opens SQLCipher with no flag, no toggle — always on', async () => {
    setPlugin(makePlugin());
    const backend = await openStorageBackend('munni_fresh');
    expect(activeStoreBackend()).toBe('sqlcipher');
    expect(localStorage.getItem(FLAG_KEY)).toBeNull(); // no decision to record
    backend.close();
  });

  it('copies an existing Dexie store on first encrypted open — outbox included', async () => {
    // veteran device: Dexie holds a space and an unpushed op
    const { MunniDB } = await import('./schema');
    const { DexieBackend } = await import('./backend');
    const db = new MunniDB('munni_veteran');
    const dexie = new DexieBackend(db);
    await dexie.put('space', { id: 'sp-1', spaceId: 'sp-1', name: 'Personal', deleted: 0 });
    await dexie.outboxAdd({ opId: 'op-1', spaceId: 'sp-1', hlc: '001', entity: 'space', entityId: 'sp-1', fields: {} } as never);
    db.close();

    const plugin = makePlugin();
    setPlugin(plugin);
    const backend = await openStorageBackend('munni_veteran');
    expect(activeStoreBackend()).toBe('sqlcipher');

    const inserts = plugin.run.mock.calls.map((c: unknown[]) => (c[0] as { statement: string; values: unknown[] }));
    expect(inserts.some((i) => i.statement.includes('INSERT OR REPLACE INTO e_space') && i.values[0] === 'sp-1')).toBe(true);
    expect(inserts.some((i) => i.statement.includes('INSERT INTO outbox') && i.values[0] === 'op-1')).toBe(true);
    // the one-shot marker lands in meta so the copy never repeats
    expect(inserts.some((i) => i.statement.includes('INTO meta') && i.values[0] === 'dexieMigrated')).toBe(true);
    backend.close();
  });

  it('an encrypted-open failure falls back to Dexie (where the data still lives) and records "0"', async () => {
    const plugin = makePlugin();
    plugin.open.mockRejectedValue(new Error('plugin config broken'));
    setPlugin(plugin);
    const backend = await openStorageBackend('munni_broken');
    expect(activeStoreBackend()).toBe('dexie'); // never brick the app
    expect(localStorage.getItem(FLAG_KEY)).toBe('0');
    backend.close();

    // and the fallback is stable on the next launch
    setPlugin(makePlugin());
    const backend2 = await openStorageBackend('munni_broken');
    expect(activeStoreBackend()).toBe('dexie');
    backend2.close();
  });
});
