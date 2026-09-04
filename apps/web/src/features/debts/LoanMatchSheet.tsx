import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { useSpaceHistoryTransactions, useTxTransform } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { countsTowardLoan } from '@/application/loanBalance';
import { autoSubFor } from '@/domain/categories';
import { normalizeIban } from '@/domain/feedIds';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { TxRow } from '@/ui/TxRow';

/** matching knobs — amounts within 10% (or 50 cents) read as "the payment" */
const AMOUNT_TOLERANCE = (paymentCents: number) => Math.max(50, Math.round(paymentCents * 0.1));
const MAX_SHOWN = 20;

interface Scored {
  tx: SpaceTx;
  score: number;
  /** dated before the loan's known-true balance — linking won't move it */
  preAnchor: boolean;
}

/** additive evidence: counter-IBAN is near-proof, the debt-payment
 *  label is strong, amount and name keywords corroborate (S3776: the
 *  branches live out of the component) */
function scoreCandidate(
  tx: SpaceTx,
  ctx: { iban: string | null; tokens: readonly string[]; paymentCents?: number },
): number {
  let score = 0;
  if (ctx.iban && tx.counterIban && normalizeIban(tx.counterIban) === ctx.iban) score += 4;
  if (tx.txType === 'debtPayment') score += 3;
  if (ctx.paymentCents && Math.abs(Math.abs(tx.amountCents) - ctx.paymentCents) <= AMOUNT_TOLERANCE(ctx.paymentCents)) score += 2;
  const hay = `${tx.merchant} ${tx.description ?? ''}`.toLowerCase();
  if (ctx.tokens.some((token) => hay.includes(token))) score += 1;
  return score;
}

/**
 * "Found these payments" (user request 2026-08-01, the event-suggest
 * idea for loans): right after a loan is created — or any time from its
 * detail — the full stored history is searched by counter-IBAN, the
 * debt-payment label, the payment amount and name keywords. The user
 * picks which rows to link; rows older than the loan's balance date are
 * flagged and only move the balance when their "count" chip is on.
 */
export function LoanMatchSheet({ accountId, onClose }: Readonly<{ accountId: string | null; onClose: () => void }>) {
  const { t } = useLang();
  const { store } = useData();
  const transform = useTxTransform();
  const { fmt } = useDisplayMoney();
  const txs = useSpaceHistoryTransactions();
  const account = useQuery(store, async () => (accountId ? store.get('account', accountId) : undefined), [accountId]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [counted, setCounted] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const candidates = useMemo<Scored[]>(() => {
    if (!account || !txs) return [];
    const ctx = {
      iban: account.iban ? normalizeIban(account.iban) : null,
      tokens: account.name
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length > 3),
      paymentCents: account.paymentCents,
    };
    const scored: Scored[] = [];
    for (const tx of txs) {
      if (tx.deleted !== 0 || tx.linkedAccountId || tx.transferPeerId || tx.accountId === account.id) continue;
      const score = scoreCandidate(tx, ctx);
      if (score >= 2) scored.push({ tx, score, preAnchor: !countsTowardLoan(account, tx) });
    }
    scored.sort((a, b) => b.score - a.score || b.tx.date.localeCompare(a.tx.date));
    return scored.slice(0, MAX_SHOWN);
  }, [account, txs]);

  // strong matches arrive pre-checked ONCE per loan; live-query
  // re-emissions must never clobber the user's pruning (review finding)
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!accountId) {
      seededFor.current = null;
      return;
    }
    if (seededFor.current === accountId || candidates.length === 0) return;
    seededFor.current = accountId;
    setPicked(new Set(candidates.filter((c) => c.score >= 3).map((c) => c.tx.id)));
    setCounted(new Set());
  }, [accountId, candidates]);

  const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const apply = async () => {
    if (!accountId || busy) return;
    setBusy(true);
    try {
      for (const { tx } of candidates) {
        if (!picked.has(tx.id)) continue;
        // a loan link IS a debt payment (review finding: leaving the
        // spending category would double-count consumption) — the same
        // retype every other counterparty path performs, family sub by
        // sign. The count-it marker lands in the SAME write; the
        // coupling re-reads the merged row so the balance follows.
        await transform(
          tx,
          {
            linkedAccountId: accountId,
            txType: 'debtPayment',
            catId: autoSubFor('debtPayment', tx.amountCents),
            ...(counted.has(tx.id) ? { loanCounted: 1 as const } : {}),
          },
          'txLink',
        );
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={accountId !== null} onOpenChange={(next) => !next && onClose()} title={t('debts.matchTitle')} size="tall">
      <p className="pb-2 text-[12px] leading-snug text-ink-3">{t('debts.matchHint')}</p>
      {candidates.length === 0 && (
        <p className="px-1 py-6 text-center text-[13px] text-ink-4" data-testid="loanmatch-empty">
          {t('debts.matchEmpty')}
        </p>
      )}
      <div className="flex flex-col" data-testid="loanmatch-list">
        {candidates.map(({ tx, preAnchor }) => (
          <div key={tx.id} className="border-b border-line-2 py-1 last:border-0">
            <label className="flex items-center gap-2">
              <input
                data-testid={`loanmatch-pick-${tx.id}`}
                type="checkbox"
                checked={picked.has(tx.id)}
                onChange={() => setPicked((prev) => toggle(prev, tx.id))}
                className="h-5 w-5 shrink-0 accent-[var(--m-accent)]"
              />
              <span className="min-w-0 flex-1">
                <TxRow tx={tx} showDate />
              </span>
            </label>
            {preAnchor && picked.has(tx.id) && (
              <div className="flex items-center gap-2 pb-1.5 pl-7">
                <span className="text-[11px] text-warning">{t('debts.matchOld')}</span>
                <Chip
                  testId={`loanmatch-count-${tx.id}`}
                  selected={counted.has(tx.id)}
                  onClick={() => setCounted((prev) => toggle(prev, tx.id))}
                >
                  {t('debts.matchCount', { amount: fmt(Math.abs(tx.amountCents), tx.currency) })}
                </Chip>
              </div>
            )}
          </div>
        ))}
      </div>
      {candidates.length > 0 && (
        <Button className="mt-3 w-full" data-testid="loanmatch-apply" disabled={busy || picked.size === 0} onClick={() => void apply()}>
          {t('debts.matchApply', { n: picked.size })}
        </Button>
      )}
    </Sheet>
  );
}
