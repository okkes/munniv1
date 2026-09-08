// munni — mock data: transactions, categories, budgets, accounts, etc.

const CATEGORIES = {
  housing:    { id: 'housing',    name: 'Housing',       icon: 'house',  group: 'Essentials' },
  groceries:  { id: 'groceries',  name: 'Groceries',     icon: 'shop',   group: 'Consumptions', parent: 'consumptions' },
  restaurants:{ id: 'restaurants',name: 'Restaurants',   icon: 'fork',   group: 'Consumptions', parent: 'consumptions' },
  coffee:     { id: 'coffee',     name: 'Coffee',        icon: 'flame',  group: 'Consumptions', parent: 'consumptions' },
  transport:  { id: 'transport',  name: 'Transport',     icon: 'car',    group: 'Transport' },
  health:     { id: 'health',     name: 'Health',        icon: 'health', group: 'Health' },
  hobby:      { id: 'hobby',      name: 'Hobby',         icon: 'bag',    group: 'Hobby' },
  subs:       { id: 'subs',       name: 'Subscriptions', icon: 'film',   group: 'Recurring' },
  income:     { id: 'income',     name: 'Income',        icon: 'arrow-dn-right', group: 'Income', positive: true },
  reimburse:  { id: 'reimburse',  name: 'Reimbursement', icon: 'link',   group: 'Income', positive: true },
  invest:     { id: 'invest',     name: 'Investment',    icon: 'rocket', group: 'Savings' },
  savings:    { id: 'savings',    name: 'Savings',       icon: 'piggy',  group: 'Savings' },
};

const ACCOUNTS = [
  { id: 'main', name: 'Main · ING',     iban: 'NL47…4231', balance: 5240.18, type: 'checking', color: '#4A6A4F' },
  { id: 'save', name: 'Savings · ING',  iban: 'NL47…7782', balance: 3120.50, type: 'savings',  color: '#A8782B' },
  { id: 'inv',  name: 'Brokerage · DEGIRO', iban: 'NL47…1015', balance: 365.00, type: 'invest', color: '#5E4A78' },
];

// Transactions — current period (Jan 20 → Feb 19)
const TRANSACTIONS = [
  // Today (Feb 18)
  { id: 't1',  date: '2026-02-18', time: '13:24', merchant: 'Vapiano',           desc: 'VAPIANO 1234 AMSTERDAM',     cat: 'restaurants', amount: -18.40, account: 'main', confidence: 92 },
  { id: 't2',  date: '2026-02-18', time: '11:08', merchant: 'Albert Heijn',      desc: 'AH 5821 AMS-CENTRAAL',       cat: 'groceries',   amount: -42.10, account: 'main', confidence: 99, hasReceipt: true },
  { id: 't3',  date: '2026-02-18', time: '08:00', merchant: 'Acme Salary',       desc: 'ACME BV PAYROLL FEB',        cat: 'income',      amount: 2480.00, account: 'main' },
  // Yesterday (Feb 17)
  { id: 't4',  date: '2026-02-17', time: '20:14', merchant: 'Spotify',           desc: 'SPOTIFY P34520',             cat: 'subs',        amount: -9.99,  account: 'main', recurring: true },
  { id: 't5',  date: '2026-02-17', time: '17:38', merchant: 'NS · Sprinter',     desc: 'NS REIZIGERS 2026',          cat: 'transport',   amount: -12.20, account: 'main' },
  { id: 't6',  date: '2026-02-17', time: '12:50', merchant: 'Apotheek Centraal', desc: 'APOTHEEK 7842',              cat: 'health',      amount: -8.50,  account: 'main', confidence: 71, needsReview: true },
  { id: 't7',  date: '2026-02-17', time: '19:20', merchant: 'Friend · Tikkie',   desc: 'TIKKIE J. DE VRIES',         cat: 'reimburse',   amount: 9.20,   account: 'main', linkedTo: 't1' },
  // Mon Feb 16
  { id: 't8',  date: '2026-02-16', time: '21:00', merchant: 'Amazon.nl',         desc: 'AMZN MKTPLC 49281',          cat: 'hobby',       amount: -34.99, account: 'main', confidence: 54, needsReview: true },
  { id: 't9',  date: '2026-02-16', time: '09:00', merchant: 'Rent · Stadgenoot', desc: 'STADGENOOT HUUR FEB',        cat: 'housing',     amount: -740.00,account: 'main', recurring: true },
  { id: 't10', date: '2026-02-16', time: '08:30', merchant: 'Koffie ☕',         desc: 'TOKI ESPRESSO',              cat: 'coffee',      amount: -3.80,  account: 'main' },
  // Earlier
  { id: 't11', date: '2026-02-14', time: '20:00', merchant: "L'Osteria",         desc: "L'OSTERIA AMS",              cat: 'restaurants', amount: -32.00, account: 'main' },
  { id: 't12', date: '2026-02-13', time: '11:00', merchant: 'Albert Heijn',      desc: 'AH 5821',                    cat: 'groceries',   amount: -28.40, account: 'main' },
  { id: 't13', date: '2026-02-12', time: '10:00', merchant: 'DEGIRO Buy',        desc: 'DEGIRO MTHLY ETF',           cat: 'invest',      amount: -300.00,account: 'main', recurring: true },
  { id: 't14', date: '2026-02-10', time: '16:00', merchant: 'Etos',              desc: 'ETOS 0341',                  cat: 'health',      amount: -14.20, account: 'main', needsReview: true },
  { id: 't15', date: '2026-02-08', time: '20:30', merchant: 'Vapiano',           desc: 'VAPIANO 1234',               cat: 'restaurants', amount: -22.50, account: 'main' },
  { id: 't16', date: '2026-02-05', time: '12:00', merchant: 'Albert Heijn',      desc: 'AH 5821',                    cat: 'groceries',   amount: -38.10, account: 'main' },
  { id: 't17', date: '2026-02-03', time: '21:30', merchant: 'Five Guys',         desc: 'FIVEGUYS AMS',               cat: 'restaurants', amount: -22.50, account: 'main' },
  { id: 't18', date: '2026-02-01', time: '08:00', merchant: 'Netflix',           desc: 'NETFLIX SUBSCR',             cat: 'subs',        amount: -13.99, account: 'main', recurring: true, needsReview: true },
  { id: 't19', date: '2026-01-30', time: '14:00', merchant: 'NS · OV Chip',      desc: 'NS REIZIGERS',               cat: 'transport',   amount: -38.20, account: 'main' },
  { id: 't20', date: '2026-01-28', time: '20:00', merchant: 'Sushi Place',       desc: 'SUSHITIME AMS',              cat: 'restaurants', amount: -22.50, account: 'main' },
  { id: 't21', date: '2026-01-26', time: '11:00', merchant: 'Albert Heijn',      desc: 'AH 5821',                    cat: 'groceries',   amount: -56.20, account: 'main' },
  { id: 't22', date: '2026-01-24', time: '15:00', merchant: 'Bol.com',           desc: 'BOL.COM 02938',              cat: 'hobby',       amount: -45.00, account: 'main', needsReview: true },
  { id: 't23', date: '2026-01-22', time: '09:00', merchant: 'Koffie ☕',         desc: 'TOKI ESPRESSO',              cat: 'coffee',      amount: -3.80,  account: 'main' },
  { id: 't24', date: '2026-01-20', time: '08:00', merchant: 'Eneco',             desc: 'ENECO ENERGIE',              cat: 'housing',     amount: -65.00, account: 'main', recurring: true },
];

// Budgets — same shape as wireframe
const BUDGETS = [
  { id: 'b1', name: 'Restaurants',  icon: 'fork',  spent: 95.40,  total: 120, period: 'Weekly',   renew: 'every week',    cats: ['restaurants', 'coffee'], stack: false },
  { id: 'b2', name: 'Groceries',    icon: 'shop',  spent: 164.80, total: 300, period: 'Monthly',  renew: 'every month',   cats: ['groceries'], stack: true, stackMax: 600, stackCur: 30 },
  { id: 'b3', name: 'Transport',    icon: 'car',   spent: 50.40,  total: 80,  period: 'Monthly',  renew: 'every month',   cats: ['transport'], stack: false },
  { id: 'b4', name: 'Hobby',        icon: 'bag',   spent: 79.99,  total: 200, period: '2 weeks',  renew: 'every 2 weeks', cats: ['hobby'], stack: false },
  { id: 'b5', name: 'Coffee runs',  icon: 'flame', spent: 18.00,  total: 60,  period: '3 weeks',  renew: 'every 3 weeks', cats: ['coffee'], stack: true, stackMax: 120, stackCur: 42 },
];

const RECURRING = [
  { id: 'r1', name: 'Rent · Stadgenoot', icon: 'house', amount: -740.00, every: 'monthly · 1st',   next: '01 Mar', cat: 'housing', active: true },
  { id: 'r2', name: 'Eneco · Energy',    icon: 'flame', amount: -65.00,  every: 'monthly · 20th',  next: '20 Feb', cat: 'housing', active: true },
  { id: 'r3', name: 'Spotify',           icon: 'film',  amount: -9.99,   every: 'monthly · 17th',  next: '17 Mar', cat: 'subs',    active: true },
  { id: 'r4', name: 'Netflix',           icon: 'film',  amount: -13.99,  every: 'monthly · 1st',   next: '01 Mar', cat: 'subs',    active: true },
  { id: 'r5', name: 'DEGIRO ETF',        icon: 'rocket',amount: -300.00, every: 'monthly · 12th',  next: '12 Mar', cat: 'invest',  active: true },
  { id: 'r6', name: 'Acme Salary',       icon: 'arrow-dn-right', amount: 2480.00, every: 'monthly · 18th', next: '18 Mar', cat: 'income', active: true },
  { id: 'r7', name: 'Audible',           icon: 'film',  amount: -7.95,   every: 'monthly · 22nd',  next: '22 Feb', cat: 'subs',    active: false },
];

const GOALS = [
  { id: 'g1', name: 'Emergency fund',   icon: 'piggy',  current: 2400, target: 6000, by: 'Dec 2026', monthly: 300, color: '#4A6A4F' },
  { id: 'g2', name: 'Trip to Lisbon',   icon: 'globe',  current: 720,  target: 1200, by: 'Jun 2026', monthly: 120, color: '#A8782B' },
  { id: 'g3', name: 'New laptop',       icon: 'box',    current: 380,  target: 1800, by: 'Sep 2026', monthly: 200, color: '#5E4A78' },
];

const EVENTS = [
  { id: 'e1', name: 'Lisbon trip 2025',     start: '2025-09-12', end: '2025-09-19', total: 1186.30, txCount: 28, status: 'closed', icon: 'globe' },
  { id: 'e2', name: 'Anna · Birthday',      start: '2026-01-30', end: '2026-02-02', total: 312.40,  txCount: 9,  status: 'closed', icon: 'star' },
  { id: 'e3', name: 'Berlin weekend',       start: '2026-02-21', end: '2026-02-23', total: 0,       txCount: 0,  status: 'upcoming', icon: 'globe' },
];

// 6-month spend history (for sparklines / category drill-in)
const SPEND_HISTORY = {
  total:       [1340, 1180, 1402, 1290, 1308, 1220],
  restaurants: [62, 88, 71, 102, 84, 95],
  groceries:   [220, 245, 280, 250, 268, 165],
  transport:   [42, 55, 68, 50, 58, 50],
  hobby:       [120, 0, 80, 240, 35, 80],
  coffee:      [22, 28, 35, 30, 28, 18],
  health:      [45, 30, 22, 18, 60, 22],
  housing:     [805, 805, 805, 805, 805, 805],
};

// Investment portfolio (mocked, EUR)
const PORTFOLIO = {
  total: 12480.50,
  contributed: 11200,
  pnl: 1280.50,
  pnlPct: 11.43,
  monthly: 300,
  positions: [
    { ticker: 'VWCE', name: 'FTSE All-World ETF',  alloc: 65, value: 8112.32, change: 1.24 },
    { ticker: 'IUSA', name: 'S&P 500 ETF',         alloc: 20, value: 2496.10, change: 0.86 },
    { ticker: 'IBGS', name: 'EUR Govt Bond ETF',   alloc: 10, value: 1248.05, change: -0.18 },
    { ticker: 'CASH', name: 'Cash',                alloc: 5,  value: 624.03,  change: 0.00 },
  ],
  curve: [10100, 10240, 10800, 10920, 11340, 11200, 11680, 11920, 12120, 12080, 12340, 12480],
};

// Helpers
const fmtEur = (n, opts = {}) => {
  const sign = n < 0 ? '−' : (opts.signed && n > 0 ? '+' : '');
  const abs = Math.abs(n);
  const s = abs.toLocaleString('nl-NL', { minimumFractionDigits: opts.decimals ?? 2, maximumFractionDigits: opts.decimals ?? 2 });
  return `${sign}€${s.replace('.', ',').replace(/,(\d{2})$/, ',$1')}`;
};
const fmtEurInt = n => fmtEur(n, { decimals: 0 });
const fmtDate = (iso, fmt = 'short') => {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (fmt === 'short') return `${d.getDate()} ${months[d.getMonth()]}`;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};
const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date('2026-02-18');
  const diff = Math.floor((today - d) / (86400000));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return `${days[d.getDay()]}, ${fmtDate(iso)}`;
};

// Period totals
const PERIOD = {
  start: '2026-01-20', end: '2026-02-19',
  income: 2480.00,
  expense: 1220.50,
  savings: 640.00,
  invest: 300.00,
  unallocated: 620.00,
  prevExpense: 1308.00,
  prevIncome: 2380.00,
};

Object.assign(window, {
  CATEGORIES, ACCOUNTS, TRANSACTIONS, BUDGETS, RECURRING, GOALS, EVENTS,
  SPEND_HISTORY, PORTFOLIO, PERIOD, fmtEur, fmtEurInt, fmtDate, dayLabel,
});
