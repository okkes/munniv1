import type { StorageBackend } from '@/db/backend';

/**
 * The in-app notification inbox (arc 6): a device-local, per-identity
 * meta list — the `txSeen` pattern, never synced. OS push/SW
 * notifications keep firing as before; this is the in-app record that
 * works identically offline and online.
 */
export type InboxKind = 'whatsnew' | 'recurringDue' | 'debtRate' | 'digest';

export interface InboxEntry {
  id: string;
  kind: InboxKind;
  /** ISO timestamp — newer than `notifSeenAt` counts as unread */
  ts: string;
  /** per-kind display bits (name, date, version, n) + the dedupe key */
  payload?: Record<string, string>;
}

const LIST_KEY = 'notifInbox';
const SEEN_KEY = 'notifSeenAt';
const CAP = 50;

export async function readInbox(store: StorageBackend): Promise<InboxEntry[]> {
  return ((await store.metaGet(LIST_KEY))?.value as InboxEntry[] | undefined) ?? [];
}

/**
 * Prepend one entry, newest first, capped. A `dedupeKey` makes the event
 * once-only (one What's-new per version, one due reminder per date) —
 * matching entries already in the list are left alone.
 */
export async function appendNotification(
  store: StorageBackend,
  kind: InboxKind,
  payload?: Record<string, string>,
  dedupeKey?: string,
): Promise<void> {
  const list = await readInbox(store);
  if (dedupeKey && list.some((e) => e.kind === kind && e.payload?.dedupe === dedupeKey)) return;
  const entry: InboxEntry = {
    id: crypto.randomUUID(),
    kind,
    ts: new Date().toISOString(),
    payload: { ...payload, ...(dedupeKey ? { dedupe: dedupeKey } : {}) },
  };
  await store.metaPut(LIST_KEY, [entry, ...list].slice(0, CAP));
}

/** unread = entries newer than the last time the tab was opened */
export async function unreadNotifCount(store: StorageBackend): Promise<number> {
  const seen = (await store.metaGet(SEEN_KEY))?.value as string | undefined;
  return (await readInbox(store)).filter((e) => !seen || e.ts > seen).length;
}

/** opening the Notifications tab marks everything seen (v1: no per-row state) */
export async function stampNotifSeen(store: StorageBackend): Promise<void> {
  await store.metaPut(SEEN_KEY, new Date().toISOString());
}
