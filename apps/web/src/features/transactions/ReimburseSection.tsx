import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSpaceTransactions } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { useLang } from '@/i18n';
import { fmtCents } from '@/lib/money';
import { cleanBankText } from '@/lib/text';
import { creditRemainingCents, givenCents, netAmountCents, remainingCents, totalReimbursedCents } from '@/domain/reimbursement';
import { useReimburseLinks } from './useReimburseLinks';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

/** the other side of a link, one tap deep — both directions use this */
function CounterpartSheet({
  counterpart,
  linkedCents,
  currency,
  onClose,
}: Readonly<{ counterpart: SpaceTx | null; linkedCents: number; currency: string; onClose: () => void }>) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  return (
    <Sheet open={counterpart !== null} onOpenChange={(open) => !open && onClose()} title={t('reimb.counterpart')} size="form">
      {counterpart && (
        <div className="flex flex-col gap-3 pt-1" data-testid="reimb-counterpart">
          <div className="rounded-card border border-line bg-surface px-4 py-3">
            <div className="truncate text-[15px] font-medium text-ink">{cleanBankText(counterpart.merchant)}</div>
            <div className="text-[12px] text-ink-4">{counterpart.date}</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="m-num text-[18px] font-semibold text-ink">
                {fmtCents(netAmountCents(counterpart), counterpart.currency, lang, { sign: true })}
              </span>
              <span className="m-num text-[12px] text-accent-deep">
                {t('reimb.linkedFor', { amount: fmtCents(linkedCents, currency, lang) })}
              </span>
            </div>
          </div>
          <Button
            data-testid="reimb-open-counterpart"
            onClick={() => {
              onClose();
              void navigate({ to: '/transactions/$txId', params: { txId: counterpart.id } });
            }}
          >
            {t('reimb.openTx')}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/**
 * Reimbursement links on a transaction: the linked list + unlink here;
 * FINDING the counterpart lives on its own full screen (user redesign
 * 2026-07-28 — search, suggestions, more room). Candidates come from
 * what the SPACE sees, so reimbursements can only ever pair
 * transactions of accounts attached to the same space (user rule).
 */
export function ReimburseSection({ tx }: { tx: SpaceTx }) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [counterpart, setCounterpart] = useState<{ tx: SpaceTx; cents: number } | null>(null);

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
                onClick={() => setCounterpart({ tx: expense, cents: link.amountCents })}
                className="m-tap flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent p-0 text-left"
              >
                <Icon name="cash-refund" size={20} color="var(--m-accent)" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{cleanBankText(expense.merchant)}</span>
                  <span className="block text-[11px] text-ink-4">{expense.date}</span>
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
            <div className="px-4 py-4 text-center text-[12px] text-ink-4">—</div>
          )}
        </div>

        <CounterpartSheet counterpart={counterpart?.tx ?? null} linkedCents={counterpart?.cents ?? 0} currency={tx.currency} onClose={() => setCounterpart(null)} />
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
      <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="reimb-list">
        {(linkedTxs ?? []).map((linked) => {
          const link = (tx.reimbursements ?? []).find((r) => r.txId === linked.id);
          return (
            <div key={linked.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0">
              {/* the row itself opens the other side of the link */}
              <button
                data-testid={`reimb-row-${linked.id}`}
                onClick={() => setCounterpart({ tx: linked, cents: link?.amountCents ?? 0 })}
                className="m-tap flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent p-0 text-left"
              >
                <Icon name="cash-refund" size={20} color="var(--m-accent)" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{cleanBankText(linked.merchant)}</span>
                  <span className="block text-[11px] text-ink-4">{linked.date}</span>
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
        {total > 0 && (
          <div className="flex items-center justify-between bg-bg-2 px-4 py-2 text-[12px] text-ink-3" data-testid="reimb-summary">
            <span>{t('reimb.of', { a: fmtCents(total, tx.currency, lang), b: fmtCents(Math.abs(tx.amountCents), tx.currency, lang) })}</span>
            {remainingCents(tx) === 0 && (
              <span className="flex items-center gap-1 font-medium text-accent-deep" data-testid="reimb-settled">
                <Icon name="check-circle-outline" size={13} />
                {t('reimb.settled')}
              </span>
            )}
          </div>
        )}
        {(linkedTxs ?? []).length === 0 && total === 0 && (
          <div className="px-4 py-4 text-center text-[12px] text-ink-4">—</div>
        )}
      </div>

      <CounterpartSheet counterpart={counterpart?.tx ?? null} linkedCents={counterpart?.cents ?? 0} currency={tx.currency} onClose={() => setCounterpart(null)} />
    </>
  );
}
