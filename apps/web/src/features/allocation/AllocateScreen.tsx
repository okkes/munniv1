import { useMemo, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useAllocationOps, useAllocations } from '@/application/allocation';
import { useBudgets } from '@/application/budgets';
import { useRecurrings } from '@/application/recurring';
import { useTopicOps, useTopics } from '@/application/topics';
import { useSpaceAccounts, useSpaceTransactions } from '@/application/transactions';
import {
  ageOfMoneyDays,
  availableCents,
  availableRecCents,
  recBucketId,
  recurringPeriodShare,
  spentByMainCat,
  spentByRecurring,
  spreadEvenly,
  toAllocateCents,
} from '@/domain/allocation';
import type { RecurringRow, TopicRow } from '@/db/types';
import { periodHistory } from '@/domain/periods';
import type { Period } from '@/domain/periods';
import { catName, useCategories } from '@/features/categories/useCategories';
import type { Cat } from '@/features/categories/useCategories';
import { parseCents } from '@/lib/money';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { HelpButton } from '@/features/help/HelpButton';
import { IntroCard } from '@/features/help/IntroCard';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

const WINDOW = 24; // periods of history the math replays

/**
 * The allocation ritual (approved allocation design): every period's
 * income gets a job across the main categories until the header reads
 * zero. Unassigned money carries; envelopes roll over (per-space
 * toggle); overspent envelopes get covered from calmer ones.
 */
export function AllocateScreen() {
  const { t, lang } = useLang();
  const { store, repo, spaceId } = useData();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const txs = useSpaceTransactions();
  const accounts = useSpaceAccounts();
  const allocations = useAllocations();
  const budgets = useBudgets();
  const cats = useCategories();
  const ops = useAllocationOps();

  const [viewBack, setViewBack] = useState(0); // 0 = current period
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [focusedCat, setFocusedCat] = useState<string | null>(null);
  const [coverFor, setCoverFor] = useState<string | null>(null);
  const recurrings = useRecurrings();
  const topics = useTopics();
  const topicOps = useTopicOps();
  const [topicEdit, setTopicEdit] = useState<TopicRow | 'new' | null>(null);
  const [topicName, setTopicName] = useState('');
  const [topicCats, setTopicCats] = useState<ReadonlySet<string>>(new Set());

  const history = useMemo(
    () => periodHistory(space?.periodType ?? 'month', space?.periodDay ?? 1, WINDOW),
    [space?.periodType, space?.periodDay],
  );
  const viewIndex = history.length - 1 - viewBack;
  const view = history[viewIndex];
  const editable = viewBack === 0;
  const rollover = space?.allocRollover !== 0;

  const rows = useMemo(() => cats.parents.filter((p) => p.txTypes.includes('expense')), [cats]);
  const accountsById = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts]);

  // the cumulative window: from the earliest assigned period up to the view
  const windowPeriods = useMemo(() => {
    const starts = new Set((allocations ?? []).map((a) => a.periodStart));
    let first = viewIndex;
    for (let i = 0; i < viewIndex; i++) {
      if (starts.has(history[i].start)) {
        first = i;
        break;
      }
    }
    return history.slice(first, viewIndex + 1);
  }, [allocations, history, viewIndex]);

  const model = useMemo(() => {
    const allocRows = allocations ?? [];
    const allTxs = txs ?? [];
    const assignedOf = (period: Period, catId: string) =>
      allocRows
        .filter((a) => a.periodStart === period.start && a.catId === catId)
        .reduce((sum, a) => sum + a.assignedCents, 0);
    const spent = spentByMainCat(allTxs, cats, view);
    return {
      toAllocate: toAllocateCents(windowPeriods, allTxs, accountsById, allocRows),
      age: ageOfMoneyDays(allTxs),
      assignedOf,
      spent,
      availableOf: (catId: string) => availableCents(catId, windowPeriods, rollover, allTxs, cats, allocRows),
    };
  }, [allocations, txs, accountsById, cats, windowPeriods, view, rollover]);

  const currency = space?.currency ?? 'EUR';
  const { fmt } = useDisplayMoney();
  const money = (cents: number) => fmt(cents, currency);
  const fmtShort = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });

  let headerColor = 'var(--m-warning)';
  if (model.toAllocate === 0) headerColor = 'var(--m-accent-deep)';
  else if (model.toAllocate < 0) headerColor = 'var(--m-negative)';

  const commitDraft = (catId: string) => {
    const draft = drafts[catId];
    if (draft === undefined) return;
    const cents = parseCents(draft) ?? 0;
    if (cents !== model.assignedOf(view, catId)) void ops.assign(view.start, catId, cents);
    setDrafts((d) => {
      const { [catId]: _, ...rest } = d;
      return rest;
    });
  };

  const assignEvenly = () => {
    for (const [catId, extra] of spreadEvenly(model.toAllocate, rows.map((r) => r.id))) {
      void ops.assign(view.start, catId, model.assignedOf(view, catId) + extra);
    }
  };

  // single-category budgets double as assignment suggestions
  const budgetSuggestion = (catId: string): number | null => {
    const match = (budgets ?? []).find((b) => b.catIds.length === 1 && b.catIds[0] === catId);
    return match ? match.amountCents : null;
  };
  const hasBudgets = (budgets ?? []).some((b) => b.catIds.length === 1);

  const fillToBudgets = () => {
    let remaining = model.toAllocate;
    for (const row of rows) {
      if (remaining <= 0) break;
      const suggestion = budgetSuggestion(row.id);
      const current = model.assignedOf(view, row.id);
      if (suggestion === null || suggestion <= current) continue;
      const bump = Math.min(suggestion - current, remaining);
      remaining -= bump;
      void ops.assign(view.start, row.id, current + bump);
    }
  };

  const avgSpent = (catId: string): number => {
    const past = history.slice(Math.max(0, viewIndex - 3), viewIndex);
    if (past.length === 0) return 0;
    const total = past.reduce((sum, p) => sum + (spentByMainCat(txs ?? [], cats, p).get(catId) ?? 0), 0);
    return Math.round(total / past.length);
  };

  const chipAssign = (catId: string, cents: number) => {
    setDrafts((d) => ({ ...d, [catId]: (cents / 100).toFixed(2) }));
    void ops.assign(view.start, catId, cents);
  };

  const coverShortfall = (donorId: string) => {
    if (!coverFor) return;
    const shortfall = -model.availableOf(coverFor);
    const donorRoom = model.availableOf(donorId);
    const moved = Math.min(shortfall, donorRoom);
    if (moved > 0) {
      void ops.move(view.start, donorId, coverFor, moved, (catId) => model.assignedOf(view, catId));
    }
    setCoverFor(null);
  };

  const renderRow = (cat: Cat) => {
    const assigned = model.assignedOf(view, cat.id);
    const spent = model.spent.get(cat.id) ?? 0;
    const available = model.availableOf(cat.id);
    const focused = focusedCat === cat.id;
    let pillColor = 'var(--m-ink-3)';
    if (available > 0) pillColor = 'var(--m-accent-deep)';
    else if (available < 0) pillColor = 'var(--m-negative)';
    return (
      <div key={cat.id} className="border-b border-line-2 px-4 py-2.5 last:border-0" data-testid={`alloc-row-${cat.id}`}>
        <div className="flex items-center gap-3">
          <Icon name={cat.icon} size={17} color={cat.color ?? 'var(--m-ink-3)'} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{catName(cat, t)}</span>
            <span className="block text-[11px] text-ink-4">
              {t('alloc.spentShort', { amount: money(spent) })}
            </span>
          </span>
          <button
            data-testid={`alloc-avail-${cat.id}`}
            disabled={!editable || available >= 0}
            onClick={() => setCoverFor(cat.id)}
            className="m-num rounded-full border-none px-2 py-0.5 text-[11px] font-semibold"
            style={{ color: pillColor, background: `color-mix(in srgb, ${pillColor} 12%, transparent)` }}
          >
            {money(available)}
          </button>
          <input
            data-testid={`alloc-input-${cat.id}`}
            type="number"
            inputMode="decimal"
            step="0.01"
            disabled={!editable}
            value={drafts[cat.id] ?? (assigned === 0 ? '' : (assigned / 100).toFixed(2))}
            placeholder="0.00"
            onFocus={() => setFocusedCat(cat.id)}
            onChange={(e) => setDrafts((d) => ({ ...d, [cat.id]: e.target.value }))}
            onBlur={() => commitDraft(cat.id)}
            className="h-9 w-24 rounded-input border border-line bg-surface px-2 text-right font-mono text-[13px] text-ink outline-none placeholder:text-ink-4 disabled:opacity-60"
          />
        </div>
        {focused && editable && (
          <div className="mt-2 flex gap-1.5 pl-8" data-testid="alloc-chips">
            {budgetSuggestion(cat.id) !== null && (
              <button data-testid="alloc-chip-budget" onClick={() => chipAssign(cat.id, budgetSuggestion(cat.id)!)} className="m-tap rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-2">
                {t('alloc.chipBudget', { amount: money(budgetSuggestion(cat.id)!) })}
              </button>
            )}
            {viewIndex > 0 && (
              <button data-testid="alloc-chip-last" onClick={() => chipAssign(cat.id, model.assignedOf(history[viewIndex - 1], cat.id))} className="m-tap rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-2">
                {t('alloc.chipLast')}
              </button>
            )}
            <button data-testid="alloc-chip-avg" onClick={() => chipAssign(cat.id, avgSpent(cat.id))} className="m-tap rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-2">
              {t('alloc.chipAvg')}
            </button>
          </div>
        )}
      </div>
    );
  };

  const donors = rows.filter((r) => r.id !== coverFor && model.availableOf(r.id) > 0);

  // ── recurring set-asides (user request: fund the inevitable) ─────────
  const recSpent = useMemo(() => spentByRecurring(txs ?? [], view), [txs, view]);
  const renderRecRow = (rec: RecurringRow) => {
    const bucket = recBucketId(rec.id);
    const assigned = model.assignedOf(view, bucket);
    const available = availableRecCents(rec.id, windowPeriods, rollover, txs ?? [], allocations ?? []);
    const share = recurringPeriodShare(rec, space?.periodType === 'week' ? 'week' : 'month');
    let pillColor = 'var(--m-ink-3)';
    if (available > 0) pillColor = 'var(--m-accent-deep)';
    else if (available < 0) pillColor = 'var(--m-negative)';
    return (
      <div key={rec.id} className="border-b border-line-2 px-4 py-2.5 last:border-0" data-testid={`alloc-rec-${rec.id}`}>
        <div className="flex items-center gap-3">
          <Icon name={rec.icon ?? 'autorenew'} size={17} color="var(--m-ink-3)" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{rec.name}</span>
            <span className="block text-[11px] text-ink-4">
              {t('alloc.spentShort', { amount: money(recSpent.get(rec.id) ?? 0) })}
            </span>
          </span>
          {editable && assigned < share && (
            <button
              data-testid={`alloc-rec-fill-${rec.id}`}
              onClick={() => chipAssign(bucket, share)}
              className="m-tap rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-2"
            >
              {t('alloc.recFill', { amount: money(share) })}
            </button>
          )}
          <span
            className="m-num rounded-full px-2 py-0.5 text-[11px] font-semibold"
            data-testid={`alloc-rec-avail-${rec.id}`}
            style={{ color: pillColor, background: `color-mix(in srgb, ${pillColor} 12%, transparent)` }}
          >
            {money(available)}
          </span>
          <input
            data-testid={`alloc-rec-input-${rec.id}`}
            type="number"
            inputMode="decimal"
            step="0.01"
            disabled={!editable}
            value={drafts[bucket] ?? (assigned === 0 ? '' : (assigned / 100).toFixed(2))}
            placeholder="0.00"
            onChange={(e) => setDrafts((d) => ({ ...d, [bucket]: e.target.value }))}
            onBlur={() => commitDraft(bucket)}
            className="h-9 w-24 rounded-input border border-line bg-surface px-2 text-right font-mono text-[13px] text-ink outline-none placeholder:text-ink-4 disabled:opacity-60"
          />
        </div>
      </div>
    );
  };

  // ── topics: user-defined envelope groups (user request) ──────────────
  const topicOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const topic of topics ?? []) for (const catId of topic.catIds) map.set(catId, topic.id);
    return map;
  }, [topics]);
  const ungrouped = rows.filter((r) => !topicOf.has(r.id));
  const topicSubtotal = (topic: TopicRow) =>
    topic.catIds.reduce((sum, catId) => sum + model.availableOf(catId), 0);
  const openTopicEditor = (topic: TopicRow | 'new') => {
    setTopicEdit(topic);
    setTopicName(topic === 'new' ? '' : topic.name);
    setTopicCats(new Set(topic === 'new' ? [] : topic.catIds));
  };
  const saveTopic = async () => {
    if (!topicName.trim() || topicCats.size === 0) return;
    await topicOps.save(topicEdit === 'new' || topicEdit === null ? null : topicEdit.id, {
      name: topicName.trim(),
      catIds: [...topicCats],
    });
    setTopicEdit(null);
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-allocate">
      <AppBar
        title={t('alloc.title')}
        leading={
          <IconButton label={t('action.back')} testId="alloc-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={<HelpButton tourId="allocation" />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <IntroCard tourId="allocation" />
        {/* period pager */}
        <div className="flex items-center justify-between">
          <IconButton label="‹" testId="alloc-prev" onClick={() => setViewBack((v) => Math.min(v + 1, history.length - 1))}>
            <Icon name="chevron-left" size={20} />
          </IconButton>
          <span className="text-[13px] font-medium text-ink-2" data-testid="alloc-period">
            {fmtShort(view.start)} – {fmtShort(view.end)}
          </span>
          <IconButton label="›" testId="alloc-next" onClick={() => setViewBack((v) => Math.max(v - 1, 0))}>
            <Icon name="chevron-right" size={20} />
          </IconButton>
        </div>

        {/* the ritual header */}
        <div className="rounded-card border border-line bg-surface p-4 text-center" data-testid="alloc-header">
          <div className="m-num text-[28px] font-semibold" style={{ color: headerColor }} data-testid="alloc-toallocate">
            {money(model.toAllocate)}
          </div>
          <div className="text-[12px] text-ink-3">
            {model.toAllocate === 0 ? t('alloc.allAssigned') : t('alloc.toAllocate')}
          </div>
          {model.age !== null && (
            <div className="mt-1 text-[11px] text-ink-4" data-testid="alloc-age">
              {t('alloc.ageOfMoney', { n: model.age })}
            </div>
          )}
          {editable && model.toAllocate > 0 && (
            <div className="mt-3 flex justify-center gap-2">
              <Button size="sm" data-testid="alloc-evenly" onClick={assignEvenly}>
                {t('alloc.evenly')}
              </Button>
              {hasBudgets && (
                <Button size="sm" variant="outline" data-testid="alloc-fill" onClick={fillToBudgets}>
                  {t('alloc.fillBudgets')}
                </Button>
              )}
            </div>
          )}
        </div>

        {!editable && (
          <p className="mt-2 px-1 text-center text-[11px] text-ink-4" data-testid="alloc-readonly">
            {t('alloc.readOnly')}
          </p>
        )}

        {/* first run: an untouched wall of envelopes explains itself (§2L) */}
        {editable && model.toAllocate > 0 && rows.every((c) => model.assignedOf(view, c.id) === 0) && (
          <div className="mt-3 flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3" data-testid="alloc-firstrun">
            <Icon name="cash-multiple" size={20} color="var(--m-accent-deep)" />
            <span className="min-w-0 flex-1 text-[12px] text-ink-3">
              <span className="block text-[13px] font-medium text-ink">{t('alloc.firstRunTitle')}</span>
              {t('alloc.firstRunBody')}
            </span>
          </div>
        )}

        {/* recurring set-asides: fund the inevitable before it hits */}
        {(recurrings ?? []).length > 0 && (
          <>
            <div className="m-cap mt-4 mb-1 px-1">{t('alloc.setAside')}</div>
            <p className="mb-1 px-1 text-[11px] text-ink-4">{t('alloc.setAsideHint')}</p>
            <div className="rounded-card border border-line bg-surface" data-testid="alloc-rec-list">
              {(recurrings ?? []).map(renderRecRow)}
            </div>
          </>
        )}

        {/* envelopes, grouped by the user's topics */}
        <div className="mt-4 mb-1 flex items-center justify-between px-1">
          <span className="m-cap">{t('alloc.envelopes')}</span>
          <button
            data-testid="alloc-topic-new"
            onClick={() => openTopicEditor('new')}
            className="m-tap border-none bg-transparent text-[12px] font-medium text-accent-deep"
          >
            + {t('alloc.topicNew')}
          </button>
        </div>
        {(topics ?? []).map((topic) => (
          <div key={topic.id} className="mb-3 rounded-card border border-line bg-surface" data-testid={`alloc-topicgroup-${topic.id}`}>
            <div className="flex items-center gap-2 border-b border-line-2 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-wide text-ink-2 uppercase">{topic.name}</span>
              <span className="m-num text-[11px] font-semibold" style={{ color: topicSubtotal(topic) < 0 ? 'var(--m-negative)' : 'var(--m-accent-deep)' }} data-testid={`alloc-topic-total-${topic.id}`}>
                {money(topicSubtotal(topic))}
              </span>
              <button
                aria-label={t('action.edit')}
                data-testid={`alloc-topic-edit-${topic.id}`}
                onClick={() => openTopicEditor(topic)}
                className="m-tap border-none bg-transparent text-ink-4"
              >
                <Icon name="pencil-outline" size={14} />
              </button>
            </div>
            {rows.filter((r) => topic.catIds.includes(r.id)).map(renderRow)}
          </div>
        ))}
        <div className="rounded-card border border-line bg-surface" data-testid="alloc-list">
          {ungrouped.map(renderRow)}
        </div>

        {/* rollover is a space decision, synced */}
        <button
          data-testid="alloc-rollover"
          onClick={() => void repo.upsert('space', spaceId, spaceId, { allocRollover: rollover ? (0 as const) : (1 as const) })}
          className="m-tap mt-3 flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
        >
          <Icon name="autorenew" size={18} color="var(--m-ink-3)" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">{t('alloc.rollover')}</span>
            <span className="block text-[11px] text-ink-4">{t('alloc.rolloverHint')}</span>
          </span>
          <span
            className={`flex h-6 w-10 items-center rounded-full px-0.5 transition-colors ${rollover ? 'justify-end bg-accent' : 'justify-start bg-bg-2'}`}
          >
            <span className="h-5 w-5 rounded-full bg-surface shadow" />
          </span>
        </button>
      </div>

      {/* topic editor: name + member categories */}
      <Sheet open={topicEdit !== null} onOpenChange={(open) => !open && setTopicEdit(null)} title={t('alloc.topicTitle')} size="tall">
        <div className="flex flex-col gap-3 pt-1">
          <input
            data-testid="alloc-topic-name"
            value={topicName}
            onChange={(e) => setTopicName(e.target.value)}
            placeholder={t('alloc.topicName')}
            className="h-11 rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {rows.map((cat) => {
              const member = topicCats.has(cat.id);
              const elsewhere = topicOf.get(cat.id) !== undefined && (topicEdit === 'new' || topicOf.get(cat.id) !== (topicEdit as TopicRow | null)?.id);
              return (
                <button
                  key={cat.id}
                  data-testid={`alloc-topiccat-${cat.id}`}
                  disabled={elsewhere && !member}
                  onClick={() =>
                    setTopicCats((prev) => {
                      const next = new Set(prev);
                      if (next.has(cat.id)) next.delete(cat.id);
                      else next.add(cat.id);
                      return next;
                    })
                  }
                  className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-2.5 text-left last:border-0 disabled:opacity-40"
                >
                  <Icon name={cat.icon} size={17} color={cat.color ?? 'var(--m-ink-3)'} />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{catName(cat, t)}</span>
                  <Icon name={member ? 'checkbox-marked' : 'checkbox-blank-outline'} size={18} color={member ? 'var(--m-accent-deep)' : 'var(--m-ink-4)'} />
                </button>
              );
            })}
          </div>
          <Button data-testid="alloc-topic-save" onClick={() => void saveTopic()} disabled={!topicName.trim() || topicCats.size === 0}>
            {t('split.done')}
          </Button>
          {topicEdit !== 'new' && topicEdit !== null && (
            <Button
              variant="danger"
              data-testid="alloc-topic-delete"
              onClick={() => {
                void topicOps.remove(topicEdit.id);
                setTopicEdit(null);
              }}
            >
              {t('action.delete')}
            </Button>
          )}
        </div>
      </Sheet>

      {/* cover an overspent envelope from a calmer one */}
      <Sheet open={coverFor !== null} onOpenChange={(open) => !open && setCoverFor(null)} title={t('alloc.coverTitle')} size="form">
        <p className="pb-2 text-[12px] text-ink-3">{t('alloc.coverHint')}</p>
        <div data-testid="alloc-cover-list">
          {donors.map((cat) => (
            <button
              key={cat.id}
              data-testid={`alloc-cover-${cat.id}`}
              onClick={() => coverShortfall(cat.id)}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left last:border-0"
            >
              <Icon name={cat.icon} size={17} color={cat.color ?? 'var(--m-ink-3)'} />
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{catName(cat, t)}</span>
              <span className="m-num text-[13px] font-semibold text-accent-deep">{money(model.availableOf(cat.id))}</span>
            </button>
          ))}
          {donors.length === 0 && <p className="px-1 py-3 text-[12px] text-ink-4">{t('alloc.coverNone')}</p>}
        </div>
      </Sheet>
    </div>
  );
}
