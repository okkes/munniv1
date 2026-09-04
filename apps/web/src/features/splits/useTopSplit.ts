import { useEffect, useState } from 'react';
import { useSession } from '@/app/session';
import { apiFetch } from '@/lib/api';
import { netPositions } from '@/domain/splitLedger';

export interface TopSplit {
  id: string;
  name: string;
  memberCount: number;
  entryCount: number;
  currency: string;
  /** my net position (settlement plan sign: + = owed to me) */
  net: number;
}

/**
 * The Home block's data: my most recently created OPEN split with my
 * net position. Splits are online-only — offline, signed-out and
 * "no open splits" all resolve to null and the block falls back to
 * its teaser. undefined = still loading (render nothing yet).
 */
export function useTopSplit(): TopSplit | null | undefined {
  const { identity } = useSession();
  const [top, setTop] = useState<TopSplit | null | undefined>(undefined);

  useEffect(() => {
    if (identity?.kind !== 'user') {
      setTop(null);
      return;
    }
    let stale = false;
    void (async () => {
      const list = await apiFetch('/splits').catch(() => null);
      if (!list?.ok) {
        if (!stale) setTop(null);
        return;
      }
      const splits = (await list.json()) as { id: string; name: string; status: string; currency: string; memberCount: number; entryCount: number }[];
      const open = splits.find((s) => s.status === 'open'); // server orders newest first
      if (!open) {
        if (!stale) setTop(null);
        return;
      }
      const res = await apiFetch(`/splits/${open.id}`).catch(() => null);
      if (!res?.ok) {
        if (!stale) setTop(null);
        return;
      }
      const detail = (await res.json()) as {
        members: { userId: string; isMe: boolean }[];
        entries: { paidByUserId: string; amountCents: number; shares: { userId: string; cents: number }[] }[];
      };
      const nets = netPositions(
        detail.entries.map((e) => ({ paidByUserId: e.paidByUserId, amountCents: e.amountCents, shares: e.shares })),
        detail.members.map((m) => m.userId),
      );
      const me = detail.members.find((m) => m.isMe);
      if (!stale) {
        setTop({
          id: open.id,
          name: open.name,
          memberCount: open.memberCount,
          entryCount: open.entryCount,
          currency: open.currency,
          net: (me && nets.get(me.userId)) ?? 0,
        });
      }
    })();
    return () => {
      stale = true;
    };
  }, [identity]);

  return top;
}
