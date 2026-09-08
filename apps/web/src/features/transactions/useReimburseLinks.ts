import { useTxTransform } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { useLang } from '@/i18n';
import {
  clampReimbursement,
  creditRemainingCents,
  givenCents,
  isReimbContainer,
  reimbCentsByPart,
  reimbSettleFields,
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
 * (old + new, both directions) and the gross invariant can never drift
 * apart.
 */
export function useReimburseLinks(allTxs: SpaceTx[] | undefined) {
  const transform = useTxTransform();
  const cats = useCategories();
  const { t } = useLang();
  const nameOf = (id: string) => catName(cats.byId(id), t);

  // settlement rewrites category attribution (redesign, docs/
  // reimbursement-redesign.md): slices keep the GROSS truth and the
  // settled value moves into an explicit `reimbursed` slice on BOTH
  // sides. #228 (user): a container's settle lives on the PART each
  // link names — inside the part's own `cats` — never as a pseudo-part
  // in the container's `splits`; the parent is impacted through value
  // math only. A whole row settles inside its own `cats`.
  const expensePatch = (expense: SpaceTx, newLinks: TxReimbursement[]) => ({
    reimbursements: newLinks,
    ...(reimbSettleFields(
      expense,
      totalReimbursedCents({ reimbursements: newLinks }),
      reimbCentsByPart(newLinks, 'partId', expense.splits),
      nameOf,
    ) as Record<string, never>),
  });

  /** every link naming `creditId`, with `expenseId`'s links replaced by
   *  its NEXT state — the write below lands both sides in one gesture,
   *  so the live snapshot is one beat behind */
  const givenView = (creditId: string, expenseId: string, expenseLinks: TxReimbursement[]) => {
    const naming = (allTxs ?? [])
      .flatMap((row) => (row.id === expenseId ? expenseLinks : (row.reimbursements ?? [])))
      .filter((link) => link.txId === creditId);
    return {
      total: naming.reduce((sum, link) => sum + link.amountCents, 0),
      byPart: (splits: SpaceTx['splits']) => reimbCentsByPart(naming, 'creditPartId', splits),
    };
  };

  // a settled credit deserves a real category instead of "Uncategorized"
  // (user remark): the moment it is linked it self-files as Reimbursed,
  // unless the user already picked something deliberately. A split
  // credit never self-files — its parts own their categories.
  const creditPatch = (credit: SpaceTx, view: ReturnType<typeof givenView>) => {
    const selfFiles =
      !isReimbContainer(credit) &&
      (!credit.catId || credit.catId === UNCATEGORIZED_ID || credit.needsReview === 1) &&
      view.total > 0;
    const catId = selfFiles ? REIMBURSED_ID : credit.catId;
    return {
      ...(reimbSettleFields({ ...credit, catId }, view.total, view.byPart(credit.splits), nameOf) as Record<string, never>),
      ...(selfFiles ? { catId, txType: 'income' as const, needsReview: 0 as const } : {}),
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
   *  existing link between the two (both directions call this); a
   *  partId targets one PART of a split expense (#126 r5), a
   *  creditPartId one PART of a split credit (#197) */
  const link = (expense: SpaceTx, credit: SpaceTx, cents: number, partId?: string, creditPartId?: string): void => {
    const clamped = clampReimbursement(expense, giveableCents(credit), cents);
    if (clamped <= 0) return;
    const prev =
      (expense.reimbursements ?? []).find(
        (r) => r.txId === credit.id && r.partId === partId && r.creditPartId === creditPartId,
      )?.amountCents ?? 0;
    const nextLinks = withLink(expense.reimbursements, credit.id, prev + clamped, partId, creditPartId);
    void transform(expense, expensePatch(expense, nextLinks), 'reimburse');
    void transform(credit, creditPatch(credit, givenView(credit.id, expense.id, nextLinks)), null); // one line per gesture, not per side
  };

  /** remove the link between the two (either side's unlink button) —
   *  severs the WHOLE pair, part-targeted links included (#126 r5) */
  const unlink = (expense: SpaceTx, credit: SpaceTx): void => {
    const links = expense.reimbursements ?? [];
    const nextLinks = links.filter((r) => r.txId !== credit.id);
    void transform(expense, expensePatch(expense, nextLinks), 'reimburse');
    void transform(credit, creditPatch(credit, givenView(credit.id, expense.id, nextLinks)), null);
  };

  return { link, unlink, giveableCents };
}
