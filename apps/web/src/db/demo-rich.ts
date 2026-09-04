import type { Repo } from './repo';
import { DEMO_SPACE_ID } from './seed';

/**
 * Rich demo seeding (user request): every feature ships with living,
 * date-relative data so a first-time demo user sees each surface work
 * immediately. All dates are computed from "now", so the profile never
 * ages — and demo logout wipes the db, so a fresh login reseeds clean.
 *
 * Edge cases are deliberate: an over-budget category, a nearly-complete
 * goal, a high-interest card, a yearly insurance, a subscription price
 * hike, a running event, crypto + a dividend in the portfolio.
 */

const now = () => new Date();
const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number): string => iso(new Date(Date.now() - n * 86_400_000));
const daysAhead = (n: number): string => iso(new Date(Date.now() + n * 86_400_000));
/** first day of the current local month — budget/allocation anchors */
const monthStartIso = (): string => iso(new Date(now().getFullYear(), now().getMonth(), 1));
/** an ISO date on `day` of the month `offset` months from now */
const monthDay = (offset: number, day: number): string => {
  const base = new Date(now().getFullYear(), now().getMonth() + offset, 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const candidate = new Date(base.getFullYear(), base.getMonth(), Math.min(day, last));
  if (candidate <= now()) return iso(candidate);
  // never strand a row in the future (caught on Aug 1: "this month's
  // 4th" hadn't happened) — an unarrived current-month day slides back
  const prev = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  const prevLast = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
  return iso(new Date(prev.getFullYear(), prev.getMonth(), Math.min(day, prevLast)));
};

export async function seedRichDemo(repo: Repo): Promise<void> {
  await seedIncome(repo);
  await seedHistory(repo);
  await seedRecurring(repo);
  await seedBudgets(repo);
  await seedGoals(repo);
  await seedDebts(repo);
  await seedEvents(repo);
  await seedAllocation(repo);
  await seedPortfolio(repo);
}

// ── recent income: keeps the salary pattern current so this-period
//    tiles, trends and the payday forecast all have something to show ──
async function seedIncome(repo: Repo): Promise<void> {
  const credit = (id: string, date: string, cents: number, merchant: string, cat: string, desc: string) =>
    repo.upsert('transaction', DEMO_SPACE_ID, id, {
      accountId: 'demo_main', date, amountCents: cents, currency: 'EUR', merchant,
      catId: cat, txType: 'income', needsReview: 0, description: desc,
    } as never);
  // salary on the 24th, six months of history ending at the most
  // recent 24th that has already passed (never seed a future charge —
  // that keeps "safe to spend until payday" and the tiles honest)
  const today = iso(now());
  const latestPast = today.slice(8) >= '24' ? 0 : -1; // this month's 24th passed?
  for (let i = 0; i < 6; i++) {
    await credit(`demo_sal_${i}`, monthDay(latestPast - i, 24), 240_000, 'Demo Corp BV', 'salary', 'DEMO CORP BV SALARIS');
  }
  // a smaller irregular side gig — populates the custom Side gig category
  await credit('demo_sidegig_1', daysAgo(12), 45_000, 'Freelance Client', 'demo_cat_sidegig', 'INVOICE #204');
}


// ── six months of everyday spending (user request): budgets, trends and
//    the new per-cycle bars all get real long-term shapes. Fixed rotas,
//    not randomness — the seed must be idempotent and test-stable. ──────
async function seedHistory(repo: Repo): Promise<void> {
  const spend = (id: string, date: string, cents: number, merchant: string, cat: string, review = 0) =>
    repo.upsert('transaction', DEMO_SPACE_ID, id, {
      accountId: 'demo_main', date, amountCents: -cents, currency: 'EUR', merchant,
      catId: review ? 'uncategorized' : cat, txType: 'expense', needsReview: review, description: merchant.toUpperCase(),
    } as never);

  // weekly groceries — amounts rotate so no two cycles look identical
  const grocery = [5230, 4875, 6120, 3990];
  for (let week = 1; week <= 26; week += 1) {
    await spend(`demo_hist_ah_${week}`, daysAgo(week * 7 + 2), grocery[week % 4], 'Albert Heijn', 'groceries');
  }
  // dining out twice a month + takeout once
  const dinner = [4650, 3400, 5450, 2900];
  for (let m = 0; m < 6; m += 1) {
    await spend(`demo_hist_din_${m}a`, monthDay(-m, 4), dinner[m % 4], 'Bistro Zwaan', 'restaurants');
    await spend(`demo_hist_din_${m}b`, monthDay(-m, 17), dinner[(m + 1) % 4], 'Demo Restaurant', 'restaurants');
    await spend(`demo_hist_din_${m}c`, monthDay(-m, 8), 3890, 'Thuisbezorgd', 'takeout');
  }
  // utilities + transport, monthly rhythms
  for (let m = 0; m < 6; m += 1) {
    await spend(`demo_hist_water_${m}`, monthDay(-m, 3), 2850, 'Waternet', 'housingUtility');
    await spend(`demo_hist_ns_${m}`, monthDay(-m, 6), 4500, 'NS Groep', 'transportPublic');
    if (m % 2 === 0) await spend(`demo_hist_fuel_${m}`, monthDay(-m, 20), 6240, 'Shell', 'transportFuel');
  }
  // the typed-splits showcase (v2): the phone bill is TWO kinds of money
  // — telecom plus paying the device off. Counterparty-less debt part →
  // the default-loan bucket; amounts unchanged, so every pinned total
  // stays put.
  await repo.upsert('transaction', DEMO_SPACE_ID, 'demo_split_phone', {
    accountId: 'demo_main', date: monthDay(0, 2), amountCents: -6500, currency: 'EUR',
    merchant: 'Vodafone', catId: 'telecom', txType: 'expense', needsReview: 0,
    description: 'VODAFONE ABONNEMENT + TOESTEL',
    splits: [
      { id: 'demo_split_phone_p1', catId: 'telecom', amountCents: 4000 },
      { id: 'demo_split_phone_p2', label: 'Device plan', catId: 'loanRepayment', amountCents: 2500, txType: 'debtPayment' },
    ],
  } as never);
  // small weekly coffee + occasional fun money
  for (let week = 1; week <= 26; week += 2) {
    await spend(`demo_hist_cof_${week}`, daysAgo(week * 7), 380, 'Coffee District', 'coffee');
  }
  for (let m = 0; m < 6; m += 2) {
    await spend(`demo_hist_fun_${m}`, monthDay(-m, 14), 2400, 'Pathé', 'movie');
    await spend(`demo_hist_shop_${m}`, monthDay(-m, 22), 3499, 'Bol.com', 'shopping');
  }

  // a same-merchant REVIEW pile (user request: exercising bulk apply —
  // confirming one Albert Heijn offers the siblings in one tap)
  await spend('demo_rev_ah_0', daysAgo(1), 2340, 'Albert Heijn', 'groceries', 1);
  await spend('demo_rev_ah_1', daysAgo(3), 5115, 'Albert Heijn', 'groceries', 1);
  await spend('demo_rev_ah_2', daysAgo(5), 1875, 'Albert Heijn', 'groceries', 1);
  await spend('demo_rev_ah_3', daysAgo(6), 4420, 'Albert Heijn', 'groceries', 1);
  // and two more strangers so the queue feels like a real backlog
  await spend('demo_rev_x_0', daysAgo(2), 1799, 'Praxis', 'uncategorized', 1);
  await spend('demo_rev_x_1', daysAgo(4), 899, 'Etos', 'uncategorized', 1);
}

// ── recurring costs + their linked charge history ──────────────────────
async function seedRecurring(repo: Repo): Promise<void> {
  const up = (id: string, fields: Record<string, unknown>) =>
    repo.upsert('recurring', DEMO_SPACE_ID, id, fields as never);
  const charge = (id: string, recId: string, date: string, cents: number, merchant: string, cat: string) =>
    repo.upsert('transaction', DEMO_SPACE_ID, id, {
      accountId: 'demo_main',
      date,
      amountCents: -cents,
      currency: 'EUR',
      merchant,
      catId: cat,
      txType: 'expense',
      needsReview: 0,
      recurringId: recId,
    } as never);

  // rent — the big fixed cost, monthly, with three months of history
  await up('demo_rec_rent', { name: 'Rent', kind: 'fixed', amountCents: 118_000, catId: 'housingRent', every: 'month', dueDay: 1, active: 1 });
  for (let i = 6; i >= 0; i--) await charge(`demo_rent_${i}`, 'demo_rec_rent', monthDay(-i, 1), 118_000, 'Housing Corp', 'housingRent');

  // Netflix — a SUSTAINED price hike (13.99 → 15.99): subscription intel
  await up('demo_rec_netflix', { name: 'Netflix', kind: 'subscription', luxury: 1, amountCents: 1599, catId: 'subs', every: 'month', dueDay: 12, active: 1 });
  const nflx = [1399, 1399, 1399, 1399, 1599, 1599];
  for (let i = 0; i < 6; i++) await charge(`demo_nflx_${i}`, 'demo_rec_netflix', monthDay(i - 5, 12), nflx[i], 'NETFLIX.COM', 'subs');

  // Spotify — a second streaming sub (overlap insight), steady price
  await up('demo_rec_spotify', { name: 'Spotify', kind: 'subscription', luxury: 1, amountCents: 1099, catId: 'subs', every: 'month', dueDay: 5, active: 1 });
  for (let i = 6; i >= 0; i--) await charge(`demo_spot_${i}`, 'demo_rec_spotify', monthDay(-i, 5), 1099, 'Spotify', 'subs');

  // gym — monthly subscription
  await up('demo_rec_gym', { name: 'Basic-Fit', kind: 'subscription', amountCents: 2499, catId: 'gym', every: 'month', dueDay: 2, active: 1 });
  for (let i = 6; i >= 0; i--) await charge(`demo_gym_${i}`, 'demo_rec_gym', monthDay(-i, 2), 2499, 'Basic-Fit', 'gym');

  // yearly insurance — edge case: year cadence, due a few months out
  await up('demo_rec_ins', { name: 'Home insurance', kind: 'fixed', amountCents: 24_000, catId: 'insurance', every: 'year', dueDay: 15, dueMonth: ((now().getMonth() + 3) % 12) + 1, active: 1 });

  // cancelled subscription — edge case: inactive
  await up('demo_rec_disney', { name: 'Disney+', kind: 'subscription', luxury: 1, amountCents: 1199, catId: 'subs', every: 'month', dueDay: 20, active: 0, until: daysAgo(40) });
}

// ── budgets: under, over, and a weekly one ─────────────────────────────
async function seedBudgets(repo: Repo): Promise<void> {
  const up = (id: string, fields: Record<string, unknown>) => repo.upsert('budget', DEMO_SPACE_ID, id, fields as never);
  await up('demo_bud_groceries', { name: 'Groceries', icon: 'cart-variant', amountCents: 45_000, every: 'month', anchor: monthStartIso(), catIds: ['groceries'], active: 1, notifyAtPct: 90 });
  // eating out: small cap so the demo shows an OVER-budget state
  await up('demo_bud_eatout', { name: 'Eating out', icon: 'silverware-fork-knife', amountCents: 8_000, every: 'month', anchor: monthStartIso(), catIds: ['restaurants', 'takeout'], active: 1 });
  await up('demo_bud_fun', { name: 'Fun money', icon: 'party-popper', amountCents: 12_000, every: 'month', anchor: monthStartIso(), catIds: ['entertainment'], active: 1 });
  // weekly coffee budget — edge case: different cadence
  await up('demo_bud_coffee', { name: 'Coffee', icon: 'coffee-outline', amountCents: 1_500, every: 'week', anchor: daysAgo(7), catIds: ['coffee'], active: 1 });

  // a few this-period charges so the budgets have something to score
  const spend = (id: string, cat: string, cents: number, merchant: string, day: number) =>
    repo.upsert('transaction', DEMO_SPACE_ID, id, {
      accountId: 'demo_main', date: monthDay(0, day), amountCents: -cents, currency: 'EUR',
      merchant, catId: cat, txType: 'expense', needsReview: 0,
    } as never);
  await spend('demo_b_g1', 'groceries', 6_240, 'Albert Heijn', Math.min(now().getDate(), 3));
  await spend('demo_b_g2', 'groceries', 4_180, 'Jumbo', Math.min(now().getDate(), 6));
  await spend('demo_b_e1', 'restaurants', 5_450, 'Bistro Zwaan', Math.min(now().getDate(), 4));
  await spend('demo_b_e2', 'takeout', 3_890, 'Thuisbezorgd', Math.min(now().getDate(), 8)); // pushes eat-out over
  await spend('demo_b_f1', 'movie', 2_400, 'Pathé', Math.min(now().getDate(), 5));
}

// ── goals: started, mid, nearly done ───────────────────────────────────
async function seedGoals(repo: Repo): Promise<void> {
  const goal = (id: string, fields: Record<string, unknown>) => repo.upsert('goal', DEMO_SPACE_ID, id, fields as never);
  const contrib = (id: string, goalId: string, cents: number, date: string) =>
    repo.upsert('goalContribution', DEMO_SPACE_ID, id, { goalId, amountCents: cents, date } as never);

  await goal('demo_goal_trip', { name: 'Summer trip', icon: 'airplane', color: '#16A085', targetCents: 200_000, targetDate: daysAhead(120), allocatedCents: 90_000 });
  await contrib('demo_gc_trip1', 'demo_goal_trip', 50_000, daysAgo(60));
  await contrib('demo_gc_trip2', 'demo_goal_trip', 40_000, daysAgo(25));

  // nearly complete — edge case near 100%
  await goal('demo_goal_ef', { name: 'Emergency fund', icon: 'shield-check-outline', color: '#2980B9', targetCents: 500_000, targetDate: daysAhead(30), allocatedCents: 470_000 });
  await contrib('demo_gc_ef1', 'demo_goal_ef', 470_000, daysAgo(200));

  // just started — edge case ~0%
  await goal('demo_goal_laptop', { name: 'New laptop', icon: 'laptop', color: '#9B59B6', targetCents: 180_000, allocatedCents: 15_000 });
  await contrib('demo_gc_lap1', 'demo_goal_laptop', 15_000, daysAgo(10));
}

// ── debts: loan, high-interest card, a friend (loans v2: the account
//    IS the debt — story fields live right on the liability row) ───────
async function seedDebts(repo: Repo): Promise<void> {
  const loan = (id: string, fields: Record<string, unknown>) =>
    repo.upsert('account', DEMO_SPACE_ID, id, { source: 'manual', currency: 'EUR', ...fields } as never);
  // v2 note: these are REAL accounts now, so they honestly weigh on the
  // balance band — sized so the demo stays in the black
  await loan('demo_loan_duo', { name: 'Student loan (DUO)', type: 'loan', balanceCents: -240_000, originalCents: 1_800_000, interestPctYear: 2.56, paymentCents: 9_500 });
  // credit card — edge case: high interest, small balance; the debt
  // story is what puts a card on the debts screen at all
  await loan('demo_loan_card', { name: 'Credit card', type: 'credit', balanceCents: -84_000, originalCents: 120_000, interestPctYear: 14, paymentCents: 15_000 });
  // money lent to a friend — edge case: no interest, no schedule
  await loan('demo_loan_friend', { name: 'Lent to Sam', type: 'loan', balanceCents: -25_000, originalCents: 25_000 });
}

// ── events: running now (with spend) + an archived past trip ────────────
async function seedEvents(repo: Repo): Promise<void> {
  const event = (id: string, fields: Record<string, unknown>) => repo.upsert('event', DEMO_SPACE_ID, id, fields as never);
  await event('demo_evt_bcn', { name: 'Barcelona weekend', icon: 'airplane', color: '#E67E22', from: daysAgo(2), to: daysAhead(2), budgetCents: 60_000 });
  const spend = (id: string, cat: string, cents: number, merchant: string, date: string) =>
    repo.upsert('transaction', DEMO_SPACE_ID, id, {
      accountId: 'demo_main', date, amountCents: -cents, currency: 'EUR', merchant,
      catId: cat, txType: 'expense', needsReview: 0, eventId: 'demo_evt_bcn',
    } as never);
  await spend('demo_ev_1', 'flight', 18_900, 'Vueling', daysAgo(2));
  await spend('demo_ev_2', 'hotel', 21_000, 'Hotel Ramblas', daysAgo(1));
  await spend('demo_ev_3', 'restaurants', 4_650, 'Tapas 24', daysAgo(1));

  // archived past event — edge case
  await event('demo_evt_wed', { name: "Lisa's wedding", icon: 'party-popper', color: '#E91E63', from: daysAgo(120), to: daysAgo(118), budgetCents: 30_000, archived: 1 });
}

// ── allocation: assign this period's money to a few mains ───────────────
async function seedAllocation(repo: Repo): Promise<void> {
  const start = monthStartIso();
  const cell = (id: string, catId: string, cents: number) =>
    repo.upsert('allocation', DEMO_SPACE_ID, id, { periodStart: start, catId, assignedCents: cents } as never);
  await cell('demo_alloc_house', 'housing', 118_000);
  await cell('demo_alloc_food', 'consumption', 50_000);
  await cell('demo_alloc_fun', 'entertainment', 12_000);
  await cell('demo_alloc_save', 'saving', 40_000);
}

// ── portfolio: ETF, stock, crypto, cash + a dividend ────────────────────
async function seedPortfolio(repo: Repo): Promise<void> {
  const holding = (id: string, fields: Record<string, unknown>) => repo.upsert('holding', DEMO_SPACE_ID, id, fields as never);
  const lot = (id: string, holdingId: string, fields: Record<string, unknown>) =>
    repo.upsert('lot', DEMO_SPACE_ID, id, { holdingId, ...fields } as never);

  await holding('demo_h_vwrl', { name: 'Vanguard FTSE All-World', symbol: 'VWRL', assetClass: 'etf', currency: 'EUR', priceSource: 'manual', manualPriceCents: 11_450 });
  await lot('demo_l_vwrl1', 'demo_h_vwrl', { kind: 'buy', date: daysAgo(300), quantity: 20, priceCents: 9_800, totalCents: 196_000 });
  await lot('demo_l_vwrl2', 'demo_h_vwrl', { kind: 'buy', date: daysAgo(90), quantity: 8, priceCents: 10_900, totalCents: 87_200 });
  // dividend — edge case lot kind
  await lot('demo_l_vwrl3', 'demo_h_vwrl', { kind: 'dividend', date: daysAgo(30), totalCents: 4_200 });

  await holding('demo_h_asml', { name: 'ASML Holding', symbol: 'ASML', assetClass: 'stock', currency: 'EUR', priceSource: 'manual', manualPriceCents: 68_500 });
  await lot('demo_l_asml1', 'demo_h_asml', { kind: 'buy', date: daysAgo(200), quantity: 3, priceCents: 60_000, totalCents: 180_000 });

  // crypto — edge case asset class
  await holding('demo_h_btc', { name: 'Bitcoin', symbol: 'BTC', assetClass: 'crypto', currency: 'EUR', priceSource: 'manual', manualPriceCents: 5_800_000 });
  await lot('demo_l_btc1', 'demo_h_btc', { kind: 'buy', date: daysAgo(150), quantity: 0.05, priceCents: 4_200_000, totalCents: 210_000 });

  // uninvested cash sitting at the broker — edge case cash asset
  await holding('demo_h_cash', { name: 'Cash at broker', assetClass: 'cash', currency: 'EUR', priceSource: 'manual', manualPriceCents: 100 });
  await lot('demo_l_cash1', 'demo_h_cash', { kind: 'buy', date: daysAgo(20), quantity: 500, priceCents: 100, totalCents: 50_000 });
}
