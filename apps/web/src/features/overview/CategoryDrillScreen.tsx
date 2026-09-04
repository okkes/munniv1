import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useSpaceAccounts, useSpaceTransactions } from '@/application/transactions';
import { useData } from '@/app/data';
import { categoryContributionCents, txsForCategory } from '@/domain/overview';
import type { OverviewKind } from '@/domain/overview';
import { periodHistory } from '@/domain/periods';
import { catName, useCategories } from '@/features/categories/useCategories';
import { LOCALES, useLang } from '@/i18n';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { AppBar, IconButton } from '@/ui/AppBar';
import { BarChart } from '@/ui/charts';
import { Icon } from '@/ui/Icon';
import { TxRow } from '@/ui/TxRow';
import { TxPartRow } from '@/ui/TxPartRow';
import { matchingPartIndexes } from '@/domain/txFilter';
import type { TxSplit } from '@/db/types';

const PERIOD_COUNT = 6;

/** the part's cents belonging to the drilled category (spread-aware) */
const partCatShare = (part: TxSplit, catSet: ReadonlySet<string>): number => {
  if (part.cats?.length) {
    return part.cats.filter((entry) => catSet.has(entry.catId)).reduce((sum, entry) => sum + entry.amountCents, 0);
  }
  return Math.abs(part.amountCents);
};

const KIND_ACCENT: Record<OverviewKind, string> = {
  income: 'var(--m-accent)',
  expense: 'var(--m-negative)',
  saving: 'var(--m-warning)',
  investment: 'var(--m-special)',
  funding: '#16A085',
  debt: 'var(--m-special)',
};

/**
 * One category, in place: period total, per-period mini bars doubling as
 * the period selector, and the plain list of the transactions behind the
 * number — each row navigating straight to its transaction page (#168
 * r5: the in-between peek sheet is retired; back returns here). Replaces
 * the old forward to the filtered Transactions tab, which lost the
 * analysis context.
 */
export function CategoryDrillScreen() {
  const { t, lang } = useLang();
  const { store, spaceId } = useData();
  const { kind, catId } = useParams({ strict: false }) as { kind: OverviewKind; catId: string };
  const { from } = useSearch({ strict: false }) as { from?: string };
  const cats = useCategories();
  const navigate = useNavigate();
  // #168 r5 (user): rows go STRAIGHT to the transaction page — pushed,
  // so the browser back lands right back on this drill
  const openTx = (txId: string) => void navigate({ to: '/transactions/$txId', params: { txId } });

  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const accounts = useSpaceAccounts();
  const txs = useSpaceTransactions();

  const periods = useMemo(
    () => periodHistory(space?.periodType ?? 'month', space?.periodDay ?? 1, PERIOD_COUNT),
    [space?.periodType, space?.periodDay],
  );
  // land on the period the overview was looking at (falls back to current)
  const initialIndex = useMemo(() => {
    const found = from ? periods.findIndex((p) => p.start === from) : -1;
    return found >= 0 ? found : PERIOD_COUNT - 1;
  }, [periods, from]);
  const [periodIndex, setPeriodIndex] = useState(initialIndex);
  // the space row loads async: the first render computes periods with
  // default month boundaries, so a custom period start makes `from`
  // unmatchable and the drill snapped back to the CURRENT period (user
  // bug). Re-anchor when the real config lands — unless the user already
  // picked a bar themselves (render-time prev-value pattern).
  const touched = useRef(false);
  const lastInitial = useRef(initialIndex);
  if (lastInitial.current !== initialIndex) {
    lastInitial.current = initialIndex;
    if (!touched.current) setPeriodIndex(initialIndex);
  }
  const selectPeriod = (index: number) => {
    touched.current = true;
    setPeriodIndex(index);
  };

  const accountsById = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts]);
  const perPeriod = useMemo(
    () => periods.map((period) => txsForCategory(kind, txs ?? [], accountsById, period, catId, cats)),
    [periods, kind, txs, accountsById, catId, cats],
  );
  const barLabels = useMemo(
    () =>
      periods.map((period) => {
        const start = new Date(period.start);
        const end = new Date(period.end);
        const fromLabel = start.toLocaleDateString(LOCALES[lang], { month: 'short' });
        const toLabel = end.toLocaleDateString(LOCALES[lang], { month: 'short' });
        return fromLabel === toLabel ? fromLabel : `${fromLabel}–${toLabel}`;
      }),
    [periods, lang],
  );

  const selected = perPeriod[periodIndex];
  const period = periods[periodIndex];
  const currency = space?.currency ?? 'EUR';
  const { fmt } = useDisplayMoney();
  const cat = cats.byId(catId);
  const color = cat.color ?? cats.byId(cat.parentId)?.color ?? KIND_ACCENT[kind];
  const periodLabel = `${new Date(period.start).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' })} – ${new Date(period.end).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' })}`;

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-category-drill">
      <AppBar
        title={catName(cat, t)}
        leading={
          <IconButton label={t('action.back')} testId="catdrill-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex flex-col items-center py-2 text-center">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-2xl"
            style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
          >
            <Icon name={cat.icon} size={22} />
          </span>
          <div className="m-num mt-2 text-4xl text-ink" data-testid="catdrill-total">
            {fmt(selected.totalCents, currency)}
          </div>
          <div className="mt-1 text-xs font-medium text-ink-3" data-testid="catdrill-period">
            {periodLabel}
          </div>
        </div>

        {/* the mini bars double as the period selector */}
        <div className="mt-2 rounded-card border border-line bg-surface px-4 pt-3 pb-2">
          <BarChart
            values={perPeriod.map((entry) => entry.totalCents)}
            labels={barLabels}
            selected={periodIndex}
            onSelect={selectPeriod}
            accent={color}
          />
        </div>

        <div className="m-cap mt-5 mb-1 px-1">
          {t('overview.payments')} · {selected.txs.length}
        </div>
        {selected.txs.length > 0 ? (
          <div className="divide-y divide-line-2 rounded-card border border-line bg-surface px-3 py-1" data-testid="catdrill-list">
            {selected.txs.map((tx) => {
              // the headline is what THIS category got (splits partition);
              // the full net amount stays visible small when they differ
              const slice = categoryContributionCents(kind, tx, catId, cats);
              const signed = tx.amountCents < 0 ? -slice : slice;
              // #126 r8 (user request): a split shows only ITS matching
              // parts here — normal-looking rows with the split glyph;
              // #168 r5: they open the parent transaction's page
              const rowParts = (tx.splits ?? []).filter((s) => s.catId !== 'reimbursed');
              // #149: every multi-part row branches, labels or not
              if (rowParts.length > 1) {
                const drillCats = new Set([catId, ...cats.childrenOf(catId).map((c) => c.id)]);
                const shown = matchingPartIndexes(tx, { catIds: drillCats });
                return shown.map((i) => (
                  <TxPartRow
                    key={rowParts[i].id ?? `${tx.id}-${i}`}
                    tx={tx}
                    part={rowParts[i]}
                    index={i}
                    amountText={fmt(
                      (tx.amountCents < 0 ? -1 : 1) * partCatShare(rowParts[i], drillCats),
                      currency,
                    )}
                    onClick={() => openTx(tx.id)}
                    showDate
                  />
                ));
              }
              return (
                <TxRow
                  key={tx.id}
                  tx={tx}
                  showDate
                  // a sub-category drill repeats its own name on every row
                  hideCategory={!!cat.parentId}
                  amountOverrideCents={signed}
                  onClick={() => openTx(tx.id)}
                />
              );
            })}
          </div>
        ) : (
          <p className="px-1 text-[12px] text-ink-4" data-testid="catdrill-empty">
            {t('overview.noPayments')}
          </p>
        )}
      </div>
    </div>
  );
}
