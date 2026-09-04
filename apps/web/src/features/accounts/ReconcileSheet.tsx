import { useEffect, useState } from 'react';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { applyReconcile } from '@/application/reconcile';
import type { ReconcileResult } from '@/application/reconcile';
import type { ReconcilePlan } from '@/domain/reconcile';
import type { TransactionRow } from '@/db/types';
import { fmtCents } from '@/lib/money';
import { cleanBankText } from '@/lib/text';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

function TxLine({ tx, lang }: Readonly<{ tx: TransactionRow; lang: ReturnType<typeof useLang>['lang'] }>) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink">{cleanBankText(tx.merchant)}</span>
        <span className="block text-[11px] text-ink-4">{tx.date}</span>
      </span>
      <span className="m-num shrink-0 text-[13px] font-semibold text-ink">
        {fmtCents(tx.amountCents, tx.currency, lang, { sign: true })}
      </span>
    </span>
  );
}

/**
 * Review-before-delete reconciliation (master plan requirement x): the
 * bank connection is the truth inside its coverage — matched imports
 * hand their edits over (each match can be opted out, answer 2), the
 * FULL list of mismatched rows is shown before anything is deleted,
 * and pre-coverage history is called out as untouched.
 */
export function ReconcileSheet({
  open,
  onOpenChange,
  accountIds,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; accountIds: string[] }>) {
  const { t, lang } = useLang();
  const { store, repo, spaceId } = useData();
  const [plan, setPlan] = useState<ReconcilePlan | null>(null);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReconcileResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setIgnored(new Set());
    void (async () => {
      // one plan across every involved account: the same-IBAN pair case
      // feeds both accounts' rows in — linked rows vouch either way
      const rows: TransactionRow[] = [];
      for (const accountId of accountIds) {
        rows.push(...((await store.allRows('transaction')).filter((r) => r.deleted === 0 && r.accountId === accountId)));
      }
      const { reconcilePlan } = await import('@/domain/reconcile');
      setPlan(reconcilePlan(rows));
    })();
  }, [open, accountIds, store]);

  const toggleIgnore = (id: string) => {
    setIgnored((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      setResult(await applyReconcile(store, repo, spaceId, plan, ignored));
    } finally {
      setBusy(false);
    }
  };

  const judged = plan ? plan.matches.length + plan.mismatched.length : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('reconcile.title')} size="tall">
      {result && (
        <div className="flex flex-col items-center gap-3 pt-4 text-center" data-testid="reconcile-done">
          <Icon name="check-circle-outline" size={40} color="var(--m-accent)" />
          <p className="text-[14px] text-ink-2">{t('reconcile.done', { migrated: result.migrated, removed: result.removed })}</p>
          <Button variant="outline" data-testid="reconcile-close" onClick={() => onOpenChange(false)}>
            {t('action.done')}
          </Button>
        </div>
      )}
      {!result && plan && judged === 0 && (
        <p className="pt-2 text-[13px] text-ink-2" data-testid="reconcile-nothing">
          {t('reconcile.nothing')}
        </p>
      )}
      {!result && plan && judged > 0 && (
        <div className="flex flex-col gap-3 pt-1" data-testid="reconcile-review">
          {plan.coverage && (
            <p className="text-[12px] leading-relaxed text-ink-3">
              {t('reconcile.intro', { from: plan.coverage.from, to: plan.coverage.to })}
            </p>
          )}

          {plan.matches.length > 0 && (
            <div>
              <div className="m-cap mb-1 px-1">{t('reconcile.matches', { n: plan.matches.length })}</div>
              <p className="mb-1 px-1 text-[11px] text-ink-4">{t('reconcile.matchSub')}</p>
              <div className="overflow-hidden rounded-card border border-line bg-surface">
                {plan.matches.map((match) => (
                  <label
                    key={match.imported.id}
                    data-testid={`reconcile-match-${match.imported.id}`}
                    className="flex cursor-pointer items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0"
                  >
                    <input
                      type="checkbox"
                      data-testid={`reconcile-migrate-${match.imported.id}`}
                      checked={!ignored.has(match.imported.id)}
                      onChange={() => toggleIgnore(match.imported.id)}
                      className="h-4 w-4 accent-(--m-accent)"
                    />
                    <TxLine tx={match.imported} lang={lang} />
                  </label>
                ))}
              </div>
            </div>
          )}

          {plan.mismatched.length > 0 && (
            <div>
              <div className="m-cap mb-1 px-1">{t('reconcile.mismatched', { n: plan.mismatched.length })}</div>
              <p className="mb-1 px-1 text-[11px] text-ink-4">{t('reconcile.mismatchSub')}</p>
              <div className="overflow-hidden rounded-card border border-warning bg-warning-soft/40">
                {plan.mismatched.map((tx) => (
                  <div key={tx.id} data-testid={`reconcile-mismatch-${tx.id}`} className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0">
                    <Icon name="alert-circle-outline" size={16} color="var(--m-warning)" />
                    <TxLine tx={tx} lang={lang} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.kept.length > 0 && (
            <p className="px-1 text-[11px] text-ink-4" data-testid="reconcile-kept">
              {t('reconcile.kept', { n: plan.kept.length })}
            </p>
          )}

          <Button variant="danger" data-testid="reconcile-confirm" disabled={busy} onClick={() => void confirm()}>
            {t('reconcile.confirm', { n: judged })}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
