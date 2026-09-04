import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useEvents } from '@/application/events';
import { useSpaceTransactions } from '@/application/transactions';
import { eventCategoryBreakdown, eventPerDayCents, eventSpentCents, eventSubcategoryBreakdown, suggestableTxs } from '@/domain/events';
import { catName, useCategories } from '@/features/categories/useCategories';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { ProgressBar } from '@/ui/primitives';
import { TxRow } from '@/ui/TxRow';
import { TxPartRow } from '@/ui/TxPartRow';
import { EventFormSheet, eventPicture } from './EventsScreen';
import { SplitEventSummary } from '@/features/splits/SplitEventSummary';
import { REIMBURSED_ID } from '@/domain/categories';
import type { EventRow, TransactionRow, TxSplit } from '@/db/types';

// ── #143: a split's parts attach individually — never the container ──
/** the pickable parts of one row, keeping their ORIGINAL splits index
 *  (legacy flat spreads may lack part ids — the index is the address) */
export function partEntries(tx: TransactionRow): { part: TxSplit; idx: number }[] {
  return (tx.splits ?? []).map((part, idx) => ({ part, idx })).filter((e) => e.part.catId !== REIMBURSED_ID);
}
export const partPickKey = (txId: string, idx: number): string => `${txId}#${idx}`;
/** every checkbox key the picker opens with: part keys for multi-part
 *  rows (parts already attached elsewhere stay out), else the tx id */
export function suggestionKeysOf(txs: readonly TransactionRow[] | undefined): string[] {
  return (txs ?? []).flatMap((tx) => {
    const entries = partEntries(tx);
    if (entries.length > 1) return entries.filter((e) => !e.part.eventId).map((e) => partPickKey(tx.id, e.idx));
    return [tx.id];
  });
}

/**
 * One event in full: what it cost (per day when dated), where the money
 * went, every transaction — and the fast path: review everything that
 * happened inside the date range and attach your picks in one go.
 */
export function EventDetailScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const { eventId } = useParams({ strict: false }) as { eventId: string };
  const events = useEvents();
  const txs = useSpaceTransactions();
  const cats = useCategories();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const [formInitial, setFormInitial] = useState<EventRow | 'new' | null>(null);
  // category drill (user request): a tapped main filters the payments and
  // unfolds its subcategories; a tapped sub narrows further
  const [drillMain, setDrillMain] = useState<string | null>(null);
  const [drillSub, setDrillSub] = useState<string | null>(null);

  const event = events?.find((e) => e.id === eventId);
  // deleted here or on another device: leave the orphaned detail
  useEffect(() => {
    if (events && !event) void navigate({ to: '/events', replace: true });
  }, [events, event, navigate]);
  const currency = space?.currency ?? 'EUR';
  const { fmt } = useDisplayMoney();
  const money = (cents: number) => fmt(cents, currency);

  const view = useMemo(() => {
    if (!event || !txs) return undefined;
    // #143: membership is per-slice — a row belongs when it (or any of
    // its parts) carries the event
    const list = txs
      .filter(
        (tx) =>
          tx.deleted === 0 &&
          (tx.eventId === event.id || (tx.splits ?? []).some((s) => s.catId !== REIMBURSED_ID && s.eventId === event.id)),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    const spent = eventSpentCents(txs, event.id);
    return {
      list,
      spent,
      perDay: eventPerDayCents(spent, event.from, event.to),
      breakdown: eventCategoryBreakdown(txs, event.id, cats),
      suggestions: suggestableTxs(txs, event.id, event.from, event.to),
    };
  }, [event, txs, cats]);

  if (!event || !view) return <div className="h-full" data-testid="screen-event-detail" />;

  const filteredList = view.list.filter((tx) => {
    if (!drillMain) return true;
    const cat = cats.byId(tx.catId);
    if (drillSub) return cat.id === drillSub;
    return (cat.parentId ?? cat.id) === drillMain;
  });

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-event-detail">
      <AppBar
        title={event.name}
        leading={
          <IconButton label={t('action.back')} testId="eventdetail-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <IconButton label={t('events.edit')} testId="eventdetail-edit" onClick={() => setFormInitial(event)}>
            <Icon name="pencil-outline" size={20} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* the picture-first hero */}
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="eventdetail-hero">
          <div className="relative h-36 w-full">
            <img src={eventPicture(event)} alt="" className="h-full w-full object-cover" />
            <span className="absolute right-3 bottom-2 rounded-lg bg-black/45 px-2.5 py-1 backdrop-blur-sm">
              <span className="m-num text-[20px] font-semibold text-white" data-testid="eventdetail-total">
                {money(view.spent)}
              </span>
            </span>
          </div>
          <div className="px-4 py-3">
            <span className="block text-[12px] text-ink-3">
              {event.from && event.to && `${fmtDate(event.from)} – ${fmtDate(event.to)}`}
              {view.perDay !== null && ` · ${t('events.perDay', { amount: money(view.perDay) })}`}
            </span>
            {event.note && (
              <p className="mt-1 text-[13px] text-ink-2" data-testid="eventdetail-note">
                {event.note}
              </p>
            )}
            {!!event.budgetCents && (
              <>
                <ProgressBar
                  className="mt-2"
                  value={view.spent / event.budgetCents}
                  tone={view.spent > event.budgetCents ? 'negative' : 'accent'}
                />
                <div className="mt-1.5 text-[11px] text-ink-3">{t('events.estimateOf', { amount: money(event.budgetCents) })}</div>
              </>
            )}
          </div>
        </div>

        {/* SP5: my split wired to this event — who owes whom, one tap away */}
        <SplitEventSummary eventId={eventId} />

        {/* the fast path after a trip: review the date range, attach your picks */}
        {view.suggestions.length > 0 && (
          <div className="mt-3 flex items-center gap-3 rounded-card border border-accent bg-accent-soft/40 px-4 py-3" data-testid="eventdetail-suggest">
            <Icon name="creation" size={17} color="var(--m-accent-deep)" />
            <span className="min-w-0 flex-1 text-[13px] text-ink-2">
              {t('events.suggestAttach', { n: view.suggestions.length })}
            </span>
            <Button
              size="sm"
              data-testid="eventdetail-attach-all"
              // #144 (user): the picker is a full SCREEN now, not a sheet
              onClick={() => void navigate({ to: '/events/$eventId/attach', params: { eventId: event.id } })}
            >
              {t('events.reviewSuggested')}
            </Button>
          </div>
        )}

        {view.breakdown.length > 0 && (
          <>
            <div className="m-cap mt-5 mb-1 px-1">{t('screen.categories')}</div>
            <div className="rounded-card border border-line bg-surface px-4 py-1" data-testid="eventdetail-cats">
              {view.breakdown.map(({ catId, totalCents }) => {
                const cat = cats.byId(catId);
                const active = drillMain === catId;
                const subs = active ? eventSubcategoryBreakdown(txs ?? [], event.id, cats, catId) : [];
                return (
                  <div key={catId} className="border-b border-line-2 last:border-0">
                    <button
                      data-testid={`eventdetail-cat-${catId}`}
                      onClick={() => {
                        setDrillMain(active ? null : catId);
                        setDrillSub(null);
                      }}
                      className={`m-tap flex w-full items-center gap-3 border-none bg-transparent py-2.5 text-left ${
                        active ? 'text-accent-deep' : ''
                      }`}
                    >
                      <Icon name={cat.icon} size={17} color={cat.color ?? 'var(--m-ink-3)'} />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{catName(cat, t)}</span>
                      <span className="m-num text-[14px] font-semibold text-ink">{money(totalCents)}</span>
                      <Icon name={active ? 'chevron-up' : 'chevron-down'} size={15} color="var(--m-ink-4)" />
                    </button>
                    {active &&
                      subs.map((sub) => {
                        const subCat = cats.byId(sub.catId);
                        const subActive = drillSub === sub.catId;
                        return (
                          <button
                            key={sub.catId}
                            data-testid={`eventdetail-subcat-${sub.catId}`}
                            onClick={() => setDrillSub(subActive ? null : sub.catId)}
                            className={`m-tap flex w-full items-center gap-3 border-none bg-transparent py-2 pl-7 text-left ${
                              subActive ? 'text-accent-deep' : ''
                            }`}
                          >
                            <Icon name={subCat.icon} size={15} color={subCat.color ?? cat.color ?? 'var(--m-ink-4)'} />
                            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{catName(subCat, t)}</span>
                            <span className="m-num text-[13px] text-ink-2">{money(sub.totalCents)}</span>
                            {subActive && <Icon name="check" size={14} color="var(--m-accent)" />}
                          </button>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="m-cap mt-5 mb-1 flex items-center gap-2 px-1">
          <span>
            {t('overview.payments')} · {filteredList.length}
          </span>
          {drillMain && (
            <button
              data-testid="eventdetail-filter-clear"
              onClick={() => {
                setDrillMain(null);
                setDrillSub(null);
              }}
              className="m-tap flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] normal-case"
            >
              {catName(cats.byId(drillSub ?? drillMain), t)}
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        {filteredList.length > 0 ? (
          <div className="divide-y divide-line-2 rounded-card border border-line bg-surface px-3 py-1" data-testid="eventdetail-txs">
            {filteredList.map((tx) => {
              // #143: a split shows its MEMBER parts as rows of their
              // own — each opens its part page
              const entries = partEntries(tx);
              if (entries.length > 1) {
                const sign = tx.amountCents < 0 ? -1 : 1;
                return entries
                  .map((e, ordinal) => ({ ...e, ordinal }))
                  .filter((e) => (e.part.eventId ?? tx.eventId) === event.id)
                  .map((e) => (
                    <TxPartRow
                      key={partPickKey(tx.id, e.idx)}
                      tx={tx}
                      part={e.part}
                      index={e.ordinal}
                      amountText={money(sign * Math.abs(e.part.amountCents))}
                      onClick={() =>
                        void navigate({ to: '/transactions/$txId', params: { txId: tx.id }, search: { part: e.part.id } })
                      }
                      showDate
                    />
                  ));
              }
              return (
                <TxRow key={tx.id} tx={tx} showDate onClick={() => void navigate({ to: '/transactions/$txId', params: { txId: tx.id } })} />
              );
            })}
          </div>
        ) : (
          <p className="px-1 text-[12px] text-ink-4" data-testid="eventdetail-empty">
            {t('events.noTxs')}
          </p>
        )}
      </div>

      {/* #144: the picker moved to its own SCREEN (/events/$id/attach) */}
      <EventFormSheet initial={formInitial} onClose={() => setFormInitial(null)} />
    </div>
  );
}
