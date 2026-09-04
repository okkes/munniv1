import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useLgViewport } from '@/lib/viewport';
import { useSpaceAccounts, useSpaceTransaction, useSpaceTransactions, useTxTransform } from '@/application/transactions';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { RecurringFormSheet, formFromTx } from '@/features/recurring/RecurringFormSheet';
import { EventFormSheet } from '@/features/events/EventsScreen';
import { useRecurringOps, useRecurrings } from '@/application/recurring';
import { useEvents } from '@/application/events';
import { RecurringVisual } from '@/features/recurring/RecurringVisual';
import { LOCALES, useLang } from '@/i18n';
import type { TFunc } from '@/i18n';
import { useData } from '@/app/data';
import { logActivity } from '@/application/activity';
import { countPreAnchorTx } from '@/application/loanBalance';
import { isLiability } from '@/features/accounts/accountTypes';
import { catName, useCategories } from '@/features/categories/useCategories';
import { fmtCents } from '@/lib/money';
import { cleanBankText, humanizeBankKeys, orDefaultLabel, txTitle } from '@/lib/text';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/primitives';
import { Sheet, hasOpenSheet } from '@/ui/Sheet';
import { givenCents, netAmountCents, netCreditCents, partNetCents, reimbursedInCats, totalReimbursedCents } from '@/domain/reimbursement';
import { EXPECTED_REIMBURSE_ID, REIMBURSED_ID, UNCATEGORIZED_ID, specialCatType, stampMovementSub } from '@/domain/categories';
import { defaultFamilyFor } from '@/domain/defaultAccounts';
import { primaryCatId } from '@/domain/splits';
import { scaleCatsTo, scaleSplitsTo } from '@/domain/txSlices';
import { ReviewPartDeck, partRecurringPrefill } from '@/features/review/ReviewScreen';
import { mirrorTxId, normalizeIban } from '@/domain/feedIds';
import { ReceiptSection } from '@/features/shopping/ReceiptSection';
import { ReimburseSection } from './ReimburseSection';
import { SplitEditorSheet } from './SplitEditorSheet';
import { CatsSheet, catsAroundSingle, partCatsApplyPatch } from './PartCatsSheet';
import type { CatsApplyEntry } from './PartCatsSheet';
import { BulkCounterQueue, CounterMatchSheet, CounterpartySheet } from './TxKindSheet';
import { TxFormSheet } from './TxFormSheet';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';
import { kindOf } from '@/domain/txKind';
import { mintMirrorForExistingLink, removeMirrorForDeletedSource } from '@/application/mirrorMint';
import { pairWithExistingRow } from '@/application/counterPair';
import { visibleTransactions, writeTxTransform } from '@/db/joined';
import { accountStamp, counterTypesFor, movementCatFor } from '@/domain/txType';
import { merchantKey } from '@/domain/merchantKey';
import { resolveTxDetailBlocks } from './TxDetailCustomizeScreen';
import type { TxDetailBlockId } from './TxDetailCustomizeScreen';
import { TxRow } from '@/ui/TxRow';
import type { SpaceTx } from '@/application/transactions';
import type { AccountRow, RecurringRow, TxSplit, TxSplitCat, TxType } from '@/db/types';

const DATE_FMT: Record<string, string> = { en: 'en-GB', nl: 'nl-NL', tr: 'tr-TR' };

/** #200: the part id a container row navigates to — the settled
 *  Reimbursed slice and id-less legacy parts return null and keep the
 *  editor. Module-level for S3776. */
const partTargetId = (multi: boolean, slice: TxSplit | null, canOpen: boolean): string | null =>
  multi && canOpen && slice?.id && slice.catId !== REIMBURSED_ID ? slice.id : null;

// sliceCounterName retired (#228 feedback): the counterparty has its own
// property row on every surface now — no "→ account" under categories.

/** #138: every category row carries its money — the single category
 *  spans the whole transaction; a PART row shows what the part is
 *  WORTH (its own settled bookkeeping nets it, #228) (S3776) */
const sliceRowAmountCents = (
  partsMode: boolean,
  slice: { amountCents: number; cats?: TxSplitCat[] } | null,
  tx: { amountCents: number },
): number => {
  if (!slice) return Math.abs(tx.amountCents);
  return partsMode ? partNetCents(slice) : slice.amountCents;
};

/** the categories block's rows: one per slice (or the single category).
 *  A single category opens the unified editor; on a container the rows
 *  ARE the parts — plain rows now (#200: the circles + vertical line
 *  are gone) and tapping one goes to that part's page, never to the
 *  manage flow. */
function CategorySlices({
  tx,
  cats,
  fallbackCat,
  fallbackColor,
  onEdit,
  onOpenPart,
}: Readonly<{
  tx: SpaceTx;
  cats: ReturnType<typeof useCategories>;
  fallbackCat: ReturnType<ReturnType<typeof useCategories>['byId']>;
  fallbackColor: string;
  /** #328 (user): absent = the category is locked — the row is inert
   *  and drops its chevron */
  onEdit?: () => void;
  /** #200: a real part row navigates to its page */
  onOpenPart?: (partId: string) => void;
}>) {
  const { t, lang } = useLang();
  // #211: a container renders its PARTS (navigable pages); a whole row
  // with its own category spread renders one plain row per entry — the
  // classic slice look, every row a door back into the cats editor
  const partsMode = !!tx.splits?.length;
  const spreadEntries = (tx.cats?.length ? tx.cats : [null]) as (TxSplit | null)[];
  const parts = partsMode ? tx.splits! : spreadEntries;
  const multi = partsMode && parts.length > 1;
  return (
    <div>
      {parts.map((slice, i) => {
        const rowCat = slice ? cats.byId(slice.catId) : fallbackCat;
        const rowColor = slice ? (rowCat.color ?? cats.byId(rowCat.parentId ?? '').color) : fallbackColor;
        const parentName = rowCat.parentId ? catName(cats.byId(rowCat.parentId), t) : t(`tx.type.${tx.txType}`);
        // typed-splits v2: the part wears its OWN story — the copied-info
        // label ("<title> – split N" unless renamed) and, when its type
        // differs from the row's kind, a quiet type chip
        const partLabel = slice?.label ?? (multi ? `${txTitle(tx)} – ${t('split.partN', { n: i + 1 })}` : undefined);
        const partType = slice?.txType && slice.txType !== tx.txType ? slice.txType : undefined;
        // a spread part's subline lists its REAL categories (v2.1;
        // #228: the settled bookkeeping is not a story to retell here)
        const realSliceCats = slice?.cats?.filter((c) => c.catId !== REIMBURSED_ID);
        const spreadNames = realSliceCats?.length
          ? realSliceCats.map((c) => catName(cats.byId(c.catId), t)).join(' · ')
          : undefined;
        const openPartId = partTargetId(multi, slice, !!onOpenPart);
        return (
          <button
            key={slice?.id ?? (slice ? `${slice.catId}-${i}` : 'single')}
            data-testid={i === 0 ? 'tx-detail-category-row' : `tx-detail-cat-${slice?.catId}`}
            onClick={openPartId ? () => onOpenPart?.(openPartId) : onEdit}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3.5 text-left last:border-0"
          >
            <Icon name={rowCat.icon} size={20} color={rowColor ?? 'var(--m-ink-3)'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] text-ink">{multi ? partLabel : catName(rowCat, t)}</span>
              <span className="block truncate text-[11px] text-ink-4">
                {multi ? (spreadNames ?? catName(rowCat, t)) : parentName}
                {partType && (
                  <span className="text-accent-deep" data-testid={`tx-detail-part-type-${slice?.id ?? i}`}>
                    {' '}· {t(`tx.type.${partType}`)}
                  </span>
                )}
              </span>
            </span>
            {i === 0 && tx.needsReview === 1 && <Pill tone="warning">{t('tx.unreviewed')}</Pill>}
            <span className="m-num text-[13px] text-ink-2">
              {fmtCents(sliceRowAmountCents(partsMode, slice, tx), tx.currency, lang)}
            </span>
            {/* #328 (user): the editor door is a door too — every live
                tap (part page OR cats editor) wears the chevron */}
            {(openPartId || onEdit) && <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />}
          </button>
        );
      })}
    </div>
  );
}

/** the DETAILS block: the facts underneath the user's edits — the
 *  original amount (reimbursements shrank it), the bank's counterparty
 *  (#220: ALWAYS shown here, read-only metadata — a tap opens the
 *  matched account's info sheet, never an editor), the bank's original
 *  title (renamed), and the raw bank data */
function DetailFacts({
  tx,
  givenOut,
  counterAccountName,
  onOpenCounterAccount,
}: Readonly<{
  tx: SpaceTx;
  givenOut: number;
  /** the space account the bank's counter-IBAN resolves to, if any */
  counterAccountName?: string;
  /** absent = the plain-metadata rendering (part pages) */
  onOpenCounterAccount?: () => void;
}>) {
  const { t, lang } = useLang();
  if (!(totalReimbursedCents(tx) > 0 || givenOut > 0 || tx.titleOverride || tx.description || tx.counterIban)) return null;
  const counterFace = counterAccountName ?? tx.counterIban;
  return (
    <>
      <div className="m-cap mt-5 mb-1 px-1">{t('tx.detailsSection')}</div>
      <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="tx-detail-facts">
        {(totalReimbursedCents(tx) > 0 || givenOut > 0) && (
          <div className="flex items-center gap-3 border-b border-line-2 px-4 py-3 text-[14px] last:border-0">
            <Icon name="cash-refund" size={18} color="var(--m-ink-3)" />
            <span className="min-w-0 flex-1 text-ink-3">{t('tx.originalAmount')}</span>
            <span className="m-num text-ink" data-testid="tx-detail-original-amount">
              {fmtCents(tx.amountCents, tx.currency, lang, { sign: true })}
            </span>
          </div>
        )}
        {/* #220 (user): the counterparty the BANK named, always here as
            metadata; recognizable ones open their account info sheet.
            #228: reads "Original counterparty" again — the editable
            property row above owns the plain name */}
        {tx.counterIban && (
          <button
            data-testid="tx-detail-original-counter"
            disabled={!counterAccountName || !onOpenCounterAccount}
            onClick={onOpenCounterAccount}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left text-[14px] last:border-0"
          >
            <Icon name="swap-horizontal" size={18} color="var(--m-ink-3)" />
            <span className="shrink-0 text-ink-3">{t('tx.originalCounterparty')}</span>
            <span className="m-num min-w-0 flex-1 truncate text-right text-ink">
              <span className={counterAccountName ? 'text-accent-deep' : 'font-mono text-[12px]'}>{counterFace}</span>
              {counterAccountName && (
                <span className="block truncate font-mono text-[11px] text-ink-4">{tx.counterIban}</span>
              )}
            </span>
            {counterAccountName && <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />}
          </button>
        )}
        {!!tx.titleOverride && (
          <div className="flex items-center gap-3 border-b border-line-2 px-4 py-3 text-[14px] last:border-0">
            <Icon name="label-outline" size={18} color="var(--m-ink-3)" />
            <span className="shrink-0 text-ink-3">{t('tx.originalTitle')}</span>
            <span className="min-w-0 flex-1 truncate text-right text-ink" data-testid="tx-detail-original-title">
              {cleanBankText(tx.merchant)}
            </span>
          </div>
        )}
        {tx.description && (
          <div className="px-4 py-3" data-testid="tx-detail-bankdata">
            <div className="flex items-center gap-3 text-[14px]">
              <Icon name="bank-outline" size={18} color="var(--m-ink-3)" />
              <span className="text-ink-3">{t('tx.bankDetails')}</span>
            </div>
            <div className="mt-1.5 pl-[30px] font-mono text-xs break-words text-ink-3 select-text">
              {humanizeBankKeys(cleanBankText(tx.description))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** every other transaction of this merchant that still differs */
const similarTo = (allTxs: SpaceTx[] | undefined, tx: SpaceTx, differs: (item: SpaceTx) => boolean): SpaceTx[] =>
  (allTxs ?? []).filter((item) => item.id !== tx.id && merchantKey(item.merchant) === merchantKey(tx.merchant) && differs(item));

/** pre-anchor payment on a manual loan that was never counted in — the
 *  deliberate one-shot override applies (loans v2). `<=` mirrors the
 *  strictly-newer rule in countsTowardLoan. A peer only disqualifies
 *  when it is a REAL other leg (bank twin, picked row — its own write
 *  already carried the value); the row's own gated MINT moved nothing
 *  for pre-anchor dates, so the offer stays. */
const offersLoanCount = (
  tx: Pick<SpaceTx, 'id' | 'transferPeerId' | 'loanCounted' | 'date'>,
  linked: Pick<AccountRow, 'source' | 'type' | 'balanceAsOf'>,
): boolean =>
  linked.source === 'manual' &&
  isLiability(linked.type) &&
  (!tx.transferPeerId || tx.transferPeerId === mirrorTxId(tx.id)) &&
  tx.loanCounted !== 1 &&
  !!linked.balanceAsOf &&
  tx.date <= linked.balanceAsOf;

/** deleting a manual row (S3776: out of the screen): its mint goes with
 *  it — the manual counter's mirror is tombstoned and the balance it
 *  moved comes back (typed-splits v2) — and the row's own manual account
 *  hands the amount back (bank-linked balances stay the bank's) */
async function deleteManualTxRow(
  store: ReturnType<typeof useData>['store'],
  repo: ReturnType<typeof useData>['repo'],
  spaceId: string,
  tx: SpaceTx,
  account: AccountRow | undefined,
): Promise<void> {
  await removeMirrorForDeletedSource(store, repo, tx, tx.linkedAccountId).catch(() => undefined);
  // #228 compat: an UNMIGRATED spread synced from an old device may
  // still carry entry-keyed mints — they go with the row too
  const { retireLegacyEntryMints } = await import('@/application/categoryModel');
  await retireLegacyEntryMints(
    store,
    repo,
    {
      baseId: tx.id,
      accountId: tx.accountId,
      sign: tx.amountCents < 0 ? -1 : 1,
      date: tx.date,
      time: tx.time,
      currency: tx.currency,
      merchant: tx.merchant,
    },
    tx.cats,
  ).catch(() => undefined);
  if (account && account.source !== 'gocardless') {
    const fresh = await store.get('account', account.id);
    if (fresh?.deleted === 0) {
      await repo.upsert('account', tx.spaceId, fresh.id, { balanceCents: fresh.balanceCents - tx.amountCents });
    }
  }
  await repo.remove('transaction', tx.spaceId, tx.id);
  void logActivity(store, repo, spaceId, 'txDelete', txTitle(tx));
}

/** the create-counter heal door (S3776: out of the screen): mint the
 *  manual counter's missing leg for a pre-engine link, then peer to it.
 *  #237: an already-minted but UNPAIRED leg (an old unlink left it
 *  orphaned) gets its reciprocal back too — the door used to no-op. */
async function healMissingMirror(
  store: ReturnType<typeof useData>['store'],
  repo: ReturnType<typeof useData>['repo'],
  tx: SpaceTx,
): Promise<void> {
  const mid = await mintMirrorForExistingLink(store, repo, tx, tx.linkedAccountId, tx.transferPeerId);
  if (!mid) return;
  await writeTxTransform(repo, tx, { transferPeerId: mid });
  const mirror = await store.get('transaction', mid);
  if (mirror?.deleted === 0 && !mirror.transferPeerId) {
    await writeTxTransform(repo, mirror, { transferPeerId: tx.id });
  }
}

/** where this transfer stands with its other leg (arc 1 pair UX).
 *  #237: ANY peered row shows its pair — the wallet story's purchase
 *  leg keeps its own category and type, so the old transfer-kind gate
 *  would have hidden the pairing from the side that matters most.
 *  #237 r2: the peer id is the EFFECTIVE one — a one-way pair (the
 *  other row points here, this one holds nothing yet) still reads as
 *  peered while the heal writes the reciprocal. */
function transferPairState(
  tx: Pick<SpaceTx, 'txType' | 'linkedAccountId'>,
  effectivePeerId: string | undefined,
  linkedAccount: { source: string } | undefined,
): 'peered' | 'awaiting' | 'offerCreate' | null {
  if (effectivePeerId) return 'peered';
  if (kindOf(tx.txType) !== 'transfer' || !tx.linkedAccountId) return null;
  if (!linkedAccount) return null;
  // manual counter: the other side can be created right here; a feed
  // counter's real row arrives with the bank — the matcher claims it
  return linkedAccount.source === 'manual' ? 'offerCreate' : 'awaiting';
}

/** the pair row: jump to the other leg, or release the link — #221: a
 *  default-ledger mirror keeps the jump but not the release (the link
 *  belongs to the ORIGIN row).
 *  #237 (user): the row reads like a reimbursement record now — who the
 *  other leg is, when, on which account and for how much — and the tap
 *  goes STRAIGHT to that transaction (no sheet in between). */
function TransferPeerRow({
  t,
  lang,
  peer,
  accountName,
  onOpen,
  onUnpair,
}: Readonly<{
  t: TFunc;
  lang: ReturnType<typeof useLang>['lang'];
  peer: SpaceTx | undefined;
  accountName: string | undefined;
  /** #255 r4: absent = the other leg is out of this space's view — the
   *  old blind jump landed on an EMPTY detail (the reported glitch) */
  onOpen?: () => void;
  onUnpair?: () => void;
}>) {
  const face = peer ? (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold tracking-wide text-accent-deep uppercase">
          {t('tx.pairedCounterpart')}
        </span>
        <span className="block truncate text-[14px] text-ink">{txTitle(peer)}</span>
        <span className="block truncate text-[11px] text-ink-4">
          {peer.date}
          {accountName ? ` · ${accountName}` : ''}
        </span>
      </span>
      <span className="m-num shrink-0 text-[14px] font-semibold text-ink">
        {fmtCents(peer.amountCents, peer.currency, lang, { sign: true })}
      </span>
    </>
  ) : (
    // the other leg lives outside this space's view — nothing to
    // preview, and (#255 r4) nothing to jump to either
    <span className="text-[14px] font-medium text-accent-deep">{t('tx.pairedCounterpart')}</span>
  );
  return (
    <>
      <div className="mx-4 h-px bg-line-2" />
      <div className="flex w-full items-center gap-3 px-4 py-3">
        <Icon name="swap-horizontal" size={20} color="var(--m-ink-3)" />
        {onOpen ? (
          <button
            data-testid="tx-detail-peer"
            onClick={onOpen}
            className="m-tap flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent p-0 text-left"
          >
            {face}
          </button>
        ) : (
          <div data-testid="tx-detail-peer" className="flex min-w-0 flex-1 items-center gap-3 text-left">
            {face}
          </div>
        )}
        {onUnpair && (
          <button
            aria-label={t('tx.unpair')}
            data-testid="tx-detail-unpair"
            onClick={onUnpair}
            className="m-tap flex h-8 w-8 items-center justify-center border-none bg-transparent text-ink-4"
          >
            <Icon name="link-off" size={16} />
          </button>
        )}
      </div>
    </>
  );
}

/** desktop panes get a CLOSE (leave the detail); mobile keeps history-back */
function DetailBackButton({ panes, onClose, t }: Readonly<{ panes: boolean; onClose: () => void; t: TFunc }>) {
  if (panes) {
    return (
      <IconButton label={t('action.close')} testId="tx-detail-back" onClick={onClose}>
        <Icon name="close" size={20} />
      </IconButton>
    );
  }
  return (
    <IconButton label={t('action.back')} testId="tx-detail-back" onClick={() => window.history.back()}>
      <Icon name="chevron-left" size={24} />
    </IconButton>
  );
}

/**
 * The bulk offer after a category change: the bar itself opens a
 * selection sheet (user request — see and pick the transactions instead
 * of a blind apply-all); Apply touches only the checked rows.
 */
function DetailBulkBar({
  targets,
  selected,
  onChange,
  onApply,
  onDismiss,
}: Readonly<{
  targets: SpaceTx[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  onApply: () => void;
  onDismiss: () => void;
}>) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const all = targets.length > 0 && targets.every((item) => selected.has(item.id));
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="border-t border-line-2 bg-accent-soft/30" data-testid="tx-detail-bulk-offer">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          data-testid="tx-detail-bulk-expand"
          onClick={() => setOpen(true)}
          className="m-tap flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent p-0 text-left"
        >
          <Icon name="content-copy" size={16} color="var(--m-accent-deep)" />
          <span className="min-w-0 flex-1 text-[13px] text-ink-2">{t('tx.bulkOffer', { n: selected.size })}</span>
        </button>
        <button
          data-testid="tx-detail-bulk-apply"
          onClick={onApply}
          disabled={selected.size === 0}
          className="m-tap border-none bg-transparent text-[13px] font-semibold text-accent-deep disabled:opacity-40"
        >
          {t('tx.bulkApply')}
        </button>
        <button
          data-testid="tx-detail-bulk-dismiss"
          aria-label={t('action.dismiss')}
          onClick={onDismiss}
          className="m-tap border-none bg-transparent text-ink-4"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      {/* selection sheet, same mechanics as the review bulk list */}
      <Sheet open={open} onOpenChange={setOpen} title={t('tx.bulkOffer', { n: selected.size })} height={760} dragHandle>
        <div className="flex items-center justify-between pb-2">
          <span className="text-[12px] text-ink-3">{t('review.bulkCount', { n: targets.length })}</span>
          <button
            data-testid="tx-detail-bulk-select-all"
            onClick={() => onChange(all ? new Set() : new Set(targets.map((item) => item.id)))}
            className="m-tap border-none bg-transparent text-[12px] font-semibold text-accent-deep"
          >
            {all ? t('review.bulkUnselectAll') : t('review.bulkSelectAll')}
          </button>
        </div>
        {/* fixed px so the list scrolls INSIDE the sheet (sheet rules) */}
        <div className="max-h-[560px] overflow-y-auto overscroll-contain" data-testid="tx-detail-bulk-list">
          {targets.map((item) => {
            const checked = selected.has(item.id);
            return (
              <div key={item.id} className="flex items-center gap-2 border-b border-line-2 last:border-0">
                <button
                  data-testid={`tx-detail-bulk-${item.id}`}
                  aria-label={cleanBankText(item.merchant)}
                  onClick={() => toggleOne(item.id)}
                  className={`m-tap flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                    checked ? 'border-accent bg-accent text-white' : 'border-line bg-surface'
                  }`}
                >
                  {checked && <Icon name="check" size={12} />}
                </button>
                <div className="min-w-0 flex-1">
                  <TxRow tx={item} showDate onClick={() => toggleOne(item.id)} />
                </div>
              </div>
            );
          })}
        </div>
        <button
          data-testid="tx-detail-bulk-apply-sheet"
          onClick={() => {
            setOpen(false);
            onApply();
          }}
          disabled={selected.size === 0}
          className="m-tap mt-3 w-full rounded-card border-none bg-accent py-3 text-[14px] font-semibold text-white disabled:opacity-40"
        >
          {t('tx.bulkApply')}
        </button>
      </Sheet>
    </div>
  );
}

/**
 * Rename a transaction's display title (user request). The bank's
 * merchant is shown underneath and never changes — clearing the field
 * (or typing the original) removes the override again.
 */
function RenameTitleSheet({
  open,
  onOpenChange,
  original,
  value,
  onSave,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  original: string;
  value: string;
  onSave: (title: string) => void;
}>) {
  const { t } = useLang();
  const [draft, setDraft] = useState(value);
  const last = useRef(open);
  if (open && !last.current) setDraft(value); // fresh open re-seeds
  last.current = open;

  return (
    // 'form' height: on iOS the sheet lifts by the keyboard height —
    // the compact sheet rose clean off the screen (user report ss 2026-07-18)
    <Sheet open={open} onOpenChange={onOpenChange} title={t('tx.renameTitle')} size="form">
      <input
        data-testid="tx-rename-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={original}
        className="h-11 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4"
      />
      <p className="mt-2 text-[12px] text-ink-4">{t('tx.renameOriginal', { name: original })}</p>
      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          data-testid="tx-rename-reset"
          onClick={() => {
            onSave('');
            onOpenChange(false);
          }}
        >
          {t('tx.renameReset')}
        </Button>
        <Button
          variant="primary"
          className="min-w-0 flex-1"
          data-testid="tx-rename-save"
          onClick={() => {
            onSave(draft);
            onOpenChange(false);
          }}
        >
          {t('action.save')}
        </Button>
      </div>
    </Sheet>
  );
}

// ContainerTypeRows + CounterpartyRow retired (#220, user): the
// transaction-level counterparty row modified the link — that story is
// category-level now (the entries carry it, edited inside the category
// editor). The bank's counterparty lives on the Details block as
// read-only metadata, interactable only to VIEW a matched account.

/** which split door the detail shows (#126 r4): the visible Split row
 *  on a whole transaction, Manage splits on a split one, nothing while
 *  the category is reimbursement-locked. Module-level for S3776. */
function splitDoorModeFor(multiPart: boolean, categoryLocked: boolean): 'row' | 'manage' | 'none' {
  if (multiPart) return 'manage';
  return categoryLocked ? 'none' : 'row';
}

/** #213/#232: the Actions card — split door first, recurring + event
 *  links after (expense, non-container rows only — r7: parts own their
 *  links). Module-level for S3776; null when no row applies. */
function DetailActionsCard({
  tx,
  multiPart,
  splitDoorMode,
  recurrings,
  events,
  onSplitDoor,
  onOpenRecurring,
  onOpenEvent,
}: Readonly<{
  tx: SpaceTx;
  multiPart: boolean;
  splitDoorMode: 'row' | 'manage' | 'none';
  recurrings: readonly { id: string; name: string }[] | undefined;
  events: readonly { id: string; name: string }[] | undefined;
  onSplitDoor: () => void;
  onOpenRecurring: () => void;
  onOpenEvent: () => void;
}>) {
  const { t } = useLang();
  // #264 (user): funding is recurring-shaped money too — its rows keep
  // the recurring/event doors
  const linkRows = (tx.txType === 'expense' || tx.txType === 'funding') && !multiPart;
  if (splitDoorMode === 'none' && !linkRows) return null;
  return (
    <>
      <div className="m-cap mt-5 mb-1 px-1">{t('tx.actionsSection')}</div>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {splitDoorMode !== 'none' && (
          <button
            data-testid={splitDoorMode === 'row' ? 'tx-detail-split-row' : 'tx-detail-manage-splits'}
            onClick={onSplitDoor}
            className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left text-[15px] text-ink"
          >
            <Icon name="call-split" size={20} color="var(--m-ink-3)" />
            <span className="flex-1 truncate">{t(splitDoorMode === 'row' ? 'split.title' : 'review.manageSplits')}</span>
            {/* #328 (user): rows whose tap opens a sheet wear the right
                chevron — the pencil stays for true in-place edits */}
            <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
          </button>
        )}
        {linkRows && (
          <>
            {splitDoorMode !== 'none' && <div className="mx-4 h-px bg-line-2" />}
            <button
              data-testid="tx-detail-recurring-row"
              onClick={onOpenRecurring}
              className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left text-[15px] text-ink"
            >
              <Icon name="autorenew" size={20} color="var(--m-ink-3)" />
              <span className="flex-1 truncate">
                {tx.recurringId
                  ? (recurrings?.find((r) => r.id === tx.recurringId)?.name ?? t('recurring.linkTitle'))
                  : t('recurring.linkTitle')}
              </span>
              {!tx.recurringId && <span className="text-xs text-ink-4">{t('recurring.linkNone')}</span>}
              <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
            </button>
            <div className="mx-4 h-px bg-line-2" />
            <button
              data-testid="tx-detail-event-row"
              onClick={onOpenEvent}
              className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left text-[15px] text-ink"
            >
              <Icon name="party-popper" size={20} color="var(--m-ink-3)" />
              <span className="flex-1 truncate">
                {tx.eventId ? (events?.find((e) => e.id === tx.eventId)?.name ?? t('events.linkTitle')) : t('events.linkTitle')}
              </span>
              {!tx.eventId && <span className="text-xs text-ink-4">{t('events.linkNone')}</span>}
              <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
            </button>
          </>
        )}
      </div>
    </>
  );
}

// ── small derivations, module-level so the screen stays readable to
// Sonar (S3776) ──
/** #143: a split container is never a bulk-recategorize target — its
 *  parts own their categories (title renames stay container-legit) */
const isMultiPartRow = (item: Pick<SpaceTx, 'splits'>): boolean =>
  (item.splits ?? []).filter((s) => s.catId !== REIMBURSED_ID).length > 1;
const catBulkTargets = (
  allTxs: SpaceTx[] | undefined,
  tx: SpaceTx,
  offer: { catId: string } | null,
): SpaceTx[] =>
  // #211: a sibling carrying its own category spread made a deliberate
  // multi-category decision — a single-category bulk never steamrolls it
  (offer ? similarTo(allTxs, tx, (item) => !isMultiPartRow(item) && !item.cats?.length && item.catId !== offer.catId) : []);
/** #141 (r2, user rule): the rows a fresh split can copy onto — same
 *  merchant, still splitless (a settled, spread or already-split sibling
 *  never gets overwritten). An exact-euros split reaches ONLY siblings
 *  of the exact same amount; a percentage split scales, so it reaches any. */
const splitBulkTargets = (allTxs: SpaceTx[] | undefined, tx: SpaceTx, source: readonly TxSplit[]): SpaceTx[] => {
  const pctSplit = source.some((s) => s.pct != null);
  const totalCents = source.reduce((sum, s) => sum + Math.abs(s.amountCents), 0);
  return similarTo(
    allTxs,
    tx,
    (item) => (item.splits ?? []).length === 0 && !item.cats?.length && (pctSplit || Math.abs(item.amountCents) === totalCents),
  );
};
/** #211 + #141: the siblings a category SPREAD can copy onto — same
 *  merchant, still partitionless. Exact euros reach only exact twins;
 *  a %-typed spread scales to any amount. */
/** shared shape of the part page's counter plumbing (S3776: the sheet
 *  callback lives at module level). #133 r4: the ◆ asks moved INSIDE
 *  the category editor — this only serves the existing-link re-pick. */

/** #211: ONE category on a whole row rewrites its partition — a spread
 *  clears (or, settled, re-forms around the pick); legacy splits clear.
 *  Module-level for S3776. */
function singleCatPartitionFields(
  tx: Pick<SpaceTx, 'amountCents' | 'cats' | 'splits'>,
  multiPart: boolean,
  settledCents: number,
  catId: string,
): Partial<{ cats: never; splits: never }> {
  if (multiPart) return {};
  if (settledCents > 0) {
    const rest = Math.max(0, Math.abs(tx.amountCents) - settledCents);
    return {
      cats: [...(rest > 0 ? [{ catId, amountCents: rest }] : []), { catId: REIMBURSED_ID, amountCents: settledCents }] as never,
      ...(tx.splits?.length ? { splits: null as never } : {}),
    };
  }
  return {
    ...(tx.cats?.length ? { cats: null as never } : {}),
    ...(tx.splits?.length ? { splits: null as never } : {}),
  };
}

// choosePartCounter retired (#220, user): part-level counterparty
// modification is gone — the category editor's entries own the links.

/** the OTHER leg's side of a release — its own row clears in the same
 *  write. The peer is fetched from the STORE when the live snapshot
 *  hasn't emitted it yet (a slow liveQuery beat left the peer's
 *  transferPeerId dangling — CI-only flake). Module for S3776. */
async function releasePeerLeg(
  store: ReturnType<typeof useData>['store'],
  repo: ReturnType<typeof useData>['repo'],
  spaceId: string,
  tx: SpaceTx,
  allTxs: SpaceTx[] | undefined,
): Promise<void> {
  const peerId = tx.transferPeerId;
  if (!peerId) return;
  const peer =
    (allTxs ?? []).find((item) => item.id === peerId) ??
    (await visibleTransactions(store, spaceId)).find((item) => item.id === peerId);
  if (peer) {
    await writeTxTransform(repo, peer, { transferPeerId: null as never });
    return;
  }
  // #255 r4 (user): a minted part-leg's back-pointer is the part-mirror
  // SOURCE key ("rowId:partId") — releasing from the leg's side must
  // reach the PART's own pointer, or the part keeps a dead pair
  const colon = peerId.indexOf(':');
  if (colon <= 0) return;
  const ownerId = peerId.slice(0, colon);
  const partId = peerId.slice(colon + 1);
  const owner =
    (allTxs ?? []).find((item) => item.id === ownerId) ??
    (await visibleTransactions(store, spaceId)).find((item) => item.id === ownerId);
  if (owner?.splits?.some((s) => s.id === partId && s.transferPeerId === tx.id)) {
    await writeTxTransform(repo, owner, {
      splits: owner.splits.map((s) => (s.id === partId ? { ...s, transferPeerId: undefined } : s)),
    });
  }
}

// retypeRow retired (#220, user): the transaction-level counterparty
// door was its last caller — the category editor's entries write
// through writeRowSingleEntry / the choke now.

/** shared deps of the row-level single-entry writer (S3776) */
interface RowEntryDeps {
  tx: SpaceTx;
  cats: ReturnType<typeof useCategories>;
  store: ReturnType<typeof useData>['store'];
  repo: ReturnType<typeof useData>['repo'];
  spaceId: string;
  transform: ReturnType<typeof useTxTransform>;
  allTxs: SpaceTx[] | undefined;
  reimbNow: number;
  bulkArmedReimbRef: { current: number };
  singleCatFields: (catId: string) => Partial<{ cats: never; splits: never }>;
  setSplitBulk: (v: TxSplit[] | null) => void;
  setCatsBulk: (v: TxSplitCat[] | null) => void;
  setBulkOffer: (v: BulkOfferState | null) => void;
  setBulkSelected: (v: ReadonlySet<string>) => void;
}

/** #268: the offer remembers the entry's counter story — a plain link
 *  bulk-applies (each sibling links and waits), a SPECIFIC pick runs the
 *  per-sibling match queue instead */
interface BulkOfferState {
  catId: string;
  txType: TxType;
  count: number;
  link?: { accountId: string; viaPeer: boolean };
}

/** ONE entry decides the row — its counterparty (#228: the transaction-
 *  level fact) was answered INSIDE the editor or the property row, so
 *  nothing asks afterwards. A linked entry lands category + link in one
 *  write (a pick-existing peer rides along and pairs the reciprocal); a
 *  bare ◆ entry keeps the deliberate bare story; and the plain pick
 *  arms the #141 bulk offer. Module-level for S3776. */
async function writeRowSingleEntry(deps: RowEntryDeps, entry: CatsApplyEntry): Promise<void> {
  const { tx } = deps;
  const family = specialCatType(entry.catId);
  const txType = family ?? deps.cats.byId(entry.catId).txTypes[0] ?? tx.txType;
  // #218: the editor OWNS the link story — a BARE entry on a linked row
  // is a detach (the choke retires our mint, the peer releases)
  const linkChanged = (entry.linkedAccountId ?? undefined) !== (tx.linkedAccountId ?? undefined);
  // #237 r2: a pick can arrive on the SAME account the row already
  // links (re-picking Paypal to point at a row) — the peer must land
  // regardless of linkChanged, or the pick writes nothing at all
  const foreignPeer =
    entry.transferPeerId && entry.transferPeerId !== tx.transferPeerId ? entry.transferPeerId : undefined;
  // a re-link away from a peered leg — or a re-pick onto a new peer —
  // releases the old pair first: a stale peer would keep collapsing
  // the pair in the list
  const unpeer = (linkChanged || !!foreignPeer) && !!tx.transferPeerId;
  if (unpeer) void releasePeerLeg(deps.store, deps.repo, deps.spaceId, tx, deps.allTxs);
  let peerField: { transferPeerId?: string | null } = {};
  if (foreignPeer) peerField = { transferPeerId: foreignPeer };
  else if (unpeer) peerField = { transferPeerId: null };
  await deps.transform(
    tx,
    {
      catId: entry.catId,
      txType,
      needsReview: 0,
      ...deps.singleCatFields(entry.catId),
      ...(linkChanged ? { linkedAccountId: (entry.linkedAccountId ?? null) as never } : {}),
      ...(peerField as Record<string, never>),
    },
    'txCategory',
  );
  // …and the picked row gets the reciprocal (#133 B's fork, per entry)
  if (foreignPeer) await pairWithExistingRow(deps.store, deps.repo, deps.spaceId, tx, foreignPeer, deps.allTxs);
  // bulk mechanism from the detail too (user request) — unlike review
  // it reaches EVERYTHING of this merchant, reviewed included. The
  // settlement category is never a bulk suggestion (user rule).
  const similar =
    entry.catId === REIMBURSED_ID
      ? []
      : similarTo(deps.allTxs, tx, (item) => !isMultiPartRow(item) && !item.cats?.length && item.catId !== entry.catId);
  deps.bulkArmedReimbRef.current = deps.reimbNow;
  deps.setSplitBulk(null);
  deps.setCatsBulk(null);
  deps.setBulkOffer(
    similar.length > 0
      ? {
          catId: entry.catId,
          txType,
          count: similar.length,
          // #268: the link travels with the offer — viaPeer flips the
          // apply into the per-sibling counter-match queue
          link: entry.linkedAccountId ? { accountId: entry.linkedAccountId, viaPeer: !!foreignPeer } : undefined,
        }
      : null,
  );
  deps.setBulkSelected(new Set(similar.map((item) => item.id)));
}

/** #211: the row-level cats apply — ONE entry routes through the single
 *  writer (its ◆ ask already answered in the editor); several land the
 *  spread in one write with the settled `reimbursed` entry re-attached
 *  and the row-level link cleared (#228: a spread means regular
 *  categories — no movement story, no counterparty), then arm the #141
 *  offer. Module for S3776. */
function applyRowCats(
  deps: {
    tx: SpaceTx;
    settledCents: number;
    transform: ReturnType<typeof useTxTransform>;
    applySingle: (entry: CatsApplyEntry) => void;
    armCatsBulk: (entries: TxSplitCat[]) => void;
  },
  entries: CatsApplyEntry[],
): void {
  if (entries.length === 1) {
    deps.applySingle(entries[0]);
    return;
  }
  const full =
    deps.settledCents > 0 ? [...entries, { catId: REIMBURSED_ID, amountCents: deps.settledCents }] : entries;
  const primary = entries.reduce((best, e) => (e.amountCents > best.amountCents ? e : best), entries[0]);
  void deps.transform(
    deps.tx,
    {
      cats: full,
      catId: primary.catId,
      needsReview: 0,
      ...(deps.tx.splits?.length ? { splits: null as never } : {}),
      ...(deps.tx.linkedAccountId ? { linkedAccountId: null as never } : {}),
    },
    'txCategory',
  );
  deps.armCatsBulk(entries);
}

const catsBulkTargets = (allTxs: SpaceTx[] | undefined, tx: SpaceTx, entries: readonly TxSplitCat[]): SpaceTx[] => {
  const pctSpread = entries.every((e) => e.pct != null);
  const totalCents = entries.reduce((sum, e) => sum + e.amountCents, 0);
  return similarTo(
    allTxs,
    tx,
    (item) => (item.splits ?? []).length === 0 && !item.cats?.length && (pctSpread || Math.abs(item.amountCents) === totalCents),
  );
};

/** #211: the spread lands on every picked sibling, resized to its
 *  amount (largest remainder). Returns how many rows it touched. */
async function writeCatsBulk(
  transform: ReturnType<typeof useTxTransform>,
  entries: readonly TxSplitCat[],
  picked: readonly SpaceTx[],
): Promise<number> {
  let n = 0;
  for (const item of picked) {
    const scaled = scaleCatsTo(entries as NonNullable<TxSplit['cats']>, Math.abs(item.amountCents));
    if (!scaled || scaled.length < 2) continue;
    const primary = scaled.reduce((best, e) => (e.amountCents > best.amountCents ? e : best), scaled[0]);
    await transform(item, { cats: scaled, catId: primary.catId, needsReview: 0 }, null);
    n++;
  }
  return n;
}

/** #141: the same split lands on every picked sibling, resized to its
 *  amount (scaleSplitsTo drops per-transaction stories). Module-level
 *  for S3776; returns how many rows it touched. */
async function writeSplitBulk(
  transform: ReturnType<typeof useTxTransform>,
  mintId: () => string,
  source: readonly TxSplit[],
  picked: readonly SpaceTx[],
): Promise<number> {
  let n = 0;
  for (const item of picked) {
    const scaled = scaleSplitsTo(source, Math.abs(item.amountCents), mintId);
    if (scaled.length < 2) continue;
    // one history line for the whole batch (caller logs), review settled;
    // the explicit cats null version-stamps the container (#211)
    await transform(item, { splits: scaled, catId: primaryCatId(scaled) ?? item.catId, cats: null as never, needsReview: 0 }, null);
    n++;
  }
  return n;
}
const titleBulkTargets = (
  allTxs: SpaceTx[] | undefined,
  tx: SpaceTx,
  bulk: { title: string } | null,
): SpaceTx[] => (bulk ? similarTo(allTxs, tx, (item) => (item.titleOverride ?? '') !== bulk.title) : []);
const normalizedCounterIban = (tx: SpaceTx | undefined): string | undefined =>
  tx?.counterIban ? normalizeIban(tx.counterIban) : undefined;
const givenOutFor = (tx: SpaceTx | undefined, allTxs: readonly SpaceTx[] | undefined): number =>
  tx && tx.amountCents > 0 ? givenCents(allTxs ?? [], tx.id) : 0;
const findPartView = (parts: readonly TxSplit[], partParam: string | undefined): TxSplit | undefined =>
  partParam ? parts.find((s) => s.id === partParam) : undefined;
const valuesEditorValue = (
  stage: TxSplit[] | null,
  multiPart: boolean,
  parts: TxSplit[],
): TxSplit[] | undefined => stage ?? (multiPart ? parts : undefined);

/** the app bar's pencil: rename on bank rows, full edit on manual ones,
 *  rename on a part page too (r9: the split's label is the user's).
 *  Module-level for S3776. */
function detailTrailingAction(
  isPart: boolean,
  importRef: string | undefined,
  t: TFunc,
  onRename: () => void,
  onEdit: () => void,
): ReactNode {
  if (isPart) {
    return (
      <IconButton label={t('tx.renameTitle')} testId="tx-part-rename" onClick={onRename}>
        <Icon name="pencil-outline" size={20} />
      </IconButton>
    );
  }
  if (importRef) {
    return (
      <IconButton label={t('tx.renameTitle')} testId="tx-detail-rename" onClick={onRename}>
        <Icon name="pencil-outline" size={20} />
      </IconButton>
    );
  }
  return (
    <IconButton label={t('action.edit')} testId="tx-detail-edit" onClick={onEdit}>
      <Icon name="pencil-outline" size={20} />
    </IconButton>
  );
}

/** the derived "… – split N" name a part settles on without a label
 *  of its own (r9 rename). Module-level for S3776. */
const derivedPartLabel = (tx: SpaceTx, parts: readonly TxSplit[], partView: TxSplit | undefined, t: TFunc): string =>
  partView ? `${txTitle(tx)} – ${t('split.partN', { n: parts.indexOf(partView) + 1 })}` : '';

/** the app bar's name: the whole transaction's title, or the part's
 *  own face on a part page. Module-level for S3776. */
function detailScreenTitle(tx: SpaceTx, parts: readonly TxSplit[], partView: TxSplit | undefined, t: TFunc): string {
  if (!partView) return txTitle(tx);
  return orDefaultLabel(partView.label, derivedPartLabel(tx, parts, partView, t));
}

/** #255 r4 (user): where a pair pointer actually LANDS. The stored id
 *  may be the peer row itself, a CONTAINER whose PART holds the pair's
 *  other end, or a minted part-leg's back-pointer — the part-mirror
 *  SOURCE key ("rowId:partId"; ':' never occurs inside real ids). Both
 *  sides resolve to the other LEG's face and a REAL navigation target:
 *  a tap must never land on an empty screen (the reported glitch was a
 *  jump to the synthetic key's blank detail). Module for S3776. */
interface ResolvedPairPeer {
  /** the row the face reads from (the container when the leg is a part) */
  row: SpaceTx;
  /** set when the other leg is a PART of `row` */
  part?: TxSplit;
  nav: { txId: string; part?: string };
}
function resolvePairPeer(
  txId: string,
  peerId: string | undefined,
  allTxs: readonly SpaceTx[] | undefined,
): ResolvedPairPeer | null {
  if (!peerId || !allTxs) return null;
  const direct = allTxs.find((row) => row.id === peerId && row.deleted === 0);
  if (direct) {
    // a part-level pair's reciprocal points at the CONTAINER row — the
    // real other leg is the part pointing back here
    const part = direct.splits?.find((s) => s.transferPeerId === txId);
    return { row: direct, part, nav: { txId: direct.id, ...(part?.id ? { part: part.id } : {}) } };
  }
  const colon = peerId.indexOf(':');
  if (colon <= 0) return null;
  const owner = allTxs.find((row) => row.id === peerId.slice(0, colon) && row.deleted === 0);
  const part = owner?.splits?.find((s) => s.id === peerId.slice(colon + 1));
  return owner && part?.id ? { row: owner, part, nav: { txId: owner.id, part: part.id } } : null;
}

/** the face the pair row wears: the peer row itself, or — when the other
 *  leg is a PART — the container recut to the part's own money and
 *  derived name. Module for S3776. */
function pairPeerFace(resolved: ResolvedPairPeer, t: TFunc): SpaceTx {
  const { row, part } = resolved;
  if (!part) return row;
  const parts = (row.splits ?? []).filter((s) => s.catId !== REIMBURSED_ID);
  return {
    ...row,
    amountCents: (row.amountCents < 0 ? -1 : 1) * Math.abs(part.amountCents),
    merchant: orDefaultLabel(part.label, derivedPartLabel(row, parts, part, t)),
    titleOverride: undefined,
  };
}

/** r9: the part's label written from its own page — Save trims; ''
 *  (or typing the default back) clears the label so the derived name
 *  rules again. Module-level for S3776. */
function writePartLabel(
  transform: ReturnType<typeof useTxTransform>,
  tx: SpaceTx,
  partView: TxSplit | undefined,
  defaultLabel: string,
  raw: string,
): void {
  if (!partView) return;
  const trimmed = raw.trim();
  const label = trimmed && trimmed !== defaultLabel ? trimmed : undefined;
  const nextSplits = (tx.splits ?? []).map((s) => (s.id === partView.id ? { ...s, label } : s));
  void transform(tx, { splits: nextSplits });
}

/** the rename sheet serves BOTH the whole transaction and a part page
 *  (r9): one place decides which story it edits. Module for S3776. */
function renameSheetProps(
  tx: SpaceTx,
  partView: TxSplit | undefined,
  partDefault: string,
  savePart: (raw: string) => void,
  saveTitle: (raw: string) => void,
): { original: string; value: string; onSave: (raw: string) => void } {
  if (partView) {
    return { original: partDefault, value: orDefaultLabel(partView.label, partDefault), onSave: savePart };
  }
  return { original: cleanBankText(tx.merchant), value: txTitle(tx), onSave: saveTitle };
}

/** drafted-until-complete (#126 r4, relaxed r7): the staged split may
 *  Apply once every part has a real category — the ONLY remaining hold;
 *  a refused Apply marks the offenders (attention badges).
 *  Module-level for S3776. */
const stagedSplitComplete = (stage: TxSplit[] | null): boolean =>
  !!stage && stage.every((s) => s.catId !== UNCATEGORIZED_ID);

/** back to a whole transaction: one category, split gone — the settled
 *  Reimbursed slice keeps the gross partition when it exists.
 *  Module-level for S3776. */
function writeUnsplit(
  transform: ReturnType<typeof useTxTransform>,
  tx: SpaceTx,
  fallbackCatId: string,
  settledCents: number,
  catId: string,
): void {
  const cat = catId !== UNCATEGORIZED_ID ? catId : fallbackCatId;
  // #260: un-splitting is a deliberate category decision — reviewed
  if (settledCents > 0) {
    // #211: a whole row's gross partition lives in its own cats now —
    // #228: the parts' settled bookkeeping folds back into the row's
    const rest = Math.max(0, Math.abs(tx.amountCents) - settledCents);
    void transform(tx, {
      cats: [...(rest > 0 ? [{ catId: cat, amountCents: rest }] : []), { catId: REIMBURSED_ID, amountCents: settledCents }],
      splits: null as never,
      catId: cat,
      needsReview: 0,
    });
  } else {
    void transform(tx, { splits: null as never, catId: cat, needsReview: 0 });
  }
}

/** the split flow's sheets (#126 r4; #211: values-only — categories
 *  have their own editor now): Done only STAGES; the completion deck's
 *  Apply is the ONE write. Module-level for S3776. */
function DetailSplitSheets({
  tx,
  splitOpen,
  setSplitOpen,
  editorValue,
  allowedCatIds,
  unsplitTo,
  unsplitFallbackCat,
  splitStage,
  setSplitStage,
  completeOpen,
  setCompleteOpen,
  activeEvents,
  lockedKind,
  recurrings,
  attention,
  openValuesEditor,
  applyStagedSplit,
}: Readonly<{
  tx: SpaceTx;
  splitOpen: boolean;
  setSplitOpen: (open: boolean) => void;
  editorValue: TxSplit[] | undefined;
  allowedCatIds?: readonly string[];
  unsplitTo: (catId: string) => void;
  unsplitFallbackCat: string;
  splitStage: TxSplit[] | null;
  setSplitStage: (stage: TxSplit[] | null) => void;
  completeOpen: boolean;
  setCompleteOpen: (open: boolean) => void;
  activeEvents: readonly { id: string; name: string; icon?: string }[];
  lockedKind: boolean;
  /** r7: parts link recurring costs like whole transactions do */
  recurrings: readonly Pick<RecurringRow, 'id' | 'name' | 'logo' | 'icon' | 'kind'>[];
  /** r7: a refused Apply marks the parts that still need a category */
  attention: boolean;
  openValuesEditor: () => void;
  applyStagedSplit: () => void;
}>) {
  const { t } = useLang();
  return (
    <>
      <SplitEditorSheet
        open={splitOpen}
        onOpenChange={setSplitOpen}
        tx={tx}
        seedSingle
        value={editorValue}
        onApplySingle={unsplitTo}
        onApply={(splits) => {
          if (splits?.length) {
            setSplitStage(splits);
            setCompleteOpen(true);
          } else {
            unsplitTo(unsplitFallbackCat);
          }
        }}
      />
      {/* drafted-until-complete (#126 r4): every part takes its category,
          type and event here; Apply is the ONE write */}
      <Sheet
        open={completeOpen}
        onOpenChange={(next) => {
          if (!next) setCompleteOpen(false);
        }}
        title={t('split.completeTitle')}
        size="tall"
      >
        <div className="flex flex-col gap-2 pt-1" data-testid="split-complete">
          <ReviewPartDeck
            splits={splitStage ?? undefined}
            rowType={tx.txType}
            tx={tx}
            activeEvents={activeEvents}
            allowedCatIds={allowedCatIds}
            lockedKind={lockedKind}
            recurrings={recurrings}
            attention={attention}
            onOpenValues={() => {
              setCompleteOpen(false);
              openValuesEditor();
            }}
            onSplits={(next) => setSplitStage([...next])}
          />
          {/* r7: always tappable — a refused Apply marks the incomplete
              parts instead of sitting silently disabled */}
          <Button data-testid="split-apply" onClick={applyStagedSplit} disabled={!splitStage}>
            {t('split.applyAll')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/** the part page's sister list (#126 r4) — every part one tap away,
 *  the current one inert. Module-level for S3776. */
function PartSiblingRows({
  tx,
  parts,
  currentId,
  onOpen,
}: Readonly<{
  tx: SpaceTx;
  parts: readonly TxSplit[];
  currentId: string | undefined;
  onOpen: (partId: string | undefined) => void;
}>) {
  const { t, lang } = useLang();
  const cats = useCategories();
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="tx-part-siblings">
      {parts.map((slice, i) => {
        const sliceCat = cats.byId(slice.catId);
        const self = slice.id === currentId;
        return (
          <button
            key={slice.id ?? i}
            data-testid={`tx-part-sibling-${i}`}
            disabled={self}
            onClick={() => onOpen(slice.id)}
            className={`m-tap flex w-full items-center gap-2.5 border-b border-line-2 px-4 py-2.5 text-left last:border-0 ${self ? 'bg-bg-2' : ''}`}
          >
            <Icon name={sliceCat.icon} size={16} color="var(--m-ink-3)" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
              {orDefaultLabel(slice.label, `${txTitle(tx)} – ${t('split.partN', { n: i + 1 })}`)}
              <span className="text-[11px] font-normal text-ink-4"> · {catName(sliceCat, t)}</span>
            </span>
            {/* #228: siblings list what each part is worth (net) */}
            <span className="m-num text-[12px] text-ink-2">{fmtCents(partNetCents(slice), tx.currency, lang)}</span>
            {!self && <Icon name="chevron-right" size={14} color="var(--m-ink-4)" />}
          </button>
        );
      })}
    </div>
  );
}

/** one part as its own transaction page (#126 r4): the sub-transaction
 *  the list drilled into — its share as the headline, its OWN type,
 *  category and event editable in place (write-through: the split is
 *  already complete), its siblings one tap away, and the manage door
 *  for the amounts. Container-only facts (notes, reimbursements,
 *  receipts, delete) stay on the whole transaction. */
function PartDetailBody({
  tx,
  part,
  parts,
  accountName,
  ownStamp,
  activeEvents,
  allowedCatIds,
  onManageSplits,
}: Readonly<{
  tx: SpaceTx;
  part: TxSplit;
  parts: readonly TxSplit[];
  accountName: string | undefined;
  ownStamp: boolean;
  activeEvents: readonly { id: string; name: string; icon?: string }[];
  allowedCatIds?: readonly string[];
  onManageSplits: () => void;
}>) {
  const { t, lang } = useLang();
  const cats = useCategories();
  const transform = useTxTransform();
  const navigate = useNavigate();
  const accounts = useSpaceAccounts();
  const [eventOpen, setEventOpen] = useState(false);
  // r7: the part links recurring costs like whole transactions do
  const [recOpen, setRecOpen] = useState(false);
  // #251: quick creation, parts edition — same doors as the whole tx
  const [recCreating, setRecCreating] = useState(false);
  const [eventCreating, setEventCreating] = useState(false);
  const recurrings = useRecurrings();
  const activeRecs = (recurrings ?? []).filter((r) => r.active === 1);
  // r6/r7: the category card opens the whole-transaction category
  // editor, scoped to this part
  const [spreadOpen, setSpreadOpen] = useState(false);
  // #228: the PART's one counterparty — its own property row
  const [counterOpen, setCounterOpen] = useState(false);
  // #255 r3 (user): the part's own counter-TRANSACTION mechanism —
  // point at the existing row, or link and wait
  const [partMatchOpen, setPartMatchOpen] = useState(false);
  const { store, repo, spaceId } = useData();

  const sign = tx.amountCents < 0 ? -1 : 1;
  const partDirection: 'debit' | 'credit' = tx.amountCents < 0 ? 'debit' : 'credit';
  const partEvent = activeEvents.find((e) => e.id === part.eventId);
  const fmtDay = new Intl.DateTimeFormat(DATE_FMT[lang], { weekday: 'long', day: 'numeric', month: 'long' });
  // r5: the links that target THIS part, and what the part is net worth.
  // #197: a CREDIT container's part also FUNDS links that live on the
  // expense rows — gather the ones naming this part.
  const allTxs = useSpaceTransactions();
  const partLinks = (tx.reimbursements ?? []).filter((r) => r.partId === part.id);
  const givenLinks = (allTxs ?? []).flatMap((row) =>
    (row.reimbursements ?? [])
      .filter((r) => r.txId === tx.id && r.creditPartId === part.id)
      .map((r) => ({ rowId: row.id, amountCents: r.amountCents })),
  );
  const rowTitleOf = (id: string) => {
    const row = allTxs?.find((item) => item.id === id);
    return row ? txTitle(row) : id;
  };
  // #270 r2 (user): the linked rows say WHEN, here too
  const rowDayOf = (id: string) => {
    const row = allTxs?.find((item) => item.id === id);
    return row ? new Date(row.date).toLocaleDateString(LOCALES[lang], { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  };

  /** per-part write-through — r7 (user rule): NO restriction on a split
   *  beyond the amounts, every patch lands. #260: a deliberate edit here
   *  IS the review — the unreviewed badge stands down with it. */
  const patchPart = (patch: Partial<TxSplit>): void => {
    const nextSplits = (tx.splits ?? []).map((s) => (s.id === part.id ? { ...s, ...patch } : s));
    const nonReimb = nextSplits.filter((s) => s.catId !== REIMBURSED_ID);
    void transform(tx, { splits: nextSplits, catId: primaryCatId(nonReimb) ?? tx.catId, needsReview: 0 }, 'txCategory');
  };

  // #228: the part's one counterparty — pick refiles the category by the
  // account's kind (the bijection's re-pick rule), remove resets it.
  // Settled `reimbursed` bookkeeping always survives a category rewrite.
  const partCounter = accounts?.find((a) => a.id === part.linkedAccountId);
  // #255 r4 (user): the part's pair resolves like the whole row's — the
  // other leg's face plus a REAL landing for the row's tap
  const partPeer = resolvePairPeer(tx.id, part.transferPeerId, allTxs);
  const partPeerFaceRow = partPeer ? pairPeerFace(partPeer, t) : undefined;
  const partPeerAccountName = partPeer ? accounts?.find((a) => a.id === partPeer.row.accountId)?.name : undefined;
  const partRealCats = (part.cats ?? []).filter((c) => c.catId !== REIMBURSED_ID);
  const partSettledCats = (part.cats ?? []).filter((c) => c.catId === REIMBURSED_ID);
  const partSigned = sign * Math.abs(part.amountCents);
  // #255 r3: the reciprocal pairing a part-level pick leaves behind —
  // the same shape review's part picks use
  const pairPartPick = (pickedTxId: string): void => {
    void pairWithExistingRow(store, repo, spaceId, { id: tx.id, accountId: tx.accountId, amountCents: partSigned }, pickedTxId, allTxs);
  };
  const applyPartCounter = (picked: { id: string; type: AccountRow['type'] }, peer?: { txId: string }): void => {
    const derived = movementCatFor(picked.type, partSigned);
    patchPart({
      catId: derived,
      txType: specialCatType(derived),
      linkedAccountId: picked.id,
      transferPeerId: peer?.txId,
      cats: catsAroundSingle(part, derived),
    });
    if (peer) pairPartPick(peer.txId);
  };
  const removePartCounter = (): void =>
    patchPart({
      catId: UNCATEGORIZED_ID,
      txType: undefined,
      linkedAccountId: undefined,
      transferPeerId: undefined,
      cats: catsAroundSingle(part, UNCATEGORIZED_ID),
    });

  return (
    <>
      <div className="flex flex-col items-center py-6 text-center">
        {/* #228: the part's headline is what it is WORTH — its own
            settled bookkeeping nets it, exactly like a whole row */}
        <div className="m-num text-4xl text-ink" data-testid="tx-part-amount">
          {fmtCents(sign * partNetCents(part), tx.currency, lang, { sign: true })}
        </div>
        <div className="mt-1 text-sm text-ink-3">
          {fmtDay.format(new Date(tx.date))}
          {tx.time ? ` · ${tx.time}` : ''}
        </div>
        {/* whose money this is a piece of */}
        <div className="mt-1 text-[12px] text-ink-4">{txTitle(tx)}</div>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex items-center gap-3 px-4 py-3.5 text-[15px] text-ink" data-testid="tx-part-account-row">
          <Icon name="bank-outline" size={20} color="var(--m-ink-3)" />
          <span className="min-w-0 flex-1 truncate">{accountName ?? '—'}</span>
          <span className="text-xs text-ink-4">{t('txform.account')}</span>
        </div>
        {/* #228 (user): the counterparty is the PART's own property —
            one per (split) transaction, editable, removable (removal
            resets the part's category) */}
        <div className="mx-4 h-px bg-line-2" />
        <button
          data-testid="tx-part-counter-row"
          onClick={() => setCounterOpen(true)}
          disabled={ownStamp}
          className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3 text-left text-[15px] text-ink"
        >
          <Icon name="bank-transfer" size={20} color="var(--m-ink-3)" />
          <span className={`min-w-0 flex-1 truncate ${partCounter ? '' : 'text-ink-4'}`}>
            {partCounter?.name ?? t('tx.counterNone')}
          </span>
          <span className="text-xs text-ink-4">{t('tx.counterAccount')}</span>
          {/* #328 (user): the tap opens the counterparty sheet — chevron */}
          {!ownStamp && <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />}
        </button>
        {/* #255 r3 (user): the part's Counter-transaction row — the
            picked leg's face, or the honest waiting state. #255 r4
            (user): a PAIRED row's tap TRAVELS to the other side (the
            same contract as the whole row's counterpart row); the
            pencil is what re-opens the match sheet. Unpaired, the tap
            still opens the sheet — there is nowhere to travel yet. */}
        {partCounter && !ownStamp && (
          <>
            <div className="mx-4 h-px bg-line-2" />
            <div className="flex w-full items-center gap-3 px-4 py-3 text-[15px] text-ink">
              <Icon name="swap-horizontal" size={20} color="var(--m-ink-3)" />
              <button
                data-testid="tx-part-countertx-row"
                onClick={() => {
                  if (partPeer) {
                    void navigate({
                      to: '/transactions/$txId',
                      params: { txId: partPeer.nav.txId },
                      ...(partPeer.nav.part ? { search: { part: partPeer.nav.part } } : {}),
                    });
                  } else setPartMatchOpen(true);
                }}
                className="m-tap flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent p-0 text-left"
              >
                {partPeerFaceRow ? (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-ink">{txTitle(partPeerFaceRow)}</span>
                      <span className="block truncate text-[11px] text-ink-4">
                        {partPeerFaceRow.date}
                        {partPeerAccountName ? ` · ${partPeerAccountName}` : ''}
                      </span>
                    </span>
                    <span className="m-num shrink-0 text-[14px] font-semibold text-ink">
                      {fmtCents(partPeerFaceRow.amountCents, partPeerFaceRow.currency, lang, { sign: true })}
                    </span>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-ink-4">{t('tx.awaitingCounterpart')}</span>
                )}
              </button>
              <span className="shrink-0 text-xs text-ink-4">{t('tx.counterTxRow')}</span>
              <button
                aria-label={t('action.edit')}
                data-testid="tx-part-countertx-edit"
                onClick={() => setPartMatchOpen(true)}
                className="m-tap flex h-8 w-8 shrink-0 items-center justify-center border-none bg-transparent p-0 text-ink-4"
              >
                <Icon name="pencil-outline" size={14} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* the category card IS the door to the whole-transaction category
          editor, scoped to this part (r7: same gears). #217/#138 (user):
          a spread shows EACH category row with its value. #228 feedback:
          no counter subline here — the property row above owns it; the
          part's settled bookkeeping renders as its own quiet row */}
      <div className="mt-3 overflow-hidden rounded-card border border-line bg-surface" data-testid="tx-part-category">
        {(partRealCats.length ? partRealCats : [null]).map((entry, i) => {
          const rowCat = cats.byId(entry?.catId ?? part.catId);
          const rowColor = rowCat.color ?? cats.byId(rowCat.parentId ?? '').color;
          return (
            <button
              key={entry ? `${entry.catId}-${i}` : 'single'}
              data-testid={i === 0 ? 'tx-part-category-row' : `tx-part-cat-${i}`}
              onClick={() => setSpreadOpen(true)}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3.5 text-left last:border-0"
            >
              <Icon name={rowCat.icon} size={20} color={rowColor ?? 'var(--m-ink-3)'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-ink">{catName(rowCat, t)}</span>
                {!entry && rowCat.parentId && (
                  <span className="block truncate text-[11px] text-ink-4">{catName(cats.byId(rowCat.parentId), t)}</span>
                )}
              </span>
              <span className="m-num text-[13px] text-ink-2">
                {fmtCents(entry ? entry.amountCents : partNetCents(part), tx.currency, lang)}
              </span>
              <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
            </button>
          );
        })}
        {partSettledCats.map((entry, i) => (
          <button
            key={`settled-${entry.catId}-${entry.amountCents}`}
            data-testid={`tx-part-cat-settled-${i}`}
            onClick={() => setSpreadOpen(true)}
            className="m-tap flex w-full items-center gap-3 border-t border-line-2 bg-transparent px-4 py-3.5 text-left opacity-60"
          >
            <Icon name={cats.byId(entry.catId).icon} size={20} color="var(--m-ink-4)" />
            <span className="min-w-0 flex-1 truncate text-[15px] text-ink-2">{catName(cats.byId(entry.catId), t)}</span>
            <span className="m-num text-[13px] text-ink-3">{fmtCents(entry.amountCents, tx.currency, lang)}</span>
            {/* #328 (user): this tap opens the editor too — say so */}
            <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
          </button>
        ))}
      </div>

      {/* r7: the part's recurring link — whole-transaction parity */}
      <button
        data-testid="tx-part-rec"
        onClick={() => setRecOpen(true)}
        className="m-tap mt-3 flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left text-[14px] text-ink"
      >
        <Icon name="autorenew" size={18} color="var(--m-ink-3)" />
        <span className="min-w-0 flex-1 truncate">
          {activeRecs.find((rec) => rec.id === part.recurringId)?.name ?? t('recurring.linkNone')}
        </span>
        <span className="text-[11px] text-ink-4">{t('recurring.linkTitle')}</span>
        <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
      </button>

      <button
        data-testid="tx-part-event"
        onClick={() => setEventOpen(true)}
        className="m-tap mt-3 flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left text-[14px] text-ink"
      >
        <Icon name="party-popper" size={18} color="var(--m-ink-3)" />
        <span className="min-w-0 flex-1 truncate">{partEvent?.name ?? t('events.linkNone')}</span>
        <span className="text-[11px] text-ink-4">{t('events.linkTitle')}</span>
        <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
      </button>

      {/* r5: the part's own note — parts are full transactions */}
      <div className="mt-3 overflow-hidden rounded-card border border-line bg-surface">
        <textarea
          data-testid="tx-part-notes"
          defaultValue={part.notes ?? ''}
          placeholder={t('tx.notesPlaceholder')}
          rows={2}
          onBlur={(e) => {
            const next = e.target.value.trim() || undefined;
            if (next !== part.notes) patchPart({ notes: next });
          }}
          className="w-full resize-none bg-transparent px-4 py-3 text-[14px] text-ink outline-none placeholder:text-ink-4"
        />
      </div>

      {/* r5: the part's own reimbursements — links born here target THIS
          part; the whole pair still shows on the container */}
      <div className="m-cap mt-5 mb-1 flex items-baseline justify-between px-1">
        <span>{t('reimb.section')}</span>
        <button
          data-testid="tx-part-reimb-link"
          onClick={() =>
            void navigate({ to: '/transactions/$txId/link-reimb', params: { txId: tx.id }, search: { part: part.id } })
          }
          className="m-tap border-none bg-transparent text-[11px] font-semibold text-accent-deep"
        >
          {t('reimb.link')}
        </button>
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="tx-part-reimbs">
        {/* #231 r2 (user): links only — the netted headline and the facts
            card's original amount carry the money story */}
        {/* #237 (user): reimbursement rows go STRAIGHT to the linked
            transaction — no sheet in between, on parts too */}
        {partLinks.map((linkRow) => (
          <button
            key={`${linkRow.txId}-${linkRow.partId}`}
            data-testid={`tx-part-reimb-${linkRow.txId}`}
            onClick={() => void navigate({ to: '/transactions/$txId', params: { txId: linkRow.txId } })}
            className="m-tap flex w-full items-center gap-3 border-x-0 border-t-0 border-b border-line-2 bg-transparent px-4 py-2.5 text-left text-[13px] last:border-0"
          >
            <Icon name="cash-refund" size={16} color="var(--m-ink-3)" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink">{rowTitleOf(linkRow.txId)}</span>
              <span className="block text-[11px] text-ink-4">{rowDayOf(linkRow.txId)}</span>
            </span>
            <span className="m-num text-ink-2">{fmtCents(linkRow.amountCents, tx.currency, lang)}</span>
          </button>
        ))}
        {/* #197: what this CREDIT part already funded elsewhere */}
        {givenLinks.map((given) => (
          <button
            key={`out-${given.rowId}`}
            data-testid={`tx-part-given-${given.rowId}`}
            onClick={() => void navigate({ to: '/transactions/$txId', params: { txId: given.rowId } })}
            className="m-tap flex w-full items-center gap-3 border-x-0 border-t-0 border-b border-line-2 bg-transparent px-4 py-2.5 text-left text-[13px] last:border-0"
          >
            <Icon name="cash-refund" size={16} color="var(--m-ink-3)" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink">{rowTitleOf(given.rowId)}</span>
              <span className="block text-[11px] text-ink-4">{rowDayOf(given.rowId)}</span>
            </span>
            <span className="m-num text-ink-2">{fmtCents(-given.amountCents, tx.currency, lang, { sign: true })}</span>
          </button>
        ))}
        {partLinks.length === 0 && givenLinks.length === 0 && <div className="px-4 py-3" />}
      </div>

      {/* #199: the parent's bank facts right here — a deliberate
          duplicate, so no trip to the container is needed */}
      <DetailFacts tx={tx} givenOut={givenOutFor(tx, allTxs)} />

      {/* the sisters: every part one tap away (#126 r4) */}
      <div className="m-cap mt-5 mb-1 px-1">{t('split.title')}</div>
      <PartSiblingRows
        tx={tx}
        parts={parts}
        currentId={part.id}
        onOpen={(partId) =>
          void navigate({ to: '/transactions/$txId', params: { txId: tx.id }, search: { part: partId } })
        }
      />
      <button
        data-testid="tx-part-manage"
        onClick={onManageSplits}
        className="m-tap mt-2 flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-line bg-transparent px-4 py-2.5 text-[13px] font-medium text-accent-deep"
      >
        <Icon name="tune" size={15} />
        {t('review.manageSplits')}
      </button>
      <button
        data-testid="tx-part-whole"
        onClick={() => void navigate({ to: '/transactions/$txId', params: { txId: tx.id }, search: {} })}
        className="m-tap mt-2 flex w-full items-center justify-center gap-1.5 rounded-card border border-line bg-surface px-4 py-2.5 text-[13px] font-medium text-ink"
      >
        <Icon name="receipt-text-outline" size={15} />
        {t('tx.partWhole')}
      </button>

      {/* #228: the part's counterparty picker — the property row's door.
          The part's category narrows the kinds; detach resets it */}
      <CounterpartySheet
        open={counterOpen}
        onOpenChange={setCounterOpen}
        excludeAccountId={tx.accountId}
        currentLinkedId={part.linkedAccountId}
        defaultFamily={specialCatType(part.catId) ? (defaultFamilyFor(part.catId) ?? undefined) : undefined}
        counterTypes={specialCatType(part.catId) ? counterTypesFor(part.catId) : undefined}
        anchor={{ id: tx.id, amountCents: partSigned, date: tx.date }}
        onChoose={(picked, peer) => applyPartCounter(picked, peer)}
        onDetach={part.linkedAccountId ? removePartCounter : undefined}
      />
      {/* #255 r3: the part's own match sheet — pick the existing row or
          keep waiting for the bank */}
      {partCounter && (
        <CounterMatchSheet
          open={partMatchOpen}
          onOpenChange={setPartMatchOpen}
          target={{ id: partCounter.id, name: partCounter.name }}
          anchor={{ id: tx.id, amountCents: partSigned, date: tx.date }}
          rows={allTxs ?? []}
          onWait={part.transferPeerId ? () => patchPart({ transferPeerId: undefined }) : undefined}
          onPick={(pickedTxId) => {
            patchPart({ transferPeerId: pickedTxId });
            pairPartPick(pickedTxId);
          }}
        />
      )}
      {/* the part's categories (r6/r7) — the whole-transaction editor,
          scoped to the part's amount. #228: a lone ◆ pick asks the
          part's counterparty inside the editor; spreads offer regular
          categories only */}
      <CatsSheet
        open={spreadOpen}
        onOpenChange={setSpreadOpen}
        subject={part}
        currency={tx.currency}
        direction={partDirection}
        txType={tx.txType}
        allowedCatIds={allowedCatIds}
        // #216 (user): the chosen %/€ shape is per-transaction data —
        // part spreads keep it too, so the editor reopens as it was left
        includePct
        excludeAccountId={tx.accountId}
        askDisabled={ownStamp}
        onApply={(entries) => patchPart(partCatsApplyPatch(part, entries))}
      />
      {/* r7: the part's recurring link — the manual pick, parts edition */}
      <Sheet
        open={recOpen}
        onOpenChange={setRecOpen}
        title={t('recurring.linkTitle')}
        size="form"
        dragHandle
      >
        <div className="pt-1" data-testid="tx-part-rec-list">
          <button
            data-testid="tx-part-rec-none"
            onClick={() => {
              patchPart({ recurringId: undefined });
              setRecOpen(false);
            }}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink-2"
          >
            <Icon name="close-circle-outline" size={18} color="var(--m-ink-4)" />
            <span className="min-w-0 flex-1 truncate">{t('recurring.linkNone')}</span>
          </button>
          {activeRecs.map((rec) => (
            <button
              key={rec.id}
              data-testid={`tx-part-rec-${rec.id}`}
              onClick={() => {
                patchPart({ recurringId: rec.id });
                setRecOpen(false);
              }}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink"
            >
              {/* #258 (user): the cost's own face, not a generic icon */}
              <RecurringVisual rec={rec} size={18} />
              <span className="min-w-0 flex-1 truncate">{rec.name}</span>
              {part.recurringId === rec.id && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
            </button>
          ))}
          {/* #251: the quick-create door the whole-tx picker has */}
          <button
            data-testid="tx-part-rec-create"
            onClick={() => {
              setRecCreating(true);
              setRecOpen(false);
            }}
            className="m-tap flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] font-medium text-accent-deep"
          >
            <Icon name="plus" size={18} />
            {t('recurring.add')}
          </button>
        </div>
      </Sheet>
      <Sheet
        open={eventOpen}
        onOpenChange={setEventOpen}
        title={t('events.linkTitle')}
        size="form"
        dragHandle
      >
        <div className="pt-1" data-testid="tx-part-event-list">
          <button
            data-testid="tx-part-event-none"
            onClick={() => {
              patchPart({ eventId: undefined });
              setEventOpen(false);
            }}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink-2"
          >
            <Icon name="close-circle-outline" size={18} color="var(--m-ink-4)" />
            <span className="min-w-0 flex-1 truncate">{t('events.linkNone')}</span>
          </button>
          {activeEvents.map((event) => (
            <button
              key={event.id}
              data-testid={`tx-part-event-${event.id}`}
              onClick={() => {
                patchPart({ eventId: event.id });
                setEventOpen(false);
              }}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink"
            >
              <Icon name={event.icon ?? 'party-popper'} size={18} color="var(--m-accent-deep)" />
              <span className="min-w-0 flex-1 truncate">{event.name}</span>
              {part.eventId === event.id && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
            </button>
          ))}
          {/* #251: the quick-create door the whole-tx picker has */}
          <button
            data-testid="tx-part-event-create"
            onClick={() => {
              setEventCreating(true);
              setEventOpen(false);
            }}
            className="m-tap flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] font-medium text-accent-deep"
          >
            <Icon name="plus" size={18} />
            {t('events.new')}
          </button>
        </div>
      </Sheet>
      {/* #251: create-and-link, parts edition — prefilled from the PART,
          the created id files onto this part alone */}
      {recCreating && (
        <RecurringFormSheet
          initial={partRecurringPrefill(tx, part)}
          onSaved={(id) => patchPart({ recurringId: id })}
          onClose={() => setRecCreating(false)}
        />
      )}
      {eventCreating && (
        <EventFormSheet initial="new" onSaved={(id) => patchPart({ eventId: id })} onClose={() => setEventCreating(false)} />
      )}
    </>
  );
}

/** the account · counterparty · pair block (S3776: out of the screen) —
 *  the row's home account, the counterparty PROPERTY row (#228: back on
 *  the transaction, one per (split) tx — editable, removable) with the
 *  loans-v2 count-it-in offer, and the transfer-pair state underneath */
function DetailAccountBlock({
  tx,
  account,
  linkedAccount,
  pairState,
  peer,
  peerAccountName,
  loanCountBusy,
  setLoanCountBusy,
  onOpenPeer,
  onUnpair,
  onEditCounter,
  onPickCounterpart,
}: Readonly<{
  tx: SpaceTx;
  account: AccountRow | undefined;
  linkedAccount: AccountRow | undefined;
  pairState: ReturnType<typeof transferPairState>;
  /** #237 r2: the other leg as the space sees it (feeds the rich row) —
   *  #255 r4: already recut to the exact LEG when that leg is a part */
  peer: SpaceTx | undefined;
  peerAccountName: string | undefined;
  loanCountBusy: boolean;
  setLoanCountBusy: (busy: boolean) => void;
  /** #255 r4: absent when the pair pointer resolves to nothing visible —
   *  the row then renders without the dead jump */
  onOpenPeer?: () => void;
  /** absent on a default-ledger row (#221): the pair releases from the
   *  origin side only */
  onUnpair?: () => void;
  /** #228: opens the transaction-level counterparty picker; absent =
   *  the row is read-only here (default ledgers, containers hide it) */
  onEditCounter?: () => void;
  /** #237: opens the counter-match sheet — point the pair at a row that
   *  already exists on the counter account */
  onPickCounterpart?: () => void;
}>) {
  const { t, lang } = useLang();
  const { store, repo } = useData();
  const counterRow = !!linkedAccount || !!onEditCounter;
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center gap-3 px-4 py-3.5 text-[15px] text-ink" data-testid="tx-detail-account-row">
        <Icon name="bank-outline" size={20} color="var(--m-ink-3)" />
        <span className="min-w-0 flex-1 truncate">{account?.name ?? '—'}</span>
        <span className="text-xs text-ink-4">{t('txform.account')}</span>
      </div>
      {/* #228 (user): the counterparty is a property of the (split)
          transaction again — one per transaction, editable in place,
          removable (removal resets the category). Sibling buttons, never
          nested (S6819). */}
      {counterRow && (
        <>
          <div className="mx-4 h-px bg-line-2" />
          <div className="flex w-full items-center gap-3 px-4 py-3 text-[15px] text-ink">
            <Icon name="bank-transfer" size={20} color="var(--m-ink-3)" />
            <span className="min-w-0 flex-1">
              <button
                data-testid="tx-detail-counter-row"
                onClick={onEditCounter}
                disabled={!onEditCounter}
                className="m-tap block w-full border-none bg-transparent p-0 text-left"
              >
                <span className={`block truncate ${linkedAccount ? '' : 'text-ink-4'}`} data-testid="tx-detail-linked-account">
                  {linkedAccount?.name ?? t('tx.counterNone')}
                </span>
                {linkedAccount && ['loan', 'mortgage'].includes(linkedAccount.type) && (
                  <span className="block truncate text-[11px] text-accent-deep" data-testid="tx-detail-pays-debt">
                    {t('tx.paysDebt', { name: linkedAccount.name })}
                  </span>
                )}
              </button>
              {/* pre-anchor payment (loans v2): dated before the loan's
                  known-true balance, so it did NOT move the balance —
                  the user can deliberately count it in, once */}
              {linkedAccount && offersLoanCount(tx, linkedAccount) && (
                <button
                  data-testid="tx-detail-loan-count"
                  disabled={loanCountBusy}
                  onClick={() => {
                    // one-shot with a busy latch: the liveQuery re-emit
                    // that hides this button trails the write (review
                    // finding: a double-tap applied the delta twice)
                    setLoanCountBusy(true);
                    void countPreAnchorTx(store, repo, { ...tx, linkedAccountId: linkedAccount.id } as never, () =>
                      writeTxTransform(repo, tx, { loanCounted: 1 }),
                    ).finally(() => setLoanCountBusy(false));
                  }}
                  className="m-tap mt-0.5 block border-none bg-transparent p-0 text-left text-[11px] text-warning underline disabled:opacity-50"
                >
                  {t('tx.loanNotCounted')}
                </button>
              )}
            </span>
            <span className="text-xs text-ink-4">{t('tx.counterAccount')}</span>
            {/* #328 (user): the tap opens the counterparty sheet — chevron */}
            {onEditCounter && <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />}
          </div>
        </>
      )}
      {pairState === 'peered' && (
        <TransferPeerRow t={t} lang={lang} peer={peer} accountName={peerAccountName} onOpen={onOpenPeer} onUnpair={onUnpair} />
      )}
      {pairState === 'awaiting' && (
        <div className="px-4 pb-3">
          <Pill testId="tx-detail-awaiting">{t('tx.awaitingCounterpart')}</Pill>
          {/* #237 (user): the wallet's other side may never arrive from
              the feed — point at the row that is already there */}
          {onPickCounterpart && (
            <button
              data-testid="tx-detail-pick-counter"
              onClick={onPickCounterpart}
              className="m-tap mt-1 block w-full border-none bg-transparent p-0 text-left text-[13px] font-medium text-accent-deep"
            >
              {t('tx.pickCounterpart', { name: linkedAccount?.name ?? '' })}
            </button>
          )}
        </div>
      )}
      {pairState === 'offerCreate' && (
        <div className="px-4 pb-3">
          {/* #237: creating is one option — pointing at the existing row
              is the other, and neither happens silently anymore */}
          <button
            data-testid="tx-detail-create-counter"
            onClick={() => void healMissingMirror(store, repo, tx).catch(() => undefined)}
            className="m-tap block w-full border-none bg-transparent p-0 text-left text-[13px] font-medium text-accent-deep"
          >
            {t('tx.createCounterpart', { name: linkedAccount?.name ?? '' })}
          </button>
          {onPickCounterpart && (
            <button
              data-testid="tx-detail-pick-counter"
              onClick={onPickCounterpart}
              className="m-tap mt-1 block w-full border-none bg-transparent p-0 text-left text-[13px] font-medium text-accent-deep"
            >
              {t('tx.pickCounterpart', { name: linkedAccount?.name ?? '' })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// NOSONAR-next-line: S3776 — router-level composition. Every decision
// (category routing, retype, bulk arms, partition rewrites, the ask
// plumbing) lives in the module helpers above; what remains here is
// state wiring and JSX visibility gating, and slicing the markup
// further would only scatter one screen across pretend-components.
// #168 r5 (user): `backTo` is where LEAVING the detail lands (panes
// close, Esc, delete) — the /recurring/tx/$txId mount passes /recurring
// so the recurring list keeps the master pane; mobile back stays history.
export function TxDetailScreen({ backTo = '/transactions' }: Readonly<{ backTo?: '/transactions' | '/recurring' }> = {}) { // NOSONAR(S3776)
  const { t, lang } = useLang();
  const { store, repo, spaceId } = useData();
  const { txId } = useParams({ strict: false }) as { txId: string };
  const [editOpen, setEditOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  // title bulk (user request): renaming offers the same pick-and-apply
  // flow as categories, and the memory teaches future arrivals
  const [titleBulk, setTitleBulk] = useState<{ title: string } | null>(null);
  const [titleSelected, setTitleSelected] = useState<ReadonlySet<string>>(new Set());
  // #228: the counterparty is a (split)-transaction property again —
  // this opens its picker; counterOpen below stays the read-only
  // account INFO sheet the Details row opens
  const [counterPickOpen, setCounterPickOpen] = useState(false);
  // #237: the unlink confirms + the counter-match sheet (declared with
  // the other hooks — the `!tx` return below must never reorder them)
  const [unpairConfirm, setUnpairConfirm] = useState<null | 'mint' | 'default'>(null);
  const [matchOpen, setMatchOpen] = useState(false);
  const [loanCountBusy, setLoanCountBusy] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  // #211: the split-categories editor — the pencil's door on whole rows
  const [catsOpen, setCatsOpen] = useState(false);
  // #126 r4: the values door + drafted-until-complete stage — splitting
  // from the detail writes NOTHING until every part is complete, then
  // lands in ONE write (no half-deployed splits, easy bulk updates)
  const [splitStage, setSplitStage] = useState<TxSplit[] | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  // r7: a refused Apply marks incomplete parts; splitting a filled row
  // warns that the container's own story resets
  const [applyAttention, setApplyAttention] = useState(false);
  const [splitResetOpen, setSplitResetOpen] = useState(false);
  const { part: partParam } = useSearch({ strict: false }) as { part?: string };
  const [recurringOpen, setRecurringOpen] = useState(false);
  // create-and-return doors (user request): snapshot of pre-existing ids
  // so the freshly created row is identifiable and auto-links to this tx
  const [recCreating, setRecCreating] = useState(false);
  const [eventCreating, setEventCreating] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const [bulkOffer, setBulkOffer] = useState<BulkOfferState | null>(null);
  // #268: the per-sibling counter-match queue a viaPeer bulk apply runs
  const [counterBulk, setCounterBulk] = useState<{ items: SpaceTx[]; catId: string; txType: TxType; accountId: string } | null>(null);
  // #141: a landed split offers itself to the splitless siblings —
  // mutually exclusive with the category offer (they share the bar)
  const [splitBulk, setSplitBulk] = useState<TxSplit[] | null>(null);
  const [splitSelected, setSplitSelected] = useState<ReadonlySet<string>>(new Set());
  // #211: a landed category SPREAD offers itself the same way
  const [catsBulk, setCatsBulk] = useState<TxSplitCat[] | null>(null);
  const [catsSelected, setCatsSelected] = useState<ReadonlySet<string>>(new Set());
  // the reimbursement total at arm time: a settlement AFTER arming
  // rewrites the category attribution, so the stale offer must retire
  // (user rule: any category change — direct or indirect — re-evaluates)
  const bulkArmedReimbRef = useRef(0);
  // which of the similar transactions the bulk apply will touch (user
  // request: see and pick them, not a blind apply-all)
  const [bulkSelected, setBulkSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();
  const panes = useLgViewport();

  // desktop affordance (D5): Esc closes the detail pane back to the plain
  // list — but only when no sheet is open (sheets own their own Esc)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // any open sheet owns Esc — mobile sheets included (they render no
      // <dialog>, which the old selector-only guard missed)
      if (e.key !== 'Escape' || hasOpenSheet() || document.querySelector('dialog[open], [role="dialog"]')) return;
      void navigate({ to: backTo });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, backTo]);

  const tx = useSpaceTransaction(txId);
  const transform = useTxTransform();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const account = useQuery(store, async () => (tx ? store.get('account', tx.accountId) : undefined), [tx?.accountId]);
  const linkedAccount = useQuery(
    store,
    async () => (tx?.linkedAccountId ? store.get('account', tx.linkedAccountId) : undefined),
    [tx?.linkedAccountId],
  );
  // a transfer into a loan account IS a payment on that loan (v2: the
  // account is the debt) — say so, matching the review card's debt row
  // read-time join (user request): the moment an account with this IBAN
  // exists locally — e.g. it was attached to a space later — every
  // transaction's counterparty upgrades from plain text to a live door
  const counterIban = normalizedCounterIban(tx);
  const counterAccount = useQuery(
    store,
    async () =>
      counterIban
        ? (await store.allRows('account')).find((a) => a.deleted === 0 && !!a.iban && normalizeIban(a.iban) === counterIban)
        : undefined,
    [counterIban],
  );
  const cats = useCategories();
  const recurrings = useRecurrings();
  const recurringOps = useRecurringOps();
  const events = useEvents();
  // what this credit refunded elsewhere — the expenses own the links,
  // so the credit's net worth is a derived fact
  const allTxs = useSpaceTransactions();
  const givenOut = givenOutFor(tx, allTxs);

  // #237 r2: pairs can exist ONE-WAY in stored data (the reciprocal
  // write used to land on the raw feed row — a void every reader
  // ignores). The screen reads the pair from EITHER direction: the
  // row's own peer, a row pointing here, or a split PART pointing here.
  const reversePeer = useMemo(
    () =>
      tx && !tx.transferPeerId
        ? allTxs?.find(
            (row) =>
              row.id !== tx.id &&
              row.deleted === 0 &&
              (row.transferPeerId === tx.id || !!row.splits?.some((s) => s.transferPeerId === tx.id)),
          )
        : undefined,
    [tx, allTxs],
  );
  const effectivePeerId = tx?.transferPeerId ?? reversePeer?.id;
  // #255 r4: the pointer resolves to a REAL destination — the peer row,
  // or the exact PART (page) when the other leg is, or points into, a
  // split; a minted part-leg's "rowId:partId" back-pointer resolves too
  const resolvedPeer = useMemo(
    () => (tx ? resolvePairPeer(tx.id, effectivePeerId, allTxs) : null),
    [tx, effectivePeerId, allTxs],
  );
  const peerAccount = useQuery(
    store,
    async () => (resolvedPeer ? store.get('account', resolvedPeer.row.accountId) : undefined),
    [resolvedPeer?.row.accountId],
  );
  // …and HEALS the missing reciprocal, once per pairing, so every other
  // surface (lists, match-sheet exclusion, the other detail) recovers.
  // The key latch keeps the heal from re-arming a pair mid-unpair.
  const healedPairRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tx || !allTxs) return;
    const key = `${tx.id}:${tx.transferPeerId ?? ''}:${reversePeer?.id ?? ''}`;
    if (healedPairRef.current === key) return;
    healedPairRef.current = key;
    if (tx.transferPeerId) {
      const peer = allTxs.find((row) => row.id === tx.transferPeerId && row.deleted === 0);
      if (peer && !peer.transferPeerId && !peer.splits?.some((s) => s.transferPeerId === tx.id)) {
        void writeTxTransform(repo, peer, { transferPeerId: tx.id });
      }
    } else if (reversePeer?.transferPeerId === tx.id && !tx.splits?.some((s) => s.transferPeerId === reversePeer.id)) {
      // row-level pointer only — a PART's pair belongs to the part.
      // #255 r4: a part-level pick's reciprocal ALSO points at the
      // container row-level; lifting it here minted a duplicate
      // row-level pair on top of the part's own (the corruption the
      // user's screenshots walked into).
      void writeTxTransform(repo, tx, { transferPeerId: reversePeer.id });
    }
  }, [tx, allTxs, reversePeer, repo]);

  // a settlement AFTER the bulk offer armed rewrote the attribution —
  // the offer's premise is stale, retire it (user rule)
  const reimbNow = tx ? totalReimbursedCents(tx) + givenOut : 0;
  useEffect(() => {
    if (bulkOffer && reimbNow !== bulkArmedReimbRef.current) setBulkOffer(null);
  }, [reimbNow, bulkOffer]);

  // display-currency lens: the headline converts at THIS day's fixing
  const { fmt, ensureDates } = useDisplayMoney();
  const txDate = tx?.date;
  useEffect(() => {
    if (txDate) ensureDates([txDate]);
  }, [txDate, ensureDates]);

  if (!tx)
    return <div className="h-full" data-testid="screen-tx-detail" />;

  const netCents = tx.amountCents > 0 ? netCreditCents(tx, givenOut) : netAmountCents(tx);
  const headlineAmount = fmt(netCents, tx.currency, { sign: true, date: tx.date });

  const cat = cats.byId(tx.catId);
  const parent = cat.parentId ? cats.byId(cat.parentId) : undefined;
  const color = cat.color ?? parent?.color ?? 'var(--m-ink-3)';
  // R1: the row's own account stamps its type — the kind row locks
  const ownStamp = accountStamp(account?.type);
  const pairState = transferPairState(tx, effectivePeerId, linkedAccount);
  // the OTHER leg's side of a release — its own row clears in the same
  // write. The peer is fetched from the STORE when the live snapshot
  // hasn't emitted it yet (a slow liveQuery beat left the peer's
  // transferPeerId dangling — CI-only flake)
  // unpairing releases BOTH legs — one activity entry covers the action.
  // #237 r2: a reverse-only pair (a row or a part points HERE) releases
  // from this side too — the pointing side is what clears.
  const releasePair = () => {
    if (tx.transferPeerId) {
      void releasePeerLeg(store, repo, spaceId, tx, allTxs);
      void transform(tx, { transferPeerId: null as never }, 'txLink');
      return;
    }
    if (!reversePeer) return;
    if (reversePeer.transferPeerId === tx.id) {
      void writeTxTransform(repo, reversePeer, { transferPeerId: null as never });
    } else if (reversePeer.splits?.some((s) => s.transferPeerId === tx.id)) {
      void writeTxTransform(repo, reversePeer, {
        splits: reversePeer.splits.map((s) => (s.transferPeerId === tx.id ? { ...s, transferPeerId: undefined } : s)),
      });
    }
  };
  // #237 (user): unlinking asks first when there is something at stake —
  // a DEFAULT counter resets the whole story, munni's own generated leg
  // can be removed or kept; a picked/bank pair just releases
  const unpair = () => {
    // the deterministic id decides, not the (async) account row — a tap
    // racing the query must never route a default to the wrong question
    if (tx.linkedAccountId?.startsWith('defaultacct_')) setUnpairConfirm('default');
    else if (tx.transferPeerId === mirrorTxId(tx.id)) setUnpairConfirm('mint');
    else releasePair();
  };
  // #237 (user): the unpair question decides the GENERATED row's fate —
  // the source keeps its counterparty either way (that story ends via
  // "Remove counterparty"), so the create/pick doors return after.
  // Keep: the leg becomes an ordinary row on its account, its balance
  // effect stays; Remove: the leg tombstones and its balance refunds.
  const keepGeneratedLeg = async () => {
    const mirror = await store.get('transaction', tx.transferPeerId!);
    if (mirror?.deleted === 0) {
      await writeTxTransform(repo, mirror, { linkedAccountId: null as never, transferPeerId: null as never });
    }
    await transform(tx, { transferPeerId: null as never }, 'txLink');
  };
  const removeGeneratedLeg = async () => {
    await removeMirrorForDeletedSource(store, repo, tx, tx.linkedAccountId);
    await transform(tx, { transferPeerId: null as never }, 'txLink');
  };
  // #237: point the pair at a row that already exists on the counter side
  const pairWithPicked = async (pickedTxId: string) => {
    await transform(tx, { transferPeerId: pickedTxId }, 'txLink');
    await pairWithExistingRow(store, repo, spaceId, tx, pickedTxId, allTxs);
    // #268: a standing bulk offer upgrades — the anchor now points at a
    // SPECIFIC row, so applying must queue per-sibling counter picks
    setBulkOffer((offer) =>
      offer?.link && offer.link.accountId === tx.linkedAccountId ? { ...offer, link: { ...offer.link, viaPeer: true } } : offer,
    );
  };
  // #221: a DEFAULT account's ledger is system-managed — its rows (the
  // minted mirror legs and balance adjustments) are read-only; they are
  // managed from the ORIGIN transaction, or by adjusting the balance
  const onDefaultLedger = !!account?.defaultFor;
  // a credit that self-filed as Reimbursed keeps that category as long
  // as any link lives (user rule) — unlink first, then recategorize
  const categoryLocked = (tx.catId === REIMBURSED_ID && givenOut > 0) || onDefaultLedger;
  // the recurring OWNS the category (user rule 2026-07-28): a linked row
  // only picks between the recurring's category and expected
  // reimbursement — the editor's picker enforces it
  const recurringAllowedCats = recurringCatConstraint(tx, recurrings);

  // #126 r4: the split's parts (the settled Reimbursed slice is
  // bookkeeping, not a part) — with a real split the container steps
  // back and the parts carry the stories
  const parts = (tx.splits ?? []).filter((s) => s.catId !== REIMBURSED_ID);
  const settledSlices = (tx.splits ?? []).filter((s) => s.catId === REIMBURSED_ID);
  const multiPart = parts.length > 1;
  const activeEventsList = (events ?? []).filter((e) => e.archived !== 1);
  const activeRecsList = (recurrings ?? []).filter((r) => r.active === 1);
  // the completion stage: values Done stages; Apply writes once whole
  const stageComplete = stagedSplitComplete(splitStage);
  const unsplitFallbackCat = primaryCatId(parts) ?? tx.catId ?? UNCATEGORIZED_ID;
  const openValuesEditor = () => setSplitOpen(true);
  // r7 (user rule): splitting RESETS the transaction's own story — a
  // filled row gets a conscious warning before the split flow opens
  const requestSplit = () => {
    const hasStory =
      !!tx.notes || !!tx.eventId || !!tx.recurringId || !!tx.cats?.length ||
      (!!tx.catId && tx.catId !== UNCATEGORIZED_ID);
    if (hasStory) setSplitResetOpen(true);
    else openValuesEditor();
  };
  // #211: two features, two doors — the categories pencil opens the
  // SPLIT-CATEGORIES editor on a whole row (a container routes into the
  // manage flow; its parts own the categories)
  const openCategoriesEditor = multiPart ? openValuesEditor : () => setCatsOpen(true);
  const splitDoorMode = splitDoorModeFor(multiPart, categoryLocked);
  const applyStagedSplit = () => {
    if (!splitStage) return;
    if (!stageComplete) {
      // r7: a refused Apply POINTS at the parts that hold it back
      setApplyAttention(true);
      return;
    }
    // the stage lands in ONE write — settled value rides along untouched.
    // r7: the container's own story RESETS as the split lands (parts
    // carry it now); explicit nulls — an undefined would drop from the
    // op and leave stale values behind (LWW)
    void transform(tx, {
      splits: [...splitStage, ...settledSlices],
      catId: primaryCatId(splitStage) ?? tx.catId,
      // #211: a container owns no category spread — the explicit null
      // also VERSION-STAMPS the row (its cats fieldVersion tells fresh
      // devices these splits are real parts, never legacy slices)
      cats: null as never,
      // #260: landing a split IS the review decision for this row
      needsReview: 0,
      ...(tx.notes ? { notes: '' } : {}),
      ...(tx.eventId ? { eventId: null as never } : {}),
      ...(tx.recurringId ? { recurringId: null as never } : {}),
    });
    armSplitBulk(splitStage); // #141: offer the partition to the siblings
    setApplyAttention(false);
    setSplitStage(null);
    setCompleteOpen(false);
  };
  // the settled value a container holds: legacy pseudo-slices plus the
  // parts' own bookkeeping (#228: the settle lives ON the parts)
  const partsSettledCents =
    settledSlices.reduce((sum, s) => sum + s.amountCents, 0) +
    parts.reduce((sum, part) => sum + reimbursedInCats(part.cats), 0);
  const unsplitTo = (catId: string) => {
    setSplitStage(null);
    // #201 (user): removing the split retires the armed bulk offers —
    // a bar selling the deleted partition (or its spread) is stale
    setSplitBulk(null);
    setCatsBulk(null);
    setBulkOffer(null);
    writeUnsplit(transform, tx, unsplitFallbackCat, partsSettledCents, catId);
  };

  // #211: ONE category on a whole row rewrites its partition — a spread
  // clears (or, settled, re-forms around the pick); legacy splits clear
  const settledPartitionCents =
    settledSlices.reduce((sum, s) => sum + s.amountCents, 0) +
    (tx.cats ?? []).filter((e) => e.catId === REIMBURSED_ID).reduce((sum, e) => sum + e.amountCents, 0);
  const singleCatFields = (catId: string) => singleCatPartitionFields(tx, multiPart, settledPartitionCents, catId);
  // #220: the bank's counterparty is ALWAYS a Details fact now — no
  // derivation gates; the row itself decides how it renders

  // the editor answered any ◆ ask already — this only writes
  const applySingleEntry = (entry: CatsApplyEntry) =>
    void writeRowSingleEntry(
      {
        tx, cats, store, repo, spaceId, transform, allTxs, reimbNow, bulkArmedReimbRef, singleCatFields,
        setSplitBulk, setCatsBulk, setBulkOffer, setBulkSelected,
      },
      entry,
    );

  // #228: the property row's picker — the answered account's KIND names
  // the category (the bijection's re-pick rule: doors overwrite
  // deliberately); a stamped row forces its movement sub instead
  const applyCounterPick = (picked: { id: string; type: AccountRow['type'] }, peer?: { txId: string }) =>
    applySingleEntry({
      catId: (ownStamp ? stampMovementSub(ownStamp, tx.amountCents) : undefined) ?? movementCatFor(picked.type, tx.amountCents),
      amountCents: Math.abs(tx.amountCents),
      linkedAccountId: picked.id,
      ...(peer ? { transferPeerId: peer.txId } : {}),
    });
  // #228 (user): removing the counterparty RESETS the category — the
  // movement story and its account are one fact
  const removeCounter = () =>
    applySingleEntry({ catId: UNCATEGORIZED_ID, amountCents: Math.abs(tx.amountCents) });

  // #141: a stored split arms the sibling offer (the staged Apply lands here)
  const armSplitBulk = (stored: TxSplit[]) => {
    const similar = splitBulkTargets(allTxs, tx, stored);
    setBulkOffer(null);
    setCatsBulk(null);
    setSplitBulk(similar.length > 0 ? stored : null);
    setSplitSelected(new Set(similar.map((item) => item.id)));
  };
  const splitTargets = splitBulk ? splitBulkTargets(allTxs, tx, splitBulk) : [];
  const applySplitBulk = async () => {
    if (!splitBulk) return;
    const picked = splitTargets.filter((target) => splitSelected.has(target.id));
    const n = await writeSplitBulk(transform, () => repo.newId(), splitBulk, picked);
    if (n > 0) void logActivity(store, repo, spaceId, 'txCategory', `${txTitle(tx)} +${n}`);
    setSplitBulk(null);
  };

  // #211 + #141: a landed category spread offers itself to the plain
  // same-merchant siblings the same way a split does
  const armCatsBulk = (entries: TxSplitCat[]) => {
    const similar = catsBulkTargets(allTxs, tx, entries);
    setBulkOffer(null);
    setSplitBulk(null);
    setCatsBulk(similar.length > 0 ? entries : null);
    setCatsSelected(new Set(similar.map((item) => item.id)));
  };
  const catsTargets = catsBulk ? catsBulkTargets(allTxs, tx, catsBulk) : [];
  const applyCatsBulk = async () => {
    if (!catsBulk) return;
    const picked = catsTargets.filter((target) => catsSelected.has(target.id));
    const n = await writeCatsBulk(transform, catsBulk, picked);
    if (n > 0) void logActivity(store, repo, spaceId, 'txCategory', `${txTitle(tx)} +${n}`);
    setCatsBulk(null);
  };

  const bulkTargets = catBulkTargets(allTxs, tx, bulkOffer);

  /** rename: '' clears the override (LWW needs the explicit value) */
  const renameTitle = (raw: string) => {
    const title = raw.trim();
    const next = title && title !== cleanBankText(tx.merchant) ? title : '';
    void transform(tx, { titleOverride: next });
    const similar = similarTo(allTxs, tx, (item) => (item.titleOverride ?? '') !== next);
    setTitleBulk(next && similar.length > 0 ? { title: next } : null);
    setTitleSelected(new Set(similar.map((item) => item.id)));
  };

  const titleTargets = titleBulkTargets(allTxs, tx, titleBulk);

  const applyTitleBulk = async () => {
    if (!titleBulk) return;
    const picked = titleTargets.filter((target) => titleSelected.has(target.id));
    // one history line for the whole bulk, not one per sibling
    for (const item of picked) await transform(item, { titleOverride: titleBulk.title }, null);
    if (picked.length) void logActivity(store, repo, spaceId, 'txEdit', `${txTitle(tx)} +${picked.length}`);
    setTitleBulk(null);
  };

  const applyBulk = async () => {
    if (!bulkOffer) return;
    const picked = bulkTargets.filter((target) => bulkSelected.has(target.id));
    // #268 (user): a SPECIFIC counter pick cannot be copied — each
    // sibling asks for its own counter row (or links and waits)
    if (bulkOffer.link?.viaPeer && picked.length > 0) {
      setCounterBulk({ items: picked, catId: bulkOffer.catId, txType: bulkOffer.txType, accountId: bulkOffer.link.accountId });
      setBulkOffer(null);
      return;
    }
    // one history line for the whole bulk, not one per sibling — a plain
    // account link rides along (each sibling links and waits, #268)
    for (const item of picked) {
      await transform(
        item,
        {
          catId: bulkOffer.catId,
          txType: bulkOffer.txType,
          needsReview: 0,
          ...(bulkOffer.link ? { linkedAccountId: bulkOffer.link.accountId } : {}),
        },
        null,
      );
    }
    if (picked.length) void logActivity(store, repo, spaceId, 'txCategory', `${txTitle(tx)} +${picked.length}`);
    setBulkOffer(null);
  };

  // #268: one queue step — the sibling gets the category, the link and
  // (on a pick) its own peer, exactly like the anchor's single write
  const resolveCounterBulk = async (item: SpaceTx, peerId: string | null) => {
    if (!counterBulk) return;
    if (item.transferPeerId) void releasePeerLeg(store, repo, spaceId, item, allTxs);
    await transform(
      item,
      {
        catId: counterBulk.catId,
        txType: counterBulk.txType,
        needsReview: 0,
        linkedAccountId: counterBulk.accountId as never,
        ...(peerId ? { transferPeerId: peerId } : {}),
      },
      null,
    );
    if (peerId) await pairWithExistingRow(store, repo, spaceId, item, peerId, allTxs);
  };
  const saveNotes = (notes: string) => {
    if (notes === (tx.notes ?? '')) return;
    void transform(tx, { notes }, null); // 'note' is the richer line
    void logActivity(store, repo, spaceId, 'note', txTitle(tx));
  };

  // two-tap confirm, matching the app's other destructive rows
  const deleteManualTx = async () => {
    await deleteManualTxRow(store, repo, spaceId, tx, account);
    void navigate({ to: backTo });
  };

  const fmtDay = new Intl.DateTimeFormat(DATE_FMT[lang], { weekday: 'long', day: 'numeric', month: 'long' });

  // #126 r4: ?part=<id> shows ONE part as its own transaction page
  const partView = findPartView(parts, partParam);
  // r9: the part's label is editable from its page — the rename sheet
  // doubles for it (derive + write + props live at module level, S3776)
  const partDefault = derivedPartLabel(tx, parts, partView, t);
  const savePartLabel = (raw: string): void => writePartLabel(transform, tx, partView, partDefault, raw);
  const renameProps = renameSheetProps(tx, partView, partDefault, savePartLabel, renameTitle);
  const screenTitle = detailScreenTitle(tx, parts, partView, t);
  // #221: a default-ledger row offers NO edit door at all — no pencil,
  // no rename; the origin transaction (or the balance edit) is the hand
  const trailingAction = onDefaultLedger
    ? undefined
    : detailTrailingAction(!!partView, tx.importRef, t, () => setRenameOpen(true), () => setEditOpen(true));
  // the values editor edits the STAGE when one exists, else the stored
  // parts; classic mode stays uncontrolled
  const editorValue = valuesEditorValue(splitStage, multiPart, parts);

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-tx-detail">
      <AppBar
        title={screenTitle}
        leading={
          <DetailBackButton panes={panes} onClose={() => void navigate({ to: backTo, replace: true })} t={t} />
        }
        trailing={trailingAction}
      />
      {!tx.importRef && <TxFormSheet open={editOpen} onOpenChange={setEditOpen} tx={tx} />}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {partView ? (
          <PartDetailBody
            key={partView.id}
            tx={tx}
            part={partView}
            parts={parts}
            accountName={account?.name}
            ownStamp={!!ownStamp}
            activeEvents={activeEventsList}
            allowedCatIds={recurringAllowedCats}
            onManageSplits={openValuesEditor}
          />
        ) : (
          <>
        <div className="flex flex-col items-center py-6 text-center">
          {/* both directions show the net truth: expenses minus what came
              back, credits minus what they refunded elsewhere */}
          <div className="m-num text-4xl text-ink" data-testid="tx-detail-amount">
            {headlineAmount}
          </div>
          <div className="mt-1 text-sm text-ink-3">
            {fmtDay.format(new Date(tx.date))}
            {tx.time ? ` · ${tx.time}` : ''}
          </div>
          {/* converted headline (display-currency lens): the recorded truth
              stays one line below — a detail screen must never hide it */}
          {headlineAmount.startsWith('≈') && (
            <div className="m-num mt-0.5 text-[13px] text-ink-4" data-testid="tx-detail-recorded-amount">
              {fmtCents(netCents, tx.currency, lang, { sign: true })}
            </div>
          )}
          {tx.pending === 1 && (
            <div className="mt-2" data-testid="tx-detail-pending">
              <Pill tone="warning">{t('tx.pendingBadge')}</Pill>
            </div>
          )}
        </div>

        {/* title bulk: right under the header so a rename's reach is
            the first thing on screen */}
        {titleBulk && (
          <div className="mb-3 overflow-hidden rounded-card border border-line bg-surface" data-testid="tx-detail-title-bulk">
            <DetailBulkBar
              targets={titleTargets}
              selected={titleSelected}
              onChange={setTitleSelected}
              onApply={() => void applyTitleBulk()}
              onDismiss={() => setTitleBulk(null)}
            />
          </div>
        )}

        {/* block: account + the counterparty property (#228: back on the
            transaction — one per (split) tx) + the transfer pair facts */}
        <DetailAccountBlock
          tx={tx}
          account={account}
          linkedAccount={linkedAccount}
          pairState={pairState}
          peer={resolvedPeer ? pairPeerFace(resolvedPeer, t) : undefined}
          peerAccountName={peerAccount?.deleted === 0 ? peerAccount.name : undefined}
          loanCountBusy={loanCountBusy}
          setLoanCountBusy={setLoanCountBusy}
          // #255 r4: the tap lands on the RESOLVED leg — the peer row,
          // or its exact part page; unresolvable = no jump at all (the
          // blind jump rendered an empty detail, the reported glitch)
          onOpenPeer={
            resolvedPeer
              ? () =>
                  void navigate({
                    to: '/transactions/$txId',
                    params: { txId: resolvedPeer.nav.txId },
                    ...(resolvedPeer.nav.part ? { search: { part: resolvedPeer.nav.part } } : {}),
                  })
              : undefined
          }
          onUnpair={onDefaultLedger ? undefined : unpair}
          // #265 (user): a recurring-narrowed row's counter door STAYS
          // open — a fully inert row left funding picks unescapable; the
          // sheet's detach is the way out (it resets the category too)
          onEditCounter={
            multiPart || onDefaultLedger || tx.adjustment === 1 || tx.txType === 'adjustment'
              ? undefined
              : () => setCounterPickOpen(true)
          }
          onPickCounterpart={onDefaultLedger ? undefined : () => setMatchOpen(true)}
        />

        {/* block: categories — ONE edit affordance for the whole block
            (user: a pencil per slice read wrong); rows stay tappable.
            r9: on a container the block lists PARTS, and says so */}
        <CategoriesHeader
          locked={categoryLocked}
          lockLabel={onDefaultLedger ? t('tx.defaultLedgerLocked') : undefined}
          byRecurring={!!recurringAllowedCats}
          multiPart={multiPart}
          onEdit={openCategoriesEditor}
        />
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="tx-detail-categories">
          <CategorySlices
            tx={tx}
            cats={cats}
            fallbackCat={cat}
            fallbackColor={color}
            // #328 (user): locked = no door — undefined drops the chevron
            onEdit={categoryLocked ? undefined : openCategoriesEditor}
            onOpenPart={(id) =>
              void navigate({ to: '/transactions/$txId', params: { txId: tx.id }, search: { part: id } })
            }
          />
          {bulkOffer && (
            <DetailBulkBar
              targets={bulkTargets}
              selected={bulkSelected}
              onChange={setBulkSelected}
              onApply={() => void applyBulk()}
              onDismiss={() => setBulkOffer(null)}
            />
          )}
          {/* #141: the landed split offers itself to the splitless
              siblings — same bar, resized per row on apply */}
          {!bulkOffer && splitBulk && (
            <DetailBulkBar
              targets={splitTargets}
              selected={splitSelected}
              onChange={setSplitSelected}
              onApply={() => void applySplitBulk()}
              onDismiss={() => setSplitBulk(null)}
            />
          )}
          {/* #211: a landed category spread rides the same offer */}
          {!bulkOffer && !splitBulk && catsBulk && (
            <DetailBulkBar
              targets={catsTargets}
              selected={catsSelected}
              onChange={setCatsSelected}
              onApply={() => void applyCatsBulk()}
              onDismiss={() => setCatsBulk(null)}
            />
          )}
        </div>

        {/* everything below the categories card follows the space's saved
            order/visibility (#232: actions and the facts card joined the
            registry — same mechanics as Home). r7/r9: a container carries
            no notes/reimbursements/receipts — the parts do. #221: a
            default-ledger row carries none either. Actions and facts run
            for every row, gated only by their own content. */}
        {resolveTxDetailBlocks(space)
          .filter((entry) => !entry.hidden)
          .map((entry) => {
            const attachable = !multiPart && !onDefaultLedger;
            const section: Record<TxDetailBlockId, ReactNode> = {
              // #213 (user): the split door leads the actions, out of the
              // categories card; recurring + event links follow (expense,
              // non-container rows only — r7: parts own their links)
              actions: (
                <DetailActionsCard
                  tx={tx}
                  multiPart={multiPart}
                  splitDoorMode={splitDoorMode}
                  recurrings={recurrings}
                  events={events}
                  onSplitDoor={splitDoorMode === 'row' ? requestSplit : openValuesEditor}
                  onOpenRecurring={() => setRecurringOpen(true)}
                  onOpenEvent={() => setEventOpen(true)}
                />
              ),
              facts: (
                <DetailFacts
                  tx={tx}
                  givenOut={givenOut}
                  counterAccountName={counterAccount?.name}
                  onOpenCounterAccount={() => setCounterOpen(true)}
                />
              ),
              reimburse: attachable ? <ReimburseSection tx={tx} /> : null,
              receipts: attachable ? <ReceiptSection tx={tx} /> : null,
              notes: attachable ? (
                <>
                  <div className="m-cap mt-5 mb-1 px-1">{t('tx.notes')}</div>
                  <NotesField
                    value={tx.notes ?? ''}
                    onSave={saveNotes}
                    placeholder={t('tx.notesPlaceholder')}
                    className="w-full resize-none rounded-card border border-line bg-surface px-4 py-3 text-[14px] text-ink outline-none placeholder:text-ink-4"
                  />
                </>
              ) : null,
            };
            return <div key={entry.id}>{section[entry.id]}</div>;
          })}

        {/* #232: actions/facts are customizable on every row now — the
            door stays on containers too; a read-only DEFAULT-ledger row
            keeps none of its doors (#221) */}
        {!onDefaultLedger && (
          <button
            data-testid="tx-detail-customize"
            onClick={() => void navigate({ to: '/tx-customize' })}
            className="m-tap mt-5 flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-line bg-transparent py-2.5 text-[13px] font-medium text-ink-3"
          >
            <Icon name="tune-variant" size={16} />
            {t('tx.customize')}
          </button>
        )}

        {/* manual rows may leave again (user request); bank rows are the
            bank's truth and only ever tombstone via their feed. #221: a
            default-ledger row leaves only with its ORIGIN (the link) or
            by a counter-adjustment — never by hand */}
        {!tx.importRef && !tx.feedSpaceId && !onDefaultLedger && (
          <button
            data-testid="tx-detail-delete"
            onClick={() => setConfirmDelete(true)}
            className="m-tap mt-6 w-full rounded-card border border-line bg-surface px-4 py-3 text-center text-[14px] font-medium text-negative"
          >
            {t('tx.deleteManual')}
          </button>
        )}
          </>
        )}
      </div>

      {/* the aligned danger confirm — no cooldown: one transaction is a
          low-stakes delete (user ruling) */}
      <DangerConfirmSheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('tx.deleteManual')}
        body={t('tx.deleteManualBody', { name: txTitle(tx) })}
        cooldown={0}
        onConfirm={() => void deleteManualTx()}
        testId="tx-delete"
      />

      {/* #228: the transaction-level counterparty picker — the property
          row's door. The current category narrows the account kinds (the
          bijection); the detach row resets the category with the link */}
      <CounterpartySheet
        open={counterPickOpen}
        onOpenChange={setCounterPickOpen}
        excludeAccountId={tx.accountId}
        currentLinkedId={tx.linkedAccountId}
        defaultFamily={!ownStamp && tx.catId && specialCatType(tx.catId) ? (defaultFamilyFor(tx.catId) ?? undefined) : undefined}
        counterTypes={tx.catId && specialCatType(tx.catId) ? counterTypesFor(tx.catId) : undefined}
        anchor={{ id: tx.id, amountCents: tx.amountCents, date: tx.date }}
        onChoose={(picked, peer) => applyCounterPick(picked, peer)}
        onDetach={tx.linkedAccountId ? removeCounter : undefined}
      />
      {/* #237: point the existing link at the row already on the counter
          side — same-sign wallet rows included (user decision "a") */}
      {linkedAccount && (
        <CounterMatchSheet
          open={matchOpen}
          onOpenChange={setMatchOpen}
          target={{ id: linkedAccount.id, name: linkedAccount.name }}
          anchor={{ id: tx.id, amountCents: tx.amountCents, date: tx.date }}
          rows={allTxs ?? []}
          onPick={(pickedTxId) => void pairWithPicked(pickedTxId)}
        />
      )}
      {/* #268 (user): a bulk apply born from a specific counter pick —
          every sibling matches its own counter row in turn */}
      {counterBulk && (
        <BulkCounterQueue
          queue={counterBulk.items}
          target={{ id: counterBulk.accountId, name: linkedAccount?.id === counterBulk.accountId ? linkedAccount.name : '' }}
          rows={allTxs ?? []}
          onResolve={(item, peerId) => void resolveCounterBulk(item as SpaceTx, peerId)}
          onDone={(resolved) => {
            if (resolved > 0) void logActivity(store, repo, spaceId, 'txCategory', `${txTitle(tx)} +${resolved}`);
            setCounterBulk(null);
          }}
        />
      )}
      {/* #237 (user): unlinking a DEFAULT counter resets the story — say
          so before doing it */}
      <DangerConfirmSheet
        open={unpairConfirm === 'default'}
        onOpenChange={(next) => {
          if (!next) setUnpairConfirm(null);
        }}
        title={t('tx.unlinkDefaultTitle')}
        body={t('tx.unlinkDefaultBody')}
        confirmLabel={t('tx.unlinkContinue')}
        cooldown={0}
        onConfirm={() => {
          setUnpairConfirm(null);
          removeCounter();
        }}
        testId="tx-unlink-default"
      />
      {/* #237 (user): munni generated the other leg — removing the link
          asks what happens to it */}
      <Sheet
        open={unpairConfirm === 'mint'}
        onOpenChange={(next) => {
          if (!next) setUnpairConfirm(null);
        }}
        title={t('tx.unpairMintTitle')}
        size="form"
      >
        <div className="flex flex-col gap-3 pt-1" data-testid="tx-unpair-mint">
          <p className="text-[14px] leading-relaxed text-ink-2">
            {t('tx.unpairMintBody', { name: linkedAccount?.name ?? '' })}
          </p>
          <Button
            data-testid="tx-unpair-remove"
            onClick={() => {
              setUnpairConfirm(null);
              void removeGeneratedLeg();
            }}
          >
            {t('tx.unpairRemove')}
          </Button>
          <Button
            variant="ghost"
            data-testid="tx-unpair-keep"
            onClick={() => {
              setUnpairConfirm(null);
              void keepGeneratedLeg();
            }}
          >
            {t('tx.unpairKeep')}
          </Button>
        </div>
      </Sheet>
      {/* #211: the split-TRANSACTION flow — the values editor whose Done
          only STAGES; nothing is written until the completion deck's
          Apply lands the whole split */}
      <DetailSplitSheets
        tx={tx}
        splitOpen={splitOpen}
        setSplitOpen={setSplitOpen}
        editorValue={editorValue}
        // #289 (user): parts are independent — the whole-row recurring
        // constraint must not narrow them (the split resets the link)
        allowedCatIds={undefined}
        unsplitTo={unsplitTo}
        unsplitFallbackCat={unsplitFallbackCat}
        splitStage={splitStage}
        setSplitStage={setSplitStage}
        completeOpen={completeOpen}
        setCompleteOpen={setCompleteOpen}
        activeEvents={activeEventsList}
        lockedKind={!!ownStamp}
        recurrings={activeRecsList}
        attention={applyAttention}
        openValuesEditor={openValuesEditor}
        applyStagedSplit={applyStagedSplit}
      />
      {/* #211: the split-CATEGORIES editor — the pencil's door. One entry
          is a plain category pick (bulk offer intact); several land the
          row's own spread in one write. #228: a lone ◆ pick asks its
          counterparty INSIDE the editor — the transaction-level answer.
          A settled `reimbursed` entry is held aside and re-attached. */}
      <CatsSheet
        open={catsOpen}
        onOpenChange={setCatsOpen}
        subject={{
          id: tx.id,
          label: txTitle(tx),
          catId: tx.catId,
          // #228 feedback: the FULL partition rides in — the sheet pins
          // the settled bookkeeping read-only and nets the gross itself
          cats: tx.cats?.length ? tx.cats : undefined,
          amountCents: Math.abs(tx.amountCents),
          linkedAccountId: tx.linkedAccountId,
          transferPeerId: tx.transferPeerId,
        }}
        currency={tx.currency}
        direction={tx.amountCents < 0 ? 'debit' : 'credit'}
        txType={tx.txType}
        allowedCatIds={recurringAllowedCats}
        title={t('split.catsTitle')}
        includePct
        excludeAccountId={tx.accountId}
        askDisabled={!!ownStamp}
        anchor={{ id: tx.id, date: tx.date }}
        onApply={(entries) =>
          applyRowCats({ tx, settledCents: settledPartitionCents, transform, applySingle: applySingleEntry, armCatsBulk }, entries)
        }
      />
      {/* r7 (user rule): splitting resets the transaction's own story —
          a conscious continue, never a silent drop */}
      <Sheet open={splitResetOpen} onOpenChange={setSplitResetOpen} title={t('split.resetWarnTitle')} size="compact">
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-[13px] leading-relaxed text-ink-2">{t('split.resetWarnBody')}</p>
          <Button
            data-testid="split-reset-continue"
            onClick={() => {
              setSplitResetOpen(false);
              openValuesEditor();
            }}
          >
            {t('split.resetContinue')}
          </Button>
          <Button variant="outline" data-testid="split-reset-cancel" onClick={() => setSplitResetOpen(false)}>
            {t('action.cancel')}
          </Button>
        </div>
      </Sheet>
      <RenameTitleSheet open={renameOpen} onOpenChange={setRenameOpen} {...renameProps} />

      {/* the counterparty is one of the user's own accounts — show it */}
      <Sheet open={counterOpen && !!counterAccount} onOpenChange={setCounterOpen} title={counterAccount?.name ?? ''} size="compact">
        {counterAccount && (
          <div className="flex flex-col pt-1" data-testid="counterparty-sheet">
            <div className="flex items-center justify-between border-b border-line-2 px-1 py-3 text-[14px]">
              <span className="text-ink-3">{t('tx.counterparty')}</span>
              <span className="font-mono text-[13px] text-ink">{counterAccount.iban}</span>
            </div>
            <div className="flex items-center justify-between border-b border-line-2 px-1 py-3 text-[14px]">
              <span className="text-ink-3">{t('acct.balanceNow')}</span>
              <span className="m-num text-ink">{fmtCents(counterAccount.balanceCents, counterAccount.currency, lang)}</span>
            </div>
            <div className="flex items-center justify-between px-1 py-3 text-[14px]">
              <span className="text-ink-3">{t('tx.counterpartySource')}</span>
              <span className="text-ink">{t(counterAccount.source === 'manual' ? 'acct.manual' : 'acct.automated')}</span>
            </div>
          </div>
        )}
      </Sheet>

      {/* attach to an event */}
      <Sheet open={eventOpen} onOpenChange={setEventOpen} title={t('events.linkTitle')} size="form" dragHandle>
        <div className="pt-1" data-testid="tx-event-list">
          <button
            data-testid="tx-event-none"
            onClick={() => {
              void transform(tx, { eventId: '' }, 'txLink');
              setEventOpen(false);
            }}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink-2"
          >
            <Icon name="close-circle-outline" size={18} color="var(--m-ink-4)" />
            <span className="min-w-0 flex-1 truncate">{t('events.linkNone')}</span>
            {!tx.eventId && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
          </button>
          {(events ?? [])
            .filter((e) => e.archived !== 1)
            .map((e) => (
              <button
                key={e.id}
                data-testid={`tx-event-${e.id}`}
                onClick={() => {
                  void transform(tx, { eventId: e.id }, 'txLink');
                  setEventOpen(false);
                }}
                className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink last:border-0"
              >
                <Icon name={e.icon ?? 'party-popper'} size={18} color="var(--m-accent-deep)" />
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {tx.eventId === e.id && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
              </button>
            ))}
          <button
            data-testid="tx-event-create"
            onClick={() => {
              setEventCreating(true);
              setEventOpen(false);
            }}
            className="m-tap flex w-full items-center gap-3 border-t border-line-2 px-1 py-3 text-left text-[14px] font-medium text-accent-deep"
          >
            <Icon name="plus" size={18} />
            {t('events.new')}
          </button>
        </div>
      </Sheet>
      {/* create-and-return: the fresh event auto-links to this tx */}
      {eventCreating && (
        <EventFormSheet
          initial="new"
          onSaved={(id) => void transform(tx, { eventId: id }, 'txLink')}
          onClose={() => setEventCreating(false)}
        />
      )}

      {/* attach to a recurring cost */}
      <Sheet open={recurringOpen} onOpenChange={setRecurringOpen} title={t('recurring.linkTitle')} size="form" dragHandle>
        <div className="pt-1" data-testid="tx-recurring-list">
          <button
            data-testid="tx-recurring-none"
            onClick={() => {
              void recurringOps.linkTx(tx, '');
              setRecurringOpen(false);
            }}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink-2"
          >
            <Icon name="close-circle-outline" size={18} color="var(--m-ink-4)" />
            <span className="min-w-0 flex-1 truncate">{t('recurring.linkNone')}</span>
            {!tx.recurringId && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
          </button>
          {(recurrings ?? [])
            .filter((r) => r.active === 1)
            .map((r) => (
              <button
                key={r.id}
                data-testid={`tx-recurring-${r.id}`}
                onClick={() => {
                  void recurringOps.linkTx(tx, r.id);
                  setRecurringOpen(false);
                }}
                className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink last:border-0"
              >
                <RecurringVisual rec={r} size={18} active={false} />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="m-num text-[12px] text-ink-4">{fmtCents(r.amountCents, tx.currency, lang)}</span>
                {tx.recurringId === r.id && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
              </button>
            ))}
          <button
            data-testid="tx-recurring-create"
            onClick={() => {
              setRecCreating(true);
              setRecurringOpen(false);
            }}
            className="m-tap flex w-full items-center gap-3 border-t border-line-2 px-1 py-3 text-left text-[14px] font-medium text-accent-deep"
          >
            <Icon name="plus" size={18} />
            {t('recurring.add')}
          </button>
        </div>
      </Sheet>
      {/* create-and-return: prefilled from THIS transaction, auto-links */}
      {recCreating && (
        <RecurringFormSheet
          initial={formFromTx(tx)}
          onSaved={(id) => void recurringOps.linkTx(tx, id)}
          onClose={() => setRecCreating(false)}
        />
      )}
    </div>
  );
}

/**
 * Notes editor that stays live in shared spaces: remote edits replace
 * the draft whenever this user is not actively typing in the field.
 */
function NotesField({
  value,
  onSave,
  placeholder,
  className,
}: Readonly<{
  value: string;
  onSave: (notes: string) => void;
  placeholder: string;
  className: string;
}>) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      ref={ref}
      data-testid="tx-detail-notes"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onSave(draft)}
      placeholder={placeholder}
      rows={3}
      className={className}
    />
  );
}

/** the counterparty row: a live door when the IBAN matches an own
 * account, otherwise EDITABLE (user remark: CAMT rows often ship
 * without one — picking an own account still works and suggests the
 * type through the same sheet as the type row) */
/** a recurring-linked row's category allowlist: the recurring's own
 *  category plus expected reimbursement (S3776: extracted) */
function recurringCatConstraint(
  tx: { recurringId?: string },
  recurrings: { id: string; catId?: string }[] | undefined,
): string[] | undefined {
  const rec = tx.recurringId ? recurrings?.find((r) => r.id === tx.recurringId) : undefined;
  return rec?.catId ? [rec.catId, EXPECTED_REIMBURSE_ID] : undefined;
}

/** the categories caption: one Edit for the block — or a lock while a
 *  reimbursement owns the attribution (user rule; S3776: extracted).
 *  r9: on a split container the rows are PARTS, so the caption says
 *  "Split transactions", not "Categories". */
function CategoriesHeader({
  locked,
  lockLabel,
  byRecurring,
  multiPart,
  onEdit,
}: Readonly<{ locked: boolean; lockLabel?: string; byRecurring?: boolean; multiPart?: boolean; onEdit: () => void }>) {
  const { t } = useLang();
  return (
    <div className="m-cap mt-5 mb-1 flex items-center justify-between px-1">
      <span>
        {t(multiPart ? 'split.partsSection' : 'screen.categories')}
        {/* informational, not a hard lock: Edit still opens the editor,
            whose picker only offers the recurring's category and
            expected reimbursement (user rule 2026-07-28) */}
        {byRecurring && !locked && (
          <span className="pl-2 font-normal text-ink-4" data-testid="tx-detail-cats-recurring">
            {t('tx.setByRecurring')}
          </span>
        )}
      </span>
      {locked && (
        <span className="flex items-center gap-1 text-[11px] text-ink-4" data-testid="tx-detail-cats-locked">
          <Icon name="lock-outline" size={12} />
          {lockLabel ?? t('reimb.categoryLocked')}
        </span>
      )}
      {/* #200: on a container the Edit pencil is gone — Manage splits
          below is the one door; a whole transaction keeps it */}
      {!locked && !multiPart && (
        <button
          data-testid="tx-detail-cats-edit"
          aria-label={t('action.edit')}
          onClick={onEdit}
          className="m-tap flex items-center gap-1 border-none bg-transparent text-[11px] font-semibold text-accent-deep"
        >
          <Icon name="pencil-outline" size={13} />
          {t('action.edit')}
        </button>
      )}
    </div>
  );
}

