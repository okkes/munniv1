import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate } from '@tanstack/react-router';
import { useSpaceAccounts, useSpaceTransactions } from '@/application/transactions';
import { localToday } from '@/application/recurring';
import { OVERVIEW_KINDS, overviewSummary } from '@/domain/overview';
import type { OverviewKind, OverviewSummary } from '@/domain/overview';
import { periodHistory } from '@/domain/periods';
import { addDays } from '@/domain/recurring';
import {
  upcomingHorizon,
  upcomingLoanAmountCents,
  upcomingLoanPayments,
  upcomingRecAmountCents,
  upcomingRecurrings,
} from '@/domain/upcoming';
import { RecurringVisual } from '@/features/recurring/RecurringVisual';
import { LoanFace } from './UpcomingScreen';
import { LOCALES, useLang } from '@/i18n';
import type { TFunc, TranslationKey } from '@/i18n';
import { useSession } from '@/app/session';
import { useTopSplit } from '@/features/splits/useTopSplit';
import { useData } from '@/app/data';
import { OfflineIndicator } from '@/app/OfflineBanner';
import { HelpButton } from '@/features/help/HelpButton';
import { InstallHint } from '@/features/help/InstallHint';
import { UpdateCard } from './UpdateCard';
import { NotificationsBell } from './NotificationsBell';
import { eventPicture } from '@/features/events/EventsScreen';
import { resolveHomeBlocks } from './HomeCustomizeScreen';
import type { HomeBlockId } from './HomeCustomizeScreen';
import { SpaceSwitcher } from '@/features/spaces/SpaceSwitcher';
import { useCategories } from '@/features/categories/useCategories';
import { safeToSpend } from '@/domain/cashflow';
import { BAND_MODES, bandEditable, bandEligible, bandIncludes, bandModeOf } from '@/domain/balanceBand';
import { minIso, netWorthSeries } from '@/domain/trends';
import { Line } from '@/ui/charts/Line';
import { cleanBankText } from '@/lib/text';
import { Sheet } from '@/ui/Sheet';
import { useBudgetStatuses, useBudgets } from '@/application/budgets';
import { useEvents } from '@/application/events';
import { useGoals } from '@/application/goals';
import { useLoanStatuses } from '@/application/debts';
import { useAllocations } from '@/application/allocation';
import { useInsights } from '@/application/insights';
import { useNewTransactions } from '@/application/newTxs';
import { eventSpentCents } from '@/domain/events';
import { goalProgress } from '@/domain/goals';
import { debtsOverview } from '@/domain/debts';
import { toAllocateCents } from '@/domain/allocation';
import { budgetColor, ratioPct } from '@/features/budgets/budgetUi';
import { budgetDaysLeft } from '@/domain/budgets';
import { fmtCents } from '@/lib/money';
import { sumCents } from '@/lib/rates';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { setDisplayCurrency } from '@/features/currency/displayCurrencyPref';
import { CURRENCIES } from '@/domain/countries';
import { AppBar } from '@/ui/AppBar';
import { Icon } from '@/ui/Icon';
import { ProgressBar, Tile } from '@/ui/primitives';
import { TxRow } from '@/ui/TxRow';
import { presetTxFilters } from '@/features/transactions/txFilters';
import { TxFormSheet } from '@/features/transactions/TxFormSheet';
import { StatementImportFlow } from '@/features/accounts/StatementImportFlow';
import { setCategoriesCreateIntent } from '@/features/categories/categoriesHandoff';
import { setSpaceAddAccountIntent } from '@/features/spaces/spaceAccountsHandoff';
import { setFriendsAddIntent } from '@/features/friends/friendsHandoff';
import { setSpacesCreateIntent } from '@/features/spaces/spacesHandoff';

const TILE_META: Record<OverviewKind, { icon: string; color: string; field: keyof OverviewSummary; signed?: boolean }> = {
  income: { icon: 'cash-plus', color: 'var(--m-accent)', field: 'incomeCents' },
  expense: { icon: 'cash-remove', color: 'var(--m-negative)', field: 'expenseCents' },
  saving: { icon: 'piggy-bank-outline', color: 'var(--m-warning)', field: 'savingCents' },
  investment: { icon: 'chart-timeline-variant', color: 'var(--m-special)', field: 'investmentCents' },
  // signed: contributing to a pot is green, drawing from it is red; a
  // borrowing-heavy period flips Repaid the same way (user rule 2026-08-01)
  funding: { icon: 'hand-coin', color: 'var(--m-accent-deep)', field: 'fundingCents', signed: true },
  debt: { icon: 'hand-coin-outline', color: 'var(--m-special)', field: 'debtCents', signed: true },
};

/** signed tiles color their VALUE by direction; the rest stay plain ink */
const tileValueClass = (kind: OverviewKind, cents: number): string => {
  if (!TILE_META[kind].signed) return 'text-ink';
  return cents < 0 ? 'text-negative' : 'text-accent-deep';
};

/** #327 r3 (user): the square tiles sit inside the card's rounded
 *  overflow-hidden frame — each corner tile owns the card's corner so
 *  the inset focus ring hugs the visible shape instead of being sliced */
const tileCorners = (i: number, len: number): string =>
  [i === 0 && 'rounded-tl-card', i === 1 && 'rounded-tr-card', i === len - 2 && 'rounded-bl-card', i === len - 1 && 'rounded-br-card']
    .filter(Boolean)
    .join(' ');

/** #313 (user): a sparse desktop home keeps ONE centered column — the
 *  block width the user liked (~720px) with emptiness on both sides */
const SINGLE_COLUMN_LG = 'lg:mx-auto lg:max-w-[720px]';

/** #313 (user ss): unused blocks render null (their door lives inside
 *  Explore), so counting CONFIGURED blocks kept a broken half-empty grid
 *  on nearly empty homes — only blocks that actually render earn a
 *  column (#155's bar of four). While the core data still loads the
 *  configured count stands in, so a content-rich home does not flash
 *  single-column on arrival. Out of the component for S3776. */
function resolveRenderedBlocks(
  visible: { id: HomeBlockId }[],
  renderers: Record<HomeBlockId, () => React.ReactNode>,
  dataReady: boolean,
): { rendered: { id: HomeBlockId; node: React.ReactNode }[]; twoColumns: boolean } {
  const rendered = visible
    .map((entry) => ({ id: entry.id, node: renderers[entry.id]() }))
    .filter((entry) => entry.node !== null);
  const contentCount = dataReady ? rendered.length : visible.length;
  return { rendered, twoColumns: contentCount >= 4 };
}

/** a block's teaser descriptor (#121) — present only while the feature
 *  is unused AND its data has loaded enough to know */
interface TeaserDesc {
  icon: string;
  titleKey: TranslationKey;
  subKey: TranslationKey;
  to: string;
  testId: string;
}

/** #121: which blocks are in their unused/teaser state right now — the
 *  conditions mirror each block's own teaser branch. Out of the
 *  component for S3776. */
function buildTeaserMap(state: {
  hasBudgets: boolean;
  identityKind: string | undefined;
  topSplit: unknown;
  eventsLoaded: boolean;
  featuredEvent: unknown;
  goalsLoaded: boolean;
  topGoalsCount: number;
  debtsLoaded: boolean;
  activeDebtsCount: number;
}): Partial<Record<HomeBlockId, TeaserDesc>> {
  const map: Partial<Record<HomeBlockId, TeaserDesc>> = {};
  if (!state.hasBudgets) {
    map.budgets = { icon: 'wallet-outline', titleKey: 'home.budgetsTeaserTitle', subKey: 'home.budgetsTeaserSub', to: '/budgets', testId: 'home-budgets-teaser' };
  }
  if (state.identityKind === 'user' && state.topSplit === null) {
    map.splits = { icon: 'account-cash-outline', titleKey: 'home.splitsTeaserTitle', subKey: 'home.splitsTeaserSub', to: '/splits', testId: 'home-splits-teaser' };
  }
  if (state.eventsLoaded && !state.featuredEvent) {
    map.events = { icon: 'party-popper', titleKey: 'home.eventsTeaserTitle', subKey: 'home.eventsTeaserSub', to: '/events', testId: 'home-events-teaser' };
  }
  if (state.goalsLoaded && state.topGoalsCount === 0) {
    map.goals = { icon: 'flag-outline', titleKey: 'home.goalsTeaserTitle', subKey: 'home.goalsTeaserSub', to: '/goals', testId: 'home-goals-teaser' };
  }
  if (state.debtsLoaded && state.activeDebtsCount === 0) {
    map.debts = { icon: 'hand-coin-outline', titleKey: 'home.debtsTeaserTitle', subKey: 'home.debtsTeaserSub', to: '/debts', testId: 'home-debts-teaser' };
  }
  return map;
}

/** the fixed row order inside Explore (the features that can teaser) */
const EXPLORE_FEATURES: readonly HomeBlockId[] = ['budgets', 'goals', 'debts', 'events', 'splits'];

/** #121 v2: Explore is a first-class block — it lives in Customize Home
 *  like any other, so the user orders and hides it themselves. It lists
 *  every feature the space hasn't used yet as a one-line door and
 *  disappears once everything is in use. The standalone dashed teaser
 *  cards retired with it. Out of the component for S3776. */
function renderExploreList(
  teaserOf: Partial<Record<HomeBlockId, TeaserDesc>>,
  go: (to: string) => void,
  t: TFunc,
): React.ReactNode {
  const ids = EXPLORE_FEATURES.filter((id) => teaserOf[id]);
  if (ids.length === 0) return null;
  return (
    <div className="mt-5" data-testid="home-explore">
      <div className="m-cap mb-1 px-1">{t('home.exploreTitle')}</div>
      <div className="overflow-hidden rounded-card border border-dashed border-line bg-surface">
        {ids.map((eid) => {
          const row = teaserOf[eid]!;
          return (
            <button
              key={eid}
              data-testid={`home-explore-${eid}`}
              onClick={() => go(row.to)}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-2.5 text-left last:border-0"
            >
              <Icon name={row.icon} size={17} color="var(--m-accent-deep)" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{t(row.titleKey)}</span>
                <span className="block truncate text-[11px] text-ink-4">{t(row.subKey)}</span>
              </span>
              <Icon name="chevron-right" size={14} color="var(--m-ink-4)" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function HomeScreen() {
  const { t, lang } = useLang();
  const { store, repo, spaceId } = useData();
  const navigate = useNavigate();
  const identity = useSession((s) => s.identity);
  const topSplit = useTopSplit();
  const [accountsOpen, setAccountsOpen] = useState(false);
  // #180: the quick-add speed dial + its two in-place hosts
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTxOpen, setQuickTxOpen] = useState(false);
  const [quickImportOpen, setQuickImportOpen] = useState(false);

  const accounts = useSpaceAccounts();
  const allTxs = useSpaceTransactions();
  const cats = useCategories();
  const { newTxs } = useNewTransactions(allTxs);
  const reviewCount = useMemo(() => allTxs?.filter((tx) => tx.needsReview === 1).length, [allTxs]);

  const needsOnboarding = useQuery(store, async () => store.metaGet('needsOnboarding'), []);
  useEffect(() => {
    if (needsOnboarding?.value === true) void navigate({ to: '/onboarding' });
  }, [needsOnboarding, navigate]);

  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const currency = space?.currency ?? accounts?.[0]?.currency ?? 'EUR';
  // the band total is convert-then-sum (currency plan): into the display
  // currency when set, else the ledger currency — no more silent numeric
  // mixing of differing account currencies; conversions say ≈
  const { display, fmt, displayCurrency } = useDisplayMoney();
  const [lensOpen, setLensOpen] = useState(false);
  const bandCurrency = display?.currency ?? currency;
  // the band's MEANING is a per-space choice now (user design
  // 2026-08-01): net worth (default, the old behavior), liquid cash,
  // safe-to-spend, or a hand-picked account set — with per-account
  // exclusions where they make sense
  const bandMode = bandModeOf(space);
  const bandTotal = useMemo(
    () =>
      sumCents(
        (accounts ?? [])
          .filter((a) => bandIncludes(bandMode, a, space))
          .map((a) => ({ cents: a.balanceCents, currency: a.currency })),
        bandCurrency,
        display?.cache.days.latest,
        display?.manual,
      ),
    [accounts, bandCurrency, display, bandMode, space],
  );
  const period = useMemo(
    () => periodHistory(space?.periodType ?? 'month', space?.periodDay ?? 1, 1)[0],
    [space?.periodType, space?.periodDay],
  );
  const summary = useMemo(() => {
    const accountsById = new Map((accounts ?? []).map((a) => [a.id, a]));
    return overviewSummary(allTxs ?? [], accountsById, period);
  }, [allTxs, accounts, period]);
  const fmtShort = (iso: string) =>
    new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });

  // landing-zone block: recurring costs due within a week (user decision:
  // the home block shows only the upcoming ones; the tab has the rest)
  const recurrings = useQuery(
    store,
    async () => (await store.bySpace('recurring', spaceId)).filter((r) => r.deleted === 0 && r.active === 1),
    [spaceId],
  );
  // landing-zone block: the 3 most urgent budgets (approved: 3)
  const budgetStatuses = useBudgetStatuses();
  const budgets = useBudgets();
  const urgentBudgets = useMemo(() => (budgetStatuses ?? []).slice(0, 3), [budgetStatuses]);
  const hasBudgets = (budgets?.length ?? 0) > 0;
  // #334 (user): the row-building is shared with the /upcoming see-all
  // landing (domain/upcoming) so block and landing can never drift
  const upcoming = useMemo(() => {
    const today = localToday();
    return upcomingRecurrings(recurrings ?? [], today, addDays(today, 7)).slice(0, 4);
  }, [recurrings]);
  // #266 (user): loan payment plans join the coming-up story — same
  // horizon, clearly labeled so recurring vs debt reads apart
  const upcomingDebts = useMemo(() => {
    const today = localToday();
    return upcomingLoanPayments(accounts ?? [], today, addDays(today, 7)).slice(0, 3);
  }, [accounts]);
  // #334 r2 (user): the see-all door only earns its place when the
  // landing (uncapped, period-wide — same shared builders + window)
  // would list MORE rows than the block already shows
  const upcomingHasMore = useMemo(() => {
    const today = localToday();
    const horizon = upcomingHorizon(space, today);
    const landingCount =
      upcomingRecurrings(recurrings ?? [], today, horizon).length +
      upcomingLoanPayments(accounts ?? [], today, horizon).length;
    return landingCount > upcoming.length + upcomingDebts.length;
  }, [space, recurrings, accounts, upcoming, upcomingDebts]);

  // landing-zone blocks that only appear once the feature is in use.
  // one event only: running now, else the next upcoming, else the latest
  const events = useEvents();
  const featuredEvent = useMemo(() => {
    const today = localToday();
    const active = (events ?? []).filter((e) => e.archived !== 1);
    const running = active.find((e) => e.from && e.from <= today && (!e.to || e.to >= today));
    if (running) return running;
    const upcoming = active
      .filter((e) => e.from && e.from > today)
      .sort((a, b) => a.from!.localeCompare(b.from!))[0];
    if (upcoming) return upcoming;
    return active[0];
  }, [events]);
  const goals = useGoals();
  const topGoals = useMemo(
    () =>
      (goals ?? [])
        .filter((g) => g.archived !== 1)
        .sort((a, b) => goalProgress(b) - goalProgress(a))
        .slice(0, 2),
    [goals],
  );
  const debtStatuses = useLoanStatuses();
  const activeDebts = useMemo(() => (debtStatuses ?? []).filter((s) => s.account.archived !== 1), [debtStatuses]);
  const debtTotals = useMemo(() => debtsOverview(activeDebts.map((s) => s.account)), [activeDebts]);
  // insights block: the top undismissed finding
  const insights = useInsights();
  // allocation block: only once the space actually allocates
  const allocations = useAllocations();
  const allocLeft = useMemo(() => {
    if (!allocations?.length) return null;
    const history = periodHistory(space?.periodType ?? 'month', space?.periodDay ?? 1, 24);
    const starts = new Set(allocations.map((a) => a.periodStart));
    const first = history.findIndex((p) => starts.has(p.start));
    const window = first === -1 ? history.slice(-1) : history.slice(first);
    const accountsById = new Map((accounts ?? []).map((a) => [a.id, a]));
    return toAllocateCents(window, allTxs ?? [], accountsById, allocations);
  }, [allocations, space?.periodType, space?.periodDay, allTxs, accounts]);

  // cash-flow forecast (F1): shows nothing rather than a wrong number
  const forecast = useMemo(() => {
    if (!accounts || !allTxs || !recurrings) return null;
    return safeToSpend({
      accounts,
      txs: allTxs,
      recurrings,
      allocations,
      catalog: cats,
      period,
      today: localToday(),
    });
  }, [accounts, allTxs, recurrings, allocations, cats, period]);
  const [forecastOpen, setForecastOpen] = useState(false);

  // #142 (user): only "Picked accounts" takes toggles — its include list
  const toggleBandAccount = async (accountId: string) => {
    if (!bandEditable(bandMode)) return;
    // read the row FRESH: two quick toggles from the render-stale space
    // object dropped the first write (review finding)
    const live = await store.get('space', spaceId);
    if (!live) return;
    const current = live.balanceBandAccounts ?? [];
    const next = current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId];
    await repo.upsert('space', spaceId, spaceId, { balanceBandAccounts: next });
  };

  // spendable rides the forecast (ledger currency, no conversion lens);
  // no payday/liquid yet → an honest dash beats a wrong number
  const spendableBand = bandMode === 'spendable';
  const bandCents = spendableBand ? (forecast?.cents ?? null) : bandTotal.cents;
  const bandApprox = !spendableBand && bandTotal.approximate ? '≈ ' : '';
  const bandShownCurrency = spendableBand ? currency : bandCurrency;
  const bandLabel = bandCents === null ? '—' : `${bandApprox}${fmtCents(bandCents, bandShownCurrency, lang)}`;

  // each landing-zone block renders through this registry so the
  // per-space layout (order + visibility) can rearrange them
  const blockRenderers: Record<HomeBlockId, () => React.ReactNode> = {
    review: renderReviewBlock,
    cashflow: renderCashflowBlock,
    networth: renderNetworthBlock,
    overview: renderOverviewBlock,
    transactions: renderTransactionsBlock,
    explore: () => renderExploreList(teaserOf, (to) => void navigate({ to }), t),
    budgets: renderBudgetsBlock,
    allocation: renderAllocationBlock,
    upcoming: renderUpcomingBlock,
    goals: renderGoalsBlock,
    debts: renderDebtsBlock,
    events: renderEventsBlock,
    splits: renderSplitsBlock,
    insights: renderInsightsBlock,
  };
  const layout = resolveHomeBlocks(space);
  const visibleBlocks = layout.filter((entry) => !entry.hidden);

  // #121 v2: the unused/teaser states, resolved in one place (module fn)
  const teaserOf = buildTeaserMap({
    hasBudgets,
    identityKind: identity?.kind,
    topSplit,
    eventsLoaded: !!events,
    featuredEvent,
    goalsLoaded: !!goals,
    topGoalsCount: topGoals.length,
    debtsLoaded: !!debtStatuses,
    activeDebtsCount: activeDebts.length,
  });

  // #313 (user ss): the columns follow what actually RENDERS — see
  // resolveRenderedBlocks (#155: the split earns its keep with 4+)
  const { rendered: renderedBlocks, twoColumns } = resolveRenderedBlocks(visibleBlocks, blockRenderers, allTxs !== undefined);

  return (
    <div className="m-fade relative flex h-full flex-col" data-testid="screen-home">
      {/* ≤3 trailing actions (redesign §2H): customize moved to the end of
          the block list, where the blocks actually live */}
      <AppBar
        large
        title={t('tab.home')}
        trailing={
          <>
            <OfflineIndicator />
            <NotificationsBell />
            <HelpButton tourId="home" />
            <SpaceSwitcher />
          </>
        }
      />
      {/* #180 (user): the quick-add speed dial — one floating door to the
          six most common creations, in the user's stated order */}
      <button
        data-testid="home-fab"
        aria-label={t('home.quickAdd')}
        onClick={() => setQuickOpen(true)}
        className="m-tap absolute right-4 bottom-4 z-30 flex h-14 w-14 items-center justify-center rounded-full border-none bg-brand text-on-brand shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
      >
        <Icon name="plus" size={26} />
      </button>
      <Sheet open={quickOpen} onOpenChange={setQuickOpen} title={t('home.quickAdd')} size="form">
        <div className="flex flex-col pt-1" data-testid="home-quick-sheet">
          {(
            [
              ['tx', 'receipt-text-plus-outline', () => setQuickTxOpen(true)],
              ['import', 'file-upload-outline', () => setQuickImportOpen(true)],
              ['category', 'shape-plus-outline', () => {
                setCategoriesCreateIntent();
                void navigate({ to: '/categories' });
              }],
              ['account', 'bank-plus', () => {
                setSpaceAddAccountIntent();
                void navigate({ to: '/spaces/$spaceId/accounts', params: { spaceId } });
              }],
              ['friend', 'account-plus-outline', () => {
                setFriendsAddIntent();
                void navigate({ to: '/friends' });
              }],
              ['space', 'home-plus-outline', () => {
                setSpacesCreateIntent();
                void navigate({ to: '/spaces' });
              }],
            ] as const
          ).map(([id, icon, go]) => (
            <button
              key={id}
              data-testid={`home-quick-${id}`}
              onClick={() => {
                setQuickOpen(false);
                go();
              }}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-1 py-3.5 text-left text-[15px] text-ink last:border-0"
            >
              <Icon name={icon} size={20} color="var(--m-accent-deep)" />
              {t(`home.quick.${id}`)}
            </button>
          ))}
        </div>
      </Sheet>
      {/* the FAB's in-place hosts — sheets are siblings (#241 rule) */}
      <TxFormSheet open={quickTxOpen} onOpenChange={setQuickTxOpen} />
      <StatementImportFlow open={quickImportOpen} onOpenChange={setQuickImportOpen} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* desktop ruling (§4.4) + D4: strict two-column split — the
            balance heads the left column (a 1040px band saying one number
            wasted the width), the nudges head the right; on mobile the
            grid dissolves and the DOM order is balance → nudges → blocks.
            #155 (user ss): with only a couple of blocks the split read
            as broken — sparse homes keep ONE centered column instead
            (#313: centered on what actually RENDERS, a bit wider) */}
        <div
          data-testid="home-columns"
          className={twoColumns ? 'lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6' : SINGLE_COLUMN_LG}
        >
          {/* slim balance band: one line; accounts fold out on tap. The
              fold-out lives BESIDE the header button (nested buttons are
              invalid HTML — the quick lens toggle needs its own) */}
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <div className="w-full rounded-card bg-brand px-5 py-4 text-on-brand">
              <button
                data-testid="home-balance-band"
                onClick={() => setAccountsOpen((v) => !v)}
                className="m-tap w-full border-none bg-transparent p-0 text-left text-on-brand"
              >
                <div className="flex items-baseline justify-between gap-3">
                  {/* the heading names what the number IS (mode-aware) */}
                  <span className="text-xs font-medium tracking-wider uppercase opacity-70" data-testid="band-mode-label">
                    {t(`home.band.${bandMode}`)}
                  </span>
                  <Icon name={accountsOpen ? 'chevron-up' : 'chevron-down'} size={16} color="currentColor" />
                </div>
                <div className="m-num mt-0.5 text-[28px]" data-testid="home-total-balance">
                  {accounts ? bandLabel : '—'}
                </div>
              </button>
              {accountsOpen && (
                <>
                  {/* what the number means — switching persists per space */}
                  <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="band-mode-row">
                    {BAND_MODES.map((m) => (
                      <button
                        key={m}
                        data-testid={`band-mode-${m}`}
                        onClick={() => void repo.upsert('space', spaceId, spaceId, { balanceBandMode: m })}
                        className={`m-tap rounded-full border px-3 py-1 text-[11px] font-semibold ${
                          bandMode === m ? 'border-on-brand bg-on-brand/20 text-on-brand' : 'border-on-brand/30 bg-transparent text-on-brand/70'
                        }`}
                      >
                        {t(`home.band.${m}`)}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-col gap-1" data-testid="home-balance-accounts">
                    {(accounts ?? []).map((a) => {
                      const included = bandIncludes(bandMode, a, space);
                      return (
                        <div key={a.id} className={`flex items-center gap-2 text-[13px] ${included ? 'opacity-90' : 'opacity-45'}`}>
                          {/* #142 (user): the premade modes are read-only —
                              only Picked accounts offers the checkboxes */}
                          {bandEditable(bandMode) && bandEligible(bandMode, a) && (
                            <input
                              data-testid={`band-acct-${a.id}`}
                              type="checkbox"
                              checked={included}
                              onChange={() => void toggleBandAccount(a.id)}
                              className="h-4 w-4 shrink-0 accent-[var(--m-bg)]"
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate">{a.name}</span>
                          <span className="m-num">{fmt(a.balanceCents, a.currency)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {/* quick display-currency lens (currency plan CD4) */}
                  <button
                    data-testid="band-display-toggle"
                    onClick={() => setLensOpen(true)}
                    className="m-tap mt-2.5 flex w-full items-center gap-2 border-none bg-transparent p-0 text-left text-[12px] opacity-80"
                  >
                    <Icon name="cash-multiple" size={14} color="currentColor" />
                    <span className="flex-1">{t('profile.displayCurrency')}</span>
                    <span className="font-mono font-semibold">{displayCurrency ?? t('profile.displayCurrencyAsRecorded')}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* first nudge loses its own top margin at lg so both column
              tops sit level with the balance card */}
          {/* release news moved into the bell's Notifications tab (arc 6)
              — the Home banner retired */}
          <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:[&>*:first-child]:mt-0">
            <UpdateCard />
            <InstallHint />

          </div>

          {/* #313: the halves split what RENDERS, so both columns carry
              real content instead of one side collecting all the nulls */}
          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            {(twoColumns ? renderedBlocks.slice(0, Math.ceil(renderedBlocks.length / 2)) : renderedBlocks).map((entry) => (
              <div key={entry.id}>{entry.node}</div>
            ))}
          </div>
          {twoColumns && (
            <div className="min-w-0 lg:col-start-2 lg:row-start-2">
              {renderedBlocks.slice(Math.ceil(renderedBlocks.length / 2)).map((entry) => (
                <div key={entry.id}>{entry.node}</div>
              ))}
            </div>
          )}
        </div>

        {/* #313: the door joins the centered column on sparse desktops —
            a full-width stray made the rest read off-center */}
        <button
          data-testid="home-customize"
          onClick={() => void navigate({ to: '/home/customize' })}
          className={'m-tap mt-5 flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-line bg-transparent py-3 text-[13px] font-medium text-ink-3' + (twoColumns ? '' : ' ' + SINGLE_COLUMN_LG)}
        >
          <Icon name="tune-variant" size={16} />
          {t('home.customize')}
        </button>
      </div>

      {/* quick display-currency picker (band fold-out shortcut) — the
          full setting with the offline manual rates lives on Profile */}
      <Sheet open={lensOpen} onOpenChange={setLensOpen} title={t('profile.displayCurrency')} size="form" dragHandle>
        {/* #150 (user): the lens needs its one-line story — same copy the
            full setting on Profile carries */}
        <p className="pb-2 text-[12px] leading-relaxed text-ink-3">{t('profile.displayCurrencyInfo')}</p>
        <div className="flex flex-col pt-1">
          <button
            data-testid="band-lens-off"
            onClick={() => {
              void setDisplayCurrency(store, identity?.kind, null);
              setLensOpen(false);
            }}
            className="m-tap flex items-center gap-3 border-b border-line-2 border-none bg-transparent px-1 py-3 text-left text-[14px] text-ink"
          >
            <span className="flex-1">{t('profile.displayCurrencyAsRecorded')}</span>
            {!displayCurrency && <Icon name="check" size={15} color="var(--m-accent)" />}
          </button>
          {CURRENCIES.map((c) => (
            <button
              key={c}
              data-testid={`band-lens-${c}`}
              onClick={() => {
                void setDisplayCurrency(store, identity?.kind, c);
                setLensOpen(false);
              }}
              className="m-tap flex items-center gap-3 border-none bg-transparent px-1 py-3 text-left text-[14px] text-ink"
            >
              <span className="flex-1 font-mono">{c}</span>
              {displayCurrency === c && <Icon name="check" size={15} color="var(--m-accent)" />}
            </button>
          ))}
        </div>
      </Sheet>

      {/* the number must never feel like magic: every part is on the table —
          the bar shows how the balance divides into bills, promises and
          what is actually free until payday */}
      <Sheet open={forecastOpen} onOpenChange={setForecastOpen} title={t('cashflow.title')} size="tall">
        {forecast && (
          <div className="flex flex-col gap-1 pt-1" data-testid="cashflow-breakdown">
            <div className="pb-2 text-center">
              <div className="m-num text-[30px] font-semibold text-ink" data-testid="cashflow-headline">
                {fmt(forecast.cents, currency)}
              </div>
              <div className="text-[12px] text-ink-3">
                {t('cashflow.untilPayday', {
                  date: new Date(forecast.payday.date).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' }),
                  perDay: fmt(forecast.perDayCents, currency),
                })}
              </div>
            </div>

            {(() => {
              const safe = Math.max(0, forecast.cents);
              const total = Math.max(1, forecast.upcomingCents + forecast.allocationCents + safe);
              const pct = (part: number) => `${(Math.max(0, part) / total) * 100}%`;
              return (
                <div className="flex h-3 w-full gap-px overflow-hidden rounded-full bg-bg-2" data-testid="cashflow-bar" aria-hidden="true">
                  {forecast.upcomingCents > 0 && <span style={{ width: pct(forecast.upcomingCents), background: 'var(--m-warning)' }} />}
                  {forecast.allocationCents > 0 && <span style={{ width: pct(forecast.allocationCents), background: 'var(--m-info)' }} />}
                  {safe > 0 && <span style={{ width: pct(safe), background: 'var(--m-accent)' }} />}
                </div>
              );
            })()}

            <div className="mt-2 flex items-baseline justify-between py-1.5 text-[14px]">
              <span className="text-ink-2">{t('cashflow.liquid')}</span>
              <span className="m-num font-semibold text-ink">{fmt(forecast.liquidCents, currency)}</span>
            </div>
            {forecast.upcoming.length > 0 && (
              <div className="flex items-baseline justify-between py-1.5 text-[14px]" data-testid="cashflow-bills">
                <span className="flex items-center gap-2 text-ink-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: 'var(--m-warning)' }} />
                  {t('cashflow.bills')}
                </span>
                <span className="m-num text-ink-2">{fmt(-forecast.upcomingCents, currency, { sign: true })}</span>
              </div>
            )}
            {forecast.upcoming.map(({ rec, due }) => (
              <button
                key={rec.id}
                data-testid={`cashflow-upcoming-${rec.id}`}
                onClick={() => void navigate({ to: '/recurring/$recId', params: { recId: rec.id } })}
                className="m-tap flex w-full items-baseline justify-between border-none bg-transparent py-1 pl-4 text-left text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate text-ink-3">
                  {rec.name} · {new Date(due).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' })}
                </span>
                <span className="m-num text-ink-3">{fmt(-rec.amountCents, currency, { sign: true })}</span>
              </button>
            ))}
            {forecast.allocationCents > 0 && (
              <div className="flex items-baseline justify-between py-1.5 text-[14px]" data-testid="cashflow-allocation">
                <span className="flex items-center gap-2 text-ink-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: 'var(--m-info)' }} />
                  {t('cashflow.allocated')}
                </span>
                <span className="m-num text-ink-2">{fmt(-forecast.allocationCents, currency, { sign: true })}</span>
              </div>
            )}
            <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3 text-[15px]">
              <span className="flex items-center gap-2 font-medium text-ink">
                <span className="h-2 w-2 rounded-full" style={{ background: 'var(--m-accent)' }} />
                {t('cashflow.safeUntil', {
                  date: new Date(forecast.payday.date).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' }),
                })}
              </span>
              <span className="m-num font-semibold text-ink" data-testid="cashflow-total">
                {fmt(forecast.cents, currency)}
              </span>
            </div>
            <p className="pt-1 text-[11px] text-ink-4">{t('cashflow.paydaySource', { merchant: cleanBankText(forecast.payday.merchant) })}</p>
          </div>
        )}
      </Sheet>
    </div>
  );

  function renderOverviewBlock() {
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
          <span>{t('overview.thisPeriod')}</span>
          <span className="text-[10px] font-medium normal-case text-ink-4" data-testid="home-period-range">
            {fmtShort(period.start)} – {fmtShort(period.end)}
          </span>
        </div>
        <div className="grid grid-cols-2 overflow-hidden rounded-card border border-line bg-surface">
          {OVERVIEW_KINDS.map((kind, i) => (
            <button
              key={kind}
              data-testid={`home-overview-${kind}`}
              onClick={() => void navigate({ to: '/overview/$kind', params: { kind } })}
              className={`m-tap flex items-center gap-2.5 border-none bg-transparent px-4 py-3 text-left ${
                i % 2 === 1 ? 'border-l border-l-line-2' : ''
              } ${i > 1 ? 'border-t border-t-line-2' : ''} ${tileCorners(i, OVERVIEW_KINDS.length)}`}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: `color-mix(in srgb, ${TILE_META[kind].color} 14%, transparent)`, color: TILE_META[kind].color }}
              >
                <Icon name={TILE_META[kind].icon} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-medium text-ink-3">{t(`overview.${kind}`)}</span>
                <span className={`m-num block truncate text-[13px] font-semibold ${tileValueClass(kind, summary[TILE_META[kind].field])}`}>
                  {fmt(summary[TILE_META[kind].field], currency)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderNetworthBlock() {
    // sparkline over the last 6 period ends; opt-in via Customize Home
    const periods6 = periodHistory(space?.periodType ?? 'month', space?.periodDay ?? 1, 6);
    const today = localToday();
    const series = netWorthSeries(accounts ?? [], allTxs ?? [], periods6.map((p) => minIso(p.end, today)));
    const nowCents = series.at(-1)?.cents ?? 0;
    const prevCents = series.at(-2)?.cents ?? nowCents;
    const delta = nowCents - prevCents;
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
          <span>{t('trends.viewNetworth')}</span>
          <button
            data-testid="home-seeall-networth"
            onClick={() => void navigate({ to: '/trends' })}
            className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
          >
            {t('action.seeAll')}
          </button>
        </div>
        <button
          data-testid="home-networth"
          onClick={() => void navigate({ to: '/trends' })}
          className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
        >
          <span className="w-24 shrink-0">
            <Line values={series.map((point) => point.cents)} height={36} color="var(--m-accent-deep)" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="m-num block text-[15px] font-semibold text-ink">{fmt(nowCents, currency)}</span>
            <span className={`block text-[11px] ${delta >= 0 ? 'text-accent-deep' : 'text-negative'}`}>
              {fmt(delta, currency, { sign: true })}
            </span>
          </span>
          <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
        </button>
      </>
    );
  }

  function renderCashflowBlock() {
    if (!forecast) return null; // no salary pattern / no liquid accounts — never guess
    const fmtPayday = new Date(forecast.payday.date).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });
    let color = 'var(--m-accent-deep)';
    if (forecast.cents < 0) color = 'var(--m-negative)';
    else if (forecast.perDayCents < 1000) color = 'var(--m-warning)'; // under €10/day gets attention
    return (
      <>
        <div className="m-cap mt-5 mb-1 px-1">{t('cashflow.title')}</div>
        <button
          data-testid="home-cashflow"
          onClick={() => setForecastOpen(true)}
          className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
        >
          <Tile icon="calendar-arrow-right" bg={`color-mix(in srgb, ${color} 14%, transparent)`} color={color} />
          <span className="min-w-0 flex-1">
            <span className="m-num block text-[15px] font-semibold" style={{ color }} data-testid="home-cashflow-amount">
              {fmt(forecast.cents, currency)}
            </span>
            <span className="block text-[11px] text-ink-4">
              {t('cashflow.untilPayday', { date: fmtPayday, perDay: fmt(forecast.perDayCents, currency) })}
            </span>
          </span>
          <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
        </button>
      </>
    );
  }

  function renderReviewBlock() {
    // review call-to-action: important enough to be its own card —
    // the quiet list row was too easy to scroll past
    if ((reviewCount ?? 0) === 0) return null;
    return (
      <button
        data-testid="home-review-banner"
        onClick={() => void navigate({ to: '/review' })}
        className="m-tap mt-5 flex w-full items-center gap-3 rounded-card border border-warning bg-warning-soft px-4 py-3.5 text-left"
      >
        <Tile icon="progress-check" bg="var(--m-surface)" color="var(--m-warning)" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-ink">{t('review.title')}</span>
          <span className="block text-[12px] text-ink-3">{t('home.reviewSub', { n: reviewCount ?? 0 })}</span>
        </span>
        <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-warning px-2 text-[12px] font-bold text-white">
          {reviewCount}
        </span>
        <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
      </button>
    );
  }

  function renderBudgetsBlock() {
    // unused features live in the Explore block now (#121 v2)
    if (!hasBudgets) return null;
    if (urgentBudgets.length === 0) return null;
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
          <span>{t('budgets.title')}</span>
          <button
            data-testid="home-budgets-all"
            onClick={() => void navigate({ to: '/budgets' })}
            className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
          >
            {t('action.seeAll')}
          </button>
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="home-budgets">
          {urgentBudgets.map((status) => {
            const color = budgetColor(status.ratio);
            const over = status.ratio > 1;
            return (
              <button
                key={status.budget.id}
                data-testid={`home-budget-${status.budget.id}`}
                onClick={() => void navigate({ to: '/budgets/$budgetId', params: { budgetId: status.budget.id } })}
                className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-2.5 text-left last:border-0"
              >
                <Icon name={status.budget.icon ?? 'wallet-outline'} size={17} color={color} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">{status.budget.name}</span>
                    <span className="flex shrink-0 items-baseline gap-1.5">
                      {/* days-to-reset on the landing zone too (user request) */}
                      <span className="text-[10px] text-ink-4" data-testid={`home-budget-days-${status.budget.id}`}>
                        {t('budgets.daysLeft', { n: budgetDaysLeft(status.budget, localToday()) })}
                      </span>
                      <span className="m-num text-[12px] font-semibold" style={{ color }}>
                        {t(over ? 'budgets.over' : 'budgets.left', {
                          amount: fmt(Math.abs(status.leftCents), currency),
                        })}
                      </span>
                    </span>
                  </span>
                  <ProgressBar className="mt-1" size="sm" value={ratioPct(status) / 100} color={color} />
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  }

  function renderUpcomingBlock() {
    if (upcoming.length === 0 && upcomingDebts.length === 0) return null;
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
          <span>{t('recurring.upcoming')}</span>
          {/* #334 (user): the block mixes recurring + loans, so see-all
              lands on the combined list — not the recurring manager.
              r2: hidden when the landing has nothing more to show */}
          {upcomingHasMore && (
            <button
              data-testid="home-seeall-upcoming"
              onClick={() => void navigate({ to: '/upcoming' })}
              className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
            >
              {t('action.seeAll')}
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="home-upcoming">
          {upcoming.map(({ rec, nextDue }) => (
            <button
              key={rec.id}
              data-testid={`home-upcoming-${rec.id}`}
              onClick={() => void navigate({ to: '/recurring/$recId', params: { recId: rec.id } })}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-2.5 text-left last:border-0"
            >
              <RecurringVisual rec={rec} size={16} active={false} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{rec.name}</span>
                <span className="block text-[11px] text-ink-4">
                  {fmtShort(nextDue)} · {t('home.upcomingRecurring')}
                </span>
              </span>
              {/* #334 r2 (user): unsigned — one sign story for both kinds */}
              <span className="m-num text-[13px] font-semibold text-ink">
                {fmt(upcomingRecAmountCents(rec), currency)}
              </span>
            </button>
          ))}
          {/* #266: the loan plans' next payments, clearly told apart */}
          {upcomingDebts.map(({ loan, nextDue }) => (
            <button
              key={loan.id}
              data-testid={`home-upcoming-debt-${loan.id}`}
              onClick={() => void navigate({ to: '/debts/$debtId', params: { debtId: loan.id } })}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-2.5 text-left last:border-0"
            >
              {/* #336 (user): the account's own face, not a stand-in */}
              <LoanFace loan={loan} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{loan.name}</span>
                <span className="block text-[11px] text-ink-4">
                  {fmtShort(nextDue)} · {t('home.upcomingLoan')}
                </span>
              </span>
              <span className="m-num text-[13px] font-semibold text-ink">
                {fmt(upcomingLoanAmountCents(loan), currency)}
              </span>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderAllocationBlock() {
    if (allocLeft === null) return null;
    let color = 'var(--m-warning)';
    if (allocLeft === 0) color = 'var(--m-accent-deep)';
    else if (allocLeft < 0) color = 'var(--m-negative)';
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
          <span>{t('alloc.title')}</span>
          <button
            data-testid="home-seeall-alloc"
            onClick={() => void navigate({ to: '/allocate' })}
            className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
          >
            {t('action.seeAll')}
          </button>
        </div>
        <button
          data-testid="home-allocation"
          onClick={() => void navigate({ to: '/allocate' })}
          className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
        >
          <Tile
            icon={allocLeft === 0 ? 'check-circle-outline' : 'cash-multiple'}
            bg={`color-mix(in srgb, ${color} 14%, transparent)`}
            color={color}
          />
          <span className="min-w-0 flex-1">
            <span className="m-num block text-[15px] font-semibold" style={{ color }}>
              {fmt(allocLeft, currency)}
            </span>
            <span className="block text-[11px] text-ink-4">
              {allocLeft === 0 ? t('alloc.allAssigned') : t('alloc.toAllocate')}
            </span>
          </span>
          <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
        </button>
      </>
    );
  }

  function renderSplitsBlock() {
    // online-only, signed-in feature: loading and every degraded state
    // renders nothing; no open split shows the teaser (user request:
    // reach the current split from Home, or all of them via see-all)
    if (identity?.kind !== 'user') return null;
    if (topSplit === undefined) return null;
    if (topSplit === null) return null; // Explore carries the door (#121 v2)
    const netLine = () => {
      if (topSplit.net > 0) return t('splits.summaryOwed', { amount: fmt(topSplit.net, topSplit.currency) });
      if (topSplit.net < 0) return t('splits.summaryOwe', { amount: fmt(-topSplit.net, topSplit.currency) });
      return t('splits.summaryEven');
    };
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-center justify-between px-1">
          {t('splits.title')}
          <button
            data-testid="home-splits-all"
            onClick={() => void navigate({ to: '/splits' })}
            className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
          >
            {t('home.seeAll')}
          </button>
        </div>
        <button
          data-testid="home-split-top"
          onClick={() => void navigate({ to: '/splits/$splitId', params: { splitId: topSplit.id } })}
          className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5 text-left"
        >
          <Tile icon="account-cash-outline" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-ink">{topSplit.name}</span>
            <span className="block text-[12px] text-ink-3">{netLine()}</span>
          </span>
          <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
        </button>
      </>
    );
  }

  function renderEventsBlock() {
    if (!featuredEvent) return null; // Explore carries the door (#121 v2)
    const today = localToday();
    const spent = eventSpentCents(allTxs ?? [], featuredEvent.id);
    const from = featuredEvent.from;
    const running = !!from && from <= today && (!featuredEvent.to || featuredEvent.to >= today);
    let statusLine = t('events.latest');
    if (running) statusLine = t('events.runningNow');
    else if (from && from > today) statusLine = t('events.upcoming', { date: fmtShort(from) });
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
          <span>{t('events.title')}</span>
          <button
            data-testid="home-seeall-events"
            onClick={() => void navigate({ to: '/events' })}
            className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
          >
            {t('action.seeAll')}
          </button>
        </div>
        <button
          data-testid={`home-event-${featuredEvent.id}`}
          onClick={() => void navigate({ to: '/events/$eventId', params: { eventId: featuredEvent.id } })}
          className="m-tap w-full overflow-hidden rounded-card border border-line bg-surface p-0 text-left"
        >
          <span className="relative block h-20 w-full" data-testid="home-events">
            <img src={eventPicture(featuredEvent)} alt="" loading="lazy" className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 flex items-baseline justify-between bg-gradient-to-t from-black/60 to-transparent px-3 pt-4 pb-1.5">
              <span className="truncate text-[14px] font-semibold text-white">{featuredEvent.name}</span>
              <span className="m-num shrink-0 pl-2 text-[13px] font-semibold text-white">{fmt(spent, currency)}</span>
            </span>
          </span>
          <span className="block px-3 py-1.5 text-[11px] text-ink-4">{statusLine}</span>
        </button>
      </>
    );
  }

  function renderGoalsBlock() {
    if (topGoals.length === 0) return null; // Explore carries the door (#121 v2)
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
          <span>{t('goals.title')}</span>
          <button
            data-testid="home-goals-all"
            onClick={() => void navigate({ to: '/goals' })}
            className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
          >
            {t('action.seeAll')}
          </button>
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="home-goals">
          {topGoals.map((goal) => {
            const progress = goalProgress(goal);
            return (
              <button
                key={goal.id}
                data-testid={`home-goal-${goal.id}`}
                onClick={() => void navigate({ to: '/goals/$goalId', params: { goalId: goal.id } })}
                className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-2.5 text-left last:border-0"
              >
                <Icon name={goal.icon ?? 'flag-outline'} size={17} color="var(--m-accent-deep)" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">{goal.name}</span>
                    <span className="m-num shrink-0 text-[12px] font-semibold text-accent-deep">
                      {Math.round(progress * 100)}%
                    </span>
                  </span>
                  <ProgressBar className="mt-1" size="sm" value={progress} />
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  }

  function renderDebtsBlock() {
    if (activeDebts.length === 0) return null; // Explore carries the door (#121 v2)
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
          <span>{t('debts.title')}</span>
          <button
            data-testid="home-seeall-debts"
            onClick={() => void navigate({ to: '/debts' })}
            className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
          >
            {t('action.seeAll')}
          </button>
        </div>
        <button
          data-testid="home-debts"
          onClick={() => void navigate({ to: '/debts' })}
          className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
        >
          <Tile icon="hand-coin-outline" tone="negative" />
          <span className="min-w-0 flex-1">
            <span className="m-num block text-[15px] font-semibold text-ink">{fmt(debtTotals.totalOwedCents, currency)}</span>
            <span className="block text-[11px] text-ink-4">
              {debtTotals.totalMonthlyCents > 0
                ? t('debts.perMonth', { amount: fmt(debtTotals.totalMonthlyCents, currency) })
                : t('debts.count', { n: activeDebts.length })}
            </span>
          </span>
          <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
        </button>
      </>
    );
  }

  function renderInsightsBlock() {
    if (!insights || insights.length === 0) return null;
    const top = insights[0];
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
          <span>{t('ins.title')}</span>
          <button
            data-testid="home-seeall-insights"
            onClick={() => void navigate({ to: '/insights' })}
            className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
          >
            {t('action.seeAll')}
          </button>
        </div>
        <button
          data-testid="home-insight"
          onClick={() => void navigate({ to: '/insights' })}
          className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
        >
          <Tile icon={top.icon} tone="warning" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">
              {t(top.titleKey, Object.fromEntries(Object.entries(top.params).map(([k, v]) => [k, typeof v === 'number' && !['n', 'x', 'months'].includes(k) ? fmt(v, currency) : v])))}
            </span>
            <span className="block text-[11px] text-ink-4">{t('ins.homeSub', { n: insights.length })}</span>
          </span>
          <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
        </button>
      </>
    );
  }

  function renderTransactionsBlock() {
    // only what arrived since the last acknowledgement — the tab has
    // the full history; seeing all marks everything as seen
    if (newTxs.length === 0) return null;
    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
          <span>
            {t('home.newTxs')} · {newTxs.length}
          </span>
          <button
            data-testid="home-newtx-all"
            onClick={() => {
              // #148 r2 (user): NEW = first-seen within 24h, not
              // unreviewed — seeing the list must NOT clear the badges
              // (their 24h clock does); arrive with the New lens on
              presetTxFilters({ newOnly: true });
              void navigate({ to: '/transactions' });
            }}
            className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
          >
            {t('action.seeAll')}
          </button>
        </div>
        <div className="divide-y divide-line-2 rounded-card border border-line bg-surface px-3 py-1" data-testid="home-newtxs">
          {newTxs.slice(0, 5).map((tx) => (
            <TxRow
              key={tx.id}
              tx={tx}
              showDate
              onClick={() => void navigate({ to: '/transactions/$txId', params: { txId: tx.id } })}
            />
          ))}
        </div>
      </>
    );
  }
}
