import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { localToday } from './recurring';
import { logRowActivity } from './activity';
import type { GoalRow } from '@/db/types';

/**
 * Goals with their allocation DERIVED from the contribution rows —
 * concurrent funding on two devices then converges by addition instead
 * of losing one bump to LWW. The stored allocatedCents is written as a
 * display snapshot but never trusted.
 */
export function useGoals(): GoalRow[] | undefined {
  const { store, spaceId } = useData();
  return useQuery(
    store,
    async () => {
      const [allGoals, allContributions] = await Promise.all([
        store.bySpace('goal', spaceId),
        store.bySpace('goalContribution', spaceId),
      ]);
      const rows = allGoals.filter((g) => g.deleted === 0);
      const contributions = allContributions.filter((c) => c.deleted === 0);
      const allocated = new Map<string, number>();
      for (const contribution of contributions) {
        allocated.set(contribution.goalId, (allocated.get(contribution.goalId) ?? 0) + contribution.amountCents);
      }
      const goals = rows.map((g) => ({ ...g, allocatedCents: allocated.get(g.id) ?? 0 }));
      goals.sort((a, b) => (a.archived ?? 0) - (b.archived ?? 0) || a.name.localeCompare(b.name));
      return goals;
    },
    [spaceId],
  );
}

export interface GoalOps {
  save: (id: string | null, fields: Partial<GoalRow>) => Promise<string>;
  remove: (id: string) => Promise<void>;
  /** + funds, − withdraws back to unallocated */
  contribute: (goalId: string, amountCents: number, note?: string) => Promise<void>;
}

export function useGoalOps(): GoalOps {
  const { store, repo, spaceId } = useData();
  return {
    save: async (id, fields) => {
      const rowId = id ?? repo.newId();
      await repo.upsert('goal', spaceId, rowId, fields);
      void logRowActivity(store, repo, spaceId, 'goal', rowId, id ? 'goalEdit' : 'goalAdd', fields.name);
      return rowId;
    },
    remove: async (id) => {
      await logRowActivity(store, repo, spaceId, 'goal', id, 'goalRemove');
      await repo.remove('goal', spaceId, id);
    },
    contribute: async (goalId, amountCents, note) => {
      await repo.upsert('goalContribution', spaceId, repo.newId(), {
        goalId,
        amountCents,
        date: localToday(),
        note,
      });
      // display snapshot only — the derived sum is the truth
      const contributions = (await store.bySpace('goalContribution', spaceId)).filter(
        (c) => c.deleted === 0 && c.goalId === goalId,
      );
      const total = contributions.reduce((sum, c) => sum + c.amountCents, 0);
      await repo.upsert('goal', spaceId, goalId, { allocatedCents: total });
      void logRowActivity(store, repo, spaceId, 'goal', goalId, 'goalEdit');
    },
  };
}
