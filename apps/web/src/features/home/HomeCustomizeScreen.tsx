import { useQuery } from '@/db/useQuery';
import { useLang } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { useData } from '@/app/data';
import type { SpaceRow } from '@/db/types';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Icon } from '@/ui/Icon';
import { BlockListEditor } from '@/features/customize/BlockListEditor';

/** every block the landing zone can show, in default order (user ruling:
 *  review → this period → transactions → budgets → coming up → goals →
 *  debts → events → insights; portfolio left Home for its own tab) */
export const HOME_BLOCK_IDS = ['review', 'cashflow', 'overview', 'transactions', 'explore', 'budgets', 'allocation', 'upcoming', 'goals', 'debts', 'events', 'splits', 'insights', 'networth'] as const;
export type HomeBlockId = (typeof HOME_BLOCK_IDS)[number];

/** blocks that arrive switched OFF (opt-in via Customize Home) */
const DEFAULT_HIDDEN: ReadonlySet<HomeBlockId> = new Set(['networth']);

export const HOME_BLOCK_LABELS: Record<HomeBlockId, TranslationKey> = {
  review: 'review.title',
  cashflow: 'cashflow.title',
  overview: 'overview.thisPeriod',
  transactions: 'tab.transactions',
  explore: 'home.exploreTitle',
  budgets: 'budgets.title',
  allocation: 'alloc.title',
  upcoming: 'recurring.upcoming',
  goals: 'goals.title',
  debts: 'debts.title',
  events: 'events.title',
  splits: 'splits.title',
  insights: 'ins.title',
  networth: 'trends.viewNetworth',
};

/** each block wears its own face — the plain text list read as a form
 *  instead of a preview of Home (user feedback 2026-07-24) */
export const HOME_BLOCK_ICONS: Record<HomeBlockId, string> = {
  review: 'check-decagram-outline',
  cashflow: 'swap-vertical',
  overview: 'chart-donut',
  transactions: 'format-list-bulleted',
  explore: 'compass-outline',
  budgets: 'wallet-outline',
  allocation: 'view-grid-outline',
  upcoming: 'calendar-clock',
  goals: 'flag-outline',
  debts: 'scale-balance',
  events: 'calendar-star',
  splits: 'account-group-outline',
  insights: 'lightbulb-outline',
  networth: 'chart-line',
};

export interface HomeBlockConfig {
  id: HomeBlockId;
  hidden: boolean;
}

/** the space's saved layout merged with defaults (new blocks append) */
export function resolveHomeBlocks(space: SpaceRow | undefined): HomeBlockConfig[] {
  const saved = space?.homeBlocks ?? [];
  const known = new Set<string>(HOME_BLOCK_IDS);
  const ordered = saved
    .filter((entry) => known.has(entry.id))
    .map((entry) => ({ id: entry.id as HomeBlockId, hidden: entry.hidden === 1 }));
  const present = new Set(ordered.map((entry) => entry.id));
  for (const id of HOME_BLOCK_IDS) if (!present.has(id)) ordered.push({ id, hidden: DEFAULT_HIDDEN.has(id) });
  return ordered;
}

/**
 * "Customize Home" as a full screen (user request: dragging around on a
 * bottom sheet felt awkward, and the sheet's transform sent the drag
 * ghost drifting). Saved on the space row, so the layout is a per-space
 * decision and syncs to every member/device.
 */
export function HomeCustomizeScreen() {
  const { t } = useLang();
  const { store, repo, spaceId } = useData();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const blocks = resolveHomeBlocks(space);

  const persist = (next: HomeBlockConfig[]) =>
    void repo.upsert('space', spaceId, spaceId, {
      homeBlocks: next.map((entry) => ({ id: entry.id, hidden: entry.hidden ? (1 as const) : (0 as const) })),
    });

  // splice, not swap: a long drag lands in one write
  const reorder = (from: number, to: number) => {
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persist(next);
  };

  const toggle = (index: number) => {
    persist(blocks.map((entry, i) => (i === index ? { ...entry, hidden: !entry.hidden } : entry)));
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-home-customize">
      <AppBar
        title={t('home.customize')}
        leading={
          <IconButton label={t('action.back')} testId="home-customize-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <p className="pb-2 text-[12px] text-ink-3">{t('home.customizeSub')}</p>
        {/* render only once the SAVED layout arrived — acting on the
            defaults mid-load silently overwrote the real order */}
        {space && (
        <div className="flex flex-col" data-testid="home-customize-list">
          <BlockListEditor
            rows={blocks.map((entry) => ({
              id: entry.id,
              label: t(HOME_BLOCK_LABELS[entry.id]),
              icon: HOME_BLOCK_ICONS[entry.id],
              hidden: entry.hidden,
            }))}
            testPrefix="home-block"
            onToggle={toggle}
            onReorder={reorder}
          />
        </div>
        )}
      </div>
    </div>
  );
}
