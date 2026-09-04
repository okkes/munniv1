import { reportError } from '@/lib/report';
import { apiFetch } from '@/lib/api';
import type { StorageBackend } from '@/db/backend';
import type { StoreConnectionRow } from '@/db/types';
import { decryptJson, encryptJson, generateDeviceKeys, mintCsk, unwrapCsk, wrapCsk } from '@/lib/connCrypto';
import { nativePlatform } from '@/lib/platform';

/**
 * E2EE store-connection sync (SC1/SC2 application layer). Everything
 * meaningful happens on-device: the server only ferries public keys,
 * wrapped sync keys and ciphertext. Meta keys (device-local, never
 * synced through spaces):
 *  - storeSyncDevice: { deviceId, publicJwk, privateJwk }
 *  - storeSyncCsk:    the unwrapped CSK — its presence means ENABLED
 */
const DEVICE_KEY = 'storeSyncDevice';
const CSK_KEY = 'storeSyncCsk';

interface DeviceRecord {
  deviceId: string;
  publicJwk: string;
  privateJwk: string;
}

export interface SyncDeviceInfo {
  deviceId: string;
  publicJwk: string;
  name: string;
  hasWrap: boolean;
  createdAt: string;
}

const deviceName = (): string => {
  const platform = nativePlatform();
  if (platform === 'ios') return 'iPhone/iPad';
  if (platform === 'android') return 'Android';
  return 'Browser';
};

async function ensureDevice(store: StorageBackend): Promise<DeviceRecord> {
  const existing = (await store.metaGet(DEVICE_KEY))?.value as DeviceRecord | undefined;
  if (existing) return existing;
  const keys = await generateDeviceKeys();
  const record: DeviceRecord = { deviceId: crypto.randomUUID(), ...keys };
  await store.metaPut(DEVICE_KEY, record);
  return record;
}

export async function localDevice(store: StorageBackend): Promise<DeviceRecord> {
  return ensureDevice(store);
}

export async function syncEnabled(store: StorageBackend): Promise<boolean> {
  return !!(await store.metaGet(CSK_KEY))?.value;
}

/** first device: mint the CSK, register, self-wrap, push what we have */
export async function enableStoreSync(store: StorageBackend): Promise<void> {
  const device = await ensureDevice(store);
  await apiFetch('/me/store-sync/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceId: device.deviceId, publicJwk: device.publicJwk, name: deviceName() }),
  });
  let csk = (await store.metaGet(CSK_KEY))?.value as string | undefined;
  if (!csk) {
    // maybe another device enabled first — adopt its wrap if one waits
    const wrapRes = await apiFetch(`/me/store-sync/devices/${device.deviceId}/wrap`);
    if (wrapRes.ok && wrapRes.status !== 204) {
      const { wrappedCsk } = (await wrapRes.json()) as { wrappedCsk: string };
      csk = await unwrapCsk(wrappedCsk, device.privateJwk);
    } else {
      csk = mintCsk();
      // self-wrap so the server state is complete from day one
      await apiFetch(`/me/store-sync/devices/${device.deviceId}/wrap`, {
        method: 'POST',
        body: JSON.stringify({ wrappedCsk: await wrapCsk(csk, device.publicJwk) }),
      });
    }
    await store.metaPut(CSK_KEY, csk);
  }
  await pushAllConnections(store);
}

/** the global OFF switch: erase server state, keep local connections */
export async function disableStoreSync(store: StorageBackend): Promise<void> {
  await apiFetch('/me/store-sync', { method: 'DELETE' }).catch(() => undefined);
  await store.metaDelete(CSK_KEY);
}

/** push one connection's tokens as ciphertext (no-op while disabled).
 *  v3: blobs are keyed by INSTANCE id — several connections per store. */
export async function pushConnection(store: StorageBackend, connection: StoreConnectionRow): Promise<void> {
  const csk = (await store.metaGet(CSK_KEY))?.value as string | undefined;
  if (!csk) return;
  const cipher = await encryptJson(csk, connection);
  await apiFetch(`/me/store-sync/connections/${connection.id}`, {
    method: 'PUT',
    body: JSON.stringify({ cipher }),
  }).catch(() => undefined); // offline: the next push wins
}

export async function removeConnectionCipher(store: StorageBackend, instanceId: string): Promise<void> {
  if (!(await syncEnabled(store))) return;
  await apiFetch(`/me/store-sync/connections/${instanceId}`, { method: 'DELETE' }).catch(() => undefined);
}

export async function pushAllConnections(store: StorageBackend): Promise<void> {
  for (const connection of await store.storeConnAll()) {
    await pushConnection(store, connection);
  }
}

/** pull ciphertext and adopt whatever is newer than the local copy */
export async function pullConnections(store: StorageBackend): Promise<number> {
  const csk = (await store.metaGet(CSK_KEY))?.value as string | undefined;
  if (!csk) return 0;
  const res = await apiFetch('/me/store-sync/connections').catch(() => null);
  if (!res?.ok) return 0;
  const rows = (await res.json()) as { store: string; cipher: string }[];
  let adopted = 0;
  for (const row of rows) {
    try {
      const decrypted = await decryptJson<StoreConnectionRow>(csk, row.cipher);
      // pre-v3 blobs carry no instance id — adopt them under the store
      // name, matching the local schema migration
      const remote = decrypted.id ? decrypted : { ...decrypted, id: decrypted.store };
      const local = await store.storeConnGet(remote.id);
      if (!local || Date.parse(remote.refreshedAt) > Date.parse(local.refreshedAt)) {
        await store.storeConnPut(remote);
        adopted++;
      }
    } catch (err) {
      // undecryptable blob (rotated CSK?) — never break the pull loop,
      // but DO tell GlitchTip: silent decrypt failures hid real bugs
      reportError('storesync', err);
    }
  }
  return adopted;
}

/** a NEW device asks to join: register, then poll for the wrap */
export async function requestEnrollment(store: StorageBackend): Promise<void> {
  const device = await ensureDevice(store);
  await apiFetch('/me/store-sync/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceId: device.deviceId, publicJwk: device.publicJwk, name: deviceName() }),
  });
}

/** poll: adopt the wrap the moment an enrolled device approves us */
export async function adoptWrapIfApproved(store: StorageBackend): Promise<boolean> {
  if (await syncEnabled(store)) return true;
  const device = await ensureDevice(store);
  const res = await apiFetch(`/me/store-sync/devices/${device.deviceId}/wrap`).catch(() => null);
  if (!res?.ok || res.status === 204) return false;
  const { wrappedCsk } = (await res.json()) as { wrappedCsk: string };
  await store.metaPut(CSK_KEY, await unwrapCsk(wrappedCsk, device.privateJwk));
  await pullConnections(store);
  return true;
}

/** list every device (the approval + revoke UI feeds off this) */
export async function listSyncDevices(): Promise<SyncDeviceInfo[]> {
  const res = await apiFetch('/me/store-sync/devices').catch(() => null);
  if (!res?.ok) return [];
  return (await res.json()) as SyncDeviceInfo[];
}

/** an ENROLLED device approves another: wrap the CSK to its public key */
export async function approveDevice(store: StorageBackend, target: SyncDeviceInfo): Promise<void> {
  const csk = (await store.metaGet(CSK_KEY))?.value as string | undefined;
  if (!csk) throw new Error('store sync is not enabled on this device');
  await apiFetch(`/me/store-sync/devices/${target.deviceId}/wrap`, {
    method: 'POST',
    body: JSON.stringify({ wrappedCsk: await wrapCsk(csk, target.publicJwk) }),
  });
}

export async function revokeDevice(deviceId: string): Promise<void> {
  await apiFetch(`/me/store-sync/devices/${deviceId}`, { method: 'DELETE' });
}
