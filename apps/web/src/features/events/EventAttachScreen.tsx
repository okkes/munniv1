import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useEvents } from '@/application/events';
import { logActivity } from '@/application/activity';
import { useSpaceTransactions, useTxTransform } from '@/application/transactions';
import { suggestableTxs } from '@/domain/events';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { useQuery } from '@/db/useQuery';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { TxRow } from '@/ui/TxRow';
import { TxPartRow } from '@/ui/TxPartRow';
import { partEntries, partPickKey, suggestionKeysOf } from './EventDetailScreen';

/**
 * #144 (user): attaching transactions to an event is a FULL SCREEN now,
 * not a cramped sheet — the list wears the transactions screen's look
 * (hairline dividers, the same rows) with one difference: a checkbox on
 * the left. Everything starts selected (excluding is the review), and
 * select/deselect-all does the whole list in one tap.
 */
export function EventAttachScreen() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { store, repo, spaceId } = useData();
  const { eventId } = useParams({ strict: false }) as { eventId: string };
  const events = useEvents();
  const txs = useSpaceTransactions();
  const transform = useTxTransform();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [attaching, setAttaching] = useState(false);

  const event = events?.find((e) => e.id === eventId);
  useEffect(() => {
    if (events && !event) void navigate({ to: '/events', replace: true });
  }, [events, event, navigate]);
  const currency = space?.currency ?? 'EUR';
  const { fmt } = useDisplayMoney();
  const money = (cents: number) => fmt(cents, currency);

  const suggestions = useMemo(
    () => (event && txs ? suggestableTxs(txs, event.id, event.from, event.to) : undefined),
    [event, txs],
  );
  // everything starts selected — excluding is the review. Adopted at
  // RENDER time the moment suggestions exist (null = not seeded yet):
  // the rows and their checks land in the SAME commit, so no tap can
  // slip in between; later emissions never re-seed (the LoanMatchSheet
  // seed-once lesson)
  if (picked === null && suggestions) setPicked(new Set(suggestionKeysOf(suggestions)));
  const pickedSet: ReadonlySet<string> = picked ?? new Set<string>();

  if (!event) return <div className="h-full" data-testid="screen-event-attach" />;

  const allKeys = suggestionKeysOf(suggestions);
  const togglePick = (id: string) => {
    const next = new Set(pickedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const attachPicked = async () => {
    setAttaching(true);
    try {
      let n = 0;
      for (const tx of suggestions ?? []) {
        // #143: multi-part rows attach PART BY PART — the picked parts
        // get the event in one splits write; the container stays bare
        const entries = partEntries(tx);
        if (entries.length > 1) {
          const idxs = new Set(entries.filter((e) => pickedSet.has(partPickKey(tx.id, e.idx))).map((e) => e.idx));
          if (idxs.size === 0) continue;
          const nextSplits = (tx.splits ?? []).map((s, i) => (idxs.has(i) ? { ...s, eventId: event.id } : s));
          await transform(tx, { splits: nextSplits }, null);
          n += idxs.size;
        } else if (pickedSet.has(tx.id)) {
          await transform(tx, { eventId: event.id }, null);
          n++;
        }
      }
      if (n > 0) void logActivity(store, repo, spaceId, 'txLink', `${event.name} +${n}`);
      // replace, not back: the attach step vanishes from history — the
      // browser back on the detail then leaves the event, not re-picks
      void navigate({ to: '/events/$eventId', params: { eventId: event.id }, replace: true });
    } finally {
      setAttaching(false);
    }
  };

  const pickedTotal = (suggestions ?? []).reduce((sum, tx) => {
    const entries = partEntries(tx);
    if (entries.length > 1) {
      const sign = tx.amountCents < 0 ? -1 : 1;
      return (
        sum +
        entries
          .filter((e) => pickedSet.has(partPickKey(tx.id, e.idx)))
          .reduce((inner, e) => inner + -(sign * Math.abs(e.part.amountCents)), 0)
      );
    }
    return sum + (pickedSet.has(tx.id) ? -tx.amountCents : 0);
  }, 0);

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-event-attach">
      <AppBar
        title={t('events.pickTitle')}
        leading={
          <IconButton label={t('action.back')} testId="eventpick-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* one tap for the whole list, either way */}
        <div className="flex gap-2 pb-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            data-testid="eventpick-all"
            onClick={() => setPicked(new Set(allKeys))}
          >
            {t('events.pickAll')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            data-testid="eventpick-none"
            onClick={() => setPicked(new Set())}
          >
            {t('events.pickNone')}
          </Button>
        </div>
        <div className="divide-y divide-line-2 rounded-card border border-line bg-surface px-3 py-1" data-testid="eventpick-list">
          {(suggestions ?? []).flatMap((tx) => {
            // #143: a split offers its PARTS, one checkbox each — the
            // container itself is never a pick
            const entries = partEntries(tx);
            if (entries.length > 1) {
              const sign = tx.amountCents < 0 ? -1 : 1;
              return entries
                .map((e, ordinal) => ({ ...e, ordinal }))
                .filter((e) => !e.part.eventId)
                .map((e) => {
                  const key = partPickKey(tx.id, e.idx);
                  const partChecked = pickedSet.has(key);
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <button
                        data-testid={`eventpick-${tx.id}-part-${e.idx}`}
                        aria-label={tx.merchant}
                        onClick={() => togglePick(key)}
                        className={`m-tap ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                          partChecked ? 'border-accent bg-accent text-white' : 'border-line bg-surface'
                        }`}
                      >
                        {partChecked && <Icon name="check" size={12} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <TxPartRow
                          tx={tx}
                          part={e.part}
                          index={e.ordinal}
                          amountText={money(sign * Math.abs(e.part.amountCents))}
                          onClick={() => togglePick(key)}
                          showDate
                        />
                      </div>
                    </div>
                  );
                });
            }
            const checked = pickedSet.has(tx.id);
            return (
              <div key={tx.id} className="flex items-center gap-2">
                <button
                  data-testid={`eventpick-${tx.id}`}
                  aria-label={tx.merchant}
                  onClick={() => togglePick(tx.id)}
                  className={`m-tap ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                    checked ? 'border-accent bg-accent text-white' : 'border-line bg-surface'
                  }`}
                >
                  {checked && <Icon name="check" size={12} />}
                </button>
                <div className="min-w-0 flex-1">
                  <TxRow tx={tx} showDate hideCategory={false} onClick={() => togglePick(tx.id)} />
                </div>
              </div>
            );
          })}
          {(suggestions ?? []).length === 0 && (
            <p className="px-1 py-3 text-[12px] text-ink-4" data-testid="eventpick-empty">
              {t('events.noTxs')}
            </p>
          )}
        </div>
      </div>
      <div className="shrink-0 border-t border-line-2 bg-bg px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
        <Button className="w-full" data-testid="eventpick-attach" disabled={attaching || pickedSet.size === 0} onClick={() => void attachPicked()}>
          {t('events.attachPicked', { n: pickedSet.size, amount: money(pickedTotal) })}
        </Button>
      </div>
    </div>
  );
}
