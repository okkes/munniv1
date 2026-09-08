import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSpaceTransactions } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { LOCALES, useLang } from '@/i18n';
import { fmtCents } from '@/lib/money';
import { cleanBankText } from '@/lib/text';
import { creditRemainingCents, givenCents, netAmountCents, remainingCents, totalReimbursedCents } from '@/domain/reimbursement';
import { useReimburseLinks } from './useReimburseLinks';
import { Icon } from '@/ui/Icon';

// #237 (user): the intermediate "Linked transaction" sheet is gone —
// a reimbursement row IS the other side's card and tapping it goes
// straight to that transaction.

/**
 * Reimbursement links on a transaction: the linked list + unlink here;
 * FINDING the counterpart lives on its own full screen (user redesign
 * 2026-07-28 — search, suggestions, more room). Candidates come from
 * what the SPACE sees, so reimbursements can only ever pair
 * transactions of accounts attached to the same space (user rule).
 */
/** #270 r2 (user): the linked rows say WHEN — "Sat 1 Aug", like the
 *  list's own day headers */
const fmtLinkDay = (iso: string, lang: keyof typeof LOCALES): string =>
  new Date(iso).toLocaleDateString(LOCALES[lang], { weekday: 'short', day: 'numeric', month: 'short' });

export function ReimburseSection({ tx }: { tx: SpaceTx }) {
  const { t, lang } = useLang();
  const navigate = useNavigate();

  const allTxs = useSpaceTransactions();
  const { unlink } = useReimburseLinks(allTxs);
  const linkedIds = useMemo(() => (tx.reimbursements ?? []).map((r) => r.txId), [tx.reimbursements]);
  const linkedTxs = useMemo(() => allTxs?.filter((c) => linkedIds.includes(c.id)), [allTxs, linkedIds]);
  // the reverse direction: expenses that name THIS credit as their refund
  const reimburses = useMemo(
    () =>
      allTxs
        ?.map((expense) => ({ expense, link: (expense.reimbursements ?? []).find((r) => r.txId === tx.id) }))
        .filter((entry): entry is { expense: SpaceTx; link: { txId: string; amountCents: number } } => !!entry.link),
    [allTxs, tx.id],
  );

  const openPicker = () => void navigate({ to: '/transactions/$txId/link-reimb', params: { txId: tx.id } });
  const openTx = (txId: string) => void navigate({ to: '/transactions/$txId', params: { txId } });

  // a credit that reimburses something shows its own side of the story —
  // and can start a link itself (user request: income side too)
  if (tx.amountCents >= 0) {
    const given = givenCents(allTxs ?? [], tx.id);
    const giveable = creditRemainingCents(tx, given);

    return (
      <>
        <div className="m-cap mt-5 mb-1 flex items-center justify-between px-1">
          <span>{t('reimb.reimburses')}</span>
          {giveable > 0 && (
            <button
              data-testid="reimb-add-out"
              onClick={openPicker}
              className="m-tap flex items-center gap-1 border-none bg-transparent text-[11px] font-semibold text-accent-deep"
            >
              <Icon name="plus" size={14} />
              {t('reimb.linkOut')}
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="reimb-reverse">
          {(reimburses ?? []).map(({ expense, link }) => (
            <div key={expense.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0">
              <button
                data-testid={`reimb-reverse-${expense.id}`}
                onClick={() => openTx(expense.id)}
                className="m-tap flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent p-0 text-left"
              >
                <Icon name="cash-refund" size={20} color="var(--m-accent)" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{cleanBankText(expense.merchant)}</span>
                  <span className="block text-[11px] text-ink-4">
                    {fmtLinkDay(expense.date, lang)} · {fmtCents(netAmountCents(expense), expense.currency, lang, { sign: true })}
                  </span>
                </span>
                <span className="m-num text-[14px] font-semibold text-ink">
                  {fmtCents(link.amountCents, tx.currency, lang)}
                </span>
              </button>
              <button
                aria-label={t('action.delete')}
                data-testid={`reimb-unlink-out-${expense.id}`}
                onClick={() => unlink(expense, tx)}
                className="m-tap border-none bg-transparent text-ink-4"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
          {given > 0 && giveable === 0 && (
            <div className="flex items-center gap-1.5 bg-bg-2 px-4 py-2 text-[12px] text-accent-deep" data-testid="reimb-settled">
              <Icon name="check-circle-outline" size={14} />
              {t('reimb.settled')}
            </div>
          )}
          {(reimburses ?? []).length === 0 && (
            <div className="px-4 py-4 text-center text-[12px] text-ink-4" data-testid="reimb-out-empty-note">
              {t('reimb.noneOutYet')}
            </div>
          )}
        </div>
      </>
    );
  }
  const total = totalReimbursedCents(tx);

  return (
    <>
      <div className="m-cap mt-5 mb-1 flex items-center justify-between px-1">
        <span>{t('reimb.section')}</span>
        {remainingCents(tx) > 0 && (
          <button
            data-testid="reimb-add"
            onClick={openPicker}
            className="m-tap flex items-center gap-1 border-none bg-transparent text-[11px] font-semibold text-accent-deep"
          >
            <Icon name="plus" size={14} />
            {t('reimb.link')}
          </button>
        )}
      </div>
      {/* #231 r2 (user): the section is the LINKS, nothing else — the
          netted headline and the Details card's original amount already
          tell the money story; no original/net/of rows here */}
      <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="reimb-list">
        {(linkedTxs ?? []).map((linked) => {
          const link = (tx.reimbursements ?? []).find((r) => r.txId === linked.id);
          return (
            <div key={linked.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0">
              {/* the row itself IS the other side — tap goes straight there */}
              <button
                data-testid={`reimb-row-${linked.id}`}
                onClick={() => openTx(linked.id)}
                className="m-tap flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent p-0 text-left"
              >
                <Icon name="cash-refund" size={20} color="var(--m-accent)" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{cleanBankText(linked.merchant)}</span>
                  <span className="block text-[11px] text-ink-4">
                    {fmtLinkDay(linked.date, lang)} · {fmtCents(netAmountCents(linked), linked.currency, lang, { sign: true })}
                  </span>
                </span>
                <span className="m-num text-[14px] font-semibold text-accent-deep">
                  +{fmtCents(link?.amountCents ?? 0, tx.currency, lang)}
                </span>
              </button>
              <button
                aria-label={t('action.delete')}
                data-testid={`reimb-unlink-${linked.id}`}
                onClick={() => {
                  const credit = allTxs?.find((c) => c.id === linked.id);
                  if (credit) unlink(tx, credit);
                }}
                className="m-tap border-none bg-transparent text-ink-4"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          );
        })}
        {total > 0 && remainingCents(tx) === 0 && (
          <div className="flex items-center gap-1.5 bg-bg-2 px-4 py-2 text-[12px] font-medium text-accent-deep" data-testid="reimb-settled">
            <Icon name="check-circle-outline" size={13} />
            {t('reimb.settled')}
          </div>
        )}
        {(linkedTxs ?? []).length === 0 && total === 0 && <div className="px-4 py-4" data-testid="reimb-empty-note" />}
      </div>
    </>
  );
}
