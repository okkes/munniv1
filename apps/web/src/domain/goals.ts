import type { AccountRow, GoalRow } from '@/db/types';

/**
 * Goal math (approved goals design) — the savings BALANCE is the only
 * truth. Withdrawing from savings can push unallocated NEGATIVE; the
 * user rebalances by removing value from goals, the app only flags it.
 */

/** the space's saved total: savings-type, non-archived accounts */
export function savingsTotalCents(accounts: readonly AccountRow[]): number {
  return accounts
    .filter((a) => a.deleted === 0 && a.type === 'savings' && a.archived !== 1)
    .reduce((sum, a) => sum + a.balanceCents, 0);
}

export interface GoalOverview {
  savedCents: number;
  allocatedCents: number;
  /** may be negative — that's the rebalance signal */
  unallocatedCents: number;
}

export function goalOverview(goals: readonly GoalRow[], accounts: readonly AccountRow[]): GoalOverview {
  const savedCents = savingsTotalCents(accounts);
  const allocatedCents = goals
    .filter((g) => g.deleted === 0 && g.archived !== 1)
    .reduce((sum, g) => sum + g.allocatedCents, 0);
  return { savedCents, allocatedCents, unallocatedCents: savedCents - allocatedCents };
}

/** whole months from `today` until the goal's deadline (min 1); null undated */
export function monthsLeft(goal: GoalRow, today: string): number | null {
  if (!goal.targetDate) return null;
  const [ty, tm] = goal.targetDate.split('-').map(Number);
  const [ny, nm] = today.split('-').map(Number);
  return Math.max(1, (ty - ny) * 12 + (tm - nm));
}

/** €/month needed to reach the target by its date; 0 when reached */
export function paceCentsPerMonth(goal: GoalRow, today: string): number | null {
  const months = monthsLeft(goal, today);
  if (months === null) return null;
  return Math.max(0, Math.ceil((goal.targetCents - goal.allocatedCents) / months));
}

export const goalProgress = (goal: GoalRow): number =>
  goal.targetCents > 0 ? Math.min(1, goal.allocatedCents / goal.targetCents) : 0;
