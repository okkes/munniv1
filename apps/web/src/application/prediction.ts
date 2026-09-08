import { visibleTransactions } from '@/db/joined';
import { buildMerchantMemory } from '@/domain/merchantMemory';
import type { MerchantMemory } from '@/domain/merchantMemory';
import { CATEGORY_BY_ID } from '@/domain/categories';
import type { StorageBackend } from '@/db/backend';

/**
 * Merchant memory is user-scoped and LOCAL-ONLY (user ruling): every
 * space this device knows teaches every other — labeling Albert Heijn
 * in space X informs the suggestion when space Y sees a similar charge.
 *
 * #161 (user rule): the OWN space answers first; other spaces are the
 * fallback when the own history has nothing for the merchant. Rows
 * from other spaces only teach with catalog (builtin) categories — a
 * prediction never names a category the target space cannot see — and
 * never teach spreads or events (both are space-scoped facts). The
 * prediction itself renders only on this user's device; only what the
 * user then CONFIRMS syncs to co-members.
 */
export interface SpaceMemory {
  own: MerchantMemory;
  others: MerchantMemory;
}

export async function buildSpaceMerchantMemory(store: StorageBackend, spaceId: string): Promise<SpaceMemory> {
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  const ownRows = [];
  const otherRows = [];
  for (const space of spaces) {
    const txs = await visibleTransactions(store, space.id);
    if (space.id === spaceId) ownRows.push(...txs);
    else {
      otherRows.push(
        ...txs
          .filter((t) => CATEGORY_BY_ID.has(t.catId ?? ''))
          .map((t) => ({ ...t, cats: undefined, eventId: undefined })),
      );
    }
  }
  return { own: buildMerchantMemory(ownRows), others: buildMerchantMemory(otherRows) };
}
