import { useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useLgViewport } from '@/lib/viewport';
import { useReceiptOps } from '@/application/receipts';
import { useTxReceiptEntry } from '@/application/receiptLinks';
import { useStoreOps, useUnmatchedReceipts } from '@/application/stores';
import type { ReceiptRow } from '@/db/types';
import type { SpaceTx } from '@/db/joined';
import { fmtCents } from '@/lib/money';
import { isNativeApp, takeNativePhoto } from '@/lib/platform';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { WebcamCaptureSheet, useWebcamDoor } from '@/ui/WebcamCaptureSheet';
import { ReceiptViewSheet } from './ReceiptViewSheet';

const dayDiff = (a: string, b: string): number => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));

/** best receipt candidates for THIS transaction: amount first, then date */
function rankForTx(tx: Pick<SpaceTx, 'date' | 'amountCents'>, receipts: readonly ReceiptRow[]): ReceiptRow[] {
  const target = Math.abs(tx.amountCents);
  return [...receipts].sort((a, b) => {
    const amountGap = Math.abs(a.totalCents - target) - Math.abs(b.totalCents - target);
    if (amountGap !== 0) return amountGap;
    return dayDiff(a.date, tx.date) - dayDiff(b.date, tx.date);
  });
}

/**
 * The transaction's line-item proof (receipts v3, R8 redesign): the
 * empty state opens ONE attach sheet — best-matching unlinked store
 * receipts first, camera/upload and the connections door as the
 * fallback rungs — instead of the old scattered buttons.
 */
export function ReceiptSection({ tx }: Readonly<{ tx: SpaceTx }>) {
  const { t, lang } = useLang();
  const panes = useLgViewport();
  const navigate = useNavigate();
  const entry = useTxReceiptEntry(tx.id);
  const unmatched = useUnmatchedReceipts();
  const receiptOps = useReceiptOps();
  const storeOps = useStoreOps();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // #160: desktop-only webcam rung under the upload button (hooks stay
  // above the `entry === undefined` early return)
  const webcamDoor = useWebcamDoor();
  const [webcamOpen, setWebcamOpen] = useState(false);

  const candidates = useMemo(() => rankForTx(tx, unmatched ?? []).slice(0, 6), [tx, unmatched]);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await receiptOps.attachPhoto(tx, file);
      setAttachOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = () => {
    // shells use the Camera plugin: the webview <input capture> path
    // crashed on iOS and offered gallery-only on Android
    if (isNativeApp()) void takeNativePhoto().then((file) => onFile(file ?? undefined));
    else fileRef.current?.click();
  };

  if (entry === undefined) return null;
  const receipt = entry?.data ?? null;

  return (
    <>
      <div className="m-cap mt-5 mb-1 px-1">{t('receipt.title')}</div>
      <input
        ref={fileRef}
        data-testid="receipt-file"
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {receipt === null ? (
        <button
          data-testid="receipt-empty"
          onClick={() => setAttachOpen(true)}
          className="m-tap flex w-full items-center gap-3 rounded-card border border-dashed border-line bg-surface px-4 py-3 text-left"
        >
          <Icon name="receipt-text-plus-outline" size={18} color="var(--m-accent-deep)" />
          <span className="min-w-0 flex-1 text-[13px] font-medium text-accent-deep">{t('receipt.attach')}</span>
          {candidates.length > 0 && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent-deep" data-testid="receipt-candidate-count">
              {candidates.length}
            </span>
          )}
        </button>
      ) : (
        <button
          data-testid="receipt-card"
          onClick={() => setViewOpen(true)}
          className="m-tap w-full overflow-hidden rounded-card border border-line bg-surface p-0 text-left"
        >
          {receipt.image && <img src={receipt.image} alt={t('receipt.title')} className="max-h-40 w-full object-cover" />}
          <span className="flex items-center gap-2 px-4 py-2.5">
            <Icon name={receipt.source === 'photo' ? 'camera-outline' : 'storefront-outline'} size={15} color="var(--m-ink-3)" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
              {receipt.items?.length ? `${receipt.items.length} · ${t('receipt.items')}` : t('receipt.sourcePhoto')}
            </span>
            <span className="m-num text-[12px] font-semibold text-ink">{fmtCents(receipt.totalCents, tx.currency, lang)}</span>
          </span>
        </button>
      )}

      {/* ONE attach flow (user: the old scatter felt odd): suggested
          receipts lead, capture and the stores door follow */}
      <Sheet open={attachOpen} onOpenChange={setAttachOpen} title={t('receipt.attach')} size="tall">
        <div className="flex flex-col gap-3 pt-1">
          {candidates.length > 0 && (
            <>
              <div className="m-cap px-1">{t('receipt.suggested')}</div>
              <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="receipt-pick-list">
                {candidates.map((row) => (
                  <button
                    key={row.id}
                    data-testid={`receipt-pick-${row.id}`}
                    onClick={() => {
                      void storeOps.linkReceipt(row, tx.id);
                      setAttachOpen(false);
                    }}
                    className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-3 text-left last:border-0"
                  >
                    <Icon name="storefront-outline" size={16} color="var(--m-ink-3)" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{row.merchant ?? row.source}</span>
                      <span className="block text-[11px] text-ink-4">{fmtDate(row.date)}</span>
                    </span>
                    <span className="m-num text-[13px] font-semibold text-ink">{fmtCents(row.totalCents, tx.currency, lang)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <Button variant="outline" className="w-full" data-testid="receipt-take-photo" disabled={busy} onClick={takePhoto}>
            <Icon name={panes ? 'upload-outline' : 'camera-outline'} size={16} />
            {panes ? t('receipt.upload') : t('receipt.takePhoto')}
          </Button>
          {/* #160: desktop webcam snapshot — same attach path as a file */}
          {webcamDoor && (
            <Button variant="outline" className="w-full" data-testid="receipt-webcam" disabled={busy} onClick={() => setWebcamOpen(true)}>
              <Icon name="camera-outline" size={16} />
              {t('webcam.use')}
            </Button>
          )}
          <button
            data-testid="receipt-connections"
            onClick={() => void navigate({ to: '/shopping' })}
            className="m-tap border-none bg-transparent py-1 text-center text-[12px] font-medium text-accent-deep"
          >
            {t('shop.title')}
          </button>
        </div>
      </Sheet>

      {/* #160: snapshot rides the same attach pipeline as a picked file */}
      <WebcamCaptureSheet open={webcamOpen} onOpenChange={setWebcamOpen} onCapture={(file) => void onFile(file)} />

      <ReceiptViewSheet entry={viewOpen ? entry : null} currency={tx.currency} onClose={() => setViewOpen(false)} contextTxId={tx.id} />
    </>
  );
}
