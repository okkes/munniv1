import type { BudgetStatus } from '@/domain/budgets';
import type { TranslationKey } from '@/i18n';

/** legacy urgency ramp mapped to our tokens: calm → amber → red */
export function budgetColor(ratio: number): string {
  if (ratio > 1) return 'var(--m-negative)';
  if (ratio >= 0.75) return 'var(--m-warning)';
  return 'var(--m-accent)';
}

export const budgetSoft = (ratio: number): string => `color-mix(in srgb, ${budgetColor(ratio)} 14%, transparent)`;

export const ratioPct = (status: BudgetStatus): number => Math.min(100, Math.round(status.ratio * 100));

export const CADENCE_KEYS: Record<'week' | '2weeks' | 'month', TranslationKey> = {
  week: 'budgets.resetsWeek',
  '2weeks': 'budgets.resets2Weeks',
  month: 'budgets.resetsMonth',
};

/** icon choices for the create/edit screen */
export const BUDGET_ICONS = [
  'wallet-outline',
  'food-fork-drink',
  'cart-outline',
  'car-outline',
  'movie-open-outline',
  'gamepad-variant-outline',
  'tshirt-crew-outline',
  'heart-pulse',
  'airplane',
  'paw',
] as const;
