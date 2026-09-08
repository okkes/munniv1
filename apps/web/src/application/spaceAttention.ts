import { useEffect, useState } from 'react';
import { useData } from '@/app/data';
import { visibleTransactions } from '@/db/joined';
import type { StorageBackend } from '@/db/backend';
import { budgetStatus } from '@/domain/budgets';
import { buildCatalog, visibleCategoryRows } from '@/domain/catalog';
import { cachedCatalog } from '@/sync/catalogSync';
import { localToday } from './recurring';

/**
 * Per-space attention (arc 7): what a space would ask of you if you
 * switched into it — unreviewed transactions and busted budgets.
 * Computed lazily when a surface opens; never a background cost.
 */
export interface SpaceAttention {
  reviewCount: number;
  budgetOver: boolean;
}

export async function spaceAttention(store: StorageBackend, spaceId: string): Promise<SpaceAttention> {
  const txs = await visibleTransactions(store, spaceId);
  const reviewCount = txs.filter((t) => t.needsReview === 1).length;
  const budgets = (await store.bySpace('budget', spaceId)).filter((b) => b.deleted === 0);
  let budgetOver = false;
  if (budgets.length > 0) {
    // the same per-space catalog recipe the retro linkers use
    const allSpaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
    const allCats = (await store.allRows('category')).filter((c) => c.deleted === 0);
    const vis = visibleCategoryRows(allSpaces, allCats, spaceId);
    const catalog = buildCatalog(vis.rows, vis.sharedScope, vis.hiddenMains, await cachedCatalog(store));
    const today = localToday();
    budgetOver = budgets.some((b) => budgetStatus(b, txs, catalog, today).leftCents < 0);
  }
  return { reviewCount, budgetOver };
}

/** the Home avatar's dot: does any OTHER space need attention? */
export async function anyOtherSpaceNeedsAttention(store: StorageBackend, activeSpaceId: string): Promise<boolean> {
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0 && s.id !== activeSpaceId);
  for (const space of spaces) {
    const attention = await spaceAttention(store, space.id);
    if (attention.reviewCount > 0 || attention.budgetOver) return true;
  }
  return false;
}

/** one lazy pass over every space the moment `active` turns true */
export function useAttentionMap(active: boolean): ReadonlyMap<string, SpaceAttention> | undefined {
  const { store } = useData();
  const [map, setMap] = useState<ReadonlyMap<string, SpaceAttention> | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
      const entries = await Promise.all(spaces.map(async (s) => [s.id, await spaceAttention(store, s.id)] as const));
      if (!cancelled) setMap(new Map(entries));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, store]);
  return map;
}

/** the avatar dot, computed once per Home mount / space switch */
export function useOtherSpacesDot(): boolean {
  const { store, spaceId } = useData();
  const [dot, setDot] = useState(false);
  useEffect(() => {
    let cancelled = false;
    anyOtherSpaceNeedsAttention(store, spaceId)
      .then((value) => {
        if (!cancelled) setDot(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [store, spaceId]);
  return dot;
}
