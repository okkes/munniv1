import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import type { AccountRow } from '@/db/types';

/**
 * Global financial accounts (user decision: accounts are NOT
 * space-scoped). Everything is computed from local synced data, so the
 * overview works offline:
 *
 * - a FEED account lives in a feed space — recognizable locally because
 *   feeds carry no space row (only spaces the user is a member of do);
 * - `sharedVia` collects every local space attached to the account;
 * - ownership comes from /me/feeds (fetched by the screen when online)
 *   — accounts on feeds the user does not own are "shared with me".
 */

export interface SharedVia {
  spaceId: string;
  spaceName: string;
  archived: boolean;
  attachedByName?: string;
  historyFrom?: string;
  /** synced link row id (client mirror) */
  linkRowId: string;
}

export interface GlobalAccount {
  account: AccountRow;
  /** set for feed accounts (undefined = legacy/manual row in a member space) */
  feedSpaceId?: string;
  sharedVia: SharedVia[];
}

export interface SpaceScopedAccounts {
  spaceId: string;
  spaceName: string;
  accounts: GlobalAccount[];
}

export interface GlobalAccounts {
  /** feed accounts (bank connections + statement imports) — truly
   *  user-level; the only rows that are "global" (user ruling 2026-07-28) */
  mine: GlobalAccount[];
  /** manual accounts, which live INSIDE a space — grouped per space so
   *  the overview says clearly where each one belongs */
  spaceScoped: SpaceScopedAccounts[];
  /** accounts reaching the user only through someone else's attachment */
  sharedWithMe: GlobalAccount[];
}

export function useGlobalAccounts(myFeedIds: ReadonlySet<string> | undefined): GlobalAccounts | undefined {
  const { store } = useData();
  return useQuery(store, async () => {
    const [allSpaces, allAccounts, allLinks] = await Promise.all([
      store.allRows('space'),
      store.allRows('account'),
      store.allRows('accountLink'),
    ]);
    const spaces = allSpaces.filter((s) => s.deleted === 0);
    const accounts = allAccounts.filter((a) => a.deleted === 0);
    const links = allLinks.filter((l) => l.deleted === 0);
    const spaceNames = new Map(spaces.map((s) => [s.id, s.name]));
    const memberSpaceIds = new Set(spaces.map((s) => s.id));

    const viaByAccount = new Map<string, SharedVia[]>();
    for (const link of links) {
      if (!memberSpaceIds.has(link.spaceId)) continue;
      const list = viaByAccount.get(link.accountId) ?? [];
      list.push({
        spaceId: link.spaceId,
        spaceName: spaceNames.get(link.spaceId) ?? link.spaceId.slice(0, 8),
        archived: !!link.archived,
        attachedByName: link.attachedByName,
        historyFrom: link.historyFrom,
        linkRowId: link.id,
      });
      viaByAccount.set(link.accountId, list);
    }

    const mine: GlobalAccount[] = [];
    const scopedBySpace = new Map<string, GlobalAccount[]>();
    const sharedWithMe: GlobalAccount[] = [];
    for (const account of accounts) {
      const isFeedAccount = !memberSpaceIds.has(account.spaceId);
      const entry: GlobalAccount = {
        account,
        feedSpaceId: isFeedAccount ? account.spaceId : undefined,
        sharedVia: viaByAccount.get(account.id) ?? [],
      };
      if (!isFeedAccount) {
        // manual rows live inside their space — never in the global list
        const list = scopedBySpace.get(account.spaceId) ?? [];
        list.push(entry);
        scopedBySpace.set(account.spaceId, list);
      } else if (!myFeedIds || myFeedIds.has(account.spaceId)) {
        mine.push(entry);
      } else {
        sharedWithMe.push(entry);
      }
    }
    const spaceScoped: SpaceScopedAccounts[] = [...scopedBySpace.entries()]
      .map(([spaceId, list]) => ({ spaceId, spaceName: spaceNames.get(spaceId) ?? spaceId.slice(0, 8), accounts: list }))
      .sort((a, b) => a.spaceName.localeCompare(b.spaceName));
    return { mine, spaceScoped, sharedWithMe };
  }, [myFeedIds]);
}
