import { useMemo, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { LOCALES, useLang } from '@/i18n';
import { LOCKED_MAIN_IDS } from '@/domain/categories';
import { useData } from '@/app/data';
import { useSpaceAccounts, useSpaceTransactions } from '@/application/transactions';
import { localToday } from '@/application/recurring';
import { periodHistory } from '@/domain/periods';
import { cashflowSeries, categorySeries, minIso, netWorthSeries } from '@/domain/trends';
import { catName, useCategories } from '@/features/categories/useCategories';
import { HelpButton } from '@/features/help/HelpButton';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Bars } from '@/ui/charts/Bars';
import { Line } from '@/ui/charts/Line';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

type View = 'categories' | 'cashflow' | 'networth';
const PERIOD_COUNT = 12;

/**
 * Trends (design T1/T2): per-category bars, income-vs-expense bars and
 * the reconstructed net-worth line — pure client-side domain work.
 */
export function TrendsScreen() {
  const { t, lang } = useLang();
  const { store, spaceId } = useData();
  const [view, setView] = useState<View>('categories');
  const [catId, setCatId] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);

  const txs = useSpaceTransactions();
  const accounts = useSpaceAccounts();
  const cats = useCategories();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const currency = space?.currency ?? 'EUR';
  const today = localToday();

  const periods = useMemo(
    () => periodHistory(space?.periodType ?? 'month', space?.periodDay ?? 1, PERIOD_COUNT),
    [space?.periodType, space?.periodDay],
  );
  // sparse labels: first, middle, last — the chart stays calm
  const labels = useMemo(
    () =>
      periods.map((period, i) =>
        i === 0 || i === periods.length - 1 || i === Math.floor(periods.length / 2)
          ? new Date(period.start).toLocaleDateString(LOCALES[lang], { month: 'short' })
          : '',
      ),
    [periods, lang],
  );

  const catValues = useMemo(
    () => (view === 'categories' ? categorySeries(txs ?? [], periods, cats, catId) : []),
    [view, txs, periods, cats, catId],
  );
  const catAverage = useMemo(() => {
    const done = catValues.slice(0, -1).filter((v) => v > 0);
    return done.length ? Math.round(done.reduce((a, b) => a + b, 0) / done.length) : 0;
  }, [catValues]);

  const flow = useMemo(
    () => (view === 'cashflow' ? cashflowSeries(txs ?? [], periods) : []),
    [view, txs, periods],
  );

  const worth = useMemo(() => {
    if (view !== 'networth') return [];
    // a running period samples "now", finished ones their end
    const dates = periods.map((p) => minIso(p.end, today));
    return netWorthSeries(accounts ?? [], txs ?? [], dates);
  }, [view, accounts, txs, periods, today]);

  const selected = catId ? cats.byId(catId) : undefined;
  const { fmt: fmtLens } = useDisplayMoney();
  const fmt = (cents: number, opts?: { sign?: boolean }) => fmtLens(cents, currency, opts);
  const periodAria = (i: number, cents: number) =>
    `${new Date(periods[i].start).toLocaleDateString(LOCALES[lang], { month: 'long', year: 'numeric' })}: ${fmt(cents)}`;

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-trends">
      <AppBar
        title={t('trends.title')}
        leading={
          <IconButton label={t('action.back')} testId="trends-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
        trailing={<HelpButton tourId="trends" />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <div className="mt-1 flex rounded-xl bg-bg-2 p-0.5">
          {(
            [
              ['categories', t('trends.viewCategories')],
              ['cashflow', t('trends.viewCashflow')],
              ['networth', t('trends.viewNetworth')],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              data-testid={`trends-view-${value}`}
              onClick={() => setView(value)}
              className={`m-tap flex-1 rounded-[10px] border-none py-2 text-[12px] whitespace-nowrap ${
                view === value ? 'bg-surface font-semibold text-ink shadow-sm' : 'bg-transparent text-ink-3'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'categories' && (
          <>
            <button
              data-testid="trends-cat-picker"
              onClick={() => setPickerOpen(true)}
              className="m-tap mt-3 flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
            >
              <Icon name={selected?.icon ?? 'shape-outline'} size={19} color={selected?.color ?? 'var(--m-ink-3)'} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
                {selected ? catName(selected, t) : t('trends.allExpenses')}
              </span>
              <Icon name="chevron-down" size={17} color="var(--m-ink-4)" />
            </button>
            <div className="mt-4 rounded-card border border-line bg-surface p-4">
              <Bars
                testId="trends-cat-chart"
                values={catValues}
                labels={labels}
                ariaLabels={catValues.map((v, i) => periodAria(i, v))}
                color={selected?.color ?? 'var(--m-accent)'}
                hollowLast
                average={catAverage}
              />
              <div className="mt-2 flex items-baseline justify-between text-[11px] text-ink-4">
                <span>{t('trends.avgLine', { amount: fmt(catAverage) })}</span>
                <span data-testid="trends-cat-current">{t('trends.thisPeriod', { amount: fmt(catValues.at(-1) ?? 0) })}</span>
              </div>
            </div>
          </>
        )}

        {view === 'cashflow' && (
          <div className="mt-4 rounded-card border border-line bg-surface p-4">
            <Bars
              testId="trends-flow-chart"
              values={flow.map((point) => point.incomeCents)}
              negativeValues={flow.map((point) => point.expenseCents)}
              labels={labels}
              ariaLabels={flow.map(
                (point, i) => `${periodAria(i, point.netCents)} (${fmt(point.incomeCents)} − ${fmt(point.expenseCents)})`,
              )}
              color="var(--m-accent)"
              hollowLast
            />
            <div className="mt-2 flex items-center gap-4 text-[11px] text-ink-4">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-accent" /> {t('overview.income')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-negative" /> {t('overview.expense')}
              </span>
              <span className="ml-auto" data-testid="trends-flow-net">
                {t('trends.netThisPeriod', { amount: fmt(flow.at(-1)?.netCents ?? 0, { sign: true }) })}
              </span>
            </div>
          </div>
        )}

        {view === 'networth' && (
          <div className="mt-4 rounded-card border border-line bg-surface p-4">
            <Line
              testId="trends-worth-chart"
              values={worth.map((point) => point.cents)}
              labels={labels}
              color="var(--m-accent-deep)"
            />
            <div className="mt-2 flex items-baseline justify-between text-[11px] text-ink-4">
              <span>{t('trends.worthNote')}</span>
              <span className="m-num text-[13px] font-semibold text-ink" data-testid="trends-worth-now">
                {fmt(worth.at(-1)?.cents ?? 0)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* main/sub picker: mains first, tapping a main offers its subs */}
      <Sheet open={pickerOpen} onOpenChange={setPickerOpen} title={t('trends.pickCategory')} size="tall" dragHandle>
        <div data-testid="trends-cat-list">
          <button
            data-testid="trends-cat-all"
            onClick={() => {
              setCatId(undefined);
              setPickerOpen(false);
            }}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink"
          >
            <Icon name="shape-outline" size={18} color="var(--m-ink-3)" />
            <span className="flex-1">{t('trends.allExpenses')}</span>
            {catId === undefined && <Icon name="check" size={16} color="var(--m-accent-deep)" />}
          </button>
          {cats.parents
            .filter((parent) => parent.txTypes.includes('expense') && !LOCKED_MAIN_IDS.has(parent.id))
            .map((parent) => (
              <div key={parent.id}>
                <button
                  data-testid={`trends-cat-${parent.id}`}
                  onClick={() => {
                    setCatId(parent.id);
                    setPickerOpen(false);
                  }}
                  className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink"
                >
                  <Icon name={parent.icon} size={18} color={parent.color} />
                  <span className="flex-1 font-medium">{catName(parent, t)}</span>
                  {catId === parent.id && <Icon name="check" size={16} color="var(--m-accent-deep)" />}
                </button>
                {catId && (catId === parent.id || cats.byId(catId).parentId === parent.id) &&
                  cats.childrenOf(parent.id).map((sub) => (
                    <button
                      key={sub.id}
                      data-testid={`trends-cat-${sub.id}`}
                      onClick={() => {
                        setCatId(sub.id);
                        setPickerOpen(false);
                      }}
                      className="m-tap flex w-full items-center gap-3 border-b border-line-2 py-2.5 pr-1 pl-8 text-left text-[13px] text-ink-2"
                    >
                      <Icon name={sub.icon} size={16} color={parent.color} />
                      <span className="flex-1">{catName(sub, t)}</span>
                      {catId === sub.id && <Icon name="check" size={15} color="var(--m-accent-deep)" />}
                    </button>
                  ))}
              </div>
            ))}
        </div>
      </Sheet>
    </div>
  );
}
