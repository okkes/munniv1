import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { useSpaceAccounts, useSpaceTransactions } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { pairWithExistingRow } from '@/application/counterPair';
import { writeTxTransform } from '@/db/joined';
import type { TransactionRow } from '@/db/types';
import { BulkCounterQueue } from '@/features/transactions/TxKindSheet';
import { useRecurringOps } from '@/application/recurring';
import { REIMBURSED_ID } from '@/domain/categories';
import { merchantKey } from '@/domain/merchantKey';
import { cycleKeyOf, recurringAmountMatches } from '@/domain/recurring';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { TxRow } from '@/ui/TxRow';

/**
 * #257 (user): accepting a detected recurring cost no longer links its
 * charges blind — this sheet lists every candidate payment (same rules
 * the auto-reconciler uses) with the reconciler's own picks pre-checked,
 * and the user prunes before anything is written. Applying links the
 * picked rows through linkTx, which also re-files them under the
 * recurring's category (the second half of the issue).
 */
export function RecurringMatchSheet({ recId, onClose }: Readonly<{ recId: string | null; onClose: () => void }>) {
  const { t } = useLang();
  const { store, repo, spaceId } = useData();
  const ops = useRecurringOps();
  const txs = useSpaceTransactions();
  const accounts = useSpaceAccounts();
  const rec = useQuery(store, async () => (recId ? store.get('recurring', recId) : undefined), [recId]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // #274: the per-row counter-match queue a bank-fed counterparty runs
  // after the links land
  const [counterQueue, setCounterQueue] = useState<SpaceTx[] | null>(null);
  const counterAcct = accounts?.find((a) => a.id === rec?.linkedAccountId);

  const candidates = useMemo<SpaceTx[]>(() => {
    if (!rec?.merchantKey || !txs) return [];
    const rows = txs.filter((tx) => {
      // #264: funding rows join the candidates (monthly pot top-ups)
      if (tx.deleted !== 0 || tx.amountCents >= 0 || (tx.txType !== 'expense' && tx.txType !== 'funding')) return false;
      if (tx.recurringId && tx.recurringId !== rec.id) return false;
      // container rule mirrors the reconciler: parts link from their own pages
      if ((tx.splits ?? []).filter((s) => s.catId !== REIMBURSED_ID).length > 1) return false;
      return merchantKey(tx.merchant) === rec.merchantKey && recurringAmountMatches(rec, tx.amountCents);
    });
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows;
  }, [rec, txs]);

  // the reconciler's own selection (one charge per billing cycle) arrives
  // pre-checked ONCE per recurring; live-query re-emissions must never
  // clobber the user's pruning (LoanMatchSheet pattern)
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!recId) {
      seededFor.current = null;
      return;
    }
    if (seededFor.current === recId || !rec || candidates.length === 0) return;
    seededFor.current = recId;
    const cycles = new Set<string>();
    const auto = new Set<string>();
    for (const tx of [...candidates].sort((a, b) => a.date.localeCompare(b.date))) {
      const cycle = cycleKeyOf(rec, tx.date);
      if (cycles.has(cycle)) continue;
      cycles.add(cycle);
      auto.add(tx.id);
    }
    setPicked(auto);
  }, [recId, rec, candidates]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (!recId || busy) return;
    setBusy(true);
    try {
      const linked: SpaceTx[] = [];
      for (const tx of candidates) {
        if (!picked.has(tx.id)) continue;
        await ops.linkTx(tx, recId);
        linked.push(tx);
      }
      // #274 (user): a BANK-FED counterparty can't mint its legs — each
      // linked row picks its own counter transaction (or keeps waiting).
      // Manual counters already minted per row inside linkTx's choke.
      if (counterAcct && counterAcct.source !== 'manual' && linked.length > 0) {
        setCounterQueue(linked);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // #274: one queue step — the row already links-and-waits; a pick adds
  // its own peer and pairs the reciprocal
  const resolveCounter = async (item: TransactionRow, peerId: string | null) => {
    if (!peerId) return; // link-and-wait: linkTx already wrote the link
    const row = txs?.find((tx) => tx.id === item.id) ?? (item as SpaceTx);
    await writeTxTransform(repo, row, { transferPeerId: peerId });
    await pairWithExistingRow(store, repo, spaceId, row, peerId, txs);
  };

  return (
    <>
      <Sheet open={recId !== null} onOpenChange={(next) => !next && onClose()} title={t('recurring.matchTitle')} size="tall">
      <p className="pb-2 text-[12px] leading-snug text-ink-3">{t('recurring.matchHint', { name: rec?.name ?? '' })}</p>
      {candidates.length === 0 && (
        <p className="px-1 py-6 text-center text-[13px] text-ink-4" data-testid="recmatch-empty">
          {t('recurring.matchEmpty')}
        </p>
      )}
      <div className="flex flex-col" data-testid="recmatch-list">
        {candidates.map((tx) => (
          <label key={tx.id} className="flex items-center gap-2 border-b border-line-2 py-1 last:border-0">
            <input
              data-testid={`recmatch-pick-${tx.id}`}
              type="checkbox"
              checked={picked.has(tx.id)}
              onChange={() => toggle(tx.id)}
              className="h-5 w-5 shrink-0 accent-[var(--m-accent)]"
            />
            <span className="min-w-0 flex-1">
              <TxRow tx={tx} showDate />
            </span>
          </label>
        ))}
      </div>
      {candidates.length > 0 && (
        <Button className="mt-3 w-full" data-testid="recmatch-apply" disabled={busy || picked.size === 0} onClick={() => void apply()}>
          {t('recurring.matchApply', { n: picked.size })}
        </Button>
      )}
      </Sheet>
      {/* #274 (user): each linked row picks its own counter transaction
          when the counterparty is bank-fed (link-and-wait otherwise) —
          a sheet SIBLING, never nested (portal order) */}
      {counterQueue && counterAcct && (
        <BulkCounterQueue
          queue={counterQueue}
          target={{ id: counterAcct.id, name: counterAcct.name }}
          rows={txs ?? []}
          onResolve={(item, peerId) => void resolveCounter(item, peerId)}
          onDone={() => {
            setCounterQueue(null);
            onClose();
          }}
        />
      )}
    </>
  );
}
