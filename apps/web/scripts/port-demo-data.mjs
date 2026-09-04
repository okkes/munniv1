// One-shot port of the legacy built-in category catalog and demo dataset.
// Usage: node scripts/port-demo-data.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const legacySrc = path.resolve(here, '../../legacy/src');
const outDomain = path.resolve(here, '../src/domain/categories.ts');
const outDemo = path.resolve(here, '../src/db/demo-data.ts');

const { CATEGORIES } = await import(pathToFileURL(path.join(legacySrc, 'shared/data/categories.js')));
const { DEMO_ACCOUNTS, DEMO_TXS } = await import(pathToFileURL(path.join(legacySrc, 'features/accounts/data.js')));

const TYPE_MAP = {
  Expense: 'expense',
  Income: 'income',
  Saving: 'saving',
  Transfer: 'transfer',
  Investment: 'investment',
  'Debt Payment': 'debtPayment',
  Adjustment: 'adjustment',
};

const catTypes = (cat) => (cat.types ?? (cat.type ? [cat.type] : [])).map((t) => TYPE_MAP[t]);
const catDirection = (cat) => {
  if (cat.direction) return cat.direction;
  if (cat.types && cat.types.length > 1) return 'both';
  const t = cat.type || cat.types?.[0];
  return t === 'Income' ? 'credit' : t === 'Expense' ? 'debit' : 'both';
};

// verify every category id has a translation key
const enSource = readFileSync(path.resolve(here, '../src/i18n/en.ts'), 'utf8');
const missingKeys = Object.keys(CATEGORIES).filter((id) => !enSource.includes(`'cat.${id}'`));
if (missingKeys.length) console.warn('categories missing i18n keys:', missingKeys.join(', '));

const catEntries = Object.values(CATEGORIES).map((cat) => {
  const entry = {
    id: cat.id,
    ...(cat.parent ? { parentId: cat.parent } : {}),
    nameKey: `cat.${cat.id}`,
    icon: cat.icon,
    ...(cat.color ? { color: cat.color } : {}),
    ...(cat.isParent ? { isParent: true } : {}),
    ...(cat.hidden ? { hidden: true } : {}),
    ...(cat.positive ? { positive: true } : {}),
    txTypes: catTypes(cat),
    direction: catDirection(cat),
  };
  return `  ${JSON.stringify(entry)},`;
});

writeFileSync(
  outDomain,
  `// GENERATED from apps/legacy/src/shared/data/categories.js by scripts/port-demo-data.mjs.
// Built-in categories are a static catalog (not synced DB rows); only custom
// categories live in the database.
import type { TxType } from '@/db/types';

export type CatDirection = 'credit' | 'debit' | 'both';

export interface BuiltinCategory {
  id: string;
  parentId?: string;
  nameKey: string; // 'cat.{id}' translation key
  icon: string;
  color?: string;
  isParent?: boolean;
  hidden?: boolean;
  positive?: boolean;
  txTypes: TxType[];
  direction: CatDirection;
}

export const BUILTIN_CATEGORIES: BuiltinCategory[] = [
${catEntries.join('\n')}
];

export const CATEGORY_BY_ID: ReadonlyMap<string, BuiltinCategory> = new Map(
  BUILTIN_CATEGORIES.map((c) => [c.id, c]),
);

export const childrenOf = (parentId: string): BuiltinCategory[] =>
  BUILTIN_CATEGORIES.filter((c) => c.parentId === parentId);

export const UNCATEGORIZED_ID = 'uncategorized';
`,
);

// ── demo dataset ────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const cents = (n) => Math.round(n * 100);
const daysAgo = (iso) => Math.round((Date.now() - new Date(iso).getTime()) / DAY);

const accounts = DEMO_ACCOUNTS.map((a) => ({
  id: a.id,
  name: a.name,
  type: a.type,
  iban: a.iban,
  bankId: a.bankId,
  color: a.color,
  balanceCents: cents(a.balance),
}));

const txs = DEMO_TXS.map((t) => ({
  id: t.id,
  daysAgo: daysAgo(t.date),
  time: t.time,
  merchant: t.merchant,
  desc: t.desc,
  cat: t.cat,
  amountCents: cents(t.amount),
  account: t.account,
  ...(t.cats ? { splits: t.cats.map((s) => ({ catId: s.catId, amountCents: cents(s.amount) })) } : {}),
  ...(t.needsReview ? { needsReview: true } : {}),
  ...(t.confidence != null ? { confidence: t.confidence } : {}),
  ...(t.reimbursements
    ? { reimbursements: t.reimbursements.map((r) => ({ txId: r.txId, amountCents: cents(r.amount) })) }
    : {}),
}));

writeFileSync(
  outDemo,
  `// GENERATED from apps/legacy/src/features/accounts/data.js by scripts/port-demo-data.mjs.
// Dates are day-offsets so the demo dataset is always recent relative to
// seeding time.
export interface DemoAccount {
  id: string;
  name: string;
  type: string;
  iban: string;
  bankId: string;
  color: string;
  balanceCents: number;
}

export interface DemoTx {
  id: string;
  daysAgo: number;
  time: string;
  merchant: string;
  desc: string;
  cat: string;
  amountCents: number;
  account: string;
  splits?: { catId: string; amountCents: number }[];
  needsReview?: boolean;
  confidence?: number;
  reimbursements?: { txId: string; amountCents: number }[];
}

export const DEMO_ACCOUNTS: DemoAccount[] = ${JSON.stringify(accounts, null, 2)};

export const DEMO_TXS: DemoTx[] = [
${txs.map((t) => `  ${JSON.stringify(t)},`).join('\n')}
];
`,
);

console.log(`categories: ${catEntries.length}, demo accounts: ${accounts.length}, demo txs: ${txs.length}`);
