import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { logActivity, logRowActivity } from './activity';
import type { TopicRow } from '@/db/types';

/**
 * Allocation topics: user-defined groupings of MAIN categories ("Fun" =
 * entertainment + coffee + …) that structure the allocate screen.
 * Synced rows like any other space data.
 */
export function useTopics(): TopicRow[] | undefined {
  const { store, spaceId } = useData();
  return useQuery(
    store,
    async () => {
      const rows = (await store.bySpace('topic', spaceId)).filter((topic) => topic.deleted === 0);
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return rows;
    },
    [spaceId],
  );
}

export function useTopicOps() {
  const { store, repo, spaceId } = useData();
  return {
    save: async (id: string | null, fields: { name: string; catIds: string[] }) => {
      await repo.upsert('topic', spaceId, id ?? crypto.randomUUID(), fields);
      void logActivity(store, repo, spaceId, id ? 'topicEdit' : 'topicAdd', fields.name);
    },
    remove: async (id: string) => {
      await logRowActivity(store, repo, spaceId, 'topic', id, 'topicRemove');
      await repo.remove('topic', spaceId, id);
    },
  };
}
