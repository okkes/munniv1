import { apiFetch } from '@/lib/api';
import type { StorageBackend } from '@/db/backend';

/**
 * Reinstall gap (user report): the Settings header reads the LOCAL
 * profile copy, which only the profile screen's Save wrote — so a fresh
 * install showed the stock avatar until the user re-saved. For signed-in
 * users the server knows the name + picture; hydrate the local copy at
 * open whenever it is missing.
 */
export async function hydrateProfileMeta(store: StorageBackend): Promise<void> {
  if ((await store.metaGet('profile'))?.value) return; // local copy exists
  const res = await apiFetch('/me').catch(() => null);
  if (!res?.ok) return; // offline: try again next open
  const me = (await res.json()) as { displayName?: string | null; picture?: string | null; country?: string | null };
  if (!me.displayName && !me.picture) return; // nothing to hydrate
  await store.metaPut('profile', { name: me.displayName ?? '', picture: me.picture ?? undefined, country: me.country ?? undefined });
}
