import type { AccountRow, BudgetRow, RecurringRow, TransactionRow } from '@/db/types';
import type { TranslationKey } from '@/i18n';
import { budgetFamily, budgetPeriodAt, budgetSpentCents, cycleIndex } from './budgets';
import { projectPayoff } from './debts';
import { cycleMonths } from './recurring';
import { detectPriceChange } from './recurringPrice';
import { merchantKey } from './merchantKey';
import type { Period } from './periods';

/**
 * Insights engine (approved insights design N1) — pure detectors over
 * local data. Quality bar: computable from what we have, a concrete
 * euro number, one obvious action. A detector below its threshold
 * stays silent; ids encode the subject so a dismissed insight only
 * resurfaces when the situation actually changes.
 */

export type InsightSeverity = 'leak' | 'pattern' | 'win';

export interface Insight {
  id: string;
  severity: InsightSeverity;
  /** yearly € impact — the ranking key */
  impactCents: number;
  icon: string;
  titleKey: TranslationKey;
  detailKey: TranslationKey;
  params: Record<string, string | number>;
  /** small history the card can chart */
  chart?: number[];
  /** where the fix lives */
  actionTo?: string;
}

interface CatalogLookup {
  byId: (id: string | undefined) => { id: string; parentId?: string };
  childrenOf: (id: string) => { id: string }[];
}

export interface InsightInputs {
  txs: readonly TransactionRow[];
  recurrings: readonly RecurringRow[];
  budgets: readonly BudgetRow[];
  /** loans v2: the tracked liability accounts (the account IS the debt) */
  loans: readonly AccountRow[];
  accountsById: ReadonlyMap<string, AccountRow>;
  catalog: CatalogLookup;
  /** oldest → current, e.g. the last 6 space periods */
  periods: readonly Period[];
  today: string;
}

// ── leaks ───────────────────────────────────────────────────────────────

/** a recurring cost that SUSTAINABLY charges more than it used to (min €0.50/mo) */
export function priceCreep(inputs: InsightInputs): Insight[] {
  const out: Insight[] = [];
  for (const rec of inputs.recurrings) {
    if (rec.deleted !== 0 || rec.active !== 1) continue;
    const charges = inputs.txs
      .filter((tx) => tx.deleted === 0 && tx.recurringId === rec.id && tx.amountCents < 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    // two consecutive charges at the new amount — one-off prorations stay silent
    const change = detectPriceChange(charges);
    if (!change || change.toCents <= change.fromCents) continue;
    const deltaMonthly = Math.round((change.toCents - change.fromCents) / cycleMonths(rec));
    if (deltaMonthly < 50) continue;
    out.push({
      id: `creep:${rec.id}:${change.toCents}`,
      severity: 'leak',
      impactCents: deltaMonthly * 12,
      icon: 'trending-up',
      titleKey: 'ins.creep.title',
      detailKey: 'ins.creep.detail',
      params: { name: rec.name, from: change.fromCents, to: change.toCents, year: deltaMonthly * 12 },
      chart: charges.slice(-8).map((tx) => -tx.amountCents),
      actionTo: `/recurring/${rec.id}`,
    });
  }
  return out;
}

/** two or more active subscriptions inside the same category */
export function subscriptionOverlap(inputs: InsightInputs): Insight[] {
  const groups = new Map<string, RecurringRow[]>();
  for (const rec of inputs.recurrings) {
    if (rec.deleted !== 0 || rec.active !== 1 || rec.kind !== 'subscription') continue;
    const cat = inputs.catalog.byId(rec.catId);
    const mainId = cat.parentId ?? cat.id;
    const list = groups.get(mainId) ?? [];
    list.push(rec);
    groups.set(mainId, list);
  }
  const out: Insight[] = [];
  for (const [catId, group] of groups) {
    if (group.length < 2) continue;
    const monthly = group.reduce((sum, rec) => sum + Math.round(rec.amountCents / cycleMonths(rec)), 0);
    out.push({
      id: `overlap:${catId}:${group.length}`,
      severity: 'leak',
      impactCents: monthly * 12,
      icon: 'content-copy',
      titleKey: 'ins.overlap.title',
      detailKey: 'ins.overlap.detail',
      params: { n: group.length, names: group.map((r) => r.name).join(' + '), month: monthly, year: monthly * 12 },
      actionTo: '/recurring',
    });
  }
  return out;
}

/** a repeated small purchase at the same merchant (≥8× in the period) */
export function smallHabit(inputs: InsightInputs): Insight[] {
  const period = inputs.periods.at(-1);
  if (!period) return [];
  const groups = new Map<string, { name: string; count: number; totalCents: number }>();
  for (const tx of inputs.txs) {
    if (tx.deleted !== 0 || tx.txType !== 'expense') continue;
    if (tx.date < period.start || tx.date > period.end) continue;
    const spent = -tx.amountCents;
    if (spent <= 0 || spent > 1000) continue;
    const key = merchantKey(tx.merchant);
    if (!key) continue;
    const group = groups.get(key) ?? { name: tx.merchant ?? key, count: 0, totalCents: 0 };
    group.count += 1;
    group.totalCents += spent;
    groups.set(key, group);
  }
  const out: Insight[] = [];
  for (const [key, group] of groups) {
    if (group.count < 8 || group.totalCents < 2000) continue;
    out.push({
      id: `habit:${key}:${period.start}`,
      severity: 'pattern',
      impactCents: group.totalCents * 12,
      icon: 'coffee-outline',
      titleKey: 'ins.habit.title',
      detailKey: 'ins.habit.detail',
      params: { name: group.name, n: group.count, period: group.totalCents, year: group.totalCents * 12 },
      actionTo: '/transactions',
    });
  }
  return out;
}

// ── patterns ────────────────────────────────────────────────────────────

/** Fri–Sun daily spend vs Mon–Thu, over the recent periods */
export function weekendMultiplier(inputs: InsightInputs): Insight[] {
  const window = inputs.periods.slice(-2);
  if (window.length === 0) return [];
  const start = window[0].start;
  const end = window.at(-1)!.end;
  let weekend = 0;
  let weekday = 0;
  for (const tx of inputs.txs) {
    if (tx.deleted !== 0 || tx.txType !== 'expense') continue;
    if (tx.date < start || tx.date > end) continue;
    const day = new Date(tx.date).getDay();
    if (day === 5 || day === 6 || day === 0) weekend += -tx.amountCents;
    else weekday += -tx.amountCents;
  }
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1);
  const weekendDays = Math.max(1, Math.round((days / 7) * 3));
  const weekdayDays = Math.max(1, days - weekendDays);
  const weekendAvg = weekend / weekendDays;
  const weekdayAvg = weekday / weekdayDays;
  if (weekdayAvg <= 0 || weekendAvg / weekdayAvg < 1.8 || weekend < 20_000) return [];
  const multiplier = Math.round((weekendAvg / weekdayAvg) * 10) / 10;
  return [
    {
      id: `weekend:${multiplier}`,
      severity: 'pattern',
      impactCents: Math.round((weekendAvg - weekdayAvg) * weekendDays * (365 / days)),
      icon: 'party-popper',
      titleKey: 'ins.weekend.title',
      detailKey: 'ins.weekend.detail',
      params: { x: multiplier, weekend: Math.round(weekendAvg), weekday: Math.round(weekdayAvg) },
      actionTo: '/overview/expense',
    },
  ];
}

/** a budget that overshot three periods in a row wants a realistic limit */
export function budgetRealityCheck(inputs: InsightInputs): Insight[] {
  const out: Insight[] = [];
  for (const budget of inputs.budgets) {
    if (budget.deleted !== 0) continue;
    const current = cycleIndex(budget, inputs.today);
    if (current < 3) continue;
    const family = budgetFamily(budget.catIds, inputs.catalog);
    const spends = [1, 2, 3].map((back) => budgetSpentCents(inputs.txs, family, budgetPeriodAt(budget, current - back)));
    if (!spends.every((spent) => spent > budget.amountCents)) continue;
    const suggested = Math.round(spends.reduce((sum, s) => sum + s, 0) / spends.length / 100) * 100;
    out.push({
      id: `budget:${budget.id}:${suggested}`,
      severity: 'pattern',
      impactCents: (suggested - budget.amountCents) * 12,
      icon: 'wallet-outline',
      titleKey: 'ins.budget.title',
      detailKey: 'ins.budget.detail',
      params: { name: budget.name, limit: budget.amountCents, suggested },
      chart: spends.slice().reverse(),
      actionTo: `/budgets/${budget.id}/edit`,
    });
  }
  return out;
}

// ── wins ────────────────────────────────────────────────────────────────

/** €25/month extra on the biggest debt: months and interest saved.
 *  Monthly payers only — the claim is per MONTH, and a weekly or yearly
 *  cadence (arc 3) would make that copy lie. */
export function debtAcceleration(inputs: InsightInputs): Insight[] {
  const EXTRA = 2_500;
  const monthlyCadence = (a: AccountRow) => !a.paymentEvery || (a.paymentEvery === 'month' && (a.paymentEveryN ?? 1) === 1);
  const candidates = inputs.loans
    .filter((a) => a.deleted === 0 && a.archived !== 1 && a.paymentCents && a.interestPctYear && monthlyCadence(a))
    .map((loan) => ({ loan, remaining: Math.max(0, -loan.balanceCents) }))
    .filter((c) => c.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);
  const top = candidates[0];
  if (!top) return [];
  const base = projectPayoff(top.remaining, top.loan.paymentCents, top.loan.interestPctYear, inputs.today);
  const boosted = projectPayoff(top.remaining, top.loan.paymentCents! + EXTRA, top.loan.interestPctYear, inputs.today);
  if (!base || !boosted) return [];
  const monthsSaved = base.months - boosted.months;
  const interestSaved = base.totalInterestCents - boosted.totalInterestCents;
  if (monthsSaved < 2 || interestSaved < 2_000) return [];
  return [
    {
      id: `debtacc:${top.loan.id}:${top.remaining}`,
      severity: 'win',
      impactCents: interestSaved,
      icon: 'rocket-launch-outline',
      titleKey: 'ins.debtacc.title',
      detailKey: 'ins.debtacc.detail',
      params: { name: top.loan.name, extra: EXTRA, months: monthsSaved, interest: interestSaved },
      actionTo: `/debts/${top.loan.id}`,
    },
  ];
}

// ── the engine ──────────────────────────────────────────────────────────

const DETECTORS = [priceCreep, subscriptionOverlap, smallHabit, weekendMultiplier, budgetRealityCheck, debtAcceleration];
const MAX_WINS = 2;

/** every detector, ranked by yearly impact; wins capped so praise never buries a leak */
export function collectInsights(inputs: InsightInputs): Insight[] {
  const all = DETECTORS.flatMap((detect) => detect(inputs));
  const work = all.filter((i) => i.severity !== 'win').sort((a, b) => b.impactCents - a.impactCents);
  const wins = all.filter((i) => i.severity === 'win').sort((a, b) => b.impactCents - a.impactCents).slice(0, MAX_WINS);
  return [...work, ...wins];
}
