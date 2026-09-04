import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@/db/useQuery';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useLoanStatuses } from '@/application/debts';
import type { LoanStatus } from '@/application/debts';
import { useSpaceTransactions, useTxTransform } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { localToday } from '@/application/recurring';
import { monthlyPaymentCents, paymentsPerYear, projectPayoff } from '@/domain/debts';
import type { AccountRow, RecurringEvery } from '@/db/types';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { AddAccountChooser } from '@/features/accounts/AddAccountChooser';
import { typeDef } from '@/features/accounts/accountTypes';
import { HelpButton } from '@/features/help/HelpButton';
import { IntroCard } from '@/features/help/IntroCard';
import { takeDebtHandoff } from './handoff';
import { LoanMatchSheet } from './LoanMatchSheet';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Icon } from '@/ui/Icon';
import { ProgressBar, Tile } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { TxRow } from '@/ui/TxRow';

const PAYMENT_LABEL = { week: 'debts.perWeek', month: 'debts.perMonth', year: 'debts.perYear' } as const;

/** "{amount} / week|month|year" — the payment line follows the cadence */
export const paymentLabelKey = (every?: RecurringEvery): (typeof PAYMENT_LABEL)[keyof typeof PAYMENT_LABEL] =>
  PAYMENT_LABEL[every ?? 'month'];

/** the loan's tile: its chosen logo, else the account type's icon */
export function LoanTile({ account, size }: Readonly<{ account: AccountRow; size?: 36 | 48 }>) {
  if (account.logo) {
    return <img src={account.logo} alt="" className="h-10 w-10 shrink-0 rounded-xl object-contain" style={size ? { width: size, height: size } : undefined} />;
  }
  return <Tile icon={typeDef(account.type).icon} tone="negative" size={size} />;
}

/**
 * The virtual "Unassigned payments" bucket (arc 3): bare debt-payment
 * rows (no counter account — the arc-2 exit, or imports) summed as a
 * computed card, never stored. Each row assigns to a loan account with
 * one tap — the link files it under that loan's history.
 */
function UnassignedPaymentsCard({
  bare,
  loans,
  currency,
}: Readonly<{ bare: SpaceTx[]; loans: readonly AccountRow[]; currency: string }>) {
  const { t } = useLang();
  const { fmt } = useDisplayMoney();
  const transform = useTxTransform();
  const [open, setOpen] = useState(false);
  const [assignTx, setAssignTx] = useState<SpaceTx | null>(null);
  const targets = loans.filter((a) => a.archived !== 1);
  if (bare.length === 0) return null;
  const total = bare.reduce((sum, tx) => sum + Math.abs(tx.amountCents), 0);
  return (
    <>
      <button
        data-testid="debts-unassigned"
        onClick={() => setOpen(true)}
        className="m-tap mt-3 flex w-full items-center gap-3 rounded-card border border-dashed border-line bg-surface p-4 text-left"
      >
        <Tile icon="help-circle-outline" tone="neutral" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold text-ink">{t('debts.unassigned')}</span>
            <span className="m-num shrink-0 text-[14px] font-semibold text-ink">{fmt(total, currency)}</span>
          </span>
          <span className="block text-[11px] text-ink-4">{t('debts.unassignedSub', { n: bare.length })}</span>
        </span>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={t('debts.unassigned')} size="tall">
        <p className="pb-2 text-[12px] text-ink-3">{t('debts.unassignedHint')}</p>
        <div className="rounded-card border border-line bg-surface px-3 py-1" data-testid="debts-unassigned-list">
          {bare.map((tx) => (
            <TxRow key={tx.id} tx={tx} showDate onClick={() => setAssignTx(tx)} />
          ))}
        </div>
      </Sheet>
      <Sheet open={assignTx !== null} onOpenChange={(next) => !next && setAssignTx(null)} title={t('debts.assignTo')} size="form">
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="debts-assign-options">
          {targets.map((account) => (
            <button
              key={account.id}
              data-testid={`debts-assign-${account.id}`}
              onClick={() => {
                // the link makes it THIS loan's payment (history + matcher
                // agree); the locked category already fits, review stands
                if (assignTx) void transform(assignTx, { linkedAccountId: account.id }, 'txLink');
                setAssignTx(null);
              }}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
            >
              <Icon name={typeDef(account.type).icon} size={18} color="var(--m-ink-2)" />
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{account.name}</span>
            </button>
          ))}
          {targets.length === 0 && <p className="px-4 py-3 text-[13px] text-ink-4">{t('debts.assignNone')}</p>}
        </div>
      </Sheet>
    </>
  );
}

/** All loans: how deep, how fast out. The account row IS the loan (v2). */
export function DebtsScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const statuses = useLoanStatuses();
  const txs = useSpaceTransactions();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const currency = space?.currency ?? 'EUR';
  // "+" mints a loan like any other account — the chooser opens on the
  // liability types only (v2: creating the account IS creating the debt)
  const [addOpen, setAddOpen] = useState(false);
  // right after creating, offer the matching payments from history
  const [matchFor, setMatchFor] = useState<string | null>(null);
  // arriving FROM the recurring form (its Debt kind): the chooser opens
  // prefilled with what the recurring already knew
  const [handoff] = useState(() => takeDebtHandoff());
  useEffect(() => {
    if (handoff) setAddOpen(true);
  }, [handoff]);
  // counterparty-less debt payments — the virtual bucket's contents
  const bare = useMemo(
    () => (txs ?? []).filter((tx) => tx.deleted === 0 && tx.txType === 'debtPayment' && !tx.linkedAccountId),
    [txs],
  );

  const { fmt } = useDisplayMoney();
  const money = (cents: number) => fmt(cents, currency);
  const active = (statuses ?? []).filter((s) => s.account.archived !== 1);
  const totalOwed = active.reduce((sum, s) => sum + s.remainingCents, 0);
  // cadence-normalized (arc 3): a weekly €100 reads as ~€433 here
  const totalMonthly = active.reduce((sum, s) => sum + monthlyPaymentCents(s.account), 0);
  const today = localToday();

  const renderCard = (status: LoanStatus) => {
    const { account, remainingCents, progress } = status;
    const projection = projectPayoff(
      remainingCents,
      account.paymentCents,
      account.interestPctYear,
      today,
      paymentsPerYear(account.paymentEvery, account.paymentEveryN),
    );
    const freeLabel = projection
      ? new Date(`${projection.endMonth}-01`).toLocaleDateString(LOCALES[lang], { month: 'short', year: 'numeric' })
      : null;
    const subParts = [
      account.originalCents ? t('budgets.of', { amount: money(account.originalCents) }) : null,
      account.paymentCents ? t(paymentLabelKey(account.paymentEvery), { amount: money(account.paymentCents) }) : null,
      freeLabel ? t('debts.freeBy', { date: freeLabel }) : null,
    ].filter(Boolean);
    return (
      <button
        key={account.id}
        data-testid={`debt-card-${account.id}`}
        onClick={() => void navigate({ to: '/debts/$debtId', params: { debtId: account.id } })}
        className={`m-tap w-full rounded-card border border-line bg-surface p-4 text-left ${account.archived === 1 ? 'opacity-60' : ''}`}
      >
        <div className="flex items-center gap-3">
          <LoanTile account={account} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] font-semibold text-ink">{account.name}</span>
              <span className="m-num shrink-0 text-[14px] font-semibold text-ink" data-testid={`debt-remaining-${account.id}`}>
                {money(remainingCents)}
              </span>
            </span>
            {subParts.length > 0 && <span className="block text-[11px] text-ink-4">{subParts.join(' · ')}</span>}
          </span>
        </div>
        {/* progress needs the original size — without it the bar would lie 0% */}
        {!!account.originalCents && <ProgressBar className="mt-3" value={progress} />}
      </button>
    );
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-debts">
      <AppBar
        title={t('debts.title')}
        leading={
          <IconButton label={t('action.back')} testId="debts-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <>
            <HelpButton tourId="debts" />
            <IconButton label={t('debts.new')} testId="debts-add" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={22} />
            </IconButton>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <IntroCard tourId="debts" />
        {active.length > 0 && (
          <div className="grid grid-cols-2 gap-3 rounded-card border border-line bg-surface p-4" data-testid="debts-overview">
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-ink-4 uppercase">{t('debts.totalOwed')}</div>
              <div className="mt-0.5 font-mono text-[15px] font-semibold text-ink">{money(totalOwed)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wide text-ink-4 uppercase">{t('debts.totalMonthly')}</div>
              <div className="mt-0.5 font-mono text-[15px] font-semibold text-ink">{money(totalMonthly)}</div>
            </div>
          </div>
        )}
        <UnassignedPaymentsCard bare={bare} loans={(statuses ?? []).map((s) => s.account)} currency={currency} />
        <div className="flex flex-col gap-2.5 pt-3">{(statuses ?? []).map(renderCard)}</div>
        {statuses?.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center" data-testid="debts-empty">
            <Icon name="hand-coin-outline" size={34} color="var(--m-ink-4)" />
            <p className="text-[14px] font-medium text-ink-2">{t('debts.emptyTitle')}</p>
            <p className="text-[12px] text-ink-4">{t('debts.emptyBody')}</p>
          </div>
        )}
      </div>
      <AddAccountChooser
        open={addOpen}
        onOpenChange={setAddOpen}
        initialStep="manual"
        manualTypes={['loan', 'mortgage', 'credit']}
        loanFlavor
        prefill={handoff ?? undefined}
        onCreated={({ id }) => setMatchFor(id)}
      />
      <LoanMatchSheet accountId={matchFor} onClose={() => setMatchFor(null)} />
    </div>
  );
}
