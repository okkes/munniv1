import { apiFetch } from '@/lib/api';
import { readSessionIdentity } from '@/app/session';
import { storeFeedId } from '@/domain/feedIds';
import type { StorageBackend } from '@/db/backend';

/**
 * The owner's personal STORE FEED (receipts v3): one server-registered
 * sync space per user holding the GLOBAL layer — receipts pulled once,
 * connection-instance metadata visible on all of the owner's devices.
 * Feed-shaped ids must be registered before the first push (S1 guard).
 */
const REGISTERED_KEY = 'storeFeedRegistered';

export function myStoreFeedId(): string | null {
  const identity = readSessionIdentity();
  return identity?.kind === 'user' ? storeFeedId(identity.sub) : null;
}

/** register once per identity; safe to call before every store push */
export async function ensureStoreFeed(store: StorageBackend): Promise<string | null> {
  const feedId = myStoreFeedId();
  if (!feedId) return null;
  if ((await store.metaGet(REGISTERED_KEY))?.value === feedId) return feedId;
  const res = await apiFetch('/feeds', {
    method: 'POST',
    body: JSON.stringify({ feedSpaceId: feedId, accountRef: 'STORES' }),
  }).catch(() => null);
  if (!res?.ok) return null; // offline — retry on the next sync pass
  await store.metaPut(REGISTERED_KEY, feedId);
  return feedId;
}
