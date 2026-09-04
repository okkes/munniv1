import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { MasterDetailLayout } from '@/ui/SplitPane';
import { AppLayout } from './AppLayout';
import { readSessionIdentity } from './session';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { HomeScreen } from '@/features/home/HomeScreen';
import { HomeCustomizeScreen } from '@/features/home/HomeCustomizeScreen';
import { TxDetailCustomizeScreen } from '@/features/transactions/TxDetailCustomizeScreen';
import { TransactionsScreen } from '@/features/transactions/TransactionsScreen';
import { TxDetailScreen } from '@/features/transactions/TxDetailScreen';
import { ReimburseLinkScreen } from '@/features/transactions/ReimburseLinkScreen';
import { SpacesScreen } from '@/features/spaces/SpacesScreen';
import { SpaceSettingsScreen } from '@/features/spaces/SpaceSettingsScreen';
import { PeriodSettingsScreen } from '@/features/spaces/PeriodSettingsScreen';
import { SpaceAccountsScreen } from '@/features/spaces/SpaceAccountsScreen';
import { SpaceMembersScreen } from '@/features/spaces/SpaceMembersScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { GlobalSettingsScreen } from '@/features/settings/GlobalSettingsScreen';
import { GoOfflineScreen } from '@/features/auth/GoOfflineScreen';
import { ReviewScreen } from '@/features/review/ReviewScreen';
import { AccountsScreen } from '@/features/accounts/AccountsScreen';
import { ManageCategoriesScreen } from '@/features/categories/ManageCategoriesScreen';
import { FriendsScreen } from '@/features/friends/FriendsScreen';
import { SplitDetailScreen, SplitsScreen } from '@/features/splits/SplitsScreen';
import { SplitJoinScreen } from '@/features/splits/SplitJoinScreen';
import { OnboardingScreen } from '@/features/auth/OnboardingScreen';
import { OverviewScreen } from '@/features/overview/OverviewScreen';
import { CategoryDrillScreen } from '@/features/overview/CategoryDrillScreen';
import { BudgetsScreen } from '@/features/budgets/BudgetsScreen';
import { BudgetFormScreen } from '@/features/budgets/BudgetFormScreen';
import { BudgetDetailScreen } from '@/features/budgets/BudgetDetailScreen';
import { EventsScreen } from '@/features/events/EventsScreen';
import { EventDetailScreen } from '@/features/events/EventDetailScreen';
import { EventAttachScreen } from '@/features/events/EventAttachScreen';
import { GoalsScreen } from '@/features/goals/GoalsScreen';
import { GoalDetailScreen } from '@/features/goals/GoalDetailScreen';
import { DebtsScreen } from '@/features/debts/DebtsScreen';
import { DebtDetailScreen } from '@/features/debts/DebtDetailScreen';
import { AllocateScreen } from '@/features/allocation/AllocateScreen';
import { HelpIndexScreen } from '@/features/help/HelpIndexScreen';
import { ShoppingConnectionsScreen } from '@/features/shopping/ShoppingConnectionsScreen';
import { ReceiptsScreen } from '@/features/shopping/ReceiptsScreen';
import { PortfolioScreen } from '@/features/portfolio/PortfolioScreen';
import { HoldingDetailScreen } from '@/features/portfolio/HoldingDetailScreen';
import { InsightsScreen } from '@/features/insights/InsightsScreen';
import { TrendsScreen } from '@/features/trends/TrendsScreen';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { DevicesScreen } from '@/features/profile/DevicesScreen';
import { UpcomingScreen } from '@/features/home/UpcomingScreen';
import { RecurringScreen } from '@/features/recurring/RecurringScreen';
import { RecurringDetailScreen } from '@/features/recurring/RecurringDetailScreen';
import { RecurringSuggestionsScreen } from '@/features/recurring/RecurringSuggestionsScreen';

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: () => {
    if (readSessionIdentity()) throw redirect({ to: '/home' });
  },
  component: LoginScreen,
});

// everything behind the login gate lives under this pathless layout
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: () => {
    if (!readSessionIdentity()) throw redirect({ to: '/login' });
  },
  component: AppLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/home' });
  },
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/home', component: HomeScreen });
// customize flows are full screens (user request: dragging on a bottom
// sheet felt awkward; the sheet transform also sent the drag ghost adrift)
const homeCustomizeRoute = createRoute({ getParentRoute: () => appRoute, path: '/home/customize', component: HomeCustomizeScreen });
const txCustomizeRoute = createRoute({ getParentRoute: () => appRoute, path: '/tx-customize', component: TxDetailCustomizeScreen });
// #334 (user): home's coming-up see-all lands on the combined recurring +
// loan list — a plain child route, so browser back returns to Home
const upcomingRoute = createRoute({ getParentRoute: () => appRoute, path: '/upcoming', component: UpcomingScreen });
// list routes render the master-detail layout: the list stays mounted
// while a detail child slides in beside it at lg (animated, §4.2)
const transactionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/transactions',
  component: () => <MasterDetailLayout list={<TransactionsScreen />} />,
});
const txDetailRoute = createRoute({
  getParentRoute: () => transactionsRoute,
  path: '$txId',
  component: TxDetailScreen,
  // #126 r4: a split's parts are addressable — ?part=<partId> shows one
  // part as its own transaction page
  validateSearch: (search: Record<string, unknown>): { part?: string } =>
    typeof search.part === 'string' && search.part.length > 0 ? { part: search.part } : {},
});
// full-screen counterpart picker (user redesign 2026-07-28) — a sibling
// of the detail under /transactions, so it owns the detail pane on
// desktop and the whole viewport on mobile
const reimburseLinkRoute = createRoute({
  getParentRoute: () => transactionsRoute,
  path: '$txId/link-reimb',
  component: ReimburseLinkScreen,
  // #126 r5: a link opened from a part page targets that part
  validateSearch: (search: Record<string, unknown>): { part?: string } =>
    typeof search.part === 'string' && search.part.length > 0 ? { part: search.part } : {},
});
const recurringRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/recurring',
  component: () => <MasterDetailLayout list={<RecurringScreen />} />,
});
// static beats the $recId param in TanStack's ranking — order here is cosmetic
const recurringSuggestionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/recurring/suggestions',
  component: RecurringSuggestionsScreen,
});
const recurringDetailRoute = createRoute({
  getParentRoute: () => recurringRoute,
  path: '$recId',
  component: RecurringDetailScreen,
});
// #168 r5 (user): a transaction opened FROM the recurring screen mounts
// under the recurring layout — at lg the recurring list stays the master
// pane beside it (like $recId above); on mobile, back lands on
// /recurring. Deeper detours from the detail (parts, peers, link-reimb)
// continue under the canonical /transactions tree by design.
const recurringTxRoute = createRoute({
  getParentRoute: () => recurringRoute,
  path: 'tx/$txId',
  component: () => <TxDetailScreen backTo="/recurring" />,
  validateSearch: (search: Record<string, unknown>): { part?: string } =>
    typeof search.part === 'string' && search.part.length > 0 ? { part: search.part } : {},
});
const spacesRoute = createRoute({ getParentRoute: () => appRoute, path: '/spaces', component: SpacesScreen });
const spaceSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/spaces/$spaceId',
  component: SpaceSettingsScreen,
});
const spacePeriodRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/spaces/$spaceId/period',
  component: PeriodSettingsScreen,
});
const spaceMembersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/spaces/$spaceId/members',
  component: SpaceMembersScreen,
});
const spaceAccountsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/spaces/$spaceId/accounts',
  component: SpaceAccountsScreen,
});
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/settings', component: SettingsScreen });
const settingsGlobalRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/global',
  component: GlobalSettingsScreen,
});
const goOfflineRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/go-offline',
  component: GoOfflineScreen,
});
const reviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/review',
  component: ReviewScreen,
  // #132: a new-transactions notification lands in the ANNOUNCED space —
  // the space id rides the hash query so cold starts carry it too
  validateSearch: (search: Record<string, unknown>): { space?: string } =>
    typeof search.space === 'string' && search.space.length > 0 ? { space: search.space } : {},
});
const accountsRoute = createRoute({ getParentRoute: () => appRoute, path: '/accounts', component: AccountsScreen });
const categoriesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/categories',
  component: ManageCategoriesScreen,
});
const friendsRoute = createRoute({ getParentRoute: () => appRoute, path: '/friends', component: FriendsScreen });
const splitsRoute = createRoute({ getParentRoute: () => appRoute, path: '/splits', component: SplitsScreen });
const splitJoinRoute = createRoute({ getParentRoute: () => appRoute, path: '/splits/join/$token', component: SplitJoinScreen });
const splitDetailRoute = createRoute({ getParentRoute: () => appRoute, path: '/splits/$splitId', component: SplitDetailScreen });
const onboardingRoute = createRoute({ getParentRoute: () => appRoute, path: '/onboarding', component: OnboardingScreen });
const profileRoute = createRoute({ getParentRoute: () => appRoute, path: '/profile', component: ProfileScreen });
const devicesRoute = createRoute({ getParentRoute: () => appRoute, path: '/devices', component: DevicesScreen });
const overviewRoute = createRoute({ getParentRoute: () => appRoute, path: '/overview/$kind', component: OverviewScreen });
const budgetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/budgets',
  component: () => <MasterDetailLayout list={<BudgetsScreen />} />,
});
// static 'new' outranks the $budgetId param in TanStack's ranking
const budgetNewRoute = createRoute({ getParentRoute: () => appRoute, path: '/budgets/new', component: BudgetFormScreen });
const budgetDetailRoute = createRoute({ getParentRoute: () => budgetsRoute, path: '$budgetId', component: BudgetDetailScreen });
const budgetEditRoute = createRoute({ getParentRoute: () => appRoute, path: '/budgets/$budgetId/edit', component: BudgetFormScreen });
const eventsRoute = createRoute({ getParentRoute: () => appRoute, path: '/events', component: EventsScreen });
const eventDetailRoute = createRoute({ getParentRoute: () => appRoute, path: '/events/$eventId', component: EventDetailScreen });
// #144: attaching is a full screen, not a sheet
const eventAttachRoute = createRoute({ getParentRoute: () => appRoute, path: '/events/$eventId/attach', component: EventAttachScreen });
const goalsRoute = createRoute({ getParentRoute: () => appRoute, path: '/goals', component: GoalsScreen });
const goalDetailRoute = createRoute({ getParentRoute: () => appRoute, path: '/goals/$goalId', component: GoalDetailScreen });
const debtsRoute = createRoute({ getParentRoute: () => appRoute, path: '/debts', component: DebtsScreen });
const debtDetailRoute = createRoute({ getParentRoute: () => appRoute, path: '/debts/$debtId', component: DebtDetailScreen });
const allocateRoute = createRoute({ getParentRoute: () => appRoute, path: '/allocate', component: AllocateScreen });
const helpRoute = createRoute({ getParentRoute: () => appRoute, path: '/help', component: HelpIndexScreen });
const shoppingRoute = createRoute({ getParentRoute: () => appRoute, path: '/shopping', component: ShoppingConnectionsScreen });
const receiptsRoute = createRoute({ getParentRoute: () => appRoute, path: '/receipts', component: ReceiptsScreen });
const portfolioRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/portfolio',
  component: () => <MasterDetailLayout list={<PortfolioScreen />} />,
});
const holdingDetailRoute = createRoute({ getParentRoute: () => portfolioRoute, path: '$holdingId', component: HoldingDetailScreen });
const insightsRoute = createRoute({ getParentRoute: () => appRoute, path: '/insights', component: InsightsScreen });
const trendsRoute = createRoute({ getParentRoute: () => appRoute, path: '/trends', component: TrendsScreen });
const categoryDrillRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/overview/$kind/$catId',
  component: CategoryDrillScreen,
  // the overview hands over its selected period
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({
    from: typeof search.from === 'string' ? search.from : undefined,
  }),
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    homeRoute,
    homeCustomizeRoute,
    txCustomizeRoute,
    upcomingRoute,
    transactionsRoute.addChildren([txDetailRoute, reimburseLinkRoute]),
    recurringRoute.addChildren([recurringDetailRoute, recurringTxRoute]),
    recurringSuggestionsRoute,
    spacesRoute,
    spaceSettingsRoute,
    spacePeriodRoute,
    spaceMembersRoute,
    spaceAccountsRoute,
    settingsRoute,
    settingsGlobalRoute,
    goOfflineRoute,
    reviewRoute,
    accountsRoute,
    categoriesRoute,
    friendsRoute,
    splitsRoute,
    splitJoinRoute,
    splitDetailRoute,
    onboardingRoute,
    profileRoute,
    devicesRoute,
    overviewRoute,
    categoryDrillRoute,
    budgetsRoute.addChildren([budgetDetailRoute]),
    budgetNewRoute,
    budgetEditRoute,
    eventsRoute,
    eventDetailRoute,
    eventAttachRoute,
    goalsRoute,
    goalDetailRoute,
    debtsRoute,
    debtDetailRoute,
    allocateRoute,
    helpRoute,
    shoppingRoute,
    receiptsRoute,
    portfolioRoute.addChildren([holdingDetailRoute]),
    insightsRoute,
    trendsRoute,
  ]),
]);

// Hash history: works on any static host (GitHub Pages, nginx) without
// rewrite rules. Swap for createBrowserHistory once nginx hosting lands.
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
