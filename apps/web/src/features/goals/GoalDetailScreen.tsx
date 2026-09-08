import { useEffect, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useGoalOps, useGoals } from '@/application/goals';
import { localToday } from '@/application/recurring';
import { goalProgress, paceCentsPerMonth } from '@/domain/goals';
import type { GoalRow } from '@/db/types';
import { parseCents } from '@/lib/money';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { HeroCard, ProgressBar, Tile } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { GoalFormSheet } from './GoalsScreen';

/** One goal: progress, pace, and the funding audit trail. */
export function GoalDetailScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const { goalId } = useParams({ strict: false }) as { goalId: string };
  const goals = useGoals();
  const ops = useGoalOps();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const contributions = useQuery(store, 
    async () => {
      const rows = (await store.bySpace('goalContribution', spaceId)).filter((c) => c.deleted === 0 && c.goalId === goalId);
      rows.sort((a, b) => b.date.localeCompare(a.date));
      return rows;
    },
    [spaceId, goalId],
  );
  const [formInitial, setFormInitial] = useState<GoalRow | 'new' | null>(null);
  const [fundOpen, setFundOpen] = useState<'fund' | 'withdraw' | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // #195: tappable — an invalid tap names the blocker
  const [attempted, setAttempted] = useState(false);

  const goal = goals?.find((g) => g.id === goalId);
  // deleted here or on another device: leave the orphaned detail
  useEffect(() => {
    if (goals && !goal) void navigate({ to: '/goals', replace: true });
  }, [goals, goal, navigate]);
  const { fmt } = useDisplayMoney();
  if (!goal) return <div className="h-full" data-testid="screen-goal-detail" />;

  const currency = space?.currency ?? 'EUR';
  const money = (cents: number) => fmt(cents, currency);
  const progress = goalProgress(goal);
  const pace = paceCentsPerMonth(goal, localToday());
  const reached = goal.allocatedCents >= goal.targetCents;

  const fundCents = parseCents(amount);
  const fundBad = fundCents === null || fundCents <= 0;

  const submitFunding = async () => {
    const cents = parseCents(amount);
    if (!fundOpen || cents === null || cents <= 0) return;
    await ops.contribute(goal.id, fundOpen === 'fund' ? cents : -cents, note.trim() || undefined);
    setFundOpen(null);
    setAmount('');
    setNote('');
    setAttempted(false);
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' });

  let paceLine = t('goals.toGo', { amount: money(goal.targetCents - goal.allocatedCents) });
  if (reached) {
    paceLine = t('goals.reached');
  } else if (pace !== null && goal.targetDate) {
    paceLine = t('goals.paceLong', {
      amount: money(pace),
      date: new Date(goal.targetDate).toLocaleDateString(LOCALES[lang], { month: 'short', year: 'numeric' }),
    });
  }

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-goal-detail">
      <AppBar
        title={goal.name}
        leading={
          <IconButton label={t('action.back')} testId="goaldetail-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <IconButton label={t('goals.edit')} testId="goaldetail-edit" onClick={() => setFormInitial(goal)}>
            <Icon name="pencil-outline" size={20} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <HeroCard
          testId="goaldetail-hero"
          tile={
            goal.picture ? (
              <img src={goal.picture} alt="" className="h-12 w-12 shrink-0 rounded-2xl object-cover" data-testid="goal-cover" />
            ) : (
              <Tile size={48} icon={goal.icon ?? 'flag-outline'} />
            )
          }
          number={<span data-testid="goaldetail-allocated">{money(goal.allocatedCents)}</span>}
          sub={t('budgets.of', { amount: money(goal.targetCents) })}
          right={<span className="m-num shrink-0 text-[14px] font-semibold text-accent-deep">{Math.round(progress * 100)}%</span>}
          progress={<ProgressBar value={progress} />}
          meta={<span data-testid="goaldetail-pace">{paceLine}</span>}
        />

        <div className="mt-3 flex gap-2">
          <Button className="flex-1" data-testid="goaldetail-fund" onClick={() => setFundOpen('fund')}>
            {t('goals.fund')}
          </Button>
          <Button variant="outline" className="flex-1" data-testid="goaldetail-withdraw" onClick={() => setFundOpen('withdraw')}>
            {t('goals.withdraw')}
          </Button>
        </div>

        <div className="m-cap mt-5 mb-1 px-1">
          {t('goals.history')} · {contributions?.length ?? 0}
        </div>
        {(contributions?.length ?? 0) > 0 ? (
          <div className="rounded-card border border-line bg-surface px-4 py-1" data-testid="goaldetail-history">
            {contributions!.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-line-2 py-2.5 last:border-0">
                <Icon
                  name={c.amountCents >= 0 ? 'tray-arrow-down' : 'tray-arrow-up'}
                  size={16}
                  color={c.amountCents >= 0 ? 'var(--m-accent-deep)' : 'var(--m-warning)'}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">{c.note ?? (c.amountCents >= 0 ? t('goals.fund') : t('goals.withdraw'))}</span>
                  <span className="block text-[11px] text-ink-4">{fmtDate(c.date)}</span>
                </span>
                <span className={`m-num text-[13px] font-semibold ${c.amountCents >= 0 ? 'text-accent-deep' : 'text-warning'}`}>
                  {fmt(c.amountCents, currency, { sign: true })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-1 text-[12px] text-ink-4">{t('goals.noHistory')}</p>
        )}
      </div>

      {/* fund / withdraw */}
      <Sheet
        open={fundOpen !== null}
        onOpenChange={(open) => {
          if (open) return;
          setFundOpen(null);
          setAttempted(false);
        }}
        title={t(fundOpen === 'withdraw' ? 'goals.withdraw' : 'goals.fund')}
        size="form"
      >
        <div className="flex flex-col gap-3 pt-1">
          <input
            data-testid="goalfund-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-invalid={attempted && fundBad}
            className={`h-12 w-full rounded-input border border-line bg-surface px-4 font-mono text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && fundBad)}`}
          />
          {/* #195 r2 (user): the blocker sits AT the field */}
          <FormBlockerNote show={attempted && fundBad} text={t('form.needAmount')} testId="goalfund-save-blocker" />
          <input
            data-testid="goalfund-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('goals.notePlaceholder')}
            className="h-11 w-full rounded-input border border-line bg-surface px-4 text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
          <Button
            data-testid="goalfund-save"
            onClick={() => {
              if (fundBad) {
                setAttempted(true);
                return;
              }
              void submitFunding();
            }}
          >
            {t(fundOpen === 'withdraw' ? 'goals.withdraw' : 'goals.fund')}
          </Button>
        </div>
      </Sheet>

      <GoalFormSheet initial={formInitial} onClose={() => setFormInitial(null)} />
    </div>
  );
}
