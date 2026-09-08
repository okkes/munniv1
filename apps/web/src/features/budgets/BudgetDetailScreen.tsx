import { useMemo, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useBudgets } from '@/application/budgets';
import { useSpaceTransactions } from '@/application/transactions';
import { localToday } from '@/application/recurring';
import { budgetFamily, budgetPeriodAt, budgetSpentCents, budgetStatus, cycleIndex } from '@/domain/budgets';
import { catName, useCategories } from '@/features/categories/useCategories';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Bars } from '@/ui/charts/Bars';
import { Icon } from '@/ui/Icon';
import { HeroCard, ProgressBar, Tile } from '@/ui/primitives';
import { TxRow } from '@/ui/TxRow';
import { budgetColor, budgetSoft } from './budgetUi';

/**
 * One budget in full: the current cycle's numbers, older cycles via the
 * ‹ › period nav, per-category spend (tap → the category drill) and the
 * cycle's transactions. Editing sits behind the pencil.
 */
export function BudgetDetailScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const { budgetId } = useParams({ strict: false }) as { budgetId: string };
  const budgets = useBudgets();
  const txs = useSpaceTransactions();
  const cats = useCategories();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const [offset, setOffset] = useState(0); // 0 = current cycle, negative = past

  const budget = budgets?.find((b) => b.id === budgetId);
  const today = localToday();

  // tap a category row to FILTER the payments below (user request: the
  // old navigation to a separate list read as a context switch)
  const [catFilter, setCatFilter] = useState<string | null>(null);

  const view = useMemo(() => {
    if (!budget || !txs) return undefined;
    const family = budgetFamily(budget.catIds, cats);
    const status = budgetStatus(budget, txs, cats, today);
    const currentIndex = cycleIndex(budget, today);
    const shownIndex = Math.max(0, currentIndex + offset);
    const period = budgetPeriodAt(budget, shownIndex);
    const spent = offset === 0 ? status.spentCents : budgetSpentCents(txs, family, period);
    const limit = offset === 0 ? status.limitCents : budget.amountCents;
    const listFamily = catFilter ? budgetFamily([catFilter], cats) : family;
    const list = txs
      .filter((tx) => tx.deleted === 0 && tx.txType === 'expense' && listFamily.has(tx.catId ?? '') && tx.date >= period.start && tx.date <= period.end)
      .sort((a, b) => b.date.localeCompare(a.date));
    const perCat = budget.catIds.map((catId) => ({
      catId,
      spentCents: budgetSpentCents(txs, budgetFamily([catId], cats), period),
    }));
    // spend per cycle, oldest → running (the overview-style bar view);
    // the bars follow the budget's OWN period, weekly bars for weekly
    // budgets — everything derives from the same transactions
    const historyStart = Math.max(0, currentIndex - 7);
    const history = [];
    for (let i = historyStart; i <= currentIndex; i += 1) {
      const p = budgetPeriodAt(budget, i);
      history.push({ start: p.start, spentCents: budgetSpentCents(txs, family, p) });
    }
    return { status, period, spent, limit, list, perCat, history, atStart: shownIndex === 0 };
  }, [budget, txs, cats, today, offset, catFilter]);

  const { fmt } = useDisplayMoney();
  if (!budget || !view)
    return <div className="h-full" data-testid="screen-budget-detail" />;

  const { period, spent, limit, list, perCat, history, status, atStart } = view;
  // whole days until the next cycle starts (user request, current cycle only)
  const daysLeft = Math.max(0, Math.round((Date.parse(period.end) - Date.parse(today)) / 86_400_000)) + 1;
  const ratio = limit > 0 ? spent / limit : 0;
  const over = ratio > 1;
  const color = budgetColor(ratio);
  const currency = space?.currency ?? 'EUR';
  const money = (cents: number) => fmt(cents, currency);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-budget-detail">
      <AppBar
        title={budget.name}
        leading={
          <IconButton label={t('action.back')} testId="budgetdetail-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <IconButton
            label={t('budgets.edit')}
            testId="budgetdetail-edit"
            onClick={() => void navigate({ to: '/budgets/$budgetId/edit', params: { budgetId: budget.id } })}
          >
            <Icon name="pencil-outline" size={20} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* period nav */}
        <div className="flex items-center justify-center gap-3 pt-1 pb-3">
          {/* HARD stop at the first cycle: the offset used to keep
              decrementing past it, so "back ×3 too far" needed "forward
              ×3" to recover (user report) */}
          <IconButton label="‹" testId="budgetdetail-prev" onClick={() => setOffset((o) => (atStart ? o : o - 1))}>
            <Icon name="chevron-left" size={20} color={atStart ? 'var(--m-ink-4)' : undefined} />
          </IconButton>
          <span className="min-w-[150px] text-center text-[13px] font-semibold text-ink" data-testid="budgetdetail-period">
            {fmtDate(period.start)} – {fmtDate(period.end)}
          </span>
          <IconButton
            label="›"
            testId="budgetdetail-next"
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
          >
            <Icon name="chevron-right" size={20} color={offset === 0 ? 'var(--m-ink-4)' : undefined} />
          </IconButton>
        </div>
        {atStart && offset < 0 && (
          <p className="pb-2 text-center text-[11px] text-ink-4">{t('budgets.firstPeriod')}</p>
        )}
        {offset === 0 && (
          <p className="pb-2 text-center text-[11px] text-ink-4" data-testid="budgetdetail-daysleft">
            {t('budgets.daysLeft', { n: daysLeft })}
          </p>
        )}

        {/* the cycle's numbers */}
        <HeroCard
          testId="budgetdetail-hero"
          tile={<Tile size={48} icon={budget.icon ?? 'wallet-outline'} bg={budgetSoft(ratio)} color={color} />}
          number={
            <span style={{ color: over ? color : undefined }} data-testid="budgetdetail-spent">
              {money(spent)}
            </span>
          }
          sub={t('budgets.of', { amount: money(limit) })}
          right={
            <span className="m-num shrink-0 text-[14px] font-semibold" style={{ color }} data-testid="budgetdetail-left">
              {t(over ? 'budgets.over' : 'budgets.left', { amount: money(Math.abs(limit - spent)) })}
            </span>
          }
          progress={
            <ProgressBar
              animateKey={offset}
              value={ratio}
              color={color}
              overlay={
                over ? (
                  <div className="absolute inset-0" style={{ background: 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,0.35) 4px 8px)' }} />
                ) : undefined
              }
            />
          }
          meta={
            offset === 0 && status.carriedCents > 0 ? (
              <span className="flex items-center gap-1.5 text-[11px]" data-testid="budgetdetail-carry">
                <Icon name="tray-arrow-down" size={13} />
                {t('budgets.carryLine', { amount: money(status.carriedCents) })}
              </span>
            ) : undefined
          }
        />

        {/* spend per cycle — the same bar view the overview drills have;
            weekly budgets get weekly bars, the running cycle is hollow,
            the dashed line is the limit */}
        {history.length > 1 && (
          <>
            <div className="m-cap mt-5 mb-1 px-1">{t('budgets.historyCap')}</div>
            <div className="rounded-card border border-line bg-surface px-4 py-3">
              <Bars
                testId="budgetdetail-bars"
                values={history.map((h) => h.spentCents)}
                labels={history.map((h) => fmtDate(h.start))}
                ariaLabels={history.map((h) => `${fmtDate(h.start)}: ${money(h.spentCents)}`)}
                hollowLast
                average={budget.amountCents}
                height={100}
              />
            </div>
          </>
        )}

        {/* per-category spend — tapping FILTERS the payments below */}
        <div className="m-cap mt-5 mb-1 px-1">{t('screen.categories')}</div>
        <div className="rounded-card border border-line bg-surface px-4 py-1" data-testid="budgetdetail-cats">
          {perCat.map(({ catId, spentCents }) => {
            const cat = cats.byId(catId);
            const active = catFilter === catId;
            return (
              <button
                key={catId}
                data-testid={`budgetdetail-cat-${catId}`}
                onClick={() => setCatFilter((v) => (v === catId ? null : catId))}
                className={`m-tap flex w-full items-center gap-3 border-b border-line-2 py-2.5 text-left last:border-0 ${
                  active ? 'bg-accent-soft' : 'bg-transparent'
                }`}
              >
                <Icon name={cat.icon} size={17} color={cat.color ?? cats.byId(cat.parentId)?.color ?? 'var(--m-ink-3)'} />
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{catName(cat, t)}</span>
                <span className="m-num text-[14px] font-semibold text-ink">{money(spentCents)}</span>
                <Icon
                  name={active ? 'filter-check' : 'filter-outline'}
                  size={14}
                  color={active ? 'var(--m-accent-deep)' : 'var(--m-ink-4)'}
                />
              </button>
            );
          })}
        </div>

        <div className="m-cap mt-5 mb-1 px-1">
          {t('overview.payments')} · {list.length}
        </div>
        {list.length > 0 ? (
          <div className="rounded-card border border-line bg-surface px-3 py-1" data-testid="budgetdetail-txs">
            {list.map((tx) => (
              <TxRow key={tx.id} tx={tx} showDate onClick={() => void navigate({ to: '/transactions/$txId', params: { txId: tx.id } })} />
            ))}
          </div>
        ) : (
          <p className="px-1 text-[12px] text-ink-4" data-testid="budgetdetail-empty">
            {t('overview.noPayments')}
          </p>
        )}
      </div>
    </div>
  );
}
