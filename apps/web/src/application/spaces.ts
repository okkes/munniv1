import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { adoptUserCategoriesOnShare } from '@/features/categories/categoryOps';

/**
 * #277 r2 (user): "the other side must also see that they joined a
 * shared space." The `kind: 'shared'` flip historically happened on the
 * OWNER's device only — a joiner whose copy predates the flip (or whose
 * row synced without it) kept `personal` and never grew the badge.
 * These helpers stamp/heal the fact from EITHER side; every write is an
 * idempotent LWW upsert.
 */

interface MemberLike {
  userId: string;
  displayName: string | null;
  role: string;
}

/**
 * Make the local space row carry the shared fact. Adopts user-scoped
 * categories BEFORE the kind flip (same order as the owner-side invite
 * flip — the scope change must not orphan category references), then
 * writes only the fields that are actually missing. Returns whether the
 * kind flipped (callers log activity for deliberate shares only).
 */
export async function ensureSpaceShared(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  creatorName?: string | null,
): Promise<boolean> {
  const space = await store.get('space', spaceId);
  if (space?.deleted !== 0) return false;
  const flip = space.kind !== 'shared';
  const fields: { kind?: 'shared'; createdByName?: string } = {};
  if (flip) fields.kind = 'shared';
  if (!space.createdByName && creatorName) fields.createdByName = creatorName;
  if (fields.kind === undefined && fields.createdByName === undefined) return false;
  if (flip) await adoptUserCategoriesOnShare(store, repo, spaceId);
  await repo.upsert('space', spaceId, spaceId, fields);
  return flip;
}

/**
 * Heal at the members fetch: a space the server says has 2+ members IS
 * shared, whatever the local row claims. Either side may run it; the
 * owner row in the payload backfills a missing createdByName.
 */
export async function healSharedKind(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  members: readonly MemberLike[],
): Promise<void> {
  if (members.length < 2) return;
  const owner = members.find((m) => m.role === 'owner');
  try {
    await ensureSpaceShared(store, repo, spaceId, owner?.displayName ?? null);
  } catch {
    // best-effort — it runs again on the next members fetch
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type JoinTarget = { spaceId: string } | { except: ReadonlySet<string>; name: string };

/** the join's space row(s), once the sync delivered them */
async function joinedRows(store: StorageBackend, target: JoinTarget) {
  if ('spaceId' in target) {
    const row = await store.get('space', target.spaceId);
    return row?.deleted === 0 ? [row] : [];
  }
  // the friend-accept payload names no space id: the joined space is what
  // `except` did NOT know AND wears the request's space name (the name
  // gate keeps a still-syncing personal space from being mis-stamped)
  return (await store.allRows('space')).filter(
    (row) => row.deleted === 0 && !target.except.has(row.id) && row.name === target.name,
  );
}

/**
 * Post-join stamp: sync until the joined row(s) arrive, then stamp them
 * shared. Bounded retries cover the engine's re-entrancy guard (a running
 * boot pass makes syncAll a no-op); best-effort throughout — the
 * members-fetch heal remains the backstop when the server stays away.
 */
export async function stampJoinedSharedSpace(
  store: StorageBackend,
  repo: Repo,
  sync: () => Promise<void>,
  target: JoinTarget,
  creatorName?: string | null,
  attempts = 4,
): Promise<void> {
  try {
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await wait(700);
      await sync();
      const rows = await joinedRows(store, target);
      if (rows.length > 0) {
        for (const row of rows) await ensureSpaceShared(store, repo, row.id, creatorName);
        return;
      }
    }
  } catch {
    // best-effort — a torn-down store mid-retry must not surface
  }
}
