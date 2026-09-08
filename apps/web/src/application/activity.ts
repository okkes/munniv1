import type { Repo } from '@/db/repo';
import type { StorageBackend } from '@/db/backend';
import type { EntityName } from '@/db/types';
import { useSession } from '@/app/session';
import { offlineProfileName } from '@/features/auth/offlineProfiles';

/** newest rows kept per space — 200 rows OR 90 days, whichever is
 *  smaller (user-approved): the cap bounds sync payloads, the age bound
 *  keeps a dormant space from replaying stale history */
export const ACTIVITY_CAP = 200;
export const ACTIVITY_MAX_AGE_DAYS = 90;

/**
 * Append one "who did what" line to the space's history (YNAB-style,
 * user request). The actor's display name is frozen at write time so
 * every member's device can render it offline. Writes ride the normal
 * Repo/outbox path — history syncs like any other space data.
 */
export async function logActivity(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  kind: string,
  detail?: string,
): Promise<void> {
  try {
    const profile = (await store.metaGet('profile'))?.value as { name?: string } | undefined;
    // actor resolution: profile display name first, the offline profile's
    // name as fallback — plus the sub so other devices can render "You"
    const identity = useSession.getState().identity;
    const actorName =
      profile?.name ?? (identity?.kind === 'offline' ? offlineProfileName(identity.profileId) : undefined);
    await repo.upsert('activity', spaceId, repo.newId(), {
      kind,
      ...(actorName ? { actorName } : {}),
      ...(identity?.kind === 'user' ? { actorSub: identity.sub } : {}),
      ...(detail ? { detail } : {}),
      at: new Date().toISOString(),
    });
    await pruneActivity(store, repo, spaceId);
  } catch {
    // history is a nicety — it must never break the action it records
  }
}

/**
 * Convenience for the uniform save/remove ops: partial updates often
 * carry no name, so resolve the row's display name from the store
 * before (for removes: while it still exists) logging.
 */
export async function logRowActivity(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  table: EntityName,
  id: string,
  kind: string,
  name?: string,
): Promise<void> {
  try {
    const detail = name ?? ((await store.get(table, id)) as { name?: string } | undefined)?.name;
    await logActivity(store, repo, spaceId, kind, detail);
  } catch {
    // history is a nicety — it must never break the action it records
  }
}

/** tombstone everything beyond the newest ACTIVITY_CAP rows or older
 *  than ACTIVITY_MAX_AGE_DAYS */
export async function pruneActivity(store: StorageBackend, repo: Repo, spaceId: string): Promise<void> {
  const rows = (await store.bySpace('activity', spaceId)).filter((r) => r.deleted === 0);
  const cutoff = new Date(Date.now() - ACTIVITY_MAX_AGE_DAYS * 86_400_000).toISOString();
  const oldestFirst = [...rows].sort((a, b) => a.at.localeCompare(b.at));
  const overCap = Math.max(0, rows.length - ACTIVITY_CAP);
  const excess = oldestFirst.filter((row, i) => i < overCap || row.at < cutoff);
  for (const row of excess) await repo.remove('activity', spaceId, row.id);
}
