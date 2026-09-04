import { apiFetch } from '@/lib/api';

interface ProfileMeta {
  name?: string;
  picture?: string;
  country?: string;
  displayCurrency?: string;
}

interface MetaStore {
  metaGet(key: string): Promise<{ key: string; value: unknown } | undefined>;
  metaPut(key: string, value: unknown): Promise<void>;
}

/**
 * Persist the display-currency preference outside the profile screen
 * (the balance-band quick toggle): the meta copy applies instantly on
 * this device; signed-in users also push it to /me so other devices
 * follow. A failed push is fine — the next profile save carries it.
 */
export async function setDisplayCurrency(
  store: MetaStore,
  identityKind: string | undefined,
  currency: string | null,
): Promise<void> {
  const profile = ((await store.metaGet('profile'))?.value ?? {}) as ProfileMeta;
  await store.metaPut('profile', { ...profile, displayCurrency: currency ?? undefined });
  if (identityKind !== 'user' || !profile.name) return; // /me needs a display name
  await apiFetch('/me', {
    method: 'PUT',
    body: JSON.stringify({
      displayName: profile.name,
      picture: profile.picture,
      country: profile.country,
      displayCurrency: currency ?? '', // '' = the server's clear sentinel
    }),
  }).catch(() => undefined);
}
