import { v7 as uuidv7 } from 'uuid';

/**
 * Registry of offline profiles on this device (localStorage). Offline
 * mode is fully local: no network calls, no sync — signing out keeps the
 * profile and its data; only its explicit deletion removes anything.
 */
export interface OfflineProfile {
  id: string;
  name: string;
  createdAt: number;
  /** avatar preset id ("icon|color"), set from the profile screen */
  picture?: string;
  /** OO1 identity rebind: a profile born from "Go offline" ADOPTS the
   *  signed-in identity's existing store — this is that identity key
   *  (e.g. "user_abc"). Absent = a normal profile with its own store. */
  storeKey?: string;
}

const KEY = 'munni_offline_profiles';

export function listOfflineProfiles(): OfflineProfile[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as OfflineProfile[]) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Mint a profile — ALWAYS a fresh one (arc 8 lifted the one-per-device
 * rule; the old silent return-the-first was a landmine once multiples
 * exist). Each profile is a fully separate world with its own store;
 * spaces INSIDE a profile are how bookkeeping splits.
 */
export function addOfflineProfile(name: string): OfflineProfile {
  const profile: OfflineProfile = { id: uuidv7(), name: name.trim(), createdAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify([...listOfflineProfiles(), profile]));
  return profile;
}

/**
 * OO1: mint the profile for an online→offline conversion. It ADOPTS the
 * signed-in identity's store (no copying — the local-first store IS the
 * data). Lives happily next to existing profiles (arc 8): every profile
 * keeps its own store, nothing merges.
 */
export function adoptOfflineProfile(name: string, picture: string | undefined, storeKey: string): OfflineProfile {
  const profile: OfflineProfile = { id: uuidv7(), name: name.trim() || 'munni', createdAt: Date.now(), picture, storeKey };
  localStorage.setItem(KEY, JSON.stringify([...listOfflineProfiles(), profile]));
  return profile;
}

export function offlineProfileName(id: string): string | undefined {
  return listOfflineProfiles().find((p) => p.id === id)?.name;
}

export function getOfflineProfile(id: string): OfflineProfile | undefined {
  return listOfflineProfiles().find((p) => p.id === id);
}

export function updateOfflineProfile(id: string, changes: Pick<Partial<OfflineProfile>, 'name' | 'picture'>): void {
  const updated = listOfflineProfiles().map((p) => (p.id === id ? { ...p, ...changes } : p));
  localStorage.setItem(KEY, JSON.stringify(updated));
}

/**
 * Delete the profile AND everything it owns (user request — with one
 * profile per device, reinstalling was the only way out): the identity
 * database wherever it lives (Dexie or SQLCipher), the app-lock config
 * and the registry row. Irreversible by design.
 */
export async function deleteOfflineProfile(id: string): Promise<void> {
  const { destroyStorage } = await import('@/db/openStore');
  const { identityDbName } = await import('@/db/schema');
  // an adopted profile lives in the rebound store — destroy THAT one
  const key = getOfflineProfile(id)?.storeKey ?? `offline_${id}`;
  await destroyStorage(identityDbName(key)).catch(() => undefined);
  localStorage.removeItem(`munni_lock_${key}`);
  localStorage.setItem(KEY, JSON.stringify(listOfflineProfiles().filter((p) => p.id !== id)));
}
