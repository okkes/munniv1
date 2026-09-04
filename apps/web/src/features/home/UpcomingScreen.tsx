import { useNavigate } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { localToday, useRecurrings } from '@/application/recurring';
import { useSpaceAccounts } from '@/application/transactions';
import type { AccountRow } from '@/db/types';
import { typeDef } from '@/features/accounts/accountTypes';
import {
  upcomingHorizon,
  upcomingLoanAmountCents,
  upcomingLoanPayments,
  upcomingRecAmountCents,
  upcomingRecurrings,
} from '@/domain/upcoming';
import { RecurringVisual } from '@/features/recurring/RecurringVisual';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Icon } from '@/ui/Icon';

/**
 * #334 (user): the home "Coming up" block mixes recurring costs and loan
 * payments, so its see-all must land on the SAME combined story — not
 * the recurring manager. One lightweight list, segmented by kind, every
 * row leading to its own detail. The window is the space's current
 * period, stretched to at least the block's 7-day horizon so no row the
 * block promised goes missing here.
 */
/** #336 (user): the loan row wears the ACCOUNT's face — its chosen
 *  logo/picture if set, else the type icon tinted the account's color —
 *  the old hardcoded card icon ignored the editor entirely. Shared by
 *  the home block and this landing so the two can never drift. */
export function LoanFace({ loan }: Readonly<{ loan: AccountRow }>) {
  if (loan.logo) return <img src={loan.logo} alt="" className="h-8 w-8 shrink-0 rounded-lg object-contain" />;
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft/60">
      <Icon name={typeDef(loan.type).icon} size={16} color={loan.color ?? 'var(--m-accent-deep)'} />
    </span>
  );
}

export function UpcomingScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const recurrings = useRecurrings();
  const accounts = useSpaceAccounts();
  const { fmt } = useDisplayMoney();
  const currency = space?.currency ?? 'EUR';

  const today = localToday();
  // #334 r2 (user): the shared window — the home block asks the same
  // helper the same question when deciding whether see-all adds anything
  const horizon = upcomingHorizon(space, today);
  const recs = upcomingRecurrings(recurrings ?? [], today, horizon);
  const loans = upcomingLoanPayments(accounts ?? [], today, horizon);

  const fmtShort = (iso: string) =>
    new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-upcoming">
      <AppBar
        title={t('upcoming.title')}
        leading={
          <IconButton label={t('action.back')} testId="upcoming-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* the window this list covers — the "given period" made visible */}
        <div className="m-cap px-1" data-testid="upcoming-window">
          {fmtShort(today)} – {fmtShort(horizon)}
        </div>

        {recs.length > 0 && (
          <>
            <div className="m-cap mt-4 mb-1 px-1">{t('upcoming.recurringSection')}</div>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {recs.map(({ rec, nextDue }) => (
                <button
                  key={rec.id}
                  data-testid={`upcoming-rec-${rec.id}`}
                  onClick={() => void navigate({ to: '/recurring/$recId', params: { recId: rec.id } })}
                  className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-2.5 text-left last:border-0"
                >
                  <RecurringVisual rec={rec} size={16} active={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{rec.name}</span>
                    <span className="block text-[11px] text-ink-4">{fmtShort(nextDue)}</span>
                  </span>
                  {/* #334 r2 (user): unsigned — one sign story for both kinds */}
                  <span className="m-num text-[13px] font-semibold text-ink">{fmt(upcomingRecAmountCents(rec), currency)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {loans.length > 0 && (
          <>
            <div className="m-cap mt-4 mb-1 px-1">{t('upcoming.loansSection')}</div>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {loans.map(({ loan, nextDue }) => (
                <button
                  key={loan.id}
                  data-testid={`upcoming-loan-${loan.id}`}
                  onClick={() => void navigate({ to: '/debts/$debtId', params: { debtId: loan.id } })}
                  className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-2.5 text-left last:border-0"
                >
                  <LoanFace loan={loan} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{loan.name}</span>
                    <span className="block text-[11px] text-ink-4">{fmtShort(nextDue)}</span>
                  </span>
                  <span className="m-num text-[13px] font-semibold text-ink">{fmt(upcomingLoanAmountCents(loan), currency)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {recs.length === 0 && loans.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center" data-testid="upcoming-empty">
            <Icon name="calendar-check-outline" size={34} color="var(--m-accent)" />
            <p className="text-[14px] font-medium text-ink-2">{t('upcoming.empty')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
