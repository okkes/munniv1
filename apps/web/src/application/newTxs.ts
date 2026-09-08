import { useMemo } from 'react';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import type { SpaceTx } from '@/db/joined';

const META_KEY = 'txSeen';
const KNOWN_CAP = 1200;

interface SeenMarker {
  ids: string[];
}

/**
 * "New transactions" for the landing zone (user feature): the device
 * remembers which transaction ids it has shown; whatever arrives after
 * the last acknowledgement is new. First visit seeds the marker
 * silently so history never floods the block. Device-level by design —
 * what my phone has shown me is not a property of the space.
 */
export function useNewTransactions(txs: SpaceTx[] | undefined): { newTxs: SpaceTx[]; ackAll: () => Promise<void> } {
  const { store } = useData();
  const marker = useQuery(store, async () => ((await store.metaGet(META_KEY))?.value as SeenMarker | undefined) ?? null, []);

  const newTxs = useMemo(() => {
    if (!txs || marker === undefined) return [];
    if (marker === null) return []; // first visit: seeding below
    const known = new Set(marker.ids);
    return txs
      .filter((tx) => tx.deleted === 0 && !known.has(tx.id))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [txs, marker]);

  // seed on first sight — everything current counts as already seen
  if (marker === null && txs) {
    void store.metaPut(META_KEY, { ids: txs.slice(0, KNOWN_CAP).map((t) => t.id) }).catch(() => undefined);
  }

  const ackAll = async () => {
    if (!txs) return;
    const ids = [...new Set([...(marker?.ids ?? []), ...txs.map((t) => t.id)])].slice(-KNOWN_CAP);
    await store.metaPut(META_KEY, { ids });
  };

  return { newTxs, ackAll };
}
