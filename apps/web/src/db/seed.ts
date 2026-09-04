import { CATEGORY_BY_ID } from '@/domain/categories';
import { kindOf } from '@/domain/txKind';
import type { TxType } from './types';
import type { Repo } from './repo';
import { DEMO_ACCOUNTS, DEMO_TXS } from './demo-data';

export const DEMO_SPACE_ID = 'demo_space';
// bump when the demo dataset changes so returning demo users reseed
const SEED_FLAG = 'seeded_demo_v4';

// local date, matching the local-time period math in domain/periods.ts —
// a daysAgo:0 row must always fall inside the current local budget period
export const isoDaysAgo = (daysAgo: number): string => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const txTypeFor = (catId: string): TxType => CATEGORY_BY_ID.get(catId)?.txTypes[0] ?? 'expense';

/**
 * Seed the demo identity's database from the bundled dataset (idempotent).
 * Dates are relative to "now" so the demo always looks alive. Logging out
 * of demo deletes the whole database, so the next login reseeds a pristine
 * state — demo changes never leave the device.
 */
export async function seedDemoIfNeeded(repo: Repo): Promise<void> {
  if (await repo.store.metaGet(SEED_FLAG)) return;

  await repo.upsert('space', DEMO_SPACE_ID, DEMO_SPACE_ID, {
    name: 'Demo',
    kind: 'personal',
    currency: 'EUR',
    periodType: 'month',
    periodDay: 1,
  });

  for (const account of DEMO_ACCOUNTS) {
    await repo.upsert('account', DEMO_SPACE_ID, account.id, {
      name: account.name,
      type: account.type as never,
      source: 'manual',
      currency: 'EUR',
      balanceCents: account.balanceCents,
      iban: account.iban,
      bankId: account.bankId,
      color: account.color,
    });
  }

  // one custom main + sub so the category system is visible in demo:
  // "Padel Club" (expense main with its locked Other) and a credit-only
  // sub under the builtin Income parent
  await repo.upsert('category', DEMO_SPACE_ID, 'demo_cat_padel', {
    name: 'Padel Club',
    icon: 'tennis',
    color: '#1ABC9C',
    txType: 'expense',
    isParent: 1,
    sortOrder: 999,
    builtin: 0,
  });
  await repo.upsert('category', DEMO_SPACE_ID, 'demo_cat_padel_other', {
    parentId: 'demo_cat_padel',
    name: 'Other',
    icon: 'tennis',
    color: '',
    txType: 'expense',
    direction: 'both',
    isOther: 1,
    sortOrder: 9999,
    builtin: 0,
  });
  await repo.upsert('category', DEMO_SPACE_ID, 'demo_cat_sidegig', {
    parentId: 'income',
    name: 'Side gig',
    icon: 'laptop',
    color: '',
    txType: 'income',
    direction: 'credit',
    sortOrder: 999,
    builtin: 0,
  });

  for (const tx of DEMO_TXS) {
    const txType = txTypeFor(tx.cat);
    await repo.upsert('transaction', DEMO_SPACE_ID, tx.id, {
      accountId: tx.account,
      date: isoDaysAgo(tx.daysAgo),
      time: tx.time,
      amountCents: tx.amountCents,
      currency: 'EUR',
      merchant: tx.merchant,
      description: tx.desc,
      catId: tx.cat,
      splits: tx.splits,
      txType,
      // kind model: a transfer-family row always names its counterparty —
      // the demo's savings transfers move demo_main → demo_save
      ...(kindOf(txType) === 'transfer' ? { linkedAccountId: 'demo_save' } : {}),
      needsReview: tx.needsReview ? 1 : 0,
      reimbursements: tx.reimbursements?.map((r) => ({ txId: r.txId, amountCents: r.amountCents })),
    });
  }

  // every other feature (budgets, goals, debts, events, allocation,
  // recurring + subscription price history, portfolio) so the demo shows
  // each surface working — date-relative, wiped on logout. Skipped under
  // the unit-test runner: feature specs assert against the lean demo and
  // control their own budgets/goals/etc.; demo-rich.test.ts covers this.
  if (!import.meta.env.VITEST) {
    const { seedRichDemo } = await import('./demo-rich');
    await seedRichDemo(repo);
  }

  await repo.store.metaPut(SEED_FLAG, Date.now());
}
