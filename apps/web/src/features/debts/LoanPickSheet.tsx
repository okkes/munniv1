import { useLang } from '@/i18n';
import { useSpaceAccounts } from '@/application/transactions';
import { isLiability, typeDef } from '@/features/accounts/accountTypes';
import { fmtCents } from '@/lib/money';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

/**
 * The flat structure's loan question (typed-splits v2, Q1): labeling a
 * row "Loan payment"/"Borrowed" asks — optionally — WHICH loan.
 * Declining files it under the default loan (the unassigned-payments
 * bucket); picking a tracked loan links the row, and the mint engine
 * writes the loan's own leg.
 */
export function LoanPickSheet({
  open,
  onOpenChange,
  onPick,
  onSkip,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (accountId: string) => void;
  onSkip: () => void;
}>) {
  const { t, lang } = useLang();
  const accounts = useSpaceAccounts();
  const loans = (accounts ?? []).filter((a) => isLiability(a.type) && !a.archived);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('debts.pickLoanTitle')} size="form">
      <p className="pb-2 text-[12px] text-ink-3">{t('debts.pickLoanHint')}</p>
      <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="loanpick-list">
        {loans.map((account) => (
          <button
            key={account.id}
            data-testid={`loanpick-${account.id}`}
            onClick={() => {
              onPick(account.id);
              onOpenChange(false);
            }}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
          >
            <Icon name={typeDef(account.type).icon} size={18} color="var(--m-ink-2)" />
            <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{account.name}</span>
            <span className="m-num text-[12px] text-ink-3">{fmtCents(account.balanceCents, account.currency, lang)}</span>
          </button>
        ))}
        {loans.length === 0 && (
          <p className="px-4 py-3 text-[13px] text-ink-4" data-testid="loanpick-empty">
            {t('debts.pickLoanNone')}
          </p>
        )}
      </div>
      <button
        data-testid="loanpick-skip"
        onClick={() => {
          onSkip();
          onOpenChange(false);
        }}
        className="m-tap mt-2 flex w-full items-center gap-2 rounded-card border border-dashed border-line bg-transparent px-4 py-3 text-left text-[14px] font-medium text-ink-2"
      >
        <Icon name="tray-full" size={18} />
        {t('debts.pickLoanSkip')}
      </button>
    </Sheet>
  );
}
