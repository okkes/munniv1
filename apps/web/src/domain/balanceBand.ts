import type { AccountRow, SpaceRow } from '@/db/types';

/**
 * The Home balance band's meaning, per space (user design 2026-08-01):
 * net worth (every attached account — the pre-config behavior and the
 * default), total cash (liquid types only), safe-to-spend (the cashflow
 * forecast's number), or a hand-picked set of accounts. The first two
 * take per-account exclusions; custom carries its own include list;
 * spendable is a formula and takes no toggles.
 */
export type BalanceBandMode = 'networth' | 'cash' | 'spendable' | 'custom';

export const BAND_MODES: readonly BalanceBandMode[] = ['networth', 'cash', 'spendable', 'custom'];

const LIQUID_TYPES = new Set<AccountRow['type']>(['checking', 'savings', 'cash']);

type BandSpace = Pick<SpaceRow, 'balanceBandMode' | 'balanceBandExclude' | 'balanceBandAccounts'>;

export const bandModeOf = (space: BandSpace | undefined): BalanceBandMode => space?.balanceBandMode ?? 'networth';

/** can this account be toggled in/out of the given mode at all? */
export function bandEligible(mode: BalanceBandMode, account: Pick<AccountRow, 'type'>): boolean {
  if (mode === 'spendable') return false;
  if (mode === 'cash') return LIQUID_TYPES.has(account.type);
  return true;
}

/** does the account count toward the band under this mode + config? */
export function bandIncludes(mode: BalanceBandMode, account: Pick<AccountRow, 'id' | 'type'>, space: BandSpace | undefined): boolean {
  if (!bandEligible(mode, account)) return false;
  if (mode === 'custom') return (space?.balanceBandAccounts ?? []).includes(account.id);
  return !(space?.balanceBandExclude ?? []).includes(account.id);
}
