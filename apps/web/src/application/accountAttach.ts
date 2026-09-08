import { accountLinkId } from '@/domain/feedIds';
import { logActivity } from './activity';
import { DEFAULT_HISTORY_MONTHS, isoMonthsAgo } from '@/features/spaces/spaceDefaults';
import { attachAccount, detachAccount, fetchSpaceLinks } from '@/features/accounts/feedGateway';
import type { Repo } from '@/db/repo';
import type { StorageBackend } from '@/db/backend';
import type { AccountType } from '@/db/types';

/**
 * Attach/detach of feed accounts to spaces (redesign 2026-07-22): the
 * space's own accounts screen drives both now — server first (access
 * control lives there), then the synced accountLink mirror so offline
 * devices render the change.
 */

export async function attachFeedToSpace(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  feedSpaceId: string,
  accountId: string,
  historyFrom?: string,
  /** #152: the SPACE-level type — each attachment decides what the
   *  account is to its space; absent keeps the account row's value */
  type?: AccountType,
): Promise<void> {
  // the override wins, then the space's history start, then the app
  // default — never silently unlimited (user bug report)
  const from =
    historyFrom || (await store.get('space', spaceId))?.historyStartDate || isoMonthsAgo(DEFAULT_HISTORY_MONTHS);
  await attachAccount(spaceId, feedSpaceId, accountId, from);
  await repo.upsert('accountLink', spaceId, accountLinkId(spaceId, feedSpaceId), {
    feedSpaceId,
    accountId,
    historyFrom: from,
    archived: 0,
    ...(type ? { type } : {}),
  });
  void logActivity(store, repo, spaceId, 'attach', (await store.get('account', accountId))?.name);
}

/**
 * Server links → local accountLink mirrors, for attachments the CLIENT
 * never saw being made. The bank-connect completion runs anonymously on
 * the hosted page (native hop: that browser has no app session), so the
 * server attaches the accounts to the initiating space but no device
 * ever wrote the mirror — the connection existed server-side yet showed
 * up NOWHERE in the app (the long-standing user issue, admin Diagnose
 * confirmed dangling SpaceAccountLinks). Runs at space open, best-effort.
 */
export async function reconcileSpaceLinks(store: StorageBackend, repo: Repo, spaceId: string): Promise<number> {
  const server = await fetchSpaceLinks(spaceId);
  if (server.length === 0) return 0;
  const local = (await store.bySpace('accountLink', spaceId)).filter((l) => l.deleted === 0);
  const space = await store.get('space', spaceId);
  let mirrored = 0;
  for (const link of server) {
    if (local.some((l) => l.feedSpaceId === link.feedSpaceId && l.accountId === link.accountId)) continue;
    // #305: copy the SERVER link's own facts — minting a fresh
    // historyFrom here out-HLC'd the real attach op mid-race and
    // ratcheted the gate forward, hiding older shared transactions
    await repo.upsert('accountLink', spaceId, accountLinkId(spaceId, link.feedSpaceId), {
      feedSpaceId: link.feedSpaceId,
      accountId: link.accountId,
      historyFrom: link.historyFrom ?? space?.historyStartDate ?? isoMonthsAgo(DEFAULT_HISTORY_MONTHS),
      ...(link.attachedByName ? { attachedByName: link.attachedByName } : {}),
      archived: link.archived ? (1 as const) : (0 as const),
    });
    mirrored++;
  }
  return mirrored;
}

/**
 * #212 r2: the SPACE owns an attached account's type. Links minted
 * before the rule (or by the server's connect mirror op) carry none
 * and read the global row live — a field the bank fetch re-asserts to
 * 'checking' on every run. Freeze today's effective reading onto the
 * link (every boot, idempotent) so the space's fact stops depending on
 * a field the server keeps rewriting.
 */
export async function healUntypedLinks(store: StorageBackend, repo: Repo): Promise<number> {
  let touched = 0;
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  for (const space of spaces) {
    for (const link of (await store.bySpace('accountLink', space.id)).filter((l) => l.deleted === 0)) {
      if (link.type) continue;
      const account = await store.get('account', link.accountId);
      if (!account) continue;
      if (account.deleted !== 0) continue;
      await repo.upsert('accountLink', space.id, link.id, { type: account.type });
      touched++;
    }
  }
  return touched;
}

export async function detachFeedFromSpace(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  feedSpaceId: string,
  accountId: string,
): Promise<void> {
  const serverLinks = await fetchSpaceLinks(spaceId);
  const serverLink = serverLinks.find((l) => l.feedSpaceId === feedSpaceId && l.accountId === accountId);
  if (serverLink) await detachAccount(spaceId, serverLink.id);
  const local = (await store.bySpace('accountLink', spaceId)).find(
    (l) => l.deleted === 0 && l.accountId === accountId && l.feedSpaceId === feedSpaceId,
  );
  if (local) await repo.remove('accountLink', spaceId, local.id);
  void logActivity(store, repo, spaceId, 'detach', (await store.get('account', accountId))?.name);
}
