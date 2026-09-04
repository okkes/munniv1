import { useQuery } from '@/db/useQuery';
import { useData } from '@/app/data';

/**
 * "Hide tips" preference (user request): one switch that removes every
 * question-mark button, first-time nudge and install hint. Stored in
 * device meta like the tutorial-seen flags — tips are personal, not
 * space data. The Help & support screen stays reachable via Settings,
 * so tours remain a deliberate choice.
 */
export const TIPS_DISABLED_KEY = 'tipsDisabled';

export function useTipsDisabled(): boolean {
  const { store } = useData();
  return !!useQuery(store, async () => (await store.metaGet(TIPS_DISABLED_KEY))?.value, []);
}
