import { useMemo, useState } from 'react';
import { LOCALES, useLang } from '@/i18n';
import { useSpaceAccounts, useSpaceHistoryTransactions } from '@/application/transactions';
import { localToday, useDismissedKeys, useRecurringOps, useRecurrings } from '@/application/recurring';
import { detectRecurring } from '@/domain/detectRecurring';
import type { RecurringSuggestion } from '@/domain/detectRecurring';
import { looksLikeDebtCreditor } from '@/domain/detectDebts';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { RecurringFormSheet, formFromSuggestion } from './RecurringFormSheet';
import type { FormState } from './RecurringFormSheet';
import { RecurringMatchSheet } from './RecurringMatchSheet';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Tile } from '@/ui/primitives';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';

/**
 * Detection inbox: every suspected recurring cost with its evidence —
 * the actual charges that formed the pattern — and one decision per
 * card. Accepting opens the prefilled form; the suggestion disappears
 * on save (its merchant key is then owned by a recurring row).
 */
export function RecurringSuggestionsScreen() {
  const { t, lang } = useLang();
  const { store, spaceId } = useData();
  const recs = useRecurrings();
  const accounts = useSpaceAccounts();
  const dismissed = useDismissedKeys();
  // the FULL stored history (user design 2026-08-01): detection and its
  // evidence read past the space's start date — a yearly subscription
  // only shows a pattern in the long tail. Accepting still links only
  // the VISIBLE rows; the older charges stay stored-but-hidden.
  const txs = useSpaceHistoryTransactions();
  const ops = useRecurringOps();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const [formInitial, setFormInitial] = useState<FormState | null>(null);
  // #257: the accepted suggestion hands its saved id to the occurrence
  // review — the user picks which charges belong before links are written
  const [matchRecId, setMatchRecId] = useState<string | null>(null);

  const today = localToday();
  const currency = space?.currency ?? 'EUR';
  const { fmt } = useDisplayMoney();
  const money = (cents: number) => fmt(cents, currency);
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' });

  const suggestions = useMemo(() => {
    if (!txs || !recs || !dismissed) return [];
    // #192: a loan owns its merchant key exactly like a recurring row —
    // accepting a pattern as a loan retires the suggestion
    const exclude = new Set([
      ...dismissed,
      ...recs.flatMap((r) => (r.merchantKey ? [r.merchantKey] : [])),
      ...(accounts ?? []).flatMap((a) => (a.merchantKey ? [a.merchantKey] : [])),
    ]);
    // #192 r2 (user): known-lender patterns belong to the DEBTS screen —
    // the recurring inbox keeps only genuine subscriptions
    return detectRecurring(txs, { excludeKeys: exclude, today }).filter((s) => !looksLikeDebtCreditor(s.name));
  }, [txs, recs, accounts, dismissed, today]);

  const txById = useMemo(() => new Map((txs ?? []).map((tx) => [tx.id, tx])), [txs]);
  const evidenceFor = (s: RecurringSuggestion) =>
    s.txIds
      .flatMap((id) => {
        const tx = txById.get(id);
        return tx ? [tx] : [];
      })
      .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-recurring-suggestions">
      <AppBar
        title={t('recurring.detected')}
        leading={
          <IconButton label={t('action.back')} testId="recsuggest-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {suggestions.map((s) => (
          <div key={s.merchantKey} className="mt-3 overflow-hidden rounded-card border border-line bg-surface" data-testid={`recsuggest-card-${s.merchantKey}`}>
            <div className="flex items-center gap-3 px-4 pt-3.5">
              <Tile icon="autorenew" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-ink">{s.name}</span>
                <span className="block text-[11px] text-ink-3">
                  {t(s.every === 'year' ? 'recurring.patternYearly' : 'recurring.patternMonthly')} ·{' '}
                  {t('recurring.confidence', { n: s.confidence })}
                </span>
              </span>
              <span className="font-mono text-[15px] font-semibold text-ink">{money(s.amountCents)}</span>
            </div>

            {/* the evidence: charges that formed the pattern */}
            <div className="mt-3 border-t border-line-2 px-4 py-2" data-testid={`recsuggest-evidence-${s.merchantKey}`}>
              <div className="m-cap pb-1">{t('recurring.matchedCharges')}</div>
              {evidenceFor(s).map((tx) => (
                <div key={tx.id} data-testid={`recsuggest-tx-${tx.id}`} className="flex items-baseline justify-between py-1 text-[13px]">
                  <span className="text-ink-2">{fmtDate(tx.date)}</span>
                  <span className="font-mono text-ink">{money(Math.abs(tx.amountCents))}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 border-t border-line-2 p-3">
              <Button
                data-testid={`recurring-accept-${s.merchantKey}`}
                className="flex-1"
                size="sm"
                onClick={() => setFormInitial(formFromSuggestion(s))}
              >
                {t('recurring.addThis')}
              </Button>
              <Button
                data-testid={`recurring-dismiss-${s.merchantKey}`}
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => void ops.dismissSuggestion(s.merchantKey)}
              >
                {t('recurring.notRecurring')}
              </Button>
            </div>
          </div>
        ))}

        {suggestions.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center" data-testid="recsuggest-empty">
            <Icon name="check-circle-outline" size={34} color="var(--m-accent)" />
            <p className="text-[14px] font-medium text-ink-2">{t('recurring.suggestionsEmpty')}</p>
          </div>
        )}
      </div>

      <RecurringFormSheet initial={formInitial} onClose={() => setFormInitial(null)} onAccepted={setMatchRecId} />
      <RecurringMatchSheet recId={matchRecId} onClose={() => setMatchRecId(null)} />
    </div>
  );
}
