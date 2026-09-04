import type { TranslationKey } from '@/i18n';

/**
 * Tutorials are data (approved tutorial design): the slides sheet and
 * the spotlight walkthrough are generic renderers over this registry.
 * Adding a feature's tour = one entry here + i18n strings ×3.
 */

export type TourId =
  | 'install'
  | 'home'
  | 'review'
  | 'budgets'
  | 'events'
  | 'goals'
  | 'debts'
  | 'allocation'
  | 'transactions'
  | 'recurring'
  | 'accounts'
  | 'spaceAccounts'
  | 'spaces'
  | 'categories'
  | 'period'
  | 'overview'
  | 'portfolio'
  | 'insights'
  | 'trends'
  | 'shopping'
  | 'splits';

export interface TourStep {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** emoji-scale art: shown on slides and as the missing-anchor sample */
  illustration: string;
  /** data-testid to spotlight in the interactive walkthrough */
  anchor?: string;
  /** 'tap' forwards the tap to the real element and advances */
  advanceOn?: 'tap' | 'next';
}

export interface Tour {
  id: TourId;
  titleKey: TranslationKey;
  icon: string;
  /** where the interactive walkthrough runs; null = slides only */
  screen: string | null;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    // browsers cap what a tab may keep (iOS clears idle-tab storage);
    // installed PWAs are exempt — nudging install is data-safety, not vanity
    id: 'install',
    titleKey: 'install.tourTitle',
    icon: 'cellphone-arrow-down',
    screen: null,
    steps: [
      { titleKey: 'tour.install.1t', bodyKey: 'tour.install.1b', illustration: '📱' },
      { titleKey: 'tour.install.2t', bodyKey: 'tour.install.2b', illustration: '🧭' },
      { titleKey: 'tour.install.3t', bodyKey: 'tour.install.3b', illustration: '🤖' },
      { titleKey: 'tour.install.4t', bodyKey: 'tour.install.4b', illustration: '💻' },
    ],
  },
  {
    id: 'home',
    titleKey: 'tab.home',
    icon: 'home-variant-outline',
    screen: '/home',
    steps: [
      { titleKey: 'tour.home.1t', bodyKey: 'tour.home.1b', illustration: '🏠' },
      { titleKey: 'tour.home.2t', bodyKey: 'tour.home.2b', illustration: '💰', anchor: 'home-balance-band' },
      { titleKey: 'tour.home.3t', bodyKey: 'tour.home.3b', illustration: '📊', anchor: 'home-overview-income' },
      { titleKey: 'tour.home.4t', bodyKey: 'tour.home.4b', illustration: '🎛️', anchor: 'home-customize', advanceOn: 'tap' },
    ],
  },
  {
    id: 'review',
    titleKey: 'review.title',
    icon: 'progress-check',
    screen: '/review',
    steps: [
      { titleKey: 'tour.review.1t', bodyKey: 'tour.review.1b', illustration: '🎯' },
      { titleKey: 'tour.review.2t', bodyKey: 'tour.review.2b', illustration: '🃏', anchor: 'review-card' },
      // no advanceOn:'tap' here (user report): forwarding the tap really
      // CONFIRMED the card — the deck advanced mid-tour and the skip
      // step could point at nothing. Tour steps only point, never act.
      { titleKey: 'tour.review.3t', bodyKey: 'tour.review.3b', illustration: '✅', anchor: 'review-confirm-btn' },
      { titleKey: 'tour.review.4t', bodyKey: 'tour.review.4b', illustration: '⏭️', anchor: 'review-skip-btn' },
    ],
  },
  {
    id: 'budgets',
    titleKey: 'budgets.title',
    icon: 'wallet-outline',
    screen: null,
    steps: [
      { titleKey: 'tour.budgets.1t', bodyKey: 'tour.budgets.1b', illustration: '💡' },
      { titleKey: 'tour.budgets.2t', bodyKey: 'tour.budgets.2b', illustration: '➕', anchor: 'budgets-add' },
      { titleKey: 'tour.budgets.3t', bodyKey: 'tour.budgets.3b', illustration: '🚦' },
      { titleKey: 'tour.budgets.4t', bodyKey: 'tour.budgets.4b', illustration: '♻️' },
    ],
  },
  {
    id: 'events',
    titleKey: 'events.title',
    icon: 'party-popper',
    screen: '/events',
    steps: [
      { titleKey: 'tour.events.1t', bodyKey: 'tour.events.1b', illustration: '🎉' },
      { titleKey: 'tour.events.2t', bodyKey: 'tour.events.2b', illustration: '➕', anchor: 'events-add' },
      { titleKey: 'tour.events.3t', bodyKey: 'tour.events.3b', illustration: '🧲' },
    ],
  },
  {
    id: 'goals',
    titleKey: 'goals.title',
    icon: 'flag-outline',
    screen: '/goals',
    steps: [
      { titleKey: 'tour.goals.1t', bodyKey: 'tour.goals.1b', illustration: '🚩' },
      { titleKey: 'tour.goals.2t', bodyKey: 'tour.goals.2b', illustration: '➕', anchor: 'goals-add' },
      { titleKey: 'tour.goals.3t', bodyKey: 'tour.goals.3b', illustration: '⚖️' },
    ],
  },
  {
    id: 'debts',
    titleKey: 'debts.title',
    icon: 'hand-coin-outline',
    screen: '/debts',
    steps: [
      { titleKey: 'tour.debts.1t', bodyKey: 'tour.debts.1b', illustration: '⛰️' },
      { titleKey: 'tour.debts.2t', bodyKey: 'tour.debts.2b', illustration: '➕', anchor: 'debts-add' },
      { titleKey: 'tour.debts.3t', bodyKey: 'tour.debts.3b', illustration: '📉' },
    ],
  },
  {
    id: 'allocation',
    titleKey: 'alloc.title',
    icon: 'cash-multiple',
    screen: '/allocate',
    steps: [
      { titleKey: 'tour.alloc.1t', bodyKey: 'tour.alloc.1b', illustration: '✉️' },
      { titleKey: 'tour.alloc.2t', bodyKey: 'tour.alloc.2b', illustration: '🧮', anchor: 'alloc-toallocate' },
      { titleKey: 'tour.alloc.3t', bodyKey: 'tour.alloc.3b', illustration: '🤝' },
      { titleKey: 'tour.alloc.4t', bodyKey: 'tour.alloc.4b', illustration: '♻️', anchor: 'alloc-rollover' },
      { titleKey: 'tour.alloc.5t', bodyKey: 'tour.alloc.5b', illustration: '📌' },
    ],
  },
  {
    id: 'transactions',
    titleKey: 'tab.transactions',
    icon: 'format-list-bulleted',
    screen: '/transactions',
    steps: [
      { titleKey: 'tour.tx.1t', bodyKey: 'tour.tx.1b', illustration: '📒' },
      { titleKey: 'tour.tx.2t', bodyKey: 'tour.tx.2b', illustration: '🔍', anchor: 'tx-search' },
      { titleKey: 'tour.tx.3t', bodyKey: 'tour.tx.3b', illustration: '🛠️' },
      { titleKey: 'tour.tx.4t', bodyKey: 'tour.tx.4b', illustration: '➕', anchor: 'tx-add' },
    ],
  },
  {
    id: 'recurring',
    titleKey: 'tab.recurring',
    icon: 'autorenew',
    screen: '/recurring',
    steps: [
      { titleKey: 'tour.rec.1t', bodyKey: 'tour.rec.1b', illustration: '📆' },
      { titleKey: 'tour.rec.2t', bodyKey: 'tour.rec.2b', illustration: '🧠' },
      { titleKey: 'tour.rec.3t', bodyKey: 'tour.rec.3b', illustration: '🔔', anchor: 'recurring-add' },
    ],
  },
  {
    id: 'accounts',
    titleKey: 'screen.accounts',
    icon: 'bank-outline',
    screen: '/accounts',
    steps: [
      { titleKey: 'tour.acct.1t', bodyKey: 'tour.acct.1b', illustration: '🏦' },
      { titleKey: 'tour.acct.2t', bodyKey: 'tour.acct.2b', illustration: '📄', anchor: 'accounts-import' },
      { titleKey: 'tour.acct.3t', bodyKey: 'tour.acct.3b', illustration: '⏰' },
    ],
  },
  {
    id: 'spaces',
    titleKey: 'screen.spaces',
    icon: 'account-group-outline',
    screen: '/spaces',
    steps: [
      { titleKey: 'tour.spaces.1t', bodyKey: 'tour.spaces.1b', illustration: '🏠' },
      { titleKey: 'tour.spaces.2t', bodyKey: 'tour.spaces.2b', illustration: '🤝', anchor: 'spaces-add' },
      { titleKey: 'tour.spaces.3t', bodyKey: 'tour.spaces.3b', illustration: '⚙️' },
    ],
  },
  {
    id: 'categories',
    titleKey: 'screen.categories',
    icon: 'shape-outline',
    screen: '/categories',
    steps: [
      { titleKey: 'tour.cats.1t', bodyKey: 'tour.cats.1b', illustration: '🗂️' },
      { titleKey: 'tour.cats.2t', bodyKey: 'tour.cats.2b', illustration: '🎨', anchor: 'cats-add' },
      { titleKey: 'tour.cats.3t', bodyKey: 'tour.cats.3b', illustration: '🧲' },
      { titleKey: 'tour.cats.4t', bodyKey: 'tour.cats.4b', illustration: '👆', anchor: 'cats-group-consumption' },
    ],
  },
  {
    // ships with the extracted period screen (user rule: new screens
    // bring their tour in the same arc); 'current' = the screen carries
    // a spaceId param, so the walkthrough runs where the ? lives
    id: 'period',
    titleKey: 'space.periodTitle',
    icon: 'calendar-month-outline',
    screen: 'current',
    steps: [
      { titleKey: 'tour.period.1t', bodyKey: 'tour.period.1b', illustration: '🗓️' },
      { titleKey: 'tour.period.2t', bodyKey: 'tour.period.2b', illustration: '📆', anchor: 'space-period-month' },
      { titleKey: 'tour.period.3t', bodyKey: 'tour.period.3b', illustration: '📌', anchor: 'space-period-day' },
      { titleKey: 'tour.period.4t', bodyKey: 'tour.period.4b', illustration: '⚡' },
    ],
  },
  {
    id: 'overview',
    titleKey: 'overview.thisPeriod',
    icon: 'chart-donut',
    screen: null,
    steps: [
      { titleKey: 'tour.ov.1t', bodyKey: 'tour.ov.1b', illustration: '📊' },
      { titleKey: 'tour.ov.2t', bodyKey: 'tour.ov.2b', illustration: '⏮️' },
      { titleKey: 'tour.ov.3t', bodyKey: 'tour.ov.3b', illustration: '🔬' },
    ],
  },
  {
    id: 'portfolio',
    titleKey: 'pf.title',
    icon: 'chart-timeline-variant',
    screen: '/portfolio',
    steps: [
      { titleKey: 'tour.pf.1t', bodyKey: 'tour.pf.1b', illustration: '📈' },
      { titleKey: 'tour.pf.2t', bodyKey: 'tour.pf.2b', illustration: '➕', anchor: 'pf-add' },
      { titleKey: 'tour.pf.3t', bodyKey: 'tour.pf.3b', illustration: '📄', anchor: 'pf-import' },
      { titleKey: 'tour.pf.4t', bodyKey: 'tour.pf.4b', illustration: '⏱️' },
    ],
  },
  {
    id: 'insights',
    titleKey: 'ins.title',
    icon: 'lightbulb-outline',
    screen: '/insights',
    steps: [
      { titleKey: 'tour.ins.1t', bodyKey: 'tour.ins.1b', illustration: '💡' },
      { titleKey: 'tour.ins.2t', bodyKey: 'tour.ins.2b', illustration: '📐' },
      { titleKey: 'tour.ins.3t', bodyKey: 'tour.ins.3b', illustration: '🔕' },
    ],
  },
  {
    id: 'trends',
    titleKey: 'trends.title',
    icon: 'chart-bar',
    screen: '/trends',
    steps: [
      { titleKey: 'tour.trends.1t', bodyKey: 'tour.trends.1b', illustration: '📊', anchor: 'trends-view-categories' },
      { titleKey: 'tour.trends.2t', bodyKey: 'tour.trends.2b', illustration: '🌊', anchor: 'trends-view-cashflow' },
      { titleKey: 'tour.trends.3t', bodyKey: 'tour.trends.3b', illustration: '📈', anchor: 'trends-view-networth' },
    ],
  },
  {
    id: 'shopping',
    titleKey: 'shop.title',
    icon: 'storefront-outline',
    screen: '/shopping',
    steps: [
      { titleKey: 'tour.shop.1t', bodyKey: 'tour.shop.1b', illustration: '🧾' },
      { titleKey: 'tour.shop.2t', bodyKey: 'tour.shop.2b', illustration: '🔒', anchor: 'shopping-store-ah' },
      { titleKey: 'tour.shop.3t', bodyKey: 'tour.shop.3b', illustration: '🧲' },
      { titleKey: 'tour.shop.4t', bodyKey: 'tour.shop.4b', illustration: '🔍' },
      { titleKey: 'tour.shop.5t', bodyKey: 'tour.shop.5b', illustration: '🔁', anchor: 'store-sync-card' },
    ],
  },
  {
    id: 'splits',
    titleKey: 'splits.title',
    icon: 'account-cash-outline',
    screen: '/splits',
    steps: [
      { titleKey: 'tour.splits.1t', bodyKey: 'tour.splits.1b', illustration: '🍽️' },
      { titleKey: 'tour.splits.2t', bodyKey: 'tour.splits.2b', illustration: '➕', anchor: 'splits-add' },
      { titleKey: 'tour.splits.3t', bodyKey: 'tour.splits.3b', illustration: '⚖️' },
      { titleKey: 'tour.splits.4t', bodyKey: 'tour.splits.4b', illustration: '🔗' },
    ],
  },
];

/** the three account tiers, taught where they live (user request:
 *  understanding manual vs import vs open banking is load-bearing) */
const SPACE_ACCOUNTS_TOUR: Tour = {
  id: 'spaceAccounts',
  titleKey: 'space.financialAccounts',
  icon: 'bank-outline',
  screen: 'current',
  steps: [
    { titleKey: 'tour.spaceacct.1t', bodyKey: 'tour.spaceacct.1b', illustration: '🏦' },
    { titleKey: 'tour.spaceacct.2t', bodyKey: 'tour.spaceacct.2b', illustration: '🔗' },
    { titleKey: 'tour.spaceacct.3t', bodyKey: 'tour.spaceacct.3b', illustration: '📄' },
    { titleKey: 'tour.spaceacct.4t', bodyKey: 'tour.spaceacct.4b', illustration: '✍️', anchor: 'space-accounts-add' },
    { titleKey: 'tour.spaceacct.5t', bodyKey: 'tour.spaceacct.5b', illustration: '🧲', anchor: 'space-accounts-attach' },
    { titleKey: 'tour.spaceacct.6t', bodyKey: 'tour.spaceacct.6b', illustration: '🏷️', anchor: 'space-accounts' },
  ],
};
TOURS.push(SPACE_ACCOUNTS_TOUR);

// The old 'welcome' walkthrough retired 2026-07-26: the Mina tutorial
// (features/mina) owns the first-run now — auto-started, forced-nav,
// replayable from the help index.

export const tourById = (id: TourId): Tour => TOURS.find((tour) => tour.id === id)!;
