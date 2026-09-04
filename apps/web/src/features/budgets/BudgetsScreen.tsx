import { useNavigate } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { useBudgetStatuses } from '@/application/budgets';
import { localToday } from '@/application/recurring';
import { budgetDaysLeft } from '@/domain/budgets';
import type { BudgetStatus } from '@/domain/budgets';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { useQuery } from '@/db/useQuery';
import { useData } from '@/app/data';
import { HelpButton } from '@/features/help/HelpButton';
import { IntroCard } from '@/features/help/IntroCard';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Icon } from '@/ui/Icon';
import { ProgressBar, Tile } from '@/ui/primitives';
import { CADENCE_KEYS, budgetColor, budgetSoft, ratioPct } from './budgetUi';

/** One budget card: urgency-colored state, progress, carry-over note. */
export function BudgetCard({ status, currency, onClick }: Readonly<{ status: BudgetStatus; currency: string; onClick: () => void }>) {
  const { t } = useLang();
  const { fmt } = useDisplayMoney();
  const { budget, leftCents, carriedCents, ratio, spentCents, limitCents } = status;
  const over = ratio > 1;
  const color = budgetColor(ratio);

  return (
    <button
      data-testid={`budget-card-${budget.id}`}
      onClick={onClick}
      className="m-tap w-full rounded-card border border-line bg-surface p-4 text-left"
    >
      <div className="flex items-center gap-3">
        <Tile icon={budget.icon ?? 'wallet-outline'} bg={budgetSoft(ratio)} color={color} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold text-ink">{budget.name}</span>
            <span className="m-num shrink-0 text-[14px] font-semibold" style={{ color }} data-testid={`budget-left-${budget.id}`}>
              {t(over ? 'budgets.over' : 'budgets.left', { amount: fmt(Math.abs(leftCents), currency) })}
            </span>
          </span>
          <span className="block text-[11px] text-ink-4" data-testid={`budget-cadence-${budget.id}`}>
            {t(CADENCE_KEYS[budget.every])}
            {/* days until reset next to the cadence (user request) */}
            {` · ${t('budgets.daysLeft', { n: budgetDaysLeft(budget, localToday()) })}`}
            {carriedCents > 0 && ` · ${t('budgets.carryLine', { amount: fmt(carriedCents, currency) })}`}
          </span>
        </span>
      </div>
      <ProgressBar
        className="mt-3"
        value={ratioPct(status) / 100}
        color={color}
        overlay={
          over ? (
            <div
              className="absolute inset-0"
              style={{ background: 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,0.35) 4px 8px)' }}
            />
          ) : undefined
        }
      />
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-3">
        <span>
          <span className="m-num font-semibold text-ink-2">{fmt(spentCents, currency)}</span> {t('budgets.spent')}
        </span>
        <span>{t('budgets.of', { amount: fmt(limitCents, currency) })}</span>
      </div>
    </button>
  );
}

/** All budgets, most urgent first. */
export function BudgetsScreen() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const statuses = useBudgetStatuses();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const currency = space?.currency ?? 'EUR';

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-budgets">
      <AppBar
        title={t('budgets.title')}
        leading={
          <IconButton label={t('action.back')} testId="budgets-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <>
            <HelpButton tourId="budgets" />
            <IconButton label={t('budgets.new')} testId="budgets-add" onClick={() => void navigate({ to: '/budgets/new' })}>
              <Icon name="plus" size={22} />
            </IconButton>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <IntroCard tourId="budgets" />
        <div className="flex flex-col gap-2.5 pt-1">
          {(statuses ?? []).map((status) => (
            <BudgetCard
              key={status.budget.id}
              status={status}
              currency={currency}
              onClick={() => void navigate({ to: '/budgets/$budgetId', params: { budgetId: status.budget.id } })}
            />
          ))}
        </div>
        {statuses?.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center" data-testid="budgets-empty">
            <Icon name="wallet-outline" size={34} color="var(--m-ink-4)" />
            <p className="text-[14px] font-medium text-ink-2">{t('budgets.emptyTitle')}</p>
            <p className="text-[12px] text-ink-4">{t('budgets.emptyBody')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
