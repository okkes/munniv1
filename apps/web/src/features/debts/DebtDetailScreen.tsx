import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { logActivity } from '@/application/activity';
import { useLoanStatuses } from '@/application/debts';
import { useSpaceHistoryTransactions } from '@/application/transactions';
import { localToday } from '@/application/recurring';
import { estimatePaymentPlan, paymentsPerYear, projectPayoff } from '@/domain/debts';
import { merchantKey } from '@/domain/merchantKey';
import type { AccountRow } from '@/db/types';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { EditAccountSheet } from '@/features/accounts/EditAccountSheet';
import { TxFormSheet } from '@/features/transactions/TxFormSheet';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { HeroCard, ProgressBar } from '@/ui/primitives';
import { TxRow } from '@/ui/TxRow';
import { LoanTile, paymentLabelKey } from './DebtsScreen';
import { LoanMatchSheet } from './LoanMatchSheet';

/** One loan: the payoff story — numbers, projection, payment history.
 *  The account row IS the loan (v2); Edit opens the account editor. */
export function DebtDetailScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { store, repo, spaceId } = useData();
  const { debtId } = useParams({ strict: false }) as { debtId: string };
  const statuses = useLoanStatuses();
  // the FULL history: the match sheet deliberately links pre-start
  // payments (count-optional), and a payment list that can't show them
  // would look like the link vanished (review finding)
  const txs = useSpaceHistoryTransactions();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);

  const status = statuses?.find((s) => s.account.id === debtId);
  // deleted or untracked here or on another device: leave the orphan
  useEffect(() => {
    if (statuses && !status) void navigate({ to: '/debts', replace: true });
  }, [statuses, status, navigate]);
  const today = localToday();

  // payment history: transactions ON the loan account, transfers naming
  // it as counterparty, and — for handoff-created loans — debt payments
  // matching the remembered merchant
  const payments = useMemo(() => {
    if (!status || !txs) return [];
    const { account } = status;
    return txs
      .filter((tx) => {
        if (tx.deleted !== 0) return false;
        if (tx.accountId === account.id || tx.linkedAccountId === account.id) return true;
        return !!account.merchantKey && tx.txType === 'debtPayment' && merchantKey(tx.merchant) === account.merchantKey;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 50);
  }, [status, txs]);

  const { fmt } = useDisplayMoney();
  if (!status) return <div className="h-full" data-testid="screen-debt-detail" />;

  const { account, remainingCents, progress } = status;
  const currency = space?.currency ?? 'EUR';
  const money = (cents: number) => fmt(cents, currency);
  // the explicit plan wins; with the fields empty, ≥3 payments speak for
  // themselves ("estimated from payments", arc 3) — never stored
  const estimate = account.paymentCents ? null : estimatePaymentPlan(payments);
  const projection = account.paymentCents
    ? projectPayoff(remainingCents, account.paymentCents, account.interestPctYear, today, paymentsPerYear(account.paymentEvery, account.paymentEveryN))
    : projectPayoff(remainingCents, estimate?.paymentCents, account.interestPctYear, today, estimate?.perYear ?? 12);

  // the way out (v2): a paid-off loan ARCHIVES (milestone, history kept);
  // a credit card just stops tracking — the card is still a live account
  const isCredit = account.type === 'credit';
  const wayOut = () => {
    const fields = isCredit ? { trackAsDebt: 0 as const } : { archived: account.archived === 1 ? (0 as const) : (1 as const) };
    void repo.upsert('account', account.spaceId, account.id, fields);
    void logActivity(store, repo, account.spaceId, 'accountEdit', account.name);
  };
  const wayOutLabel = () => {
    if (isCredit) return t('debts.stopTracking');
    return account.archived === 1 ? t('debts.reopen') : t('debts.markPaidOff');
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-debt-detail">
      <AppBar
        title={account.name}
        leading={
          <IconButton label={t('action.back')} testId="debtdetail-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <IconButton label={t('acct.editAccount')} testId="debtdetail-edit" onClick={() => setEditing(account)}>
            <Icon name="pencil-outline" size={20} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <HeroCard
          testId="debtdetail-hero"
          tile={<LoanTile account={account} size={48} />}
          number={<span data-testid="debtdetail-remaining">{money(remainingCents)}</span>}
          // without the original size there is no "of …" story and no
          // honest progress — the hero stays a plain remaining figure
          sub={account.originalCents ? t('debts.remainingOf', { amount: money(account.originalCents) }) : undefined}
          right={
            account.originalCents ? (
              <span className="m-num shrink-0 text-[14px] font-semibold text-accent-deep">{Math.round(progress * 100)}%</span>
            ) : undefined
          }
          progress={account.originalCents ? <ProgressBar value={progress} /> : undefined}
          meta={
            <>
              {account.paymentCents && (
                <span>{t(paymentLabelKey(account.paymentEvery), { amount: money(account.paymentCents) })}</span>
              )}
              {estimate && (
                <span data-testid="debtdetail-estimate">
                  {t('debts.estimatedPlan', { amount: money(estimate.paymentCents), days: estimate.everyDays })}
                </span>
              )}
              {account.interestPctYear !== undefined && <span>{account.interestPctYear}% {t('debts.aprShort')}</span>}
              {projection && (
                <span data-testid="debtdetail-projection">
                  {t('debts.projection', {
                    date: new Date(`${projection.endMonth}-01`).toLocaleDateString(LOCALES[lang], { month: 'long', year: 'numeric' }),
                    interest: money(projection.totalInterestCents),
                  })}
                </span>
              )}
            </>
          }
        />
        {account.note && (
          <p className="mt-3 rounded-card border border-line bg-surface px-4 py-3 text-[13px] leading-relaxed text-ink-2" data-testid="debtdetail-note">
            {account.note}
          </p>
        )}

        {/* a hand-entered payment, pre-staged onto this loan (arc 3):
            the manual form opens as a transfer to the loan account */}
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            className="min-w-0 flex-1"
            data-testid="debtdetail-add-payment"
            onClick={() => setPaymentOpen(true)}
          >
            <Icon name="plus" size={16} /> {t('debts.addPayment')}
          </Button>
          {/* re-run the payment search any time (user request) */}
          <Button
            variant="outline"
            className="min-w-0 flex-1"
            data-testid="debtdetail-find-payments"
            onClick={() => setMatchOpen(true)}
          >
            <Icon name="magnify" size={16} /> {t('debts.matchFind')}
          </Button>
        </div>

        <div className="m-cap mt-5 mb-1 px-1">
          {t('debts.payments')} · {payments.length}
        </div>
        {payments.length > 0 ? (
          <div className="rounded-card border border-line bg-surface px-3 py-1" data-testid="debtdetail-payments">
            {payments.map((tx) => (
              <TxRow key={tx.id} tx={tx} showDate onClick={() => void navigate({ to: '/transactions/$txId', params: { txId: tx.id } })} />
            ))}
          </div>
        ) : (
          <p className="px-1 text-[12px] text-ink-4" data-testid="debtdetail-nopayments">
            {t('debts.noPayments')}
          </p>
        )}

        <Button variant="outline" className="mt-5 w-full" data-testid="debtdetail-archive" onClick={wayOut}>
          <Icon name={isCredit ? 'eye-off-outline' : 'flag-checkered'} size={16} /> {wayOutLabel()}
        </Button>
      </div>
      <EditAccountSheet account={editing} onClose={() => setEditing(null)} />
      <TxFormSheet
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        prefill={{ linkedAccountId: account.id, merchant: account.name }}
      />
      <LoanMatchSheet accountId={matchOpen ? account.id : null} onClose={() => setMatchOpen(false)} />
    </div>
  );
}
