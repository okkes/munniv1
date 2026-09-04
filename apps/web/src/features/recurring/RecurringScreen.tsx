import { useEffect, useMemo, useState } from 'react';
import { attachScrollMemory } from '@/lib/scrollMemory';
import { useQuery } from '@/db/useQuery';
import { useNavigate } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useSpaceAccounts, useSpaceHistoryTransactions, useSpaceTransactions } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { localToday, useDismissedKeys, useRecurringOps, useRecurrings } from '@/application/recurring';
import { computeRange, monthlyRecurringSeries, summarize } from '@/domain/recurring';
import type { RecurringComputed } from '@/domain/recurring';
import { detectPriceChange, yearlyCents } from '@/domain/recurringPrice';
import { detectRecurring } from '@/domain/detectRecurring';
import type { RecurringRow } from '@/db/types';
import { looksLikeDebtCreditor } from '@/domain/detectDebts';
import { nextPeriod, periodHistory } from '@/domain/periods';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { RecurringFormSheet, emptyForm } from './RecurringFormSheet';
import type { FormState } from './RecurringFormSheet';
import { RecurringVisual, cadenceLabel } from './RecurringVisual';
import { HelpButton } from '@/features/help/HelpButton';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { Pill, ProgressBar } from '@/ui/primitives';
import { TxRow } from '@/ui/TxRow';
import { readRecurringView, writeRecurringView } from './recurringView';
import type { RecurringView } from './recurringView';
import { MultiLine } from '@/ui/charts/MultiLine';

/** linked-tx rows with their ids for the period sheet (#168 r2/r3) —
 *  structurally a superset of domain LinkedTx, so the same map feeds
 *  computeRange; the sheet resolves ids back to full rows */
interface ChartTx {
  id: string;
  date: string;
  amountCents: number;
}

/** #168 r5 (user): is this dot an ESTIMATE month (future)? Its sheet
 *  lists expected recurring costs instead of transactions — the chart
 *  door and the sheet body decide from the same fact */
const isEstimateMonth = (seriesIndex: number, monthIdx: number, chartYear: number, today: string): boolean =>
  seriesIndex === 0 && `${chartYear}-${String(monthIdx + 1).padStart(2, '0')}` > today.slice(0, 7);

export function RecurringScreen() {
  const { t, lang } = useLang();
  const { store, spaceId } = useData();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const recs = useRecurrings();
  const dismissed = useDismissedKeys();
  const txs = useSpaceTransactions();
  const ops = useRecurringOps();
  const navigate = useNavigate();

  // #188 (user): this year, next year and All join the range filter.
  // #168 r5 (user): the tab survives a detour into a transaction — the
  // module snapshot seeds it and every change writes back (#140 pattern)
  const [view, setView] = useState<RecurringView>(() => readRecurringView());
  const switchView = (next: RecurringView) => {
    writeRecurringView(next);
    setView(next);
  };
  const [formInitial, setFormInitial] = useState<FormState | null>(null);

  // pick up freshly imported payments the moment the screen opens
  useEffect(() => {
    void ops.reconcile().catch(() => undefined); // teardown-safe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const today = localToday();
  const currency = space?.currency ?? 'EUR';
  const { fmt } = useDisplayMoney();
  const money = (cents: number) => fmt(cents, currency);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });

  const period = useMemo(
    () => periodHistory(space?.periodType ?? 'month', space?.periodDay || 1, 1)[0],
    [space?.periodType, space?.periodDay],
  );
  const upcoming = useMemo(
    () => nextPeriod(space?.periodType ?? 'month', space?.periodDay || 1),
    [space?.periodType, space?.periodDay],
  );
  const thisYear = Number(today.slice(0, 4));
  let range = period;
  if (view === 'next') range = upcoming;
  // 'all' borrows this year's range for the paid math; its LIST skips
  // the occurrence filter below (every recurring shows, user #188)
  else if (view === 'year' || view === 'all') range = { start: `${thisYear}-01-01`, end: `${thisYear}-12-31` };
  else if (view === 'nextyear') range = { start: `${thisYear + 1}-01-01`, end: `${thisYear + 1}-12-31` };

  const linkedByRec = useMemo(() => {
    const map = new Map<string, ChartTx[]>();
    for (const tx of txs ?? []) {
      if (!tx.recurringId) continue;
      const list = map.get(tx.recurringId) ?? [];
      list.push({ id: tx.id, date: tx.date, amountCents: tx.amountCents });
      map.set(tx.recurringId, list);
    }
    return map;
  }, [txs]);

  // #189: occurrences before the space's start date are unknowable —
  // their payments are older than the space shows, so they must not
  // read as "not paid yet"
  const computed = useMemo(
    () => computeRange(recs ?? [], linkedByRec, range.start, range.end, today, space?.historyStartDate),
    [recs, linkedByRec, range.start, range.end, today, space?.historyStartDate],
  );
  const summary = summarize(computed.filter((c) => c.rec.active === 1));

  // detection reads the FULL stored history (user design 2026-08-01):
  // yearly patterns live in the pre-start tail the display gate hides
  const historyTxs = useSpaceHistoryTransactions();
  const spaceAccounts = useSpaceAccounts();
  const suggestionCount = useMemo(() => {
    if (!historyTxs || !recs || !dismissed) return 0;
    // #192: loans own their merchant keys like recurring rows do
    const exclude = new Set([
      ...dismissed,
      ...recs.flatMap((r) => (r.merchantKey ? [r.merchantKey] : [])),
      ...(spaceAccounts ?? []).flatMap((a) => (a.merchantKey ? [a.merchantKey] : [])),
    ]);
    // #192 r2: known-lender patterns surface on the DEBTS screen — the
    // banner must promise only what this inbox actually shows
    return detectRecurring(historyTxs, { excludeKeys: exclude, today }).filter((s) => !looksLikeDebtCreditor(s.name))
      .length;
  }, [historyTxs, recs, spaceAccounts, dismissed, today]);

  // #188 (user ss): a recurring shows only in ranges it actually
  // OCCURS in — a yearly due Jan 2027 belongs to "next year" alone.
  // 'all' lists everything; a stray in-range payment keeps a row too.
  const occursHere = (c: RecurringComputed) => view === 'all' || c.occurrences > 0 || c.paidCents > 0;
  const fixed = computed.filter((c) => c.rec.kind === 'fixed' && c.rec.active === 1 && occursHere(c));
  const subs = computed.filter((c) => c.rec.kind === 'subscription' && c.rec.active === 1 && occursHere(c));
  const inactive = computed.filter((c) => c.rec.active !== 1);
  const empty = (recs?.length ?? 0) === 0 && suggestionCount === 0;

  const subtitleFor = (c: RecurringComputed): string => {
    if (view === 'period' && c.paid) return t('recurring.paidThisPeriod');
    // custom cadences say their rhythm; plain monthly/yearly say the due day
    const custom = c.rec.every === 'week' || (c.rec.everyN ?? 1) > 1;
    const parts = [custom ? cadenceLabel(c.rec, t) : t('recurring.dueDay2', { day: c.rec.dueDay })];
    if (c.nextDue) parts.push(t('recurring.next', { date: fmtDate(c.nextDue) }));
    if (c.rec.until) parts.push(t('recurring.ends', { date: fmtDate(c.rec.until) }));
    return parts.join(' · ');
  };

  // the toggle filters by date range — label it with the actual dates,
  // not the "period" word (cadences are independent of the space period)
  const rangeLabelFor = (r: { start: string; end: string }): string => {
    if (r.start.slice(5) === '01-01' && r.end.slice(5) === '12-31' && r.start.slice(0, 4) === r.end.slice(0, 4))
      return r.start.slice(0, 4);
    const [y, m] = r.start.split('-').map(Number);
    const fullMonth =
      r.start.slice(8) === '01' &&
      r.end.slice(0, 7) === r.start.slice(0, 7) &&
      Number(r.end.slice(8)) === new Date(y, m, 0).getDate();
    if (fullMonth) return new Date(r.start).toLocaleDateString(LOCALES[lang], { month: 'long' });
    const fmtShort = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });
    return `${fmtShort(r.start)} – ${fmtShort(r.end)}`;
  };

  const renderRow = (c: RecurringComputed) => (
    <button
      key={c.rec.id}
      data-testid={`recurring-row-${c.rec.id}`}
      onClick={() => void navigate({ to: '/recurring/$recId', params: { recId: c.rec.id } })}
      className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-3 text-left last:border-0"
    >
      <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${c.paid && view === 'period' ? 'bg-accent-soft' : 'bg-bg-2'}`}>
        <RecurringVisual rec={c.rec} active={c.paid && view === 'period'} fill />
        {c.paid && view === 'period' && (
          <span className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white ring-2 ring-surface">
            <Icon name="check" size={9} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-medium text-ink">{c.rec.name}</span>
          {c.rec.luxury === 1 && (
            <Pill tone="accent" caps>
              {t('recurring.luxury')}
            </Pill>
          )}
          {/* S2: a sustained price change wears its delta openly */}
          {(() => {
            const change = detectPriceChange(linkedByRec.get(c.rec.id) ?? []);
            if (!change) return null;
            const up = change.toCents > change.fromCents;
            return (
              <Pill tone={up ? 'warning' : 'accent'} testId={`recurring-pricechange-${c.rec.id}`}>
                {up ? '+' : '−'}
                {money(Math.abs(change.toCents - change.fromCents))}
              </Pill>
            );
          })()}
        </span>
        <span className="block truncate text-[11px] text-ink-4">{subtitleFor(c)}</span>
      </span>
      <span className="text-right">
        <span className="block font-mono text-[14px] font-semibold text-ink">{money(c.effectiveCents)}</span>
        <span className="block font-mono text-[10px] text-ink-4">{t('recurring.perYear', { amount: money(yearlyCents(c.rec)) })}</span>
      </span>
      <Icon name="chevron-right" size={14} color="var(--m-ink-4)" />
    </button>
  );

  const section = (labelKey: 'recurring.fixed' | 'recurring.subs' | 'recurring.inactive', rows: RecurringComputed[]) =>
    rows.length > 0 && (
      <>
        <div className="m-cap mt-5 mb-1 px-1">
          {t(labelKey)} · {rows.length}
        </div>
        <div className={`overflow-hidden rounded-card border border-line bg-surface ${labelKey === 'recurring.inactive' ? 'opacity-60' : ''}`}>
          {rows.map(renderRow)}
        </div>
      </>
    );

  const progress = summary.totalCents > 0 ? Math.min(1, summary.paidCents / summary.totalCents) : 0;
  // #167: a future range has no payments — only its total is a fact
  const futureView = view === 'next' || view === 'nextyear';

  // #168 r2 (user): the year views plot the months — estimate from the
  // current period into the future, paid from the past up to it, and
  // every point is a tappable dot that opens its month's numbers
  const yearView = view === 'year' || view === 'nextyear';
  const chartYear = view === 'nextyear' ? thisYear + 1 : thisYear;
  const monthly = useMemo(
    () => (yearView ? monthlyRecurringSeries(recs ?? [], linkedByRec, chartYear, today, space?.historyStartDate) : null),
    [yearView, recs, linkedByRec, chartYear, today, space?.historyStartDate],
  );
  const nowMonthIdx = Number(today.slice(5, 7)) - 1;
  // #168 r4 (user): the vertical marker means the SPACE'S START — the
  // months left of it are untracked; outside the charted year, no marker
  const startDate = space?.historyStartDate;
  const startMonthIdx =
    startDate && Number(startDate.slice(0, 4)) === chartYear ? Number(startDate.slice(5, 7)) - 1 : undefined;
  const [selectedDot, setSelectedDot] = useState<{ seriesIndex: number; pointIndex: number } | null>(null);
  const [periodSheet, setPeriodSheet] = useState<{ seriesIndex: number; monthIdx: number } | null>(null);
  // a dot selection is meaningless on a different range's chart
  useEffect(() => {
    setSelectedDot(null);
    setPeriodSheet(null);
  }, [view]);
  const toggleDot = (seriesIndex: number, pointIndex: number) =>
    setSelectedDot((prev) =>
      prev?.seriesIndex === seriesIndex && prev?.pointIndex === pointIndex ? null : { seriesIndex, pointIndex },
    );
  const monthNameOf = (idx: number) => new Date(chartYear, idx, 1).toLocaleDateString(LOCALES[lang], { month: 'long' });
  const monthLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) =>
        i % 2 === 0 ? new Date(chartYear, i, 1).toLocaleDateString(LOCALES[lang], { month: 'short' }) : '',
      ),
    [chartYear, lang],
  );

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-recurring">
      <AppBar
        large
        title={t('screen.recurring')}
        trailing={
          <>
            <HelpButton tourId="recurring" />
            <IconButton label={t('recurring.add')} testId="recurring-add" onClick={() => setFormInitial(emptyForm())}>
              <Icon name="plus" size={22} />
            </IconButton>
          </>
        }
      />
      <div ref={(el) => attachScrollMemory(el, 'recurring')} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* date-range filter (#188): current range / next range / this
            year / next year / all — five tabs scroll when tight */}
        <div className="mt-1 flex overflow-x-auto rounded-xl bg-bg-2 p-0.5">
          {(
            [
              ['period', rangeLabelFor(period)],
              ['next', rangeLabelFor(upcoming)],
              ['year', String(thisYear)],
              ['nextyear', String(thisYear + 1)],
              ['all', t('recurring.viewAll')],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              data-testid={`recurring-view-${v}`}
              onClick={() => switchView(v)}
              className={`m-tap min-w-fit flex-1 rounded-[10px] border-none px-2.5 py-2 text-[12px] whitespace-nowrap ${
                view === v ? 'bg-surface font-semibold text-ink shadow-sm' : 'bg-transparent text-ink-3'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* detection inbox entry: one quiet notification, details behind it */}
        {suggestionCount > 0 && (
          <button
            data-testid="recurring-suggestions-banner"
            onClick={() => void navigate({ to: '/recurring/suggestions' })}
            className="m-tap mt-3 flex w-full items-center gap-3 rounded-card border border-accent bg-accent-soft/40 px-4 py-3 text-left"
          >
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface">
              <Icon name="creation" size={17} color="var(--m-accent-deep)" />
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
                {suggestionCount}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-ink">{t('recurring.detected')}</span>
              <span className="block text-[11px] text-ink-3">{t('recurring.detectedSub', { n: suggestionCount })}</span>
            </span>
            <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
          </button>
        )}

        {/* summary card — 'all' is not a date range, so the range-bound
            numbers stand down and only the honest annual figure stays.
            #167 (user): FUTURE ranges have no payments yet — paid and
            remaining would always parrot 0 and the total, so they and
            the progress bar stand down; only the total speaks. */}
        <div className="mt-3 rounded-card border border-line bg-surface p-4" data-testid="recurring-summary">
          {view !== 'all' && futureView && (
            <div data-testid="recurring-summary-future">
              <div className="text-[10px] font-semibold tracking-wide text-ink-4 uppercase">{t('recurring.total')}</div>
              <div className="mt-0.5 font-mono text-[15px] font-semibold text-ink">{money(summary.totalCents)}</div>
            </div>
          )}
          {view !== 'all' && !futureView && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ['recurring.total', summary.totalCents, 'var(--m-ink)'],
                    ['recurring.paid', summary.paidCents, 'var(--m-accent-deep)'],
                    ['recurring.remaining', summary.remainingCents, summary.remainingCents > 0 ? 'var(--m-warning)' : 'var(--m-accent-deep)'],
                  ] as const
                ).map(([key, cents, color]) => (
                  <div key={key}>
                    <div className="text-[10px] font-semibold tracking-wide text-ink-4 uppercase">{t(key)}</div>
                    <div className="mt-0.5 font-mono text-[15px] font-semibold" style={{ color }}>
                      {money(cents)}
                    </div>
                  </div>
                ))}
              </div>
              <ProgressBar className="mt-3" value={progress} />
            </>
          )}
          {/* subscription intelligence S1: the honest annual figure */}
          <div className={`${view === 'all' ? '' : 'mt-3 '}text-[11px] text-ink-3`} data-testid="recurring-year-total">
            {t('recurring.perYearTotal', {
              amount: money((recs ?? []).filter((r) => r.active === 1).reduce((sum, r) => sum + yearlyCents(r), 0)),
            })}
          </div>
          {view !== 'all' && summary.luxuryCents > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3" data-testid="recurring-luxury-line">
              <Pill tone="accent" caps>
                {t('recurring.luxury')}
              </Pill>
              {t('recurring.luxuryNote', {
                period: money(summary.luxuryCents),
                year: money(view === 'year' || view === 'nextyear' ? summary.luxuryCents : summary.luxuryCents * 12),
              })}
            </div>
          )}
        </div>

        {/* #168 r2 (user): both lines always draw and tapped dots surface
            their month. #168 r4: the marker sits on the space's start
            month — the lines' own paid/estimate split marks "now". */}
        {yearView && monthly && (
          <RecurringChartCard
            monthly={monthly}
            labels={monthLabels}
            nowIndex={chartYear === thisYear ? nowMonthIdx : undefined}
            markerIndex={startMonthIdx}
            selected={selectedDot}
            onSelect={toggleDot}
            onShowTxs={() => {
              if (selectedDot) setPeriodSheet({ seriesIndex: selectedDot.seriesIndex, monthIdx: selectedDot.pointIndex });
            }}
            // #168 r5 (user): an estimate month's door promises recurring
            // costs, not transactions — matching what the sheet will list
            estimateSelected={
              !!selectedDot && isEstimateMonth(selectedDot.seriesIndex, selectedDot.pointIndex, chartYear, today)
            }
            money={money}
            monthNameOf={monthNameOf}
          />
        )}

        {section('recurring.fixed', fixed)}
        {section('recurring.subs', subs)}
        {section('recurring.inactive', inactive)}

        {empty && (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center" data-testid="recurring-empty">
            <Icon name="autorenew" size={34} color="var(--m-ink-4)" />
            <p className="text-[14px] font-medium text-ink-2">{t('recurring.emptyTitle')}</p>
            <p className="text-[12px] text-ink-4">{t('recurring.emptyBody')}</p>
          </div>
        )}
      </div>

      <RecurringFormSheet initial={formInitial} onClose={() => setFormInitial(null)} />
      <PeriodTxSheet
        sel={periodSheet}
        chartYear={chartYear}
        recs={recs ?? []}
        linkedByRec={linkedByRec}
        today={today}
        floor={space?.historyStartDate}
        money={money}
        onClose={() => setPeriodSheet(null)}
      />
    </div>
  );
}

/** #168 r2 (user): the year chart card — passive legend, smoothed
 *  lines split at the current period, tapped dot's value + tx door */
function RecurringChartCard({
  monthly,
  labels,
  nowIndex,
  markerIndex,
  selected,
  onSelect,
  onShowTxs,
  estimateSelected,
  money,
  monthNameOf,
}: Readonly<{
  monthly: { expected: number[]; paid: number[] };
  labels: string[];
  /** current-month index (splits paid/estimate); undefined when the
   *  chart year is future */
  nowIndex?: number;
  /** #168 r4 (user): the space's start month — the vertical marker;
   *  undefined when the start falls outside the charted year */
  markerIndex?: number;
  selected: { seriesIndex: number; pointIndex: number } | null;
  onSelect: (seriesIndex: number, pointIndex: number) => void;
  onShowTxs: () => void;
  /** #168 r5 (user): the selected dot is an ESTIMATE month — the door
   *  promises recurring costs instead of transactions */
  estimateSelected: boolean;
  money: (cents: number) => string;
  monthNameOf: (idx: number) => string;
}>) {
  const { t } = useLang();
  // cents → euros keeps the shared scale honest across both lines;
  // estimate exists from now onward, paid up to now — overlap only at now.
  // #168 r3 (user): at now the estimate BORROWS paid's value, so it rises
  // smoothly out of the paid line's endpoint instead of shelving at its
  // own expected figure; paid owns the shared point's one dot
  const series = useMemo(
    () => [
      {
        values: monthly.expected.map((c, i) => {
          if (nowIndex === undefined) return c / 100;
          if (i < nowIndex) return null;
          return (i === nowIndex ? monthly.paid[i] : c) / 100;
        }),
        color: 'var(--m-ink-4)',
        dashed: true,
        skipDotAt: nowIndex,
      },
      {
        values: monthly.paid.map((c, i) => (nowIndex === undefined || i > nowIndex ? null : c / 100)),
        color: 'var(--m-accent)',
      },
    ],
    [monthly, nowIndex],
  );
  const selectedSeries = selected?.seriesIndex === 0 ? monthly.expected : monthly.paid;
  const selectedCents = selected ? selectedSeries[selected.pointIndex] : null;
  return (
    <div className="mt-3 rounded-card border border-line bg-surface p-4">
      <div className="mb-2 flex items-center gap-4 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-[2px] w-[14px] rounded opacity-70"
            style={{ backgroundImage: 'repeating-linear-gradient(90deg, var(--m-ink-4) 0 4px, transparent 4px 7px)' }}
          />
          {t('recurring.chartEstimate')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-[2px] w-[14px] rounded" style={{ background: 'var(--m-accent)' }} />
          {t('recurring.chartActual')}
        </span>
      </div>
      <MultiLine
        series={series}
        labels={labels}
        height={120}
        testId="recurring-chart"
        markerIndex={markerIndex}
        onPointClick={onSelect}
        selected={selected}
      />
      {selected !== null && selectedCents !== null && (
        <div className="mt-2 flex items-center justify-between gap-2" data-testid="recurring-chart-value">
          <span className="text-[12px] text-ink-2">
            {monthNameOf(selected.pointIndex)}
            <span
              className="ml-2 font-mono text-[13px] font-semibold"
              style={{ color: selected.seriesIndex === 0 ? 'var(--m-ink-2)' : 'var(--m-accent-deep)' }}
            >
              {money(selectedCents)}
            </span>
          </span>
          {/* #168 r4 (user): the door wears its arrow; r5: it names the
              story behind it — payments, or a future month's estimates */}
          <Button size="sm" variant="outline" data-testid="recurring-chart-txs" onClick={onShowTxs}>
            {t(estimateSelected ? 'recurring.showRecs' : 'recurring.showTxs')}
            <Icon name="chevron-right" size={14} color="var(--m-ink-4)" />
          </Button>
        </div>
      )}
    </div>
  );
}

/** #168 r2 (user): the tapped period's story — the linked transactions
 *  behind a paid number; a future estimate lists the expected items.
 *  #168 r3 (user): payments wear the standard TxRow face. #168 r5
 *  (user): the in-between peek is retired — a payment row travels
 *  STRAIGHT to the transaction page (chevron and all), mounted under
 *  /recurring so desktop keeps this list as the master pane; expected
 *  rows carry the recurring's own face and lead on to its detail. */
function PeriodTxSheet({
  sel,
  chartYear,
  recs,
  linkedByRec,
  today,
  floor,
  money,
  onClose,
}: Readonly<{
  sel: { seriesIndex: number; monthIdx: number } | null;
  chartYear: number;
  recs: readonly RecurringRow[];
  linkedByRec: ReadonlyMap<string, readonly ChartTx[]>;
  today: string;
  floor?: string;
  money: (cents: number) => string;
  onClose: () => void;
}>) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const txs = useSpaceTransactions();
  const monthIdx = sel?.monthIdx ?? 0;
  const monthKey = `${chartYear}-${String(monthIdx + 1).padStart(2, '0')}`;

  const active = useMemo(() => recs.filter((r) => r.active === 1), [recs]);
  const txById = useMemo(() => new Map((txs ?? []).map((tx) => [tx.id, tx] as const)), [txs]);
  const txRows = useMemo(() => {
    if (!sel) return [];
    const rows: SpaceTx[] = [];
    for (const rec of active) {
      for (const link of linkedByRec.get(rec.id) ?? []) {
        const row = link.date.startsWith(monthKey) ? txById.get(link.id) : undefined;
        if (row) rows.push(row);
      }
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [sel, active, linkedByRec, monthKey, txById]);

  // #168 r4 (user): the recurring's own page, reached from an expected row
  const openRec = (recId: string) => {
    onClose();
    void navigate({ to: '/recurring/$recId', params: { recId } });
  };
  // #168 r5 (user): straight to the transaction — under the recurring
  // tree, so lg keeps the recurring list beside it and mobile's back
  // returns to /recurring (pushed, never replaced)
  const openTx = (txId: string) => {
    onClose();
    void navigate({ to: '/recurring/tx/$txId', params: { txId } });
  };

  // an ESTIMATE dot in a future month has no payments yet — it lists
  // the expected recurring items for that month instead
  const futureEstimate = sel !== null && isEstimateMonth(sel.seriesIndex, monthIdx, chartYear, today);
  const expectedRows = useMemo(() => {
    if (!futureEstimate) return [];
    const lastDay = String(new Date(chartYear, monthIdx + 1, 0).getDate()).padStart(2, '0');
    return computeRange(active, linkedByRec, `${monthKey}-01`, `${monthKey}-${lastDay}`, today, floor).filter(
      (c) => c.occurrences > 0,
    );
  }, [futureEstimate, active, linkedByRec, monthKey, chartYear, monthIdx, today, floor]);

  return (
    <Sheet
      open={sel !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`${new Date(chartYear, monthIdx, 1).toLocaleDateString(LOCALES[lang], { month: 'long' })} ${chartYear}`}
      size="form"
    >
      <div data-testid="recurring-period-sheet" className="pt-1">
        {futureEstimate ? (
          // #168 r4 (user): an expected row wears the recurring's own
          // icon and is a door into its detail — arrow included
          expectedRows.map((c) => (
            <button
              key={c.rec.id}
              data-testid={`recurring-period-exp-${c.rec.id}`}
              onClick={() => openRec(c.rec.id)}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 py-2.5 text-left last:border-0"
            >
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bg-2">
                <RecurringVisual rec={c.rec} active={false} fill />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{c.rec.name}</span>
                <span className="block text-[11px] text-ink-4">{t('recurring.chartEstimate')}</span>
              </span>
              <span className="font-mono text-[13px] font-semibold text-ink">
                {c.occurrences > 1 ? `${c.occurrences}× ` : ''}
                {money(c.expectedCents)}
              </span>
              <Icon name="chevron-right" size={14} color="var(--m-ink-4)" />
            </button>
          ))
        ) : (
          <div className="divide-y divide-line-2">
            {txRows.map((tx) => (
              // #168 r5 (user): the row is a door to the transaction page
              // and wears the arrow like the expected rows do
              <div key={tx.id} data-testid={`recurring-period-tx-${tx.id}`} className="flex items-center">
                <div className="min-w-0 flex-1">
                  <TxRow tx={tx} showDate onClick={() => openTx(tx.id)} />
                </div>
                <Icon name="chevron-right" size={14} color="var(--m-ink-4)" />
              </div>
            ))}
          </div>
        )}
        {(futureEstimate ? expectedRows : txRows).length === 0 && (
          <p className="py-6 text-center text-[12px] text-ink-4" data-testid="recurring-period-empty">
            {t('recurring.periodNoTxs')}
          </p>
        )}
      </div>
    </Sheet>
  );
}
