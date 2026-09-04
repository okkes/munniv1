import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useSpaceTransactions, useTxTransform } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { buildSpaceMerchantMemory } from '@/application/prediction';
import { useRecurringOps, useRecurrings } from '@/application/recurring';
import { useEvents } from '@/application/events';
import { EventFormSheet } from '@/features/events/EventsScreen';
import { RecurringFormSheet, formFromTx } from '@/features/recurring/RecurringFormSheet';
import { merchantKey } from '@/domain/merchantKey';
import { draftReady, initDraft, withBareType, withCategory, withKind, withLinkedAccount, withSplits, withType } from '@/domain/reviewDraft';
import { kindOf, standardTypeFor } from '@/domain/txKind';
import { EXPECTED_REIMBURSE_ID } from '@/domain/categories';
import { Collapse } from '@/ui/Collapse';
import type { TxKind } from '@/domain/txKind';
import { normalizeIban } from '@/domain/feedIds';
import { isPaypalAccount, isPaypalFunding } from '@/domain/paypal';
import { hapticNotify } from '@/lib/platform';
import { TxRow } from '@/ui/TxRow';
import { fetchSettlementCandidates } from '@/features/splits/settlementCandidates';
import type { SettlementCandidate } from '@/features/splits/settlementCandidates';
import { useSession } from '@/app/session';
import type { ReviewDraft } from '@/domain/reviewDraft';
import type { AccountType, RecurringRow, TxType } from '@/db/types';
import { resolveSplitsFor, splitsArePct } from '@/domain/splits';
import { predictTx } from '@/domain/predictCategory';
import { recurringAmountMatches } from '@/domain/recurring';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { logActivity } from '@/application/activity';
import { catName, useCategories } from '@/features/categories/useCategories';
import { fmtCents } from '@/lib/money';
import { cleanBankText, txTitle } from '@/lib/text';
import { HelpButton } from '@/features/help/HelpButton';
import { IntroCard } from '@/features/help/IntroCard';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { SplitEditorSheet } from '@/features/transactions/SplitEditorSheet';
import { RecurringVisual, cadenceLabel } from '@/features/recurring/RecurringVisual';
import { TX_TYPE_VISUAL } from '@/features/transactions/TxTypeSheet';
import { CounterpartySheet, TX_KIND_VISUAL, TxKindSheet, kindDetail } from '@/features/transactions/TxKindSheet';

/** one grouped-context row inside the category editor (counterparty,
 *  type) — the card-row anatomy in the sheet's input skin */
/** why the shown category was suggested, per prediction source */
const REASON_KEYS = {
  history: 'review.reasonHistory',
  'history-amount': 'review.reasonAmount',
  keyword: 'review.reasonKeyword',
} as const;

/** render-time reset when the card underneath changes (prev-id ref pattern) */
function useFreshCardReset(txId: string | undefined, reset: () => void) {
  const lastTxId = useRef(txId);
  if (txId !== lastTxId.current) {
    lastTxId.current = txId;
    reset();
  }
}

/** progress bar + "n / total" sub line — skips count as handled too */
function progressState(initial: number | null, queueLen: number | undefined, skippedCount: number) {
  const total = initial ?? 1;
  const confirmed = initial === null ? 0 : Math.max(0, initial - (queueLen ?? 0));
  const done = confirmed + skippedCount;
  return {
    progress: initial ? done / initial : 0,
    sub: (queueLen ?? 0) > 0 ? `${Math.min(done + 1, total)} / ${total}` : undefined,
  };
}

/** the draft's value, an explicit null to clear a tx that had one, or nothing */
function replacing<K extends string, T>(key: K, next: T | undefined, had: boolean): Partial<Record<K, T>> {
  if (next !== undefined) return { [key]: next } as Partial<Record<K, T>>;
  // explicit null clears the synced field (undefined would be dropped)
  return had ? ({ [key]: null } as unknown as Partial<Record<K, T>>) : {};
}

/** one confirm: the whole DRAFT lands in one write (+ the bulk selection) */
async function writeConfirmation(args: {
  tx: SpaceTx;
  draft: ReviewDraft;
  recurringId: string | undefined;
  eventId: string | undefined;
  bulk: SpaceTx[];
  transform: ReturnType<typeof useTxTransform>;
}): Promise<void> {
  const { draft } = args;
  // draft-cleared fields on a tx that HAD them need an explicit null
  const splitsField = replacing('splits', draft.splits?.length ? draft.splits : undefined, !!args.tx.splits?.length);
  const linkField = replacing('linkedAccountId', draft.linkedAccountId, !!args.tx.linkedAccountId);
  await args.transform(args.tx, {
    catId: draft.catId,
    txType: draft.txType,
    needsReview: 0,
    ...splitsField,
    ...linkField,
    ...(args.recurringId ? { recurringId: args.recurringId } : {}),
    ...(args.eventId ? { eventId: args.eventId } : {}),
  }, null); // confirm logs its own richer 'review' line (with bulk count)
  for (const item of args.bulk) {
    await args.transform(item, bulkFieldsFor(item, draft, args.recurringId, args.eventId), null);
  }
}

/** the WHOLE decision rides to every selected sibling (user rule):
 *  category, type, counterparty, recurring, event. Absolute splits fit
 *  exact twins by the similar-rule, pct splits rescale per item — and
 *  sign-bound standard types re-derive by the sibling's OWN sign (the
 *  similar filter already keeps signs together; this guards any path
 *  that doesn't). */
function bulkFieldsFor(item: SpaceTx, draft: ReviewDraft, recurringId: string | undefined, eventId: string | undefined) {
  const splits = draft.splits?.length ? resolveSplitsFor(item.amountCents, draft.splits) : undefined;
  const siblingType = kindOf(draft.txType) === 'standard' ? standardTypeFor(item.amountCents) : draft.txType;
  return {
    catId: draft.catId,
    txType: siblingType,
    needsReview: 0 as const,
    ...(splits ? { splits } : {}),
    ...(draft.linkedAccountId ? { linkedAccountId: draft.linkedAccountId } : {}),
    ...(recurringId ? { recurringId } : {}),
    ...(eventId ? { eventId } : {}),
  };
}

/** "also apply to n similar": a compact summary row on the card; the full
 *  list lives in a Sheet so long histories never squeeze the card
 *  (user request), with per-row read-only detail expansion */
/** transfers carry no spending category — the hidden 'uncategorized'
 * builtin keeps the confirm armed (settle-match chip) */
function stageAsTransfer(draft: ReviewDraft, cats: ReturnType<typeof useCategories>): ReviewDraft {
  const next = withType(draft, 'transfer', cats);
  return next.catId ? next : withCategory(next, 'uncategorized', cats);
}

/** a kind pick keeps the confirm armed the way transfers always did:
 *  the hidden 'uncategorized' builtin backs category-less kinds */
function stageKind(
  draft: ReviewDraft,
  kind: TxKind,
  amountCents: number,
  cats: ReturnType<typeof useCategories>,
): ReviewDraft {
  const next = withKind(draft, kind, amountCents, cats);
  if (kind !== 'standard' && !next.catId) return withCategory(next, 'uncategorized', cats);
  return next;
}

/** the counterparty row's face: dimmed n/a, the account, or the bare
 *  label — counterless is legal now (arc 2's exit), so no warning cry */
function counterRowLabel(kind: TxKind, name: string | undefined, t: ReturnType<typeof useLang>['t']): string {
  if (kind !== 'transfer') return t('tx.counterNotApplicable');
  return name ?? t('tx.counterNone');
}

/** the card's kind + counterparty rows (S3776: out of the main screen);
 *  the counterparty is a transfer concept — other kinds show it dimmed */
function CardKindRows({
  kind,
  detail,
  counterName,
  onKind,
  onCounter,
}: Readonly<{
  kind: TxKind;
  detail: TxType | null;
  counterName: string | undefined;
  onKind: () => void;
  onCounter: () => void;
}>) {
  const { t } = useLang();
  const isTransfer = kind === 'transfer';
  return (
    <>
      <button
        data-testid="review-kind-row"
        onClick={onKind}
        className="m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] text-ink"
      >
        <Icon name={TX_KIND_VISUAL[kind].icon} size={18} color={TX_KIND_VISUAL[kind].color} />
        <span className="min-w-0 flex-1 truncate">
          {t(`tx.kind.${kind}`)}
          {detail && <span className="text-[12px] font-normal text-ink-4"> · {t(`tx.type.${detail}`)}</span>}
        </span>
        <span className="text-[11px] text-ink-4">{t('tx.kindTitle')}</span>
        <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
      </button>
      {/* fields show only when they MEAN something: the counterparty
          eases in when Transfer is picked instead of sitting disabled
          on every card (user redesign 2026-07-28) */}
      <Collapse open={isTransfer}>
        <button
          data-testid="review-counter-row"
          onClick={onCounter}
          className="m-tap m-fade flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] text-ink"
        >
          <Icon name="bank-transfer" size={18} color="var(--m-ink-3)" />
          <span className="min-w-0 flex-1 truncate">{counterRowLabel(kind, counterName, t)}</span>
          <span className="text-[11px] text-ink-4">{t('tx.counterparty')}</span>
          <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
        </button>
      </Collapse>
    </>
  );
}

/** own-account counterparty pre-applies the link + suggested type; the
 * hidden 'uncategorized' builtin keeps the confirm armed for transfers */
function applyOwnCounterDefault(
  baseDraft: ReviewDraft | null,
  ownCounter: { id: string; type: AccountType } | undefined,
  cats: ReturnType<typeof useCategories>,
  amountCents: number,
): ReviewDraft | null {
  if (!baseDraft || !ownCounter || baseDraft.linkedAccountId) return baseDraft;
  const linked = withLinkedAccount(baseDraft, { id: ownCounter.id, type: ownCounter.type }, cats, amountCents);
  return linked.catId ? linked : withCategory(linked, 'uncategorized', cats);
}

/** the bulk sheet's read-only transaction peek: (almost) the detail
 * screen's facts — amount, date, category, type, account, counterparty,
 * bank text — without any of its edit affordances (user request) */
function BulkTxPeek({ tx }: Readonly<{ tx: SpaceTx }>) {
  const { t, lang } = useLang();
  const cats = useCategories();
  const { store } = useData();
  const account = useQuery(store, async () => store.get('account', tx.accountId), [tx.accountId]);
  const cat = cats.byId(tx.catId);
  const catColor = cat.color ?? cats.byId(cat.parentId ?? '').color;
  const factRow = (label: string, value: string, icon: string, color?: string) => (
    <div className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0">
      <Icon name={icon} size={18} color={color ?? 'var(--m-ink-3)'} />
      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{value}</span>
      <span className="text-xs text-ink-4">{label}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-3 pt-1" data-testid="review-bulk-detail">
      <div className="m-num text-center text-[26px] text-ink">
        {fmtCents(tx.amountCents, tx.currency, lang, { sign: true })}
      </div>
      <p className="text-center text-[12px] text-ink-4">
        {new Date(tx.date).toLocaleDateString(LOCALES[lang], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {factRow(t('screen.categories'), catName(cat, t), cat.icon, catColor)}
        {factRow(t('tx.type'), t(`tx.type.${tx.txType}`), TX_TYPE_VISUAL[tx.txType].icon, TX_TYPE_VISUAL[tx.txType].color)}
        {account && factRow(t('txform.account'), account.name, 'bank-outline')}
        {tx.counterIban && factRow(t('tx.counterparty'), tx.counterIban, 'swap-horizontal')}
      </div>
      {tx.description && (
        <p className="rounded-xl bg-bg-2 px-3 py-2.5 font-mono text-[11px] break-words text-ink-3">
          {cleanBankText(tx.description)}
        </p>
      )}
    </div>
  );
}

function BulkConfirmSection({
  similar,
  selected,
  onChange,
}: Readonly<{ similar: SpaceTx[]; selected: ReadonlySet<string>; onChange: (next: ReadonlySet<string>) => void }>) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  if (similar.length === 0) return null;

  const all = similar.every((s) => selected.has(s.id));
  const detail = detailId ? similar.find((s) => s.id === detailId) : undefined;
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="mt-3 overflow-hidden rounded-card border border-line bg-surface" data-testid="review-bulk">
      {/* the WHOLE bar opens the sheet (user request); the checkbox is
          the one carve-out — two sibling buttons, no nesting */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          data-testid="review-bulk-toggle"
          aria-label={t('review.alsoApply', { n: similar.length })}
          onClick={() => onChange(all ? new Set() : new Set(similar.map((s) => s.id)))}
          className={`m-tap flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
            all ? 'border-accent bg-accent text-white' : 'border-line bg-surface'
          }`}
        >
          {all && <Icon name="check" size={12} />}
        </button>
        <button
          data-testid="review-bulk-expand"
          onClick={() => setOpen(true)}
          className="m-tap flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent p-0 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{t('review.alsoApply', { n: selected.size })}</span>
          <span className="flex items-center gap-1 text-[12px] text-ink-3">
            {t('review.bulkViewAll')}
            <Icon name="chevron-right" size={15} />
          </span>
        </button>
      </div>

      {/* near-max-height sheet styled like the transactions list (user
          redesign): TxRow rows with a checkbox rail, select/unselect all,
          and a row tap opens a compact READ-ONLY detail as a stacked sheet */}
      <Sheet open={open} onOpenChange={setOpen} title={t('review.alsoApply', { n: selected.size })} height={760} dragHandle>
        <div className="flex items-center justify-between pb-2">
          <span className="text-[12px] text-ink-3">{t('review.bulkCount', { n: similar.length })}</span>
          <button
            data-testid="review-bulk-select-all"
            onClick={() => onChange(all ? new Set() : new Set(similar.map((s) => s.id)))}
            className="m-tap border-none bg-transparent text-[12px] font-semibold text-accent-deep"
          >
            {all ? t('review.bulkUnselectAll') : t('review.bulkSelectAll')}
          </button>
        </div>
        {/* fixed px so the list scrolls INSIDE the sheet (sheet rules) */}
        <div className="max-h-[620px] overflow-y-auto overscroll-contain" data-testid="review-bulk-list">
          {similar.map((item) => {
            const checked = selected.has(item.id);
            return (
              <div key={item.id} className="flex items-center gap-2 border-b border-line-2 last:border-0">
                <button
                  data-testid={`review-bulk-${item.id}`}
                  aria-label={cleanBankText(item.merchant)}
                  onClick={() => toggleOne(item.id)}
                  className={`m-tap flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                    checked ? 'border-accent bg-accent text-white' : 'border-line bg-surface'
                  }`}
                >
                  {checked && <Icon name="check" size={12} />}
                </button>
                <div className="min-w-0 flex-1" data-testid={`review-bulk-open-${item.id}`}>
                  {/* every row here is unreviewed by definition — the badge is noise */}
                  <TxRow tx={item} showDate hideUnreviewed onClick={() => setDetailId(item.id)} />
                </div>
              </div>
            );
          })}
        </div>
      </Sheet>

      {/* read-only peek — taller now (user request), still clearly SHORTER
          than the list sheet so its top edge stays visible against the
          parent behind it (the stacked-sheet cue) */}
      <Sheet
        open={detailId !== null}
        onOpenChange={(next) => !next && setDetailId(null)}
        title={detail ? cleanBankText(detail.merchant) : ''}
        height={600}
      >
        {detail && <BulkTxPeek tx={detail} />}
      </Sheet>
    </div>
  );
}

/**
 * The card's link row below categories: for a loan/mortgage counterparty
 * it names WHICH debt the transfer pays (a payoff is a debt payment, not
 * a recurring cost — user request 2026-07-29); otherwise the editable
 * recurring link with its price-delta warning.
 */
function DebtOrRecurringRow({
  isLoanCounter,
  payingDebt,
  recMatch,
  linkRecurring,
  manualRec,
  amountCents,
  currency,
  onEdit,
}: Readonly<{
  isLoanCounter: boolean;
  payingDebt: { name: string } | undefined;
  recMatch: RecurringRow | undefined;
  linkRecurring: boolean;
  manualRec: RecurringRow | undefined;
  amountCents: number;
  currency: string;
  onEdit: () => void;
}>) {
  const { t, lang } = useLang();
  if (isLoanCounter) {
    return (
      <div data-testid="review-debt-row" className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[14px] text-ink">
        <Icon name="hand-coin-outline" size={18} color="var(--m-ink-3)" />
        {/* v2: the counterparty account IS the loan — name it directly */}
        <span className="min-w-0 flex-1 truncate">{payingDebt?.name}</span>
        <span className="text-[11px] text-ink-4">{t('review.debtRow')}</span>
      </div>
    );
  }
  const delta = recMatch ? Math.abs(Math.abs(amountCents) - recMatch.amountCents) : 0;
  return (
    <>
      <button
        data-testid="review-recurring-row"
        onClick={onEdit}
        className="m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] text-ink"
      >
        <Icon name="autorenew" size={18} color="var(--m-ink-3)" />
        <span className="min-w-0 flex-1 truncate">{recurringRowLabel(recMatch, linkRecurring, manualRec, t)}</span>
        <span className="text-[11px] text-ink-4">{t('recurring.linkTitle')}</span>
        <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
      </button>
      {recMatch && linkRecurring && delta >= 50 && (
        <div className="flex items-center gap-1 px-4 pb-1 text-[11px] text-warning" data-testid="review-rec-delta">
          <Icon name={Math.abs(amountCents) > recMatch.amountCents ? 'trending-up' : 'trending-down'} size={12} />
          {t(Math.abs(amountCents) > recMatch.amountCents ? 'review.recDeltaMore' : 'review.recDeltaLess', {
            amount: fmtCents(delta, currency, lang),
          })}
        </div>
      )}
    </>
  );
}

/** the recurring row's display label: linked name or "None" */
function recurringRowLabel(
  recMatch: RecurringRow | undefined,
  linkRecurring: boolean,
  manualRec: RecurringRow | undefined,
  t: ReturnType<typeof useLang>['t'],
): string {
  const linked = recMatch && linkRecurring ? recMatch : manualRec;
  if (!chosenRecurringId(recMatch, linkRecurring, manualRec?.id ?? null)) return t('recurring.linkNone');
  return linked?.name ?? t('recurring.linkTitle');
}

/** which recurring the confirm links: the auto-match wins (unless the
 *  user un-ticked it); otherwise whatever was picked by hand */
function chosenRecurringId(recMatch: RecurringRow | undefined, linkRecurring: boolean, manualRecId: string | null): string | undefined {
  if (recMatch) return linkRecurring ? recMatch.id : undefined;
  return manualRecId ?? undefined;
}

/** stacked picker for the manual recurring link: every active recurring
 *  plus an explicit "no link" row (user request — auto-detection alone
 *  missed renamed merchants) */
function RecurringPickSheet({
  open,
  onOpenChange,
  recurrings,
  selectedId,
  currency,
  onPick,
  onCreate,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recurrings: RecurringRow[];
  selectedId: string | null;
  currency: string;
  onPick: (id: string | null) => void;
  /** create-and-return door: opens the recurring form, auto-attaches */
  onCreate: () => void;
}>) {
  const { t, lang } = useLang();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('review.linkRecurringPick')} size="form" dragHandle>
      <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="recpick-list">
        <button
          data-testid="recpick-none"
          onClick={() => onPick(null)}
          className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3 text-left"
        >
          <Icon name="close-circle-outline" size={18} color="var(--m-ink-4)" />
          <span className="min-w-0 flex-1 text-[14px] text-ink-2">{t('review.recNone')}</span>
          {!selectedId && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
        </button>
        {recurrings.map((rec) => (
          <button
            key={rec.id}
            data-testid={`recpick-${rec.id}`}
            onClick={() => onPick(rec.id)}
            className="m-tap flex w-full items-center gap-3 border-t border-line-2 px-4 py-3 text-left"
          >
            <RecurringVisual rec={rec} size={18} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-ink">{rec.name}</span>
              <span className="block text-[11px] text-ink-4">{cadenceLabel(rec, t)}</span>
            </span>
            <span className="m-num text-[13px] text-ink-2">{fmtCents(rec.amountCents, currency, lang)}</span>
            {selectedId === rec.id && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
          </button>
        ))}
        <button
          data-testid="recpick-create"
          onClick={onCreate}
          className="m-tap flex w-full items-center gap-3 border-t border-line-2 px-4 py-3 text-left text-[14px] font-medium text-accent-deep"
        >
          <Icon name="plus" size={18} />
          {t('recurring.add')}
        </button>
      </div>
    </Sheet>
  );
}

/** v2: the loan/mortgage counterparty IS the debt being paid (S3776:
 *  the branch lives out of the component) */
const loanCounterOf = (counter: { type: string; name: string } | undefined): { name: string } | undefined =>
  counter && ['loan', 'mortgage'].includes(counter.type) ? { name: counter.name } : undefined;

/**
 * Review queue, rebuilt around the legacy mechanics with a calmer face:
 * one card at a time, the prediction pre-applied WITH its reason, bulk
 * confirm for similar transactions (same merchant; same amount too once
 * split), type/counter-account and splits via the shared sheets, a
 * recurring-cost link offer, and a skip pile at the end.
 */
export function ReviewScreen() {
  const { t, lang } = useLang();
  const { store, repo, spaceId } = useData();
  const cats = useCategories();
  const allTxs = useSpaceTransactions();
  const transform = useTxTransform();
  const recurrings = useRecurrings();
  const recurringOps = useRecurringOps();

  const [splitOpen, setSplitOpen] = useState(false);
  // kind + counterparty rows live ON the card now (user simplification);
  // a user-picked transfer REQUIRES a counterparty, so dismissing the
  // picker without choosing rolls the kind back to what it was
  const [kindOpen, setKindOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const counterFallback = useRef<ReviewDraft | null>(null);
  const counterChosen = useRef(false);
  // per-visit only (user ruling): mid-review side steps happen in sheets
  // that keep the screen mounted, so state survives those — but leaving
  // review and coming back later starts the deck from the top again
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  // the card's STAGED decision (review redesign): user edits live here,
  // only Confirm writes; null = untouched, follow tx + prediction live
  const [stagedDraft, setStagedDraft] = useState<ReviewDraft | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<ReadonlySet<string>>(new Set());
  // deck animation (user request): keep the outgoing card's markup as a
  // ghost that flies out left while the next card slides in from the right
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [leavingHtml, setLeavingHtml] = useState<string | null>(null);
  const captureLeaving = () => {
    if (!cardRef.current) return;
    // strip testids so the decorative ghost never doubles a live element
    setLeavingHtml(cardRef.current.innerHTML.replaceAll(/data-testid="[^"]*"/g, ''));
    setTimeout(() => setLeavingHtml(null), 260);
  };
  const [linkRecurring, setLinkRecurring] = useState(true);
  // no auto-match? the user can still link a recurring by hand (user request)
  const [manualRecId, setManualRecId] = useState<string | null>(null);
  const [recPickOpen, setRecPickOpen] = useState(false);
  // events join the review card (user redesign): staged, written on confirm
  const [eventPick, setEventPick] = useState<string | null>(null);
  const [eventPickOpen, setEventPickOpen] = useState(false);
  // create-and-return doors: snapshot ids, diff on close, auto-attach
  const [recCreating, setRecCreating] = useState(false);
  const [eventCreating, setEventCreating] = useState(false);
  const [initialCount, setInitialCount] = useState<number | null>(null);

  // teaching data: what this space (or the user's personal spaces) confirmed before
  const memory = useQuery(store, async () => buildSpaceMerchantMemory(store, spaceId), [spaceId]);

  const queue = useMemo(
    // oldest first (user request): work through the backlog chronologically
    () => allTxs?.filter((item) => item.needsReview === 1).sort((a, b) => a.date.localeCompare(b.date)),
    [allTxs],
  );
  useEffect(() => {
    if (queue && initialCount === null) setInitialCount(queue.length || 1);
  }, [queue, initialCount]);

  const remaining = useMemo(() => queue?.filter((item) => !skipped.has(item.id)), [queue, skipped]);
  const tx = remaining?.[0];

  const prediction = useMemo(
    () => (tx && memory ? predictTx({ memory, merchant: tx.merchant, titleOverride: tx.titleOverride, description: tx.description, amountCents: tx.amountCents }) : null),
    [tx, memory],
  );

  // counterparty IBAN belonging to one of MY OWN accounts = money moving
  // between my accounts — a transfer by definition, pre-applied (user
  // report: credit-card top-ups showed up as expense + income pairs)
  // the funding account, named on the card (user request)
  const cardAccount = useQuery(store, async () => (tx ? store.get('account', tx.accountId) : undefined), [tx?.accountId]);
  const ownCounter = useQuery(
    store,
    async () => {
      const accounts = await store.allRows('account');
      const iban = tx?.counterIban ? normalizeIban(tx.counterIban) : undefined;
      const byIban = iban
        ? accounts.find((a) => a.deleted === 0 && !!a.iban && normalizeIban(a.iban) === iban)
        : undefined;
      if (byIban) return byIban;
      // PP1 rung 3: a PayPal-funding debit defaults to the PayPal account
      // (shared collection IBAN never matches — the name pattern does)
      if (tx && tx.amountCents < 0 && isPaypalFunding(tx)) {
        return accounts.find((a) => a.deleted === 0 && isPaypalAccount(a));
      }
      return undefined;
    },
    [tx?.counterIban, tx?.id],
  );

  // untouched cards follow the tx + the (async) prediction live
  const baseDraft = tx ? initDraft(tx, prediction?.catId, cats) : null;
  const ownTransferDraft = useMemo(
    () => applyOwnCounterDefault(baseDraft, ownCounter, cats, tx?.amountCents ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tx?.id, ownCounter, prediction?.catId, cats],
  );
  const draft = stagedDraft ?? ownTransferDraft;
  const draftCounter = useQuery(
    store,
    async () => (draft?.linkedAccountId ? store.get('account', draft.linkedAccountId) : undefined),
    [draft?.linkedAccountId],
  );
  // a loan/mortgage counterparty makes this a DEBT payment: the account
  // IS the loan (v2), so the card names the counterparty itself and
  // retires the recurring row — a payoff transfer is not a recurring
  // cost (user request 2026-07-29)
  const payingDebt = loanCounterOf(draftCounter);
  const isLoanCounter = payingDebt !== undefined;
  const events = useEvents();
  const activeEvents = useMemo(() => (events ?? []).filter((e) => e.archived !== 1), [events]);
  const pickedEvent = activeEvents.find((e) => e.id === eventPick);
  const cat = cats.byId(draft?.catId);
  const parentColor = cat.parentId ? cats.byId(cat.parentId).color : cat.color;

  const recMatch = useMemo(
    () =>
      tx
        ? recurrings?.find(
            (r) =>
              r.active === 1 &&
              !!r.merchantKey &&
              r.merchantKey === merchantKey(tx.merchant) &&
              recurringAmountMatches(r, tx.amountCents),
          )
        : undefined,
    [tx, recurrings],
  );
  const activeRecs = useMemo(() => (recurrings ?? []).filter((r) => r.active === 1), [recurrings]);
  const manualRec = activeRecs.find((r) => r.id === manualRecId);

  // SP5: an incoming amount that exactly matches an open split settlement
  // to me is very likely that person paying me back — suggest transfer
  const identity = useSession((s) => s.identity);
  const [settlements, setSettlements] = useState<SettlementCandidate[]>([]);
  useEffect(() => {
    if (identity?.kind !== 'user') return;
    void fetchSettlementCandidates().then(setSettlements);
  }, [identity]);
  const settleMatch = useMemo(
    () => (tx && tx.amountCents > 0 ? settlements.find((c) => c.cents === tx.amountCents) : undefined),
    [tx, settlements],
  );

  // bulk rule: plain confirm reaches every same-merchant item; absolute
  // splits only fit exact twins (same amount), percentage splits scale
  // to any amount so the whole merchant group stays eligible
  const draftSplits = draft?.splits;
  const similar = useMemo(() => {
    if (!tx || !queue) return [] as SpaceTx[];
    const key = merchantKey(tx.merchant);
    const mustMatchAmount = !!draftSplits?.length && !splitsArePct(draftSplits);
    // skipped cards left the deck on purpose — bulk must not drag them
    // back in (user request: the count follows the visible queue)
    return queue.filter(
      (item) =>
        item.id !== tx.id &&
        !skipped.has(item.id) &&
        // decisions are sign-bound (income vs expense, reimbursement
        // side): a -€1000 sibling must never inherit a "received
        // reimbursement" decision made on +€1000 (user ss 2026-07-28)
        Math.sign(item.amountCents) === Math.sign(tx.amountCents) &&
        merchantKey(item.merchant) === key &&
        (!mustMatchAmount || item.amountCents === tx.amountCents),
    );
  }, [tx, queue, draftSplits, skipped]);

  // fresh card: reset the staged draft and offer the link. This runs
  // DURING render (previous-id ref pattern), not in an effect — a late
  // effect flush could undo user input that landed right after the card
  // swap (a real race under coverage instrumentation)
  useFreshCardReset(tx?.id, () => {
    setStagedDraft(null);
    setLinkRecurring(true);
    setManualRecId(null);
    setEventPick(null);
    setDescExpanded(false);
  });
  // select every similar item by default. Keyed on MEMBERSHIP, not array
  // identity: the native SQL backend re-emits unchanged rows every sync
  // cycle, and an identity-keyed reset kept re-arming boxes the user had
  // just cleared (iOS ss 2026-07-28). When a sync genuinely changes the
  // list mid-card, new arrivals join checked and the user's unchecks
  // survive — the visible count stays honest either way.
  const similarKey = useMemo(() => similar.map((s) => s.id).sort((a, b) => a.localeCompare(b)).join(','), [similar]);
  const prevSimilarIds = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const ids = similarKey ? similarKey.split(',') : [];
    const prev = prevSimilarIds.current;
    prevSimilarIds.current = new Set(ids);
    setBulkSelected((sel) => new Set(ids.filter((id) => (prev.has(id) ? sel.has(id) : true))));
  }, [similarKey]);

  // the recurring OWNS the category (user rule 2026-07-28): linking one
  // stages its category once, and the editor then only offers that
  // category or expected reimbursement (the one allowed override)
  const chosenRec = useMemo(() => {
    if (isLoanCounter) return undefined; // debt payments never carry a recurring link
    const id = chosenRecurringId(recMatch, linkRecurring, manualRecId);
    return id ? (recurrings ?? []).find((r) => r.id === id) : undefined;
  }, [recMatch, linkRecurring, manualRecId, recurrings, isLoanCounter]);
  useEffect(() => {
    if (!chosenRec?.catId || !draft) return;
    if (draft.catId === chosenRec.catId || draft.catId === EXPECTED_REIMBURSE_ID) return;
    setStagedDraft(withCategory(withSplits(draft, undefined), chosenRec.catId, cats));
    // once per selection — the pick itself is the trigger, not the draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenRec?.id, chosenRec?.catId]);
  const recurringAllowedCats = chosenRec?.catId ? [chosenRec.catId, EXPECTED_REIMBURSE_ID] : undefined;

  const draftKind: TxKind = draft ? kindOf(draft.txType) : 'standard';
  const draftKindDetail = draft ? kindDetail(draft.txType) : null;
  const showReason = !!tx && !stagedDraft && prediction?.catId === draft?.catId;
  const reasonLine =
    showReason && prediction ? t(REASON_KEYS[prediction.source], { n: prediction.evidence ?? 1 }) : null;

  const confirm = async () => {
    captureLeaving();
    if (!tx || !draft || !draftReady(draft)) return;
    await writeConfirmation({
      tx,
      draft,
      recurringId: isLoanCounter ? undefined : chosenRecurringId(recMatch, linkRecurring, manualRecId),
      eventId: eventPick ?? undefined,
      bulk: similar.filter((s) => bulkSelected.has(s.id)),
      transform,
    });
    // other billing cycles of a linked recurring pick up their link here
    void recurringOps.reconcile().catch(() => undefined);
    const bulkN = similar.filter((s) => bulkSelected.has(s.id)).length;
    void logActivity(store, repo, spaceId, 'review', bulkN ? `${txTitle(tx)} +${bulkN}` : txTitle(tx));
    hapticNotify('SUCCESS'); // §5: a physical tick on the native shells
  };

  const { progress, sub } = progressState(initialCount, queue?.length, skipped.size);

  const emptyBecauseSkipped = queue && queue.length > 0 && remaining?.length === 0;

  // desktop affordances (D5): Enter confirms, ←/→ skips to the next card —
  // never while a sheet is open or the focus sits in an input
  useEffect(() => {
    if (!tx) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        void confirm();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        captureLeaving();
        setSkipped((prev) => new Set([...prev, tx.id]));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-review">
      <AppBar
        title={t('review.title')}
        sub={sub}
        leading={
          <IconButton label={t('action.back')} testId="review-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
        trailing={<HelpButton tourId="review" />}
      />
      {/* quiet progress line under the bar */}
      <div className="h-0.5 shrink-0 bg-bg-2">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6">
        {/* the first-time nudge must come BEFORE the user works the deck,
            not after it (user bug report) — it's one dismissible line and
            never returns once seen */}
        <IntroCard tourId="review" />
        {!tx && queue && !emptyBecauseSkipped && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center" data-testid="review-empty">
            <Icon name="check-circle-outline" size={48} color="var(--m-accent)" />
            <div className="m-h3 text-ink">{t('review.noTxs')}</div>
            <p className="max-w-[260px] text-sm text-ink-3">{t('review.noTxsSub')}</p>
          </div>
        )}
        {emptyBecauseSkipped && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center" data-testid="review-skipped-note">
            <Icon name="debug-step-over" size={40} color="var(--m-warning)" />
            <p className="max-w-[260px] text-sm text-ink-2">{t('review.skippedRemain', { n: skipped.size })}</p>
            <Button variant="outline" data-testid="review-reset-skipped" onClick={() => setSkipped(() => new Set())}>
              {t('review.reviewSkipped')}
            </Button>
          </div>
        )}
        {tx && (
          /* D3 focus layout: at lg the deck becomes a fixed 520px column,
             centered both ways (user: left-anchored read as broken); the
             pickers slide in as dimmed right-hand panels, so the card
             stays visible while editing. Skip/Confirm attach under the
             card instead of the far bottom. */
          <div className="relative flex min-h-0 flex-1 flex-col lg:mx-auto lg:my-auto lg:w-[520px] lg:flex-none lg:pb-10">
            {leavingHtml && (
              <div
                aria-hidden
                className="m-card-out pointer-events-none absolute inset-x-0 top-0 z-10"
                // our own just-rendered markup, snapshotted for the exit flight
                dangerouslySetInnerHTML={{ __html: leavingHtml }} // NOSONAR
              />
            )}
            <div key={`card-${tx.id}`} ref={cardRef} className="m-card-in">
            <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface" data-testid="review-card">
              {/* compact header (user: title + amount were too huge once
                  the card carries every editable row) */}
              <div className="px-4 pt-3 pb-2.5">
                <div className="text-[11px] text-ink-4" data-testid="review-card-meta">
                  {new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(tx.date))}
                  {cardAccount && <span> · {cardAccount.name}</span>}
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink">{txTitle(tx)}</span>
                  <span className="m-num shrink-0 text-[18px] text-ink">{fmtCents(tx.amountCents, tx.currency, lang, { sign: true })}</span>
                </div>
                {tx.description && (
                  // tap to read everything — the clamp sits on an INNER
                  // span (display on the button kills -webkit-box)
                  <button
                    data-testid="review-description"
                    aria-expanded={descExpanded}
                    onClick={() => setDescExpanded((v) => !v)}
                    className="m-tap mt-1 block w-full border-none bg-transparent p-0 text-left font-mono text-[11px] text-ink-4"
                  >
                    <span data-testid="review-description-text" className={descExpanded ? '' : 'line-clamp-2'}>
                      {cleanBankText(tx.description)}
                    </span>
                  </button>
                )}
              </div>
              <div className="mx-4 h-px bg-line-2" />

              {/* kind first (user simplification): WHAT this transaction
                  is, then the counterparty it involves — the split sheet
                  is pure categories now */}
              <div data-testid="review-cats">
                <CardKindRows
                  kind={draftKind}
                  detail={draftKindDetail}
                  counterName={draftCounter?.name}
                  onKind={() => setKindOpen(true)}
                  onCounter={() => {
                    counterFallback.current = null;
                    setCounterOpen(true);
                  }}
                />
                {(draft?.splits?.length ? draft.splits : [null]).map((slice) => {
                  const sliceCat = slice ? cats.byId(slice.catId) : cat;
                  const sliceColor = slice
                    ? (sliceCat.color ?? cats.byId(sliceCat.parentId ?? '').color)
                    : parentColor;
                  return (
                    <button
                      key={slice?.catId ?? 'single'}
                      data-testid={slice ? `review-cat-${slice.catId}` : 'review-category-chip'}
                      onClick={() => setSplitOpen(true)}
                      className="m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] font-medium text-ink"
                    >
                      <Icon name={sliceCat.icon} size={18} color={sliceColor ?? 'var(--m-ink-3)'} />
                      <span className="min-w-0 flex-1 truncate">
                        {slice || draft?.catId ? (
                          <>
                            {catName(sliceCat, t)}
                            {/* the parent gives the sub its context (user request) */}
                            {sliceCat.parentId && (
                              <span className="text-[12px] font-normal text-ink-4"> · {catName(cats.byId(sliceCat.parentId), t)}</span>
                            )}
                          </>
                        ) : (
                          t('review.pickPrompt')
                        )}
                      </span>
                      {slice && <span className="m-num text-[12px] text-ink-2">{fmtCents(slice.amountCents, tx.currency, lang)}</span>}
                      <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
                    </button>
                  );
                })}

                <DebtOrRecurringRow
                  isLoanCounter={isLoanCounter}
                  payingDebt={payingDebt}
                  recMatch={recMatch}
                  linkRecurring={linkRecurring}
                  manualRec={manualRec}
                  amountCents={tx.amountCents}
                  currency={tx.currency}
                  onEdit={() => setRecPickOpen(true)}
                />

                <button
                  data-testid="review-event-row"
                  onClick={() => setEventPickOpen(true)}
                  className="m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] text-ink"
                >
                  <Icon name="party-popper" size={18} color="var(--m-ink-3)" />
                  <span className="min-w-0 flex-1 truncate">{pickedEvent?.name ?? t('events.linkNone')}</span>
                  <span className="text-[11px] text-ink-4">{t('events.linkTitle')}</span>
                  <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
                </button>
              </div>

              {/* contextual offers keep their chip shape under the rows */}
              {ownCounter && draft?.linkedAccountId === ownCounter.id && (
                <div className="px-4 pb-3">
                  <Chip
                    testId="review-own-transfer"
                    selected
                    onClick={() => setStagedDraft(withLinkedAccount(draft, null, cats))}
                  >
                    <Icon name="swap-horizontal" size={13} />
                    {t('review.ownTransfer', { name: ownCounter.name })}
                  </Chip>
                </div>
              )}
              {settleMatch && draft && (
                <div className="px-4 pb-3">
                  <Chip
                    testId="review-settle-match"
                    selected={draft.txType === 'transfer'}
                    onClick={() => setStagedDraft(stageAsTransfer(draft, cats))}
                  >
                    <Icon name="handshake-outline" size={13} />
                    {t('review.settleMatch', {
                      name: settleMatch.fromName ?? t('review.settleSomeone'),
                      split: settleMatch.splitName,
                    })}
                  </Chip>
                </div>
              )}
            </div>

            <BulkConfirmSection similar={similar} selected={bulkSelected} onChange={setBulkSelected} />
            </div>

            {/* mobile: pinned to the thumb at the bottom; lg: attached to the card */}
            <div className="mt-auto flex gap-3 pt-4 lg:mt-0">
              <Button
                variant="outline"
                className="w-28"
                data-testid="review-skip-btn"
                onClick={() => {
                  captureLeaving();
                  setSkipped((prev) => new Set([...prev, tx.id]));
                }}
              >
                {t('review.skip')}
              </Button>
              <Button
                variant="primary"
                className="min-w-0 flex-1"
                data-testid="review-confirm-btn"
                disabled={!draft || !draftReady(draft)}
                onClick={() => void confirm()}
              >
                <span className="truncate">
                  {/* multi-category: the list above already says it all */}
                  {draft?.catId && !draft.splits?.length ? t('review.confirmAs', { name: catName(cat, t) }) : t('review.confirm')}
                </span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* the quick picker is gone (user redesign): every category edit
          goes through the unified split editor's per-row pickers */}
      {tx && draft && (
        <SplitEditorSheet
          open={splitOpen}
          onOpenChange={setSplitOpen}
          tx={tx}
          // empty value: the editor itself seeds "current category owns the
          // full amount + one fresh row" — exactly the add-category start
          value={draft.splits}
          txType={draft.txType}
          seedSingle
          seedCatId={draft.catId}
          onApply={(splits) => setStagedDraft(withSplits(draft, splits ?? undefined))}
          onApplySingle={(catId) => setStagedDraft(withCategory(withSplits(draft, undefined), catId, cats))}
          reason={reasonLine}
          allowedCatIds={recurringAllowedCats}
        />
      )}
      {tx && draft && (
        <TxKindSheet
          open={kindOpen}
          onOpenChange={setKindOpen}
          current={draftKind}
          allowAdjustment={!tx.importRef && !tx.feedSpaceId}
          onPick={(kind) => {
            const next = stageKind(draft, kind, tx.amountCents, cats);
            setStagedDraft(next);
            // a transfer is not complete without its counterparty —
            // open the picker right away, remember what to roll back to
            if (kind === 'transfer' && !next.linkedAccountId) {
              counterFallback.current = draft;
              setCounterOpen(true);
            }
          }}
        />
      )}
      {tx && draft && (
        <CounterpartySheet
          open={counterOpen}
          onOpenChange={(open) => {
            setCounterOpen(open);
            if (!open) {
              // dismissed without a pick: a user-chosen transfer rolls
              // back — an unlinked transfer is unrepresentable
              if (!counterChosen.current && counterFallback.current) setStagedDraft(counterFallback.current);
              counterFallback.current = null;
              counterChosen.current = false;
            }
          }}
          excludeAccountId={tx.accountId}
          currentLinkedId={draft.linkedAccountId}
          onChoose={(account) => {
            counterChosen.current = true;
            setStagedDraft(withLinkedAccount(draft, account, cats, tx?.amountCents));
          }}
          // the bare label COMPLETES the transfer intent (arc 2) — the
          // roll-back guard treats it exactly like an account pick
          onBare={(type) => {
            counterChosen.current = true;
            setStagedDraft(withBareType(draft, type, tx.amountCents, cats));
          }}
        />
      )}
      {tx && (
        <RecurringPickSheet
          open={recPickOpen}
          onOpenChange={setRecPickOpen}
          recurrings={activeRecs}
          selectedId={chosenRecurringId(recMatch, linkRecurring, manualRecId) ?? null}
          currency={tx.currency}
          onPick={(id) => {
            // the auto-match keeps its toggle semantics: picking it re-arms
            // the link, "no link" disarms; anything else is a manual pick
            if (id !== null && id === recMatch?.id) {
              setLinkRecurring(true);
              setManualRecId(null);
            } else {
              if (recMatch) setLinkRecurring(false);
              setManualRecId(id);
            }
            setRecPickOpen(false);
          }}
          onCreate={() => {
            setRecCreating(true);
            setRecPickOpen(false);
          }}
        />
      )}
      {/* create-and-return: a fresh recurring auto-attaches to this card,
          prefilled from the transaction itself (user request). onSaved
          carries the id — sniffing the live-query list after close was a
          lost race, which is why "create" never actually attached */}
      {recCreating && tx && (
        <RecurringFormSheet
          initial={formFromTx(tx)}
          onSaved={(id) => {
            if (recMatch) setLinkRecurring(false);
            setManualRecId(id);
          }}
          onClose={() => setRecCreating(false)}
        />
      )}
      {tx && (
        <Sheet open={eventPickOpen} onOpenChange={setEventPickOpen} title={t('events.linkTitle')} size="form" dragHandle>
          <div className="pt-1" data-testid="review-event-list">
            <button
              data-testid="review-event-none"
              onClick={() => {
                setEventPick(null);
                setEventPickOpen(false);
              }}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink-2"
            >
              <Icon name="close-circle-outline" size={18} color="var(--m-ink-4)" />
              <span className="min-w-0 flex-1 truncate">{t('events.linkNone')}</span>
              {!eventPick && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
            </button>
            {activeEvents.map((event) => (
              <button
                key={event.id}
                data-testid={`review-event-${event.id}`}
                onClick={() => {
                  setEventPick(event.id);
                  setEventPickOpen(false);
                }}
                className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink"
              >
                <Icon name={event.icon ?? 'party-popper'} size={18} color="var(--m-accent-deep)" />
                <span className="min-w-0 flex-1 truncate">{event.name}</span>
                {eventPick === event.id && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
              </button>
            ))}
            <button
              data-testid="review-event-create"
              onClick={() => {
                setEventCreating(true);
                setEventPickOpen(false);
              }}
              className="m-tap flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] font-medium text-accent-deep"
            >
              <Icon name="plus" size={18} />
              {t('events.new')}
            </button>
          </div>
        </Sheet>
      )}
      {eventCreating && (
        <EventFormSheet
          initial="new"
          onSaved={(id) => setEventPick(id)}
          onClose={() => setEventCreating(false)}
        />
      )}
    </div>
  );
}
