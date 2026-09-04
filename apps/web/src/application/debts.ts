import { useMemo } from 'react';
import { useSpaceAccounts } from './transactions';
import { isDebtTracked, loanProgress, loanRemainingCents } from '@/domain/debts';
import { manualBalanceDate } from '@/features/accounts/accountTypes';
import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import type { AccountRow, DebtRow } from '@/db/types';

export interface LoanStatus {
  account: AccountRow;
  remainingCents: number;
  progress: number;
}

/** the space's tracked liability accounts joined with their live story —
 *  active first, archived (paid off) trailing */
export function useLoanStatuses(): LoanStatus[] | undefined {
  const accounts = useSpaceAccounts();
  return useMemo(() => {
    if (!accounts) return undefined;
    const loans = accounts.filter((a) => a.deleted === 0 && isDebtTracked(a));
    loans.sort((a, b) => (a.archived ?? 0) - (b.archived ?? 0) || a.name.localeCompare(b.name));
    return loans.map((account) => {
      const remainingCents = loanRemainingCents(account);
      return { account, remainingCents, progress: loanProgress(account, remainingCents) };
    });
  }, [accounts]);
}

/** deterministic account id for an account-less debt's minted loan —
 *  two devices folding the same debt converge instead of duplicating */
export const foldedLoanAccountId = (debtId: string): string => `loanacct_${debtId}`;

const STORY_FIELDS = ['interestPctYear', 'originalCents', 'note', 'paymentCents', 'paymentEvery', 'paymentEveryN', 'merchantKey'] as const;

/** mint the missing backing account at the debt's remaining value
 *  (deterministic id — see foldedLoanAccountId) */
async function mintFoldedAccount(store: StorageBackend, repo: Repo, debt: DebtRow): Promise<string> {
  const targetId = foldedLoanAccountId(debt.id);
  if (!(await store.get('account', targetId))) {
    const space = await store.get('space', debt.spaceId);
    await repo.upsert('account', debt.spaceId, targetId, {
      name: debt.name,
      type: 'loan',
      source: 'manual',
      currency: space?.currency ?? 'EUR',
      balanceCents: -Math.max(0, debt.remainingCents ?? debt.originalCents ?? 0),
      balanceAsOf: manualBalanceDate(),
    });
  }
  return targetId;
}

/** the field writes one debt asks of its account — blank-only copies
 *  (a field the account already carries won), tracked by definition,
 *  and the paid-off story mapped by type */
function foldedFields(debt: DebtRow, account: AccountRow | undefined): Partial<AccountRow> {
  const fields: Partial<AccountRow> = {};
  for (const key of STORY_FIELDS) {
    const value = debt[key as keyof DebtRow];
    if (value !== undefined && account?.[key] === undefined) (fields as Record<string, unknown>)[key] = value;
  }
  // it WAS a debt — it stays one, whatever the account type defaults say
  if (account?.trackAsDebt === undefined) fields.trackAsDebt = 1;
  // the paid-off story: an archived loan archives its account (the
  // milestone keeps its history); an archived CARD debt just stops
  // tracking — the card itself is still a live account
  if (debt.archived === 1) {
    if ((account?.type ?? 'loan') === 'credit') fields.trackAsDebt = 0;
    else if (account?.archived !== 1) fields.archived = 1;
  }
  return fields;
}

/**
 * Loans v2 boot fold: every live debt row collapses into its liability
 * account — story fields copy over, account-less debts mint a manual
 * loan account at their remaining value, and the debt row tombstones.
 * Runs on EVERY boot, not behind a marker: it's idempotent, the table
 * is tiny, and a debt syncing in later from an old device gets folded
 * the same way instead of stranding invisibly.
 */
export async function foldDebtsIntoAccounts(store: StorageBackend, repo: Repo): Promise<void> {
  const debts = (await store.allRows('debt')).filter((d) => d.deleted === 0);
  for (const debt of debts) {
    const account = debt.accountId ? await store.get('account', debt.accountId) : undefined;
    const targetId = account?.id ?? (await mintFoldedAccount(store, repo, debt));
    const fields = foldedFields(debt, account);
    if (Object.keys(fields).length > 0) {
      await repo.upsert('account', account?.spaceId ?? debt.spaceId, targetId, fields);
    }
    await repo.remove('debt', debt.spaceId, debt.id);
  }
}
