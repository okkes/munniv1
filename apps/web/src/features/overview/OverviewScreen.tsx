import { useMemo, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useSpaceAccounts, useSpaceTransactions } from '@/application/transactions';
import { useData } from '@/app/data';
import { categoryBreakdown, contributionCents, txsForKind } from '@/domain/overview';
import type { OverviewKind } from '@/domain/overview';
import { periodHistory } from '@/domain/periods';
import { catName, useCategories } from '@/features/categories/useCategories';
import { LOCALES, useLang } from '@/i18n';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { HelpButton } from '@/features/help/HelpButton';
import { AppBar, IconButton } from '@/ui/AppBar';
import { BarChart, StackedBar } from '@/ui/charts';
import { Collapse } from '@/ui/Collapse';
import { Icon } from '@/ui/Icon';
import { Tile } from '@/ui/primitives';

const PERIOD_COUNT = 6;
const FALLBACK_COLORS = ['#27AE60', '#E67E22', '#3498DB', '#9B59B6', '#E74C3C', '#16A085'];

const KIND_ACCENT: Record<OverviewKind, string> = {
  income: 'var(--m-accent)',
  expense: 'var(--m-negative)',
  saving: '#A8782B',
  investment: '#673AB7',
  funding: '#16A085',
  debt: 'var(--m-special)',
};

/**
 * Drill-down for one overview bucket (earned/spent/saved/invested):
 * per-period bar chart, composition bar, and main-category cards that
 * unfold into their sub categories (legacy ScreenExpenses parity).
 */
export function OverviewScreen() {
  const { t, lang } = useLang();
  const { store, spaceId } = useData();
  const { kind } = useParams({ strict: false }) as { kind: OverviewKind };
  const navigate = useNavigate();
  const cats = useCategories();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const accounts = useSpaceAccounts();
  const txs = useSpaceTransactions();

  const periods = useMemo(
    () => periodHistory(space?.periodType ?? 'month', space?.periodDay ?? 1, PERIOD_COUNT),
    [space?.periodType, space?.periodDay],
  );
  const [periodIndex, setPeriodIndex] = useState(PERIOD_COUNT - 1);

  const accountsById = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts]);

  const barValues = useMemo(
    () =>
      periods.map((period) =>
        txsForKind(kind, txs ?? [], accountsById, period).reduce((sum, tx) => sum + contributionCents(kind, tx), 0),
      ),
    [periods, txs, accountsById, kind],
  );
  const barLabels = useMemo(
    () =>
      periods.map((period) => {
        const start = new Date(period.start);
        const end = new Date(period.end);
        const from = start.toLocaleDateString(LOCALES[lang], { month: 'short' });
        const to = end.toLocaleDateString(LOCALES[lang], { month: 'short' });
        return from === to ? from : `${from}–${to}`;
      }),
    [periods, lang],
  );

  const period = periods[periodIndex];
  // drill into the category's own screen, keeping the selected period
  const openCategory = (catId: string) =>
    void navigate({ to: '/overview/$kind/$catId', params: { kind, catId }, search: { from: period.start } });
  const groups = useMemo(
    () => categoryBreakdown(kind, txs ?? [], accountsById, period, cats),
    [kind, txs, accountsById, period, cats],
  );
  const grandTotal = barValues[periodIndex] ?? 0;
  const positiveTotal = groups.reduce((sum, g) => sum + Math.max(g.totalCents, 0), 0);
  const currency = space?.currency ?? 'EUR';
  const { fmt } = useDisplayMoney();

  const colorOf = (catId: string, i: number) => cats.byId(catId).color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
  const periodLabel = `${new Date(period.start).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' })} – ${new Date(period.end).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' })}`;

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-overview">
      <AppBar
        title={t(`overview.${kind}`)}
        leading={
          <IconButton label={t('action.back')} testId="overview-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
        trailing={<HelpButton tourId="overview" />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="py-2 text-center">
          <div className="m-num text-4xl text-ink" data-testid="overview-total">
            {fmt(grandTotal, currency)}
          </div>
          <div className="mt-1 text-xs font-medium text-ink-3">{periodLabel}</div>
        </div>

        <div className="mt-2 rounded-card border border-line bg-surface px-4 pt-3 pb-2">
          <BarChart
            values={barValues}
            labels={barLabels}
            selected={periodIndex}
            onSelect={setPeriodIndex}
            accent={KIND_ACCENT[kind]}
            valueLabels={barValues.map((v) => fmt(v, currency))}
          />
        </div>

        <div className="mt-4">
          <StackedBar segments={groups.map((g, i) => ({ id: g.catId, value: g.totalCents, color: colorOf(g.catId, i) }))} />
          <div className="mt-3 mb-4 flex flex-wrap gap-x-3 gap-y-1.5">
            {groups.map((g, i) => (
              <span key={g.catId} className="flex items-center gap-1.5 text-[11px] text-ink-2">
                <span className="h-2 w-2 rounded-[3px]" style={{ background: colorOf(g.catId, i) }} />
                {catName(cats.byId(g.catId), t)}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {groups.map((group, i) => {
            const main = cats.byId(group.catId);
            // a lone main unfolds by itself — with one card there is
            // nothing to compare, the subs ARE the story (user request);
            // an explicit tap can still close it
            const isOpen = expanded[group.catId] ?? groups.length === 1;
            const pct = positiveTotal > 0 ? (Math.max(group.totalCents, 0) / positiveTotal) * 100 : 0;
            return (
              <div key={group.catId} className="overflow-hidden rounded-card border border-line bg-surface">
                <button
                  data-testid={`overview-group-${group.catId}`}
                  onClick={() => setExpanded((prev) => ({ ...prev, [group.catId]: !isOpen }))}
                  className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left"
                >
                  <Tile icon={main.icon} bg={`${colorOf(group.catId, i)}22`} color={colorOf(group.catId, i)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between">
                      <span className="truncate text-[14px] font-semibold text-ink">{catName(main, t)}</span>
                      <span className="m-num text-[14px] font-semibold text-ink">
                        {fmt(group.totalCents, currency)}
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-center gap-2">
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-bg-2">
                        <span
                          key={periodIndex} /* replay the grow on period switches */
                          className="m-grow-x block h-full origin-left"
                          style={{ width: `${pct}%`, background: colorOf(group.catId, i), animationDelay: `${i * 40}ms` }}
                        />
                      </span>
                      <span className="min-w-[30px] text-right text-[11px] font-medium text-ink-3">{pct.toFixed(0)}%</span>
                    </span>
                  </span>
                  {group.subs.length > 0 && (
                    <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color="var(--m-ink-4)" />
                  )}
                </button>
                {group.subs.length > 0 && (
                <Collapse open={isOpen}>
                  <div className="bg-bg-2 px-4 py-1" data-testid={`overview-subs-${group.catId}`}>
                    {/* whole main category first (legacy 'All'): the header
                        row folds/unfolds, so this is how you reach ALL of
                        the main's transactions */}
                    <button
                      data-testid={`overview-all-${group.catId}`}
                      onClick={() => openCategory(group.catId)}
                      className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent py-2.5 text-left"
                    >
                      <Icon name="format-list-bulleted" size={16} color="var(--m-ink-3)" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                        {t('overview.allIn', { name: catName(main, t) })}
                      </span>
                      <span className="m-num text-[13px] font-medium text-ink">
                        {fmt(group.totalCents, currency)}
                      </span>
                      <Icon name="chevron-right" size={14} color="var(--m-ink-4)" />
                    </button>
                    {group.subs.map((sub) => (
                      <button
                        key={sub.catId}
                        data-testid={`overview-sub-${sub.catId}`}
                        onClick={() => openCategory(sub.catId)}
                        className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent py-2.5 text-left last:border-0"
                      >
                        <Icon name={cats.byId(sub.catId).icon} size={16} color="var(--m-ink-3)" />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                          {catName(cats.byId(sub.catId), t)}
                          <span className="ml-2 text-[11px] text-ink-4">{t('overview.transactions', { n: sub.count })}</span>
                        </span>
                        <span className="m-num text-[13px] font-medium text-ink">
                          {fmt(sub.totalCents, currency)}
                        </span>
                        <Icon name="chevron-right" size={14} color="var(--m-ink-4)" />
                      </button>
                    ))}
                  </div>
                </Collapse>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
