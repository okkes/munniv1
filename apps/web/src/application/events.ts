import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { logRowActivity } from './activity';
import type { EventRow } from '@/db/types';

/** the active space's events, active first then archived, newest range first */
export function useEvents(): EventRow[] | undefined {
  const { store, spaceId } = useData();
  return useQuery(
    store,
    async () => {
      const rows = (await store.bySpace('event', spaceId)).filter((e) => e.deleted === 0);
      rows.sort((a, b) => (a.archived ?? 0) - (b.archived ?? 0) || (b.from ?? '').localeCompare(a.from ?? '') || a.name.localeCompare(b.name));
      return rows;
    },
    [spaceId],
  );
}

export interface EventOps {
  save: (id: string | null, fields: Partial<EventRow>) => Promise<string>;
  remove: (id: string) => Promise<void>;
}

export function useEventOps(): EventOps {
  const { store, repo, spaceId } = useData();
  return {
    save: async (id, fields) => {
      const rowId = id ?? repo.newId();
      await repo.upsert('event', spaceId, rowId, fields);
      void logRowActivity(store, repo, spaceId, 'event', rowId, id ? 'eventEdit' : 'eventAdd', fields.name);
      return rowId;
    },
    remove: async (id) => {
      await logRowActivity(store, repo, spaceId, 'event', id, 'eventRemove');
      await repo.remove('event', spaceId, id);
    },
  };
}
