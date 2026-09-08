import { apiFetch } from '@/lib/api';
import { identityKey } from '@/app/session';
import type { Identity } from '@/app/session';
import type { Repo } from '@/db/repo';
import type { StorageBackend } from '@/db/backend';
import { adoptOfflineProfile } from './offlineProfiles';

/**
 * Online → offline conversion (OO1-OO3). munni is local-first, so this
 * is not a data migration: the device already holds everything. It is
 * an identity REBIND (the new offline profile adopts the existing
 * store) plus an honest triage of the server-only features:
 *
 * - bank-linked accounts flip to the manual tier (user ruling: manual
 *   continuation instead of a frozen label) — data stays, you type from
 *   here on;
 * - shared-space MEMBERSHIP ends server-side for every shared space;
 *   locally each one is either kept as a snapshot or purged (per-space
 *   choice);
 * - server data is deleted outright when asked (GDPR-clean exit) —
 *   default ON in the UI.
 *
 * Every server call is best-effort: going offline must work while
 * offline. Returns the new profile id (arc 8 lifted the one-per-device
 * rule — the conversion mints its profile next to any existing ones).
 */
export interface GoOfflineContext {
  store: StorageBackend;
  repo: Repo;
  engine: { purgeSpace: (spaceId: string) => Promise<void> } | null;
  identity: Identity;
}

export interface GoOfflineOptions {
  /** shared spaces whose LOCAL copy is purged instead of kept as snapshot */
  dropSpaceIds: readonly string[];
  profileName: string;
  profilePicture?: string;
}

export async function convertToOffline(ctx: GoOfflineContext, opts: GoOfflineOptions): Promise<string | null> {
  if (ctx.identity.kind !== 'user') return null;

  // the registry rebind first — the new profile adopts this identity's
  // existing store and lives next to any profiles already on the device
  const profile = adoptOfflineProfile(opts.profileName, opts.profilePicture, identityKey(ctx.identity));

  // server exit, best-effort (user ruling: going offline always deletes
  // the server data — as if the app had been offline from day one).
  // keepIdentity: the Logto login survives in EVERY environment (dev and
  // prod share identities); other devices detect the dead account via
  // the /me binding check and wipe themselves.
  await apiFetch('/me?keepIdentity=true', { method: 'DELETE' }).catch(() => undefined);

  // bank-linked accounts → manual tier: the feed is gone, hand-typed
  // rows take over; balances and history stay untouched
  const accounts = (await ctx.store.allRows('account')).filter((a) => a.deleted === 0 && a.source === 'gocardless');
  for (const account of accounts) {
    await ctx.repo.upsert('account', account.spaceId, account.id, { source: 'manual' });
  }

  // dropped shared spaces lose their local copy; kept ones stay as
  // read-only-by-circumstance snapshots (no members to sync with)
  for (const spaceId of opts.dropSpaceIds) {
    await ctx.engine?.purgeSpace(spaceId);
  }

  return profile.id;
}
