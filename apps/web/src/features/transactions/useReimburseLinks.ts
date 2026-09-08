import { useTxTransform } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { useLang } from '@/i18n';
import {
  clampReimbursement,
  creditRemainingCents,
  givenCents,
  settledSplits,
  totalReimbursedCents,
  withLink,
} from '@/domain/reimbursement';
import { reimbEarmarkCents } from '@/domain/reimburseMatch';
import type { TxReimbursement } from '@/db/types';
import { REIMBURSED_ID, UNCATEGORIZED_ID } from '@/domain/categories';
import { catName, useCategories } from '@/features/categories/useCategories';

/**
 * The one place reimbursement links are written — shared by the
 * detail-screen section and the full-screen picker so MERGE semantics
 * (old + new, both directions) and the gross-splits invariant can never
 * drift apart.
 */
export function useReimburseLinks(allTxs: SpaceTx[] | undefined) {
  const transform = useTxTransform();
  const cats = useCategories();
  const { t } = useLang();
  const nameOf = (id: string) => catName(cats.byId(id), t);

  // settlement rewrites category attribution (redesign, docs/
  // reimbursement-redesign.md): slices keep the GROSS truth and the
  // settled value moves into an explicit `reimbursed` slice on BOTH sides
  const expensePatch = (expense: SpaceTx, newLinks: TxReimbursement[]) => ({
    reimbursements: newLinks,
    splits: settledSplits(expense, totalReimbursedCents({ reimbursements: newLinks }), nameOf),
  });

  // a settled credit deserves a real category instead of "Uncategorized"
  // (user remark): the moment it is linked it self-files as Reimbursed,
  // unless the user already picked something deliberately
  const creditPatch = (credit: SpaceTx, newGivenCents: number) => {
    const selfFiles = (!credit.catId || credit.catId === UNCATEGORIZED_ID || credit.needsReview === 1) && newGivenCents > 0;
    const catId = selfFiles ? REIMBURSED_ID : credit.catId;
    return {
      ...(selfFiles ? { catId, txType: 'income' as const, needsReview: 0 as const } : {}),
      splits: settledSplits({ ...credit, catId }, newGivenCents, nameOf),
    };
  };

  /** what the credit can still give — capped by its reimbursement
   *  earmark when it carries one (a split's received-reimb slice funds
   *  links; its groceries slice never does — user rule 2026-07-28) */
  const giveableCents = (credit: SpaceTx): number => {
    const given = givenCents(allTxs ?? [], credit.id);
    const net = creditRemainingCents(credit, given);
    const earmark = reimbEarmarkCents(credit);
    return earmark === null ? net : Math.max(0, Math.min(net, earmark - given));
  };

  /** link `cents` of `credit` against `expense`, MERGING into any
   *  existing link between the two (both directions call this) */
  const link = (expense: SpaceTx, credit: SpaceTx, cents: number): void => {
    const clamped = clampReimbursement(expense, giveableCents(credit), cents);
    if (clamped <= 0) return;
    const prev = (expense.reimbursements ?? []).find((r) => r.txId === credit.id)?.amountCents ?? 0;
    void transform(expense, expensePatch(expense, withLink(expense.reimbursements, credit.id, prev + clamped)), 'reimburse');
    void transform(credit, creditPatch(credit, givenCents(allTxs ?? [], credit.id) + clamped), null); // one line per gesture, not per side
  };

  /** remove the link between the two (either side's unlink button) */
  const unlink = (expense: SpaceTx, credit: SpaceTx): void => {
    const removed = (expense.reimbursements ?? []).find((r) => r.txId === credit.id)?.amountCents ?? 0;
    void transform(expense, expensePatch(expense, withLink(expense.reimbursements, credit.id, 0)), 'reimburse');
    void transform(credit, creditPatch(credit, givenCents(allTxs ?? [], credit.id) - removed), null);
  };

  return { link, unlink, giveableCents };
}
