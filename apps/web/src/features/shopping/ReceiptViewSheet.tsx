import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useReceiptOps } from '@/application/receipts';
import { storesAvailable, useStoreOps } from '@/application/stores';
import type { ReceiptEntry } from '@/application/receiptLinks';
import { useSpaceTransactions } from '@/application/transactions';
import { candidateLadder, parseReceiptText } from '@/domain/storeReceipts';
import { apiFetch } from '@/lib/api';
import { fmtCents } from '@/lib/money';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { TxRow } from '@/ui/TxRow';

const STORE_NAMES: Record<string, string> = {
  ah: 'Albert Heijn',
  jumbo: 'Jumbo',
  bol: 'bol.com',
  coolblue: 'Coolblue',
  mediamarkt: 'MediaMarkt',
  amazon: 'Amazon',
};

/**
 * One receipt in full — shared by the tx detail, the receipts browser
 * and the unmatched list. Works on a normalized entry: v3 snapshot
 * links, legacy rows and unmatched global receipts each route their
 * delete/link actions to the right store.
 */
export function ReceiptViewSheet({
  entry,
  currency,
  onClose,
  contextTxId,
}: Readonly<{
  entry: ReceiptEntry | null;
  currency: string;
  onClose: () => void;
  /** the transaction the sheet was opened FROM — its own row is noise there (user bug) */
  contextTxId?: string;
}>) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const txs = useSpaceTransactions();
  const receiptOps = useReceiptOps();
  const storeOps = useStoreOps();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picking, setPicking] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [ocrState, setOcrState] = useState<'idle' | 'busy' | 'failed'>('idle');

  const receipt = entry?.data ?? null;

  useEffect(() => {
    setConfirmDelete(false);
    setPicking(false);
    setShowMore(false);
    setOcrState('idle');
  }, [receipt?.id]);

  const linkedTxId = entry?.txId;
  const linkedTx = linkedTxId ? txs?.find((tx) => tx.id === linkedTxId) : undefined;
  const money = (cents: number) => fmtCents(cents, currency, lang);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' });

  // the matching ladder (receipts v2): near-matches first, same-price
  // and latest expenses behind "show more" — never a dead end
  const ladder = receipt ? candidateLadder(receipt, txs ?? []) : { primary: [], more: [] };
  const candidates = () => (showMore ? [...ladder.primary, ...ladder.more] : ladder.primary);

  // OCR via the NAS sidecar (signed-in users only — demo stays offline)
  const readItems = async () => {
    if (!receipt?.image) return;
    setOcrState('busy');
    try {
      const response = await apiFetch('/ocr/receipt', { method: 'POST', body: JSON.stringify({ image: receipt.image }) });
      if (!response.ok) {
        setOcrState('failed');
        return;
      }
      const { text } = (await response.json()) as { text: string };
      const items = parseReceiptText(text);
      if (items.length === 0) {
        setOcrState('failed');
        return;
      }
      await receiptOps.setItems(receipt.id, items);
      setOcrState('idle');
    } catch {
      setOcrState('failed');
    }
  };

  // a snapshot link "deletes" by unlinking — the wording must say so
  const deleteLabel = entry?.kind === 'link' ? t('receipt.unlink') : t('action.delete');

  const removeReceipt = async () => {
    if (!entry) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    // each generation deletes in its own store: unlink the snapshot,
    // remove the legacy row, or drop the unmatched global receipt
    if (entry.kind === 'link' && entry.linkId) await storeOps.unlinkReceipt(entry.linkId);
    else if (entry.kind === 'global') await storeOps.removeGlobalReceipt(entry.data.id);
    else await receiptOps.remove(entry.data.id);
    onClose();
  };

  return (
    <Sheet open={entry !== null} onOpenChange={(open) => !open && onClose()} title={t('receipt.title')} size="tall">
      {entry && receipt && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between px-1 text-[12px] text-ink-3">
            <span>
              {STORE_NAMES[receipt.source] ?? t('receipt.sourcePhoto')} · {fmtDate(receipt.date)}
            </span>
            <span className="m-num text-[14px] font-semibold text-ink" data-testid="receipt-view-total">
              {money(receipt.totalCents)}
            </span>
          </div>

          {receipt.image && <img src={receipt.image} alt={t('receipt.title')} className="max-h-[45vh] w-full rounded-card object-contain" />}

          {!!receipt.items?.length && (
            <div className="rounded-card border border-line bg-surface px-4 py-1" data-testid="receipt-items">
              {receipt.items.map((item) => (
                <div key={`${item.name}-${item.totalCents}`} className="flex items-baseline gap-2 border-b border-line-2 py-2 text-[13px] last:border-0">
                  <span className="min-w-0 flex-1 truncate text-ink">{item.name}</span>
                  {item.qty !== undefined && <span className="text-[11px] text-ink-4">×{item.qty}</span>}
                  <span className="m-num text-ink">{money(item.totalCents)}</span>
                </div>
              ))}
            </div>
          )}

          {receipt.payment?.method && (
            <p className="px-1 text-[11px] text-ink-4" data-testid="receipt-payment">
              {receipt.payment.method}
            </p>
          )}

          {/* the transaction this receipt proves — hidden when the sheet
              was opened from that very transaction (self-reference) */}
          {linkedTx && linkedTx.id !== contextTxId && (
            <div className="rounded-card border border-line bg-surface px-3" data-testid="receipt-linked-tx">
              <TxRow tx={linkedTx} showDate onClick={() => void navigate({ to: '/transactions/$txId', params: { txId: linkedTx.id } })} />
            </div>
          )}
          {!linkedTxId && (
            <>
              <Button variant="outline" className="w-full" data-testid="receipt-link-tx" onClick={() => setPicking((v) => !v)}>
                {t('receipts.pickTx')}
              </Button>
              {picking && (
                <div className="rounded-card border border-line bg-surface px-3" data-testid="receipt-candidates">
                  {candidates().map((tx) => (
                    <TxRow
                      key={tx.id}
                      tx={tx}
                      showDate
                      onClick={() => {
                        void storeOps.linkReceipt(receipt, tx.id);
                        setPicking(false);
                      }}
                    />
                  ))}
                  {!showMore && ladder.more.length > 0 && (
                    <button
                      data-testid="receipt-show-more"
                      onClick={() => setShowMore(true)}
                      className="m-tap flex w-full items-center justify-center gap-1 border-none bg-transparent py-2.5 text-[13px] font-medium text-accent-deep"
                    >
                      {t('receipts.showMore', { n: ladder.more.length })}
                      <Icon name="chevron-down" size={15} />
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {entry.kind === 'legacy' && receipt.source === 'photo' && !receipt.items?.length && storesAvailable() && (
            <>
              <Button variant="outline" className="w-full" data-testid="receipt-read-items" disabled={ocrState === 'busy'} onClick={() => void readItems()}>
                {t('receipt.readItems')}
              </Button>
              {ocrState === 'failed' && (
                <p className="text-center text-[12px] text-ink-4" data-testid="receipt-read-failed">
                  {t('receipt.readFailed')}
                </p>
              )}
            </>
          )}

          <Button variant="danger" className="w-full" data-testid="receipt-delete" onClick={() => void removeReceipt()}>
            {confirmDelete ? t('action.confirm') : deleteLabel}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
