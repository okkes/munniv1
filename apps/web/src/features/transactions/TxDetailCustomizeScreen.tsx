import { useQuery } from '@/db/useQuery';
import { useLang } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { useData } from '@/app/data';
import type { SpaceRow } from '@/db/types';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Icon } from '@/ui/Icon';
import { BlockListEditor } from '@/features/customize/BlockListEditor';

/** the movable sections below the categories card, in default order —
 *  #232 (user): actions and the details/facts card joined the registry;
 *  the headline, account and categories cards stay fixed */
export const TX_DETAIL_BLOCK_IDS = ['actions', 'facts', 'reimburse', 'receipts', 'notes'] as const;
export type TxDetailBlockId = (typeof TX_DETAIL_BLOCK_IDS)[number];

export const TX_DETAIL_BLOCK_LABELS: Record<TxDetailBlockId, TranslationKey> = {
  actions: 'tx.actionsSection',
  facts: 'tx.detailsSection',
  reimburse: 'reimb.section',
  receipts: 'receipt.title',
  notes: 'tx.notes',
};

/** icons matching the sections they stand for (user feedback 2026-07-24) */
export const TX_DETAIL_BLOCK_ICONS: Record<TxDetailBlockId, string> = {
  actions: 'gesture-tap-button',
  facts: 'information-outline',
  reimburse: 'cash-refund',
  receipts: 'receipt-text-outline',
  notes: 'note-edit-outline',
};

export interface TxDetailBlockConfig {
  id: TxDetailBlockId;
  hidden: boolean;
}

/** the space's saved layout merged with defaults — #232: a section the
 *  save predates slots in at its DEFAULT position (appending shoved
 *  actions/facts under notes for every existing space) */
export function resolveTxDetailBlocks(space: SpaceRow | undefined): TxDetailBlockConfig[] {
  const saved = space?.txDetailBlocks ?? [];
  const known = new Set<string>(TX_DETAIL_BLOCK_IDS);
  const ordered = saved
    .filter((entry) => known.has(entry.id))
    .map((entry) => ({ id: entry.id as TxDetailBlockId, hidden: entry.hidden === 1 }));
  const defaultIndex = (id: TxDetailBlockId) => TX_DETAIL_BLOCK_IDS.indexOf(id);
  for (const id of TX_DETAIL_BLOCK_IDS) {
    if (ordered.some((entry) => entry.id === id)) continue;
    const at = ordered.findIndex((entry) => defaultIndex(entry.id) > defaultIndex(id));
    ordered.splice(at === -1 ? ordered.length : at, 0, { id, hidden: false });
  }
  return ordered;
}

/**
 * "Customize this view" for the transaction detail, as a full screen
 * (same reasoning as Customize Home: drags on a sheet felt awkward and
 * the ghost drifted). Saved on the space row — syncs to every member.
 */
export function TxDetailCustomizeScreen() {
  const { t } = useLang();
  const { store, repo, spaceId } = useData();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const blocks = resolveTxDetailBlocks(space);

  const persist = (next: TxDetailBlockConfig[]) =>
    void repo.upsert('space', spaceId, spaceId, {
      txDetailBlocks: next.map((entry) => ({ id: entry.id, hidden: entry.hidden ? (1 as const) : (0 as const) })),
    });

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
    <div className="m-fade flex h-full flex-col" data-testid="screen-tx-customize">
      <AppBar
        title={t('tx.customize')}
        leading={
          <IconButton label={t('action.back')} testId="tx-customize-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <p className="pb-2 text-[12px] text-ink-3">{t('tx.customizeSub')}</p>
        {/* render only once the SAVED layout arrived — acting on the
            defaults mid-load silently overwrote the real order */}
        {space && (
        <div className="flex flex-col" data-testid="tx-customize-list">
          <BlockListEditor
            rows={blocks.map((entry) => ({
              id: entry.id,
              label: t(TX_DETAIL_BLOCK_LABELS[entry.id]),
              icon: TX_DETAIL_BLOCK_ICONS[entry.id],
              hidden: entry.hidden,
            }))}
            testPrefix="tx-block"
            onToggle={toggle}
            onReorder={reorder}
          />
        </div>
        )}
      </div>
    </div>
  );
}
