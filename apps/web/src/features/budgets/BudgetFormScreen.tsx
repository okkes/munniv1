import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useBudgetOps, useBudgets } from '@/application/budgets';
import { localToday } from '@/application/recurring';
import { budgetFamily, categoryConflicts } from '@/domain/budgets';
import { LOCKED_MAIN_IDS } from '@/domain/categories';
import type { BudgetCarryMode, BudgetEvery, BudgetRow } from '@/db/types';
import { catName, useCategories } from '@/features/categories/useCategories';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Collapse } from '@/ui/Collapse';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { BUDGET_ICONS } from './budgetUi';

/**
 * Create/edit a budget — a full screen, not a sheet: icon, name, amount,
 * cadence + anchor, the category checklist with exclusivity badges,
 * carry-over configuration and the warning threshold.
 */
export function BudgetFormScreen() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const { budgetId } = useParams({ strict: false }) as { budgetId?: string };
  const budgets = useBudgets();
  const ops = useBudgetOps();
  const cats = useCategories();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);

  const editing = budgets?.find((b) => b.id === budgetId);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(BUDGET_ICONS[0]);
  const [amount, setAmount] = useState('');
  const [every, setEvery] = useState<BudgetEvery>('month');
  const [anchor, setAnchor] = useState(localToday());
  const [catIds, setCatIds] = useState<string[]>([]);
  // long list tamed (user request): search + fold, mains start collapsed
  const [catQuery, setCatQuery] = useState('');
  const [openCats, setOpenCats] = useState<ReadonlySet<string>>(new Set());
  const [carryOver, setCarryOver] = useState(false);
  const [carryMode, setCarryMode] = useState<BudgetCarryMode>('periods');
  const [carryPeriods, setCarryPeriods] = useState(1);
  // free-typed draft so the '1' can be deleted while editing; clamped on blur
  const [carryPeriodsText, setCarryPeriodsText] = useState('1');
  const [carryCap, setCarryCap] = useState('');
  const [notifyAtPct, setNotifyAtPct] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!editing || loaded) return;
    setName(editing.name);
    setIcon(editing.icon ?? BUDGET_ICONS[0]);
    setAmount((editing.amountCents / 100).toFixed(2));
    setEvery(editing.every);
    setAnchor(editing.anchor);
    setCatIds(editing.catIds);
    setCarryOver(editing.carryOver === 1);
    setCarryMode(editing.carryMode ?? 'periods');
    setCarryPeriods(editing.carryPeriods ?? 1);
    setCarryPeriodsText(String(editing.carryPeriods ?? 1));
    setCarryCap(editing.carryCapCents ? (editing.carryCapCents / 100).toFixed(2) : '');
    setNotifyAtPct(editing.notifyAtPct ?? 0);
    setLoaded(true);
  }, [editing, loaded]);

  // exclusivity: categories other budgets already claim get a badge
  const otherBudgets = useMemo(
    () => (budgets ?? []).filter((b): b is BudgetRow => b.id !== budgetId),
    [budgets, budgetId],
  );
  // the locked reimbursement tree is excluded from budget math (rule c) —
  // budgeting it would be budgeting money that is not spending
  const expenseParents = useMemo(
    () => cats.parents.filter((p) => p.txTypes.includes('expense') && !LOCKED_MAIN_IDS.has(p.id)),
    [cats],
  );
  const conflictCandidates = useMemo(
    () => expenseParents.flatMap((p) => [p.id, ...cats.childrenOf(p.id).map((c) => c.id)]),
    [expenseParents, cats],
  );
  const conflicts = useMemo(
    () => categoryConflicts(conflictCandidates, otherBudgets, cats),
    [conflictCandidates, otherBudgets, cats],
  );
  // a checked main claims its subs — the family covers them
  const ownFamily = useMemo(() => budgetFamily(catIds, cats), [catIds, cats]);

  const toggleCat = (id: string) =>
    setCatIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const amountCents = Math.round(Number.parseFloat(amount.replace(',', '.')) * 100);
  const valid = name.trim().length > 0 && Number.isFinite(amountCents) && amountCents > 0 && catIds.length > 0 && !!anchor;

  const save = async () => {
    if (!valid) return;
    const capCents = Math.round(Number.parseFloat(carryCap.replace(',', '.')) * 100);
    await ops.save(editing?.id ?? null, {
      name: name.trim(),
      icon,
      amountCents,
      every,
      anchor,
      catIds,
      carryOver: carryOver ? 1 : 0,
      carryMode: carryOver ? carryMode : undefined,
      carryPeriods: carryOver && carryMode === 'periods' ? Math.max(1, carryPeriods) : undefined,
      carryCapCents: carryOver && carryMode === 'cap' && Number.isFinite(capCents) && capCents > 0 ? capCents : undefined,
      notifyAtPct: notifyAtPct || undefined,
      active: editing?.active ?? 1,
    });
    if (editing) await navigate({ to: '/budgets/$budgetId', params: { budgetId: editing.id }, replace: true });
    else await navigate({ to: '/budgets', replace: true });
  };

  const removeBudget = async () => {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await ops.remove(editing.id);
    await navigate({ to: '/budgets', replace: true });
  };

  const currency = space?.currency ?? 'EUR';

  const renderCatRow = (id: string, indent: boolean) => {
    const cat = cats.byId(id);
    const conflictOwner = conflicts.get(id);
    const coveredByMain = !catIds.includes(id) && ownFamily.has(id);
    const disabled = !!conflictOwner || coveredByMain;
    const checked = catIds.includes(id) || coveredByMain;
    return (
      <button
        key={id}
        data-testid={`budget-cat-${id}`}
        disabled={disabled}
        onClick={() => toggleCat(id)}
        className={`m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent py-2.5 text-left last:border-0 ${indent ? 'pl-8' : 'pl-1'} ${disabled ? 'opacity-45' : ''}`}
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? 'border-accent bg-accent' : 'border-line bg-transparent'}`}
        >
          {checked && <Icon name="check" size={12} color="#fff" />}
        </span>
        <Icon name={cat.icon} size={16} color={cat.color ?? cats.byId(cat.parentId)?.color ?? 'var(--m-ink-3)'} />
        <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{catName(cat, t)}</span>
        {conflictOwner && (
          <span className="shrink-0 rounded-full bg-bg-2 px-2 py-0.5 text-[10px] font-medium text-ink-3" data-testid={`budget-cat-conflict-${id}`}>
            {t('budgets.inBudget', { name: conflictOwner })}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-budget-form">
      <AppBar
        title={editing ? t('budgets.edit') : t('budgets.new')}
        leading={
          <IconButton label={t('action.back')} testId="budgetform-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex flex-col gap-3 pt-1">
          {/* icon row */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {BUDGET_ICONS.map((candidate) => (
              <button
                key={candidate}
                data-testid={`budgetform-icon-${candidate}`}
                onClick={() => setIcon(candidate)}
                className={`m-tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                  icon === candidate ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line bg-surface text-ink-2'
                }`}
              >
                <Icon name={candidate} size={19} />
              </button>
            ))}
          </div>

          <input
            data-testid="budgetform-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('budgets.namePlaceholder')}
            className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4"
          />

          <div className="m-cap px-1">{t('budgets.amount', { currency })}</div>
          <input
            data-testid="budgetform-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="h-12 w-full rounded-input border border-line bg-surface px-4 font-mono text-[15px] text-ink outline-none placeholder:text-ink-4"
          />

          <div className="m-cap px-1">{t('budgets.cadence')}</div>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['week', 'budgets.everyWeek'],
                ['2weeks', 'budgets.every2Weeks'],
                ['month', 'budgets.everyMonth'],
              ] as const
            ).map(([value, labelKey]) => (
              <Chip key={value} testId={`budgetform-every-${value}`} selected={every === value} onClick={() => setEvery(value)}>
                {t(labelKey)}
              </Chip>
            ))}
          </div>
          <label className="flex items-center gap-3 text-[13px] text-ink-2">
            {t('budgets.anchor')}
            <input
              data-testid="budgetform-anchor"
              type="date"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              className="h-10 rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none"
            />
          </label>

          <div className="m-cap px-1">
            {t('screen.categories')} · {catIds.length}
          </div>
          <input
            data-testid="budgetform-cat-search"
            value={catQuery}
            onChange={(e) => setCatQuery(e.target.value)}
            placeholder={t('cats.searchPlaceholder')}
            className="h-10 w-full rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
          <div className="rounded-card border border-line bg-surface px-3 py-1" data-testid="budgetform-cats">
            {expenseParents.map((parent) => {
              const q = catQuery.trim().toLowerCase();
              const subs = cats.childrenOf(parent.id);
              const matches = (id: string) => !q || catName(cats.byId(id), t).toLowerCase().includes(q);
              const anySub = subs.some((sub) => matches(sub.id));
              if (q && !matches(parent.id) && !anySub) return null;
              // searching unfolds the hits; otherwise the fold state rules
              const open = q ? true : openCats.has(parent.id);
              return (
                <div key={parent.id}>
                  <div className="flex items-center">
                    <button
                      data-testid={`budgetform-fold-${parent.id}`}
                      aria-expanded={open}
                      onClick={() =>
                        setOpenCats((prev) => {
                          const next = new Set(prev);
                          if (next.has(parent.id)) next.delete(parent.id);
                          else next.add(parent.id);
                          return next;
                        })
                      }
                      className="m-tap flex h-9 w-7 shrink-0 items-center justify-center border-none bg-transparent text-ink-4"
                    >
                      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
                    </button>
                    <div className="min-w-0 flex-1">{renderCatRow(parent.id, false)}</div>
                  </div>
                  <Collapse open={open}>
                    <div>{subs.filter((sub) => matches(sub.id) || matches(parent.id)).map((sub) => renderCatRow(sub.id, true))}</div>
                  </Collapse>
                </div>
              );
            })}
          </div>

          {/* carry-over */}
          <button
            data-testid="budgetform-carry"
            onClick={() => setCarryOver((v) => !v)}
            className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] text-ink">{t('budgets.carryOver')}</span>
              <span className="block text-[11px] text-ink-4">{t('budgets.carryHint')}</span>
            </span>
            <span className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${carryOver ? 'justify-end bg-accent' : 'justify-start bg-bg-2'}`}>
              <span className="h-5 w-5 rounded-full bg-surface shadow" />
            </span>
          </button>
          {carryOver && (
            <div className="flex flex-wrap items-center gap-2 px-1">
              <Chip testId="budgetform-carrymode-periods" selected={carryMode === 'periods'} onClick={() => setCarryMode('periods')}>
                {t('budgets.carryPeriods')}
              </Chip>
              <Chip testId="budgetform-carrymode-cap" selected={carryMode === 'cap'} onClick={() => setCarryMode('cap')}>
                {t('budgets.carryCap')}
              </Chip>
              {carryMode === 'periods' ? (
                <input
                  data-testid="budgetform-carryperiods"
                  type="number"
                  min={1}
                  max={52}
                  value={carryPeriodsText}
                  onChange={(e) => setCarryPeriodsText(e.target.value)}
                  onBlur={() => {
                    const clamped = Math.min(52, Math.max(1, Number(carryPeriodsText) || 1));
                    setCarryPeriods(clamped);
                    setCarryPeriodsText(String(clamped));
                  }}
                  className="h-10 w-20 rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none"
                />
              ) : (
                <input
                  data-testid="budgetform-carrycap"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={carryCap}
                  onChange={(e) => setCarryCap(e.target.value)}
                  placeholder="0.00"
                  className="h-10 w-28 rounded-input border border-line bg-surface px-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-4"
                />
              )}
            </div>
          )}

          <div className="m-cap px-1">{t('budgets.notify')}</div>
          <div className="flex flex-wrap gap-2">
            {[0, 80, 90, 100].map((pct) => (
              <Chip key={pct} testId={`budgetform-notify-${pct}`} selected={notifyAtPct === pct} onClick={() => setNotifyAtPct(pct)}>
                {pct === 0 ? t('recurring.notifyOff') : `${pct}%`}
              </Chip>
            ))}
          </div>

          <Button data-testid="budgetform-save" onClick={() => void save()} disabled={!valid}>
            {editing ? t('action.save') : t('action.create')}
          </Button>
          {editing && (
            <Button variant="danger" data-testid="budgetform-delete" onClick={() => void removeBudget()}>
              {confirmDelete ? t('action.confirm') : t('action.delete')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
