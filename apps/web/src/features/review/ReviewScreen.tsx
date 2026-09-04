import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@/db/useQuery';
import { useSpaceAccounts, useSpaceTransactions, useTxTransform } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { buildSpaceMerchantMemory } from '@/application/prediction';
import { useRecurringOps, useRecurrings } from '@/application/recurring';
import { useEvents } from '@/application/events';
import { EventFormSheet } from '@/features/events/EventsScreen';
import { RecurringFormSheet, formFromTx } from '@/features/recurring/RecurringFormSheet';
import type { FormState as RecurringFormState } from '@/features/recurring/RecurringFormSheet';
import { merchantKey } from '@/domain/merchantKey';
import { draftReady, initDraft, withCategory, withCats, withKind, withLinkedAccount, withSplits, withType } from '@/domain/reviewDraft';
import { kindOf, standardTypeFor } from '@/domain/txKind';
import { EXPECTED_REIMBURSE_ID, RECEIVED_REIMBURSE_ID, REIMBURSED_ID, UNCATEGORIZED_ID, isMovementCat, specialCatType } from '@/domain/categories';
import { accountStamp, counterTypesFor, movementCatFor } from '@/domain/txType';
import { partNetCents } from '@/domain/reimbursement';
import { defaultFamilyFor } from '@/domain/defaultAccounts';
import type { DefaultFamily } from '@/application/defaultAccounts';
import { normalizeIban } from '@/domain/feedIds';
import { isPaypalAccount, isPaypalFunding } from '@/domain/paypal';
import { matchCounterAccount } from '@/domain/counterClue';
import type { ClueAccount, ClueTx } from '@/domain/counterClue';
import { hapticNotify } from '@/lib/platform';
import { TxRow } from '@/ui/TxRow';
import { fetchSettlementCandidates } from '@/features/splits/settlementCandidates';
import type { SettlementCandidate } from '@/features/splits/settlementCandidates';
import { useSession } from '@/app/session';
import type { DraftCatalog, ReviewDraft } from '@/domain/reviewDraft';
import type { AccountType, RecurringEvery, RecurringRow, TxSplit, TxSplitCat, TxType } from '@/db/types';
import { setChooserLoanPrefill } from '@/features/accounts/AddAccountChooser';
import { resolveSplitsFor, splitsArePct } from '@/domain/splits';
import { predictTx } from '@/domain/predictCategory';
import type { TxPrediction } from '@/domain/predictCategory';
import { recurringAmountMatches } from '@/domain/recurring';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { logActivity } from '@/application/activity';
import { pairWithExistingRow } from '@/application/counterPair';
import { catName, useCategories } from '@/features/categories/useCategories';
import { fmtCents } from '@/lib/money';
import { cleanBankText, orDefaultLabel, txTitle } from '@/lib/text';
import { HelpButton } from '@/features/help/HelpButton';
import { IntroCard } from '@/features/help/IntroCard';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { SplitEditorSheet } from '@/features/transactions/SplitEditorSheet';
import { CatsSheet, catsAroundSingle, partCatsApplyPatch } from '@/features/transactions/PartCatsSheet';
import type { CatsApplyEntry } from '@/features/transactions/PartCatsSheet';
import { RecurringVisual, cadenceLabel } from '@/features/recurring/RecurringVisual';
import { TX_TYPE_VISUAL } from '@/features/transactions/TxTypeSheet';
import { BulkCounterQueue, CounterMatchSheet, CounterpartySheet } from '@/features/transactions/TxKindSheet';
import { setReviewReturn, takeReviewReturn } from './reviewReturn';

/** one grouped-context row inside the category editor (counterparty,
 *  type) — the card-row anatomy in the sheet's input skin */
/** why the shown category was suggested, per prediction source */
const REASON_KEYS = {
  history: 'review.reasonHistory',
  'history-amount': 'review.reasonAmount',
  keyword: 'review.reasonKeyword',
} as const;

/** #228 feedback: the card Counterparty row's two doors — tap opens the
 *  ask (narrowed by the staged category), detach resets the pick (the
 *  counterparty and the category are one fact). Module-level for S3776. */
function buildCounterRowDoors(args: {
  draft: ReviewDraft | null;
  locked: boolean;
  amountCents: number | undefined;
  cats: DraftCatalog;
  setCounterAskCat: (v: string | null) => void;
  counterFallback: { current: ReviewDraft | null };
  setCounterOpen: (v: boolean) => void;
  counterChosen: { current: boolean };
  setStagedDraft: (d: ReviewDraft) => void;
}): { onEdit?: () => void; onDetach?: () => void } {
  const { draft } = args;
  if (!draft || args.locked) return {};
  const onEdit = () => {
    args.setCounterAskCat(draft.catId && specialCatType(draft.catId) ? draft.catId : null);
    args.counterFallback.current = null;
    args.setCounterOpen(true);
  };
  const onDetach = draft.linkedAccountId
    ? () => {
        args.counterChosen.current = true;
        args.setStagedDraft({ ...withKind(draft, 'standard', args.amountCents ?? 0, args.cats), catId: undefined });
      }
    : undefined;
  return { onEdit, onDetach };
}

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

/** #237 r2: the picked rows' reciprocals land AFTER the confirm write —
 *  the row-level pick and each part's pick pair their existing row
 *  (#133 B, per pick). Module-level for S3776. */
async function pairReviewPicks(
  deps: { store: ReturnType<typeof useData>['store']; repo: ReturnType<typeof useData>['repo']; spaceId: string },
  tx: SpaceTx,
  pickedPeerTxId: string | undefined,
  partPeers: readonly TxSplit[],
): Promise<void> {
  if (pickedPeerTxId) await pairWithExistingRow(deps.store, deps.repo, deps.spaceId, tx, pickedPeerTxId);
  for (const part of partPeers) {
    await pairWithExistingRow(
      deps.store,
      deps.repo,
      deps.spaceId,
      { id: tx.id, accountId: tx.accountId, amountCents: (tx.amountCents < 0 ? -1 : 1) * Math.abs(part.amountCents) },
      part.transferPeerId!,
    );
  }
}

/** #237 r3: the Counter-transaction row's face — the picked leg's
 *  story, or the default (created on confirm / arrives with the feed) */
function counterTxFaceFor(
  peer: SpaceTx | undefined,
  bankFed: boolean,
  currency: string,
  lang: ReturnType<typeof useLang>['lang'],
  t: ReturnType<typeof useLang>['t'],
): string {
  if (peer) return `${txTitle(peer)} · ${fmtCents(peer.amountCents, currency, lang)}`;
  return t(bankFed ? 'review.counterAwaitFeed' : 'review.counterWillCreate');
}

/** a part's signed money in its container's direction */
/** #251: a part's quick-created recurring starts from the PART — its
 *  label and amount, not the container's (shared with the detail's
 *  part page, which carries the same doors) */
export const partRecurringPrefill = (tx: SpaceTx, part: TxSplit | undefined): RecurringFormState => {
  const base = formFromTx({ ...tx, amountCents: part?.amountCents ?? tx.amountCents });
  // #331 (user): the part's picked category rides into the form too
  const withCat = { ...base, catId: stagedRealCatId(part?.catId) };
  return part?.label ? { ...withCat, name: part.label } : withCat;
};

/** #331 (user): a quick-created recurring copies the card's picked
 *  category — the uncategorized placeholder stays behind */
const stagedRealCatId = (catId: string | undefined): string | undefined =>
  catId && catId !== UNCATEGORIZED_ID ? catId : undefined;

/** #324: the review card's notes field grows with its content instead
 *  of scrolling inside the card. #324 r2 (user): the field wears a real
 *  border now (border-box), so the frame's two edges ride on top of the
 *  content-only scrollHeight. */
const autoGrowNotes = (el: HTMLTextAreaElement): void => {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
};

/** #326: the honest cadence guess for a quick-created loan — the
 *  merchant's review rows spaced near-monthly (every gap 25–35 days)
 *  mean a monthly payment plan; anything else stays unguessed */
export function guessCadence(dates: readonly string[]): RecurringEvery | undefined {
  const stamps = [...new Set(dates)].sort((a, b) => a.localeCompare(b)).map((d) => Date.parse(d));
  if (stamps.length < 2) return undefined;
  const dayMs = 86_400_000;
  const monthly = stamps.slice(1).every((ms, i) => {
    const gap = Math.round((ms - stamps[i]) / dayMs);
    return gap >= 25 && gap <= 35;
  });
  return monthly ? 'month' : undefined;
}

const partSignedCents = (containerCents: number, partAbsCents: number): number =>
  (containerCents < 0 ? -1 : 1) * partAbsCents;

/** #237 r2: pointing at ONE existing row is specific to its card — a
 *  standing bulk offer asks first, then stands down (S3776: out of the
 *  component) */
const stageWithBulkWarning = (
  similarCount: number,
  stage: () => void,
  warn: (ask: { n: number; stage: () => void }) => void,
): void => {
  if (similarCount > 0) warn({ n: similarCount, stage });
  else stage();
};

/** #268 r2: the deck's shown card — the held snapshot outranks the live
 *  queue head while the counter queue runs (S3776: out of the body) */
const shownCard = (held: SpaceTx | null, remaining: SpaceTx[] | undefined): SpaceTx | undefined =>
  held ?? remaining?.[0];

/** #324: the note the confirm writes — untouched or unchanged stays
 *  silent, and a container carries no note of its own (S3776) */
function stagedNoteFor(noteDraft: string | null, container: boolean, current: string | undefined): string | undefined {
  const staged = noteDraft?.trim();
  if (!container || staged === undefined) return undefined;
  return staged === (current ?? '') ? undefined : staged;
}

/** #309: the refused row's red ring — flat helpers keep the JSX free of
 *  nested templates/ternaries (S4624/S3358). #316 (user): the ring draws
 *  INSET — the row spans the card's full inner width and the card's
 *  overflow-hidden was clipping a box-edge ring at both sides. */
const counterRowRing = (required: boolean | undefined): string =>
  required ? ` rounded-lg${blockerRing(true)} ring-inset` : '';

function counterValueTone(required: boolean | undefined, linkedAccountId: string | undefined): string {
  if (required) return 'text-negative';
  return linkedAccountId ? '' : 'text-ink-4';
}

/** #268 r2: the held deck's face — the data marker the specs read plus
 *  the inert class that closes the frozen card to edits (S3776) */
const heldDeckProps = (held: boolean): { marker: '1' | undefined; inertCls: string } =>
  held ? { marker: '1', inertCls: ' pointer-events-none' } : { marker: undefined, inertCls: '' };

/** #268: the per-sibling counter queue a confirmed row-level pick
 *  leaves behind — null when nothing queues (S3776) */
function queuedCounterBulk(
  pickedPeer: { txId: string; linkedId: string } | null,
  bulk: SpaceTx[],
  draft: ReviewDraft,
  accounts: readonly { id: string; name: string }[] | undefined,
  recurringId: string | undefined,
  eventId: string | undefined,
  note: string | undefined,
): { items: SpaceTx[]; draft: ReviewDraft; recurringId?: string; eventId?: string; note?: string; target: { id: string; name: string } } | null {
  if (!pickedPeer || bulk.length === 0 || !draft.linkedAccountId) return null;
  const linkedId = draft.linkedAccountId;
  return {
    items: bulk,
    draft,
    recurringId,
    eventId,
    note,
    target: { id: linkedId, name: accounts?.find((a) => a.id === linkedId)?.name ?? '' },
  };
}

/** the confirm's activity line — the bulk count rides along unless a
 *  pick queued the siblings instead (S3776: out of confirm) */
function logConfirmActivity(
  deps: { store: ReturnType<typeof useData>['store']; repo: ReturnType<typeof useData>['repo']; spaceId: string },
  tx: SpaceTx,
  picked: boolean,
  bulkLen: number,
): void {
  const bulkN = picked ? 0 : bulkLen;
  void logActivity(deps.store, deps.repo, deps.spaceId, 'review', bulkN ? `${txTitle(tx)} +${bulkN}` : txTitle(tx));
}

/** #237 r3: the match sheet's create/await doors — manual counters get
 *  Create, bank-fed ones Wait; both just reset the pick (S3776) */
const resetPickDoor = (bankFed: boolean, wantBank: boolean, clear: () => void): (() => void) | undefined =>
  bankFed === wantBank ? clear : undefined;

/** #161/#324: does the card hold work a split would reset? #330 r2
 *  (user): the check reads the card's VISIBLE story, not who staged it
 *  — a row's imported/predicted category (the user's ATM card wore
 *  "Cash Withdraw · Transfer" with nothing user-staged) counts exactly
 *  like a hand-picked one, because the split's Done drops both the
 *  same way. (S3776: out of the component) */
const splitWouldReset = (args: {
  draft: ReviewDraft | null;
  staged: ReviewDraft | null;
  /** the recurring the confirm would link (auto-match or manual) */
  recurringId: string | undefined;
  eventPick: string | null;
  /** the notes field's shown value (staged draft or the row's own) */
  note: string;
}): boolean =>
  args.staged !== null ||
  args.recurringId !== undefined ||
  args.eventPick !== null ||
  args.note.trim() !== '' ||
  !!args.draft?.cats?.length ||
  !!args.draft?.splits?.length ||
  !!args.draft?.linkedAccountId ||
  (!!args.draft?.catId && args.draft.catId !== UNCATEGORIZED_ID);

/** #237 r3: the card's Counter-transaction row descriptor — undefined
 *  hides the row (no counterparty, or a funding pot: nothing ever
 *  shows there); a STORED pair renders tap-less (S3776: out of the
 *  component) */
function counterTxDescriptor(
  tx: SpaceTx | undefined,
  counterAcct: { type: AccountType } | undefined,
  peer: SpaceTx | undefined,
  bankFed: boolean,
  lang: ReturnType<typeof useLang>['lang'],
  t: ReturnType<typeof useLang>['t'],
  onEdit: () => void,
): { face: string; onEdit?: () => void } | undefined {
  if (!tx || !counterAcct || counterAcct.type === 'funding') return undefined;
  const face = counterTxFaceFor(peer, bankFed, tx.currency, lang, t);
  return tx.transferPeerId ? { face } : { face, onEdit };
}

/** #161: the remembered pct SPREAD applied onto an untouched draft —
 *  a resolved transfer, an own-counter default or the row's own
 *  partition must never be fragmented by it (S3776: out of the
 *  component) */
function applyPredictedSpread(
  resolvedDraft: ReviewDraft | null,
  prediction: TxPrediction | null,
  tx: SpaceTx | undefined,
): ReviewDraft | null {
  if (!tx || !resolvedDraft || !prediction?.cats) return resolvedDraft;
  if (
    resolvedDraft.catId !== prediction.catId ||
    resolvedDraft.linkedAccountId ||
    resolvedDraft.cats?.length ||
    resolvedDraft.splits?.length
  )
    return resolvedDraft;
  const resolved = resolveSplitsFor(tx.amountCents, prediction.cats.map((e) => ({ catId: e.catId, amountCents: 0, pct: e.pct })));
  const entries = resolved.map((s) => ({ catId: s.catId, amountCents: Math.abs(s.amountCents), ...(s.pct !== undefined ? { pct: s.pct } : {}) }));
  const primary = entries.reduce((best, e) => (e.amountCents > best.amountCents ? e : best), entries[0]);
  return { ...withCats(resolvedDraft, entries), catId: primary.catId };
}

/** one confirm: the whole DRAFT lands in one write (+ the bulk selection) */
async function writeConfirmation(args: {
  tx: SpaceTx;
  draft: ReviewDraft;
  recurringId: string | undefined;
  eventId: string | undefined;
  /** #324 (user): the staged note — undefined leaves the row's own alone */
  note?: string;
  bulk: SpaceTx[];
  transform: ReturnType<typeof useTxTransform>;
  /** #237 r2: the EXISTING row the user pointed at (pick-existing) */
  pairPeerId?: string;
}): Promise<void> {
  const { draft } = args;
  // draft-cleared fields on a tx that HAD them need an explicit null —
  // and a landed SPLIT always writes cats null: the explicit field
  // version-stamps the container so its parts never read as legacy
  // slices on a fresh device (#211)
  const splitsField = replacing('splits', draft.splits?.length ? draft.splits : undefined, !!args.tx.splits?.length);
  const draftCatEntries = draft.cats?.length ? draft.cats : undefined;
  const catsField = draft.splits?.length
    ? { cats: null as never }
    : replacing('cats', draftCatEntries, !!args.tx.cats?.length);
  // #309: no default fallback — the gate upstream made the link explicit
  const linkField = replacing('linkedAccountId', draft.linkedAccountId, !!args.tx.linkedAccountId);
  await args.transform(args.tx, {
    catId: draft.catId,
    txType: draft.txType,
    needsReview: 0,
    ...splitsField,
    ...catsField,
    ...linkField,
    // #237 r2: a pick-existing peer rides the SAME write — the choke
    // sees the incoming peer and mints nothing
    ...(args.pairPeerId ? { transferPeerId: args.pairPeerId } : {}),
    ...(args.recurringId ? { recurringId: args.recurringId } : {}),
    ...(args.eventId ? { eventId: args.eventId } : {}),
    // #324 (user): the staged note lands with the same write ('' clears)
    ...(args.note !== undefined ? { notes: args.note } : {}),
  }, null); // confirm logs its own richer 'review' line (with bulk count)
  for (const item of args.bulk) {
    await args.transform(item, bulkFieldsFor(item, draft, args.recurringId, args.eventId, args.note), null);
  }
}

/** #211: the sibling's copy of a category spread — % entries rescale to
 *  its amount, exact euros only travel when the sum still fits (the
 *  similar-rule pre-filters exact twins; this guards drift) */
function catsForSibling(item: SpaceTx, entries: TxSplitCat[]): TxSplitCat[] | undefined {
  if (entries.every((e) => e.pct != null)) {
    const resolved = resolveSplitsFor(item.amountCents, entries.map((e) => ({ catId: e.catId, amountCents: 0, pct: e.pct })));
    return resolved.map((s) => ({ catId: s.catId, amountCents: Math.abs(s.amountCents), ...(s.pct !== undefined ? { pct: s.pct } : {}) }));
  }
  const sum = entries.reduce((total, e) => total + e.amountCents, 0);
  return sum === Math.abs(item.amountCents) ? entries.map((e) => ({ catId: e.catId, amountCents: e.amountCents })) : undefined;
}

/** the WHOLE decision rides to every selected sibling (user rule):
 *  category, type, counterparty, recurring, event. Absolute splits fit
 *  exact twins by the similar-rule, pct splits rescale per item — and
 *  sign-bound standard types re-derive by the sibling's OWN sign (the
 *  similar filter already keeps signs together; this guards any path
 *  that doesn't). A partition travels whole: parts clear a sibling's
 *  spread and vice versa (#211 — the two never mix on one row). */
function bulkFieldsFor(item: SpaceTx, draft: ReviewDraft, recurringId: string | undefined, eventId: string | undefined, note?: string) {
  // #237 r2: a pointed-at EXISTING row is specific to ONE part — a
  // sibling's copy must never point at the same row (bulk is disabled
  // while a pick stands; this guards every other path)
  const splits = draft.splits?.length
    ? resolveSplitsFor(item.amountCents, draft.splits).map((s) => ({ ...s, transferPeerId: undefined }))
    : undefined;
  const catEntries = !splits && draft.cats?.length ? catsForSibling(item, draft.cats) : undefined;
  const siblingType = kindOf(draft.txType) === 'standard' ? standardTypeFor(item.amountCents) : draft.txType;
  const linkedId = draft.linkedAccountId;
  return {
    catId: draft.catId,
    txType: siblingType,
    needsReview: 0 as const,
    ...(splits ? { splits, cats: null as never } : {}),
    ...(catEntries ? { cats: catEntries, ...(item.splits?.length ? { splits: null as never } : {}) } : {}),
    ...(linkedId ? { linkedAccountId: linkedId } : {}),
    ...(recurringId ? { recurringId } : {}),
    ...(eventId ? { eventId } : {}),
    // #324 (user): the typed note travels to every selected sibling —
    // an untouched or emptied field never blanks a sibling's own note
    ...(note ? { notes: note } : {}),
  };
}

/** "also apply to n similar": a compact summary row on the card; the full
 *  list lives in a Sheet so long histories never squeeze the card
 *  (user request), with per-row read-only detail expansion */
/** an incoming settlement is money from a PERSON, not one of your
 *  accounts — R2 makes transfer strictly account-to-account, and the
 *  old ruling already said outside money is standard. The app's own
 *  concept for money-back-from-people is the received reimbursement. */
function stageAsSettlement(draft: ReviewDraft, cats: ReturnType<typeof useCategories>): ReviewDraft {
  return withCategory(withType({ ...draft, linkedAccountId: undefined }, 'income', cats), RECEIVED_REIMBURSE_ID, cats);
}

// CardCounterRow retired (#219, user): the counterparty is a CATEGORY
// fact now — the card's category rows carry "→ account"; the raw bank
// counterparty is transaction metadata, shown on the detail's Details
// block. No transaction-level counter row, no transaction-level editing.

/** the part a numbered picker/sheet is aimed at (S3776: out of the deck) */
const partAt = (parts: readonly TxSplit[], index: number | null): TxSplit | undefined =>
  index === null ? undefined : parts[index];

/** r8: the tapped card GROWS out of its slot to the front while the old
 *  active SHRINKS back into its own slot — FLIP on the real elements,
 *  nothing reorders. Module-level for S3776; animate/rects are optional
 *  (jsdom has neither). */
function playDeckFlip(
  flip: { tappedRect: DOMRect; activeRect: DOMRect },
  card: HTMLElement | null,
  oldStrip: HTMLElement | undefined,
): void {
  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const travel = (el: HTMLElement | null | undefined, from: DOMRect) => {
    if (!el) return;
    const to = el.getBoundingClientRect();
    if (!to.width || !to.height) return;
    el.animate?.(
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
          transformOrigin: 'top left',
          opacity: 0.85,
        },
        { transform: 'none', transformOrigin: 'top left', opacity: 1 },
      ],
      { duration: 220, easing: ease },
    );
  };
  travel(card, flip.tappedRect);
  travel(oldStrip, flip.activeRect);
}

/** does this draft stage a REAL split (2+ parts beyond the settled slice)? */
const multiPartSplits = (draft: ReviewDraft | null): boolean =>
  (draft?.splits ?? []).filter((s) => s.catId !== REIMBURSED_ID).length > 1;

// deckActiveFaces retired (#217/#220): the expanded part renders one
// row PER category entry now — the summary faces and the part-level
// counter/kind sub have no reader left.

/** one slice's story lines (#126): the typed part's label/own type and
 *  a spread part's category list — shared by the card summary region
 *  and the stacked part cards */
function sliceStory(
  slice: TxSplit,
  index: number,
  splits: readonly TxSplit[] | undefined,
  rowType: TxType | undefined,
  cats: ReturnType<typeof useCategories>,
  t: ReturnType<typeof useLang>['t'],
): { label?: string; type?: TxType; spread?: string } {
  // #211: splits mean parts, full stop — every real split wears labels
  const typed = (splits?.length ?? 0) > 1;
  return {
    label: typed ? (slice.label ?? t('split.partN', { n: index + 1 })) : undefined,
    type: slice.txType && slice.txType !== rowType ? slice.txType : undefined,
    spread: slice.cats?.length ? slice.cats.map((c) => catName(cats.byId(c.catId), t)).join(' · ') : undefined,
  };
}

/** the card's category region (#126 redesign): a single category row
 *  when the draft is whole; a compact "Split transaction · N parts"
 *  summary when it's split — the parts themselves stand as stacked
 *  cards UNDER the main card. The settled Reimbursed slice is not a
 *  part and keeps its own row either way. A visible "Split" row ends
 *  the old hide-out under the category pencil. */
function CardCategoryRows({
  draft,
  fallbackCat,
  fallbackColor,
  currency,
  onOpenCategories,
  onEditCounter,
  counterRequired,
  counterTx,
}: Readonly<{
  draft: ReviewDraft | null;
  fallbackCat: ReturnType<ReturnType<typeof useCategories>['byId']>;
  fallbackColor: string | undefined;
  currency: string;
  /** the classic per-slice category editor (the chip's door) */
  onOpenCategories: () => void;
  /** #228 feedback: the card's own Counterparty row — counter-first
   *  stages the special category; absent = the row hides */
  onEditCounter?: () => void;
  /** #309 (user): a refused bare-movement Confirm paints this row red */
  counterRequired?: boolean;
  /** #237 r3 (user): the card's own Counter-transaction row — appears
   *  once a counterparty stands; face = the picked row or the default
   *  (create / await the feed). No onEdit = read-only (a stored pair). */
  counterTx?: { face: string; onEdit?: () => void };
}>) {
  const { t, lang } = useLang();
  const cats = useCategories();
  const accounts = useSpaceAccounts();
  const slices = draft?.splits ?? [];
  const parts = slices.filter((s) => s.catId !== REIMBURSED_ID);
  // #211: the row's own category spread — several categories, ONE
  // transaction; the settled `reimbursed` entry renders wherever it lives
  const spreadEntries = (draft?.cats ?? []).filter((e) => e.catId !== REIMBURSED_ID);
  const settled = [...slices, ...(draft?.cats ?? [])].filter((s) => s.catId === REIMBURSED_ID);
  const multi = parts.length > 1;
  const single = parts.length === 1 ? parts[0] : null;
  const singleCat = single ? cats.byId(single.catId) : fallbackCat;
  const singleColor = single ? (singleCat.color ?? cats.byId(singleCat.parentId ?? '').color) : fallbackColor;
  const spread = single ? sliceStory(single, 0, slices, draft?.txType, cats, t).spread : undefined;
  const catRow = (catId: string, amountCents: number, key: string) => (
    <button
      key={key}
      data-testid={`review-cat-${catId}`}
      onClick={onOpenCategories}
      className="m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] font-medium text-ink"
    >
      <Icon
        name={cats.byId(catId).icon}
        size={18}
        color={cats.byId(catId).color ?? cats.byId(cats.byId(catId).parentId ?? '').color ?? 'var(--m-ink-3)'}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{catName(cats.byId(catId), t)}</span>
      </span>
      <span className="m-num text-[12px] text-ink-2">{fmtCents(amountCents, currency, lang)}</span>
      <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
    </button>
  );
  return (
    <>
      {/* multi-part (#126 r3): the main card says nothing the parts
          already say — the deck under it carries every story. #228: a
          spread's rows are regular categories — no counter sublines */}
      {!multi &&
        spreadEntries.length > 1 &&
        spreadEntries.map((entry, i) => catRow(entry.catId, entry.amountCents, `${entry.catId}-${i}`))}
      {!multi && spreadEntries.length <= 1 && (
        <button
          data-testid={single ? `review-cat-${single.catId}` : 'review-category-chip'}
          onClick={onOpenCategories}
          className="m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] font-medium text-ink"
        >
          <Icon name={singleCat.icon} size={18} color={singleColor ?? 'var(--m-ink-3)'} />
          <span className="min-w-0 flex-1 truncate">
            {single || draft?.catId ? (
              <>
                {catName(singleCat, t)}
                {/* the parent gives the sub its context (user request) */}
                {singleCat.parentId && (
                  <span className="text-[12px] font-normal text-ink-4"> · {catName(cats.byId(singleCat.parentId), t)}</span>
                )}
                {spread && <span className="block truncate text-[11px] font-normal text-ink-4">{spread}</span>}
              </>
            ) : (
              t('review.pickPrompt')
            )}
          </span>
          {single && <span className="m-num text-[12px] text-ink-2">{fmtCents(single.amountCents, currency, lang)}</span>}
          <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
        </button>
      )}
      {/* #228 feedback (user ss): the counterparty is the card's own
          row — counter-first picks the special category automatically,
          removal resets the category (same doors as the detail screen) */}
      {!multi && onEditCounter && (
        <>
          <button
            data-testid="review-counter-row"
            onClick={onEditCounter}
            className={'m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] text-ink' + counterRowRing(counterRequired)}
          >
            <Icon name="bank-transfer" size={18} color={counterRequired ? 'var(--m-negative)' : 'var(--m-ink-3)'} />
            <span className={`min-w-0 flex-1 truncate ${counterValueTone(counterRequired, draft?.linkedAccountId)}`}>
              {(accounts ?? []).find((a) => a.id === draft?.linkedAccountId)?.name ?? t('tx.counterNone')}
            </span>
            <span className="text-[11px] text-ink-4">{t('tx.counterAccount')}</span>
            <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
          </button>
          {/* #309: the honest reason the Confirm refused, under the field */}
          <FormBlockerNote show={!!counterRequired} text={t('review.counterRequired')} testId="review-counter-required" className="px-4 pb-2" />
        </>
      )}
      {/* #237 r3 (user): the counter TRANSACTION is the card's own row —
          the fork sheet after the counterparty pick is gone; this row
          opens the match sheet (pick an existing leg, or reset to the
          create/await default) */}
      {!multi && counterTx && (
        <button
          data-testid="review-countertx-row"
          onClick={counterTx.onEdit}
          disabled={!counterTx.onEdit}
          className="m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] text-ink"
        >
          <Icon name="swap-horizontal" size={18} color="var(--m-ink-3)" />
          <span className="min-w-0 flex-1 truncate">{counterTx.face}</span>
          <span className="text-[11px] text-ink-4">{t('tx.counterTxRow')}</span>
          {counterTx.onEdit && <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />}
        </button>
      )}
      {settled.map((slice) => catRow(slice.catId, slice.amountCents, `settled-${slice.catId}`))}
    </>
  );
}

/** the split, made physical (#126 v2, wallet-deck design from the
 *  user's reference): each part is a card in a deck — ONE stands
 *  expanded with every fact editable in place (label, kind +
 *  counterparty, category, event; the amount opens the values editor,
 *  since amounts are a partition), the rest collapse to slim headers a
 *  tap re-expands. A ghost card grows the split. */
export function ReviewPartDeck({
  splits,
  rowType,
  tx,
  activeEvents,
  allowedCatIds,
  lockedKind = false,
  recurrings,
  attention = false,
  onOpenValues,
  onSplits,
  onPickExisting,
}: Readonly<{
  /** the split being told — a staged draft's or a stored row's */
  splits: readonly TxSplit[] | undefined;
  /** the container's type: what untyped parts inherit */
  rowType: TxType;
  tx: SpaceTx;
  activeEvents: readonly { id: string; name: string; icon?: string }[];
  allowedCatIds?: readonly string[];
  /** R1: a stamped account types every row — parts included */
  lockedKind?: boolean;
  /** r7: parts link recurring costs like whole transactions do */
  recurrings: readonly Pick<RecurringRow, 'id' | 'name' | 'logo' | 'icon' | 'kind'>[];
  /** r7: a refused Confirm/Apply marks the parts that still need work */
  attention?: boolean;
  onOpenValues: () => void;
  onSplits: (next: TxSplit[]) => void;
  /** #237 r2 (review): a part pointed at an EXISTING row — the screen
   *  may warn (bulk update turns off) before `stage` runs */
  onPickExisting?: (stage: () => void) => void;
}>) {
  const { t, lang } = useLang();
  const cats = useCategories();
  const accounts = useSpaceAccounts();
  const allTxs = useSpaceTransactions();
  const [expanded, setExpanded] = useState(0);
  // #228 feedback: the part card's own Counterparty row — which part's
  // counter door is open (counter-first picks its category)
  const [counterForIdx, setCounterForIdx] = useState<number | null>(null);
  // #237 r3: which part's Counter-transaction row is picking its leg
  const [counterTxForIdx, setCounterTxForIdx] = useState<number | null>(null);
  const [eventFor, setEventFor] = useState<number | null>(null);
  // r7: which part is linking a recurring cost
  const [recFor, setRecFor] = useState<number | null>(null);
  // #251: quick creation, parts edition — the same doors the whole-card
  // pickers carry (create a recurring/event right from the picker)
  const [recCreateFor, setRecCreateFor] = useState<number | null>(null);
  const [eventCreateFor, setEventCreateFor] = useState<number | null>(null);
  // r6/r7: which part is editing its categories (THE category door —
  // the same amounts/percentages editor whole transactions use)
  const [spreadFor, setSpreadFor] = useState<number | null>(null);
  // r8 (user request): the WHOLE card travels — the tapped one rises out
  // of its slot to the front while the old active shrinks back into its
  // own slot; nothing else reorders. Classic FLIP on the real elements.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const stripRefs = useRef(new Map<number, HTMLElement>());
  const flipRef = useRef<{ tappedRect: DOMRect; activeRect: DOMRect; prevIdx: number } | null>(null);
  const slices = splits ?? [];
  const parts = slices.filter((s) => s.catId !== REIMBURSED_ID);
  const openIdx = Math.min(expanded, parts.length - 1);
  useLayoutEffect(() => {
    const flip = flipRef.current;
    flipRef.current = null;
    if (!flip) return;
    playDeckFlip(flip, cardRef.current, stripRefs.current.get(flip.prevIdx));
  }, [openIdx]);
  if (parts.length <= 1) return null;

  // r7 (user rule): NO restriction on a split beyond the amounts — every
  // patch lands; incompleteness is the attention badges' job
  const patchPart = (index: number, patch: Partial<TxSplit>) => {
    const target = parts[index];
    onSplits(slices.map((s) => (s === target ? { ...s, ...patch } : s)));
  };
  const counterPart = counterForIdx === null ? undefined : parts[counterForIdx];
  const partLabel = (slice: TxSplit, i: number) =>
    orDefaultLabel(slice.label, `${txTitle(tx)} – ${t('split.partN', { n: i + 1 })}`);
  const swapTo = (i: number) => {
    if (i === openIdx) return;
    const strip = stripRefs.current.get(i);
    if (strip && cardRef.current) {
      flipRef.current = {
        tappedRect: strip.getBoundingClientRect(),
        activeRect: cardRef.current.getBoundingClientRect(),
        prevIdx: openIdx,
      };
    }
    setExpanded(i);
  };

  const active = parts[openIdx];
  // #228: settled bookkeeping is not an editable category row here
  const activeRealCats = (active.cats ?? []).filter((c) => c.catId !== REIMBURSED_ID);
  const activeEventFace = activeEvents.find((event) => event.id === active.eventId)?.name ?? t('events.linkNone');
  const activeRecFace = recurrings.find((rec) => rec.id === active.recurringId)?.name ?? t('recurring.linkNone');
  const peeking = parts.map((slice, i) => ({ slice, i })).filter(({ i }) => i !== openIdx);
  const deckDirection: 'debit' | 'credit' = tx.amountCents < 0 ? 'debit' : 'credit';
  const needsAttention = (slice: TxSplit) => attention && slice.catId === UNCATEGORIZED_ID;

  return (
    <div className="mt-3" data-testid="review-part-deck">
      {/* r5 (user illustration): the section header owns the manage door */}
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Icon name="call-split" size={17} color="var(--m-accent-deep)" />
          {t('split.title')}
        </span>
        <button
          data-testid="review-manage-splits"
          onClick={onOpenValues}
          className="m-tap flex items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-accent-deep"
        >
          <Icon name="tune" size={14} />
          {t('review.manageSplits')}
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-ink-4">
        <Icon name="layers-outline" size={13} color="var(--m-ink-4)" />
        {t('review.splitsCount', { n: parts.length })}
      </div>

      {/* the deck: the other parts peek from behind — tap one to bring
          it on top; the active card carries every fact */}
      <div className="mt-2">
        {peeking.map(({ slice, i }) => {
          const sliceCat = cats.byId(slice.catId);
          return (
            <button
              key={slice.id ?? `p${i}`}
              ref={(el) => {
                if (el) stripRefs.current.set(i, el);
                else stripRefs.current.delete(i);
              }}
              data-testid={`deck-part-${i}`}
              onClick={() => swapTo(i)}
              className="m-tap -mb-1.5 flex w-full items-center gap-2.5 rounded-t-card border border-line bg-surface px-4 pt-2 pb-3.5 text-left opacity-90"
            >
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-2 text-[11px] font-semibold text-ink-3">
                {i + 1}
                {needsAttention(slice) && (
                  <span
                    data-testid={`deck-attn-${i}`}
                    className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-negative text-[8px] font-bold text-white"
                  >
                    !
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                {partLabel(slice, i)}
                <span className="text-[11px] font-normal text-ink-4"> · {catName(sliceCat, t)}</span>
              </span>
              <span className="m-num text-[12px] text-ink-2">{fmtCents(slice.amountCents, tx.currency, lang)}</span>
            </button>
          );
        })}
        <div
          key={active.id ?? `p${openIdx}`}
          ref={cardRef}
          data-testid={`deck-part-${openIdx}`}
          className="relative rounded-card border-2 border-accent-deep bg-surface shadow-[0_8px_20px_rgba(0,0,0,0.10)]"
        >
          <div className="flex items-center gap-2 px-3 pt-3 pb-1">
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-deep text-[12px] font-semibold text-white">
              {openIdx + 1}
              {needsAttention(active) && (
                <span
                  data-testid={`deck-attn-${openIdx}`}
                  className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-negative text-[9px] font-bold text-white"
                >
                  !
                </span>
              )}
            </span>
            <input
              data-testid={`deck-label-${openIdx}`}
              value={active.label ?? ''}
              placeholder={partLabel(active, openIdx)}
              onChange={(e) => patchPart(openIdx, { label: e.target.value || undefined })}
              // r8 (user rule): a label must SAY something — whitespace-only
              // settles back to the derived default on blur
              onBlur={(e) => {
                const trimmed = e.target.value.trim();
                if (trimmed !== e.target.value) patchPart(openIdx, { label: trimmed || undefined });
              }}
              className="h-9 min-w-0 flex-1 rounded-input border border-line bg-bg-2 px-3 text-[13px] text-ink outline-none placeholder:text-ink-4"
            />
            <span data-testid={`deck-amount-${openIdx}`} className="m-num text-[14px] font-semibold text-ink">
              {fmtCents(active.amountCents, tx.currency, lang)}
            </span>
          </div>
          {/* #217 (user): a spread part shows EACH category as its own
              row — same face as the unsplit card, value included; every
              row doors into the same editor. #228 feedback: no counter
              subline — the part's Counterparty row below owns it */}
          {(activeRealCats.length ? activeRealCats : [null]).map((entry, entryIdx) => {
            const rowCat = cats.byId(entry?.catId ?? active.catId);
            const rowColor = rowCat.color ?? cats.byId(rowCat.parentId ?? '').color;
            return (
              <button
                key={entry ? `${entry.catId}-${entryIdx}` : 'single'}
                data-testid={entryIdx === 0 ? `deck-cat-${openIdx}` : `deck-cat-${openIdx}-${entryIdx}`}
                onClick={() => setSpreadFor(openIdx)}
                className="m-tap flex w-full items-center gap-2.5 border-t border-line-2 bg-transparent px-3 py-2.5 text-left text-[14px] font-medium text-ink"
              >
                <Icon name={rowCat.icon} size={18} color={rowColor ?? 'var(--m-ink-3)'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {catName(rowCat, t)}
                    {!entry && rowCat.parentId && (
                      <span className="text-[12px] font-normal text-ink-4"> · {catName(cats.byId(rowCat.parentId), t)}</span>
                    )}
                  </span>
                </span>
                <span className="m-num text-[12px] font-normal text-ink-2">
                  {fmtCents(entry ? entry.amountCents : partNetCents(active), tx.currency, lang)}
                </span>
                <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
              </button>
            );
          })}
          {/* #228 feedback: the part's own Counterparty row — the same
              counter-first door the card and the detail screen carry */}
          {!lockedKind && (
            <button
              data-testid={`deck-counter-${openIdx}`}
              onClick={() => setCounterForIdx(openIdx)}
              className="m-tap flex w-full items-center gap-2.5 border-t border-line-2 bg-transparent px-3 py-2.5 text-left text-[14px] text-ink"
            >
              <Icon name="bank-transfer" size={18} color="var(--m-ink-3)" />
              <span className={`min-w-0 flex-1 truncate ${active.linkedAccountId ? '' : 'text-ink-4'}`}>
                {accounts?.find((a) => a.id === active.linkedAccountId)?.name ?? t('tx.counterNone')}
              </span>
              <span className="text-[11px] text-ink-4">{t('tx.counterAccount')}</span>
              <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
            </button>
          )}
          {/* #237 r3: the part's Counter-transaction row — same story as
              the card's (pick the existing leg, or the create/await
              default), sized to the PART's money */}
          {(() => {
            const partCounterAcct = accounts?.find((a) => a.id === active.linkedAccountId);
            if (!partCounterAcct || partCounterAcct.type === 'funding') return null;
            const peerRow = active.transferPeerId ? allTxs?.find((r) => r.id === active.transferPeerId) : undefined;
            const face = counterTxFaceFor(peerRow, (partCounterAcct.source ?? 'manual') !== 'manual', tx.currency, lang, t);
            return (
              <button
                data-testid={`deck-countertx-${openIdx}`}
                onClick={() => setCounterTxForIdx(openIdx)}
                className="m-tap flex w-full items-center gap-2.5 border-t border-line-2 bg-transparent px-3 py-2.5 text-left text-[14px] text-ink"
              >
                <Icon name="swap-horizontal" size={18} color="var(--m-ink-3)" />
                <span className="min-w-0 flex-1 truncate">{face}</span>
                <span className="text-[11px] text-ink-4">{t('tx.counterTxRow')}</span>
                <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
              </button>
            );
          })()}
          {/* r7: parts link recurring costs, exactly like the card does */}
          <button
            data-testid={`deck-rec-${openIdx}`}
            onClick={() => setRecFor(openIdx)}
            className="m-tap flex w-full items-center gap-2.5 border-t border-line-2 bg-transparent px-3 py-2.5 text-left text-[14px] text-ink"
          >
            <Icon name="autorenew" size={18} color="var(--m-ink-3)" />
            <span className="min-w-0 flex-1 truncate">{activeRecFace}</span>
            <span className="text-[11px] text-ink-4">{t('recurring.linkTitle')}</span>
            <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
          </button>
          <button
            data-testid={`deck-event-${openIdx}`}
            onClick={() => setEventFor(openIdx)}
            className="m-tap flex w-full items-center gap-2.5 border-t border-line-2 bg-transparent px-3 py-2.5 text-left text-[14px] text-ink"
          >
            <Icon name="party-popper" size={18} color="var(--m-ink-3)" />
            <span className="min-w-0 flex-1 truncate">{activeEventFace}</span>
            <span className="text-[11px] text-ink-4">{t('events.linkTitle')}</span>
            <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
          </button>
        </div>
      </div>

      {/* r7: a refused Confirm points at the parts that hold it back */}
      {attention && parts.some((slice) => slice.catId === UNCATEGORIZED_ID) && (
        <p className="mt-2 rounded-card bg-negative-soft px-3 py-2 text-[12px] leading-relaxed text-negative" data-testid="deck-attention">
          {t('split.attentionNote')}
        </p>
      )}

      {/* #228 feedback: the part card's counterparty door — pick refiles
          the part's category by the account's kind (counter-first),
          remove resets it; settled bookkeeping always survives */}
      <CounterpartySheet
        open={counterForIdx !== null}
        onOpenChange={(next) => {
          if (!next) setCounterForIdx(null);
        }}
        excludeAccountId={tx.accountId}
        currentLinkedId={counterPart?.linkedAccountId}
        defaultFamily={
          counterPart && specialCatType(counterPart.catId) ? (defaultFamilyFor(counterPart.catId) ?? undefined) : undefined
        }
        counterTypes={counterPart && specialCatType(counterPart.catId) ? counterTypesFor(counterPart.catId) : undefined}
        // #237 r3 (user): no fork after the counterparty pick — the
        // part's Counter-transaction row below owns the leg question
        onChoose={(account) => {
          if (counterForIdx === null) return;
          const index = counterForIdx;
          const part = parts[index];
          const derived = movementCatFor(account.type, (tx.amountCents < 0 ? -1 : 1) * Math.abs(part.amountCents));
          patchPart(index, {
            catId: derived,
            txType: specialCatType(derived),
            linkedAccountId: account.id,
            // a (re-)pick resets any standing leg pick — it was bound
            // to the previous counter account
            transferPeerId: undefined,
            cats: catsAroundSingle(part, derived),
          });
        }}
        onDetach={
          counterPart?.linkedAccountId
            ? () => {
                if (counterForIdx === null) return;
                const part = parts[counterForIdx];
                patchPart(counterForIdx, {
                  catId: UNCATEGORIZED_ID,
                  txType: undefined,
                  linkedAccountId: undefined,
                  transferPeerId: undefined,
                  cats: catsAroundSingle(part, UNCATEGORIZED_ID),
                });
              }
            : undefined
        }
      />
      {/* #237 r3: the part's counter-transaction match sheet — suggested
          legs first, the rest scrollable; create/await resets the pick */}
      {(() => {
        const matchPart = counterTxForIdx === null ? undefined : parts[counterTxForIdx];
        const matchAcct = accounts?.find((a) => a.id === matchPart?.linkedAccountId);
        const matchBankFed = (matchAcct?.source ?? 'manual') !== 'manual';
        const clearPick = () => {
          if (counterTxForIdx !== null) patchPart(counterTxForIdx, { transferPeerId: undefined });
        };
        return (
          <CounterMatchSheet
            open={counterTxForIdx !== null}
            onOpenChange={(next) => {
              if (!next) setCounterTxForIdx(null);
            }}
            target={matchAcct ? { id: matchAcct.id, name: matchAcct.name } : null}
            anchor={{
              id: tx.id,
              amountCents: matchPart ? partSignedCents(tx.amountCents, Math.abs(matchPart.amountCents)) : tx.amountCents,
              date: tx.date,
            }}
            rows={allTxs ?? []}
            onCreate={!matchBankFed ? clearPick : undefined}
            onWait={matchBankFed ? clearPick : undefined}
            onPick={(pickedId) => {
              if (counterTxForIdx === null) return;
              const index = counterTxForIdx;
              const stage = () => patchPart(index, { transferPeerId: pickedId });
              if (onPickExisting) onPickExisting(stage);
              else stage();
            }}
          />
        );
      })()}
      {/* the expanded part's event — per-part membership (v2 model) */}
      <Sheet
        open={eventFor !== null}
        onOpenChange={(next) => {
          if (!next) setEventFor(null);
        }}
        title={t('events.linkTitle')}
        size="form"
        dragHandle
      >
        <div className="pt-1" data-testid="deck-event-list">
          <button
            data-testid="deck-event-none"
            onClick={() => {
              if (eventFor !== null) patchPart(eventFor, { eventId: undefined });
              setEventFor(null);
            }}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink-2"
          >
            <Icon name="close-circle-outline" size={18} color="var(--m-ink-4)" />
            <span className="min-w-0 flex-1 truncate">{t('events.linkNone')}</span>
          </button>
          {activeEvents.map((event) => (
            <button
              key={event.id}
              data-testid={`deck-event-${event.id}`}
              onClick={() => {
                if (eventFor !== null) patchPart(eventFor, { eventId: event.id });
                setEventFor(null);
              }}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink"
            >
              <Icon name={event.icon ?? 'party-popper'} size={18} color="var(--m-accent-deep)" />
              <span className="min-w-0 flex-1 truncate">{event.name}</span>
              {eventFor !== null && parts[eventFor]?.eventId === event.id && (
                <Icon name="check" size={17} color="var(--m-accent-deep)" />
              )}
            </button>
          ))}
          {/* #251: the quick-create door the whole-card picker has */}
          <button
            data-testid="deck-event-create"
            onClick={() => {
              setEventCreateFor(eventFor);
              setEventFor(null);
            }}
            className="m-tap flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] font-medium text-accent-deep"
          >
            <Icon name="plus" size={18} />
            {t('events.new')}
          </button>
        </div>
      </Sheet>
      {/* r7: the part's recurring link — the manual pick, parts edition */}
      <Sheet
        open={recFor !== null}
        onOpenChange={(next) => {
          if (!next) setRecFor(null);
        }}
        title={t('recurring.linkTitle')}
        size="form"
        dragHandle
      >
        <div className="pt-1" data-testid="deck-rec-list">
          <button
            data-testid="deck-rec-none"
            onClick={() => {
              if (recFor !== null) patchPart(recFor, { recurringId: undefined });
              setRecFor(null);
            }}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink-2"
          >
            <Icon name="close-circle-outline" size={18} color="var(--m-ink-4)" />
            <span className="min-w-0 flex-1 truncate">{t('recurring.linkNone')}</span>
          </button>
          {recurrings.map((rec) => (
            <button
              key={rec.id}
              data-testid={`deck-rec-${rec.id}`}
              onClick={() => {
                if (recFor !== null) patchPart(recFor, { recurringId: rec.id });
                setRecFor(null);
              }}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-1 py-3 text-left text-[14px] text-ink"
            >
              {/* #258 (user): the cost's own face, not a generic icon */}
              <RecurringVisual rec={rec} size={18} />
              <span className="min-w-0 flex-1 truncate">{rec.name}</span>
              {recFor !== null && parts[recFor]?.recurringId === rec.id && (
                <Icon name="check" size={17} color="var(--m-accent-deep)" />
              )}
            </button>
          ))}
          {/* #251: the quick-create door the whole-card picker has */}
          <button
            data-testid="deck-rec-create"
            onClick={() => {
              setRecCreateFor(recFor);
              setRecFor(null);
            }}
            className="m-tap flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] font-medium text-accent-deep"
          >
            <Icon name="plus" size={18} />
            {t('recurring.add')}
          </button>
        </div>
      </Sheet>
      {/* #251: create-and-link, parts edition — the form lands prefilled
          from the PART and the created id files onto that part alone */}
      {recCreateFor !== null && (
        <RecurringFormSheet
          initial={partRecurringPrefill(tx, parts[recCreateFor])}
          onSaved={(id) => patchPart(recCreateFor, { recurringId: id })}
          onClose={() => setRecCreateFor(null)}
        />
      )}
      {eventCreateFor !== null && (
        <EventFormSheet
          initial="new"
          onSaved={(id) => patchPart(eventCreateFor, { eventId: id })}
          onClose={() => setEventCreateFor(null)}
        />
      )}
      {/* the part's categories (r6/r7) — the whole-transaction editor,
          scoped to the part's amount. #228: a lone ◆ pick asks the
          PART's counterparty inside the editor; a spread offers regular
          categories only */}
      <CatsSheet
        open={spreadFor !== null}
        onOpenChange={(next) => {
          if (!next) setSpreadFor(null);
        }}
        subject={partAt(parts, spreadFor)}
        currency={tx.currency}
        direction={deckDirection}
        txType={rowType}
        allowedCatIds={allowedCatIds}
        // #216 (user): part spreads keep their %/€ shape too
        includePct
        excludeAccountId={tx.accountId}
        askDisabled={lockedKind}
        onApply={(entries) => {
          if (spreadFor !== null) patchPart(spreadFor, partCatsApplyPatch(partAt(parts, spreadFor), entries));
        }}
      />
    </div>
  );
}

/** own-account counterparty pre-applies the link + suggested type; the
 * hidden 'uncategorized' builtin keeps the confirm armed for transfers */
function applyOwnCounterDefault(
  baseDraft: ReviewDraft | null,
  ownCounter: { id: string; type: AccountType } | undefined,
  cats: ReturnType<typeof useCategories>,
  amountCents: number,
  ownStamp?: TxType,
): ReviewDraft | null {
  if (!baseDraft || !ownCounter || baseDraft.linkedAccountId) return baseDraft;
  const linked = withLinkedAccount(baseDraft, { id: ownCounter.id, type: ownCounter.type }, cats, amountCents, ownStamp);
  return linked.catId ? linked : withCategory(linked, 'uncategorized', cats);
}

/** #228 r3 (user rule): an AUTOMATIC transfer prediction must name a
 * real counterparty or stand down. The bank text names one of the
 * space's tracked accounts → pre-link it (the bijection files the
 * category from the account's kind); no clue → the card opens
 * Uncategorized and review asks the human. Only the untouched baseline
 * passes through here — a user-staged draft is never rewritten. */
export function resolveTransferPrediction(
  draft: ReviewDraft | null,
  tx: (ClueTx & { accountId: string; amountCents: number }) | undefined,
  accounts: readonly ClueAccount[] | undefined,
  cats: DraftCatalog,
  ownStamp?: TxType,
): ReviewDraft | null {
  if (!draft || !tx || ownStamp) return draft;
  if (draft.linkedAccountId || draft.splits?.length || draft.cats?.length) return draft;
  if (defaultFamilyFor(draft.catId) !== 'transfer') return draft;
  const match = matchCounterAccount(tx, accounts ?? [], tx.accountId);
  if (match) return withLinkedAccount(draft, { id: match.id, type: match.type }, cats, tx.amountCents, ownStamp);
  return { ...withType({ ...draft, linkedAccountId: undefined }, standardTypeFor(tx.amountCents), cats), catId: UNCATEGORIZED_ID };
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
  // #325 (user): "Also apply to 0 similar" read odd — an emptied
  // selection gets its own short line instead of the zero count
  const countLine = selected.size === 0 ? t('review.bulkNoneSelected') : t('review.alsoApply', { n: selected.size });

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
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{countLine}</span>
          <span className="flex items-center gap-1 text-[12px] text-ink-3">
            {t('review.bulkViewAll')}
            <Icon name="chevron-right" size={15} />
          </span>
        </button>
      </div>

      {/* near-max-height sheet styled like the transactions list (user
          redesign): TxRow rows with a checkbox rail, select/unselect all,
          and a row tap opens a compact READ-ONLY detail as a stacked sheet */}
      <Sheet open={open} onOpenChange={setOpen} title={countLine} height={760} dragHandle>
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
                <div className="flex min-w-0 flex-1 items-center gap-1" data-testid={`review-bulk-open-${item.id}`}>
                  <div className="min-w-0 flex-1">
                    {/* every row here is unreviewed by definition — the badge is noise */}
                    <TxRow tx={item} showDate hideUnreviewed onClick={() => setDetailId(item.id)} />
                  </div>
                  {/* #328 r2 (user): the row opens the read-only peek —
                      it wears the opener chevron (checkboxes don't) */}
                  <Icon name="chevron-right" size={15} color="var(--m-ink-4)" />
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
 * The card's link row below categories: the editable recurring link with
 * its price-delta warning. A loan/mortgage counterparty renders NOTHING —
 * the Counterparty row already names the debt (1:1 with its account),
 * and a second "Debt" line right under it was pure repetition (#236);
 * a payoff transfer is not a recurring cost either (user 2026-07-29).
 */
function DebtOrRecurringRow({
  isLoanCounter,
  recMatch,
  linkRecurring,
  manualRec,
  amountCents,
  currency,
  onEdit,
}: Readonly<{
  isLoanCounter: boolean;
  recMatch: RecurringRow | undefined;
  linkRecurring: boolean;
  manualRec: RecurringRow | undefined;
  amountCents: number;
  currency: string;
  onEdit: () => void;
}>) {
  const { t, lang } = useLang();
  if (isLoanCounter) return null;
  const delta = recMatch ? Math.abs(Math.abs(amountCents) - recMatch.amountCents) : 0;
  // #333 (user): once a recurring is picked, the row leads with ITS OWN
  // face (logo or kind icon) — the generic circle-arrow only means
  // "nothing linked yet". Mirrors the label's chosen-rec derivation.
  const linked = recMatch && linkRecurring ? recMatch : manualRec;
  const chosen = chosenRecurringId(recMatch, linkRecurring, manualRec?.id ?? null) ? linked : undefined;
  return (
    <>
      <button
        data-testid="review-recurring-row"
        onClick={onEdit}
        className="m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] text-ink"
      >
        {chosen ? (
          <span data-testid="review-recurring-visual" className="flex shrink-0 items-center justify-center">
            <RecurringVisual rec={chosen} size={18} />
          </span>
        ) : (
          <Icon name="autorenew" size={18} color="var(--m-ink-3)" />
        )}
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

/** #133 r5/#221: the card ask derives from the PICKED category, out of
 *  the component (S3776) — every ask pins its default (the ATM pair
 *  pins the cash wallet, not the default bank account) and narrows to
 *  the account types the category can mean (the bijection) */
const askDefaultFamily = (catId: string | null): DefaultFamily | undefined =>
  catId ? (defaultFamilyFor(catId) ?? undefined) : undefined;
const askCounterTypes = (catId: string | null): readonly AccountType[] | undefined =>
  (catId ? counterTypesFor(catId) : undefined) ?? undefined;

/**
 * Review queue, rebuilt around the legacy mechanics with a calmer face:
 * one card at a time, the prediction pre-applied WITH its reason, bulk
 * confirm for similar transactions (same merchant; same amount too once
 * split), type/counter-account and splits via the shared sheets, a
 * recurring-cost link offer, and a skip pile at the end.
 */
export function ReviewScreen() {
  const { t, lang } = useLang();
  const { store, repo, spaceId, setActiveSpace } = useData();
  const navigate = useNavigate();
  // #132: a new-transactions notification names its space — arriving
  // with ?space= switches there (membership-checked), then strips the
  // param so refresh/back don't re-switch
  const { space: spaceParam } = useSearch({ strict: false }) as { space?: string };
  useEffect(() => {
    if (!spaceParam) return;
    if (spaceParam !== spaceId) {
      void store.get('space', spaceParam).then((row) => {
        if (row?.deleted === 0) void setActiveSpace(spaceParam);
      });
    }
    void navigate({ to: '/review', search: {}, replace: true });
    // one-shot per arriving param — the strip itself clears it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceParam]);
  const cats = useCategories();
  const allTxs = useSpaceTransactions();
  const transform = useTxTransform();
  const recurrings = useRecurrings();
  const recurringOps = useRecurringOps();

  const [splitOpen, setSplitOpen] = useState(false);
  // #211: two different features, two different sheets — the category
  // chip opens the SPLIT-CATEGORIES editor (the row's own spread); the
  // split doors open the split-TRANSACTION values editor (parts)
  const [catsOpen, setCatsOpen] = useState(false);
  // r7: a refused Confirm marks the parts that still need a category
  const [partsAttention, setPartsAttention] = useState(false);
  // #309 (user): a refused Confirm marks the REQUIRED counterparty red
  const [counterRequired, setCounterRequired] = useState(false);
  // r7 (user rule): splitting RESETS the card's own decisions — staged
  // edits get a conscious warning before the split flow opens. #330
  // (user): the reset itself now waits for the split editor's DONE —
  // continue only ARMS it, and cancelling the editor keeps everything.
  const [splitResetOpen, setSplitResetOpen] = useState(false);
  const splitResetArmed = useRef(false);
  const requestSplit = () => {
    // #330 r2 (user): warn on the FIRST press — the card's shown story
    // (row/prediction fills included) is what the split will reset
    const wouldReset = splitWouldReset({
      draft,
      staged: stagedDraft,
      recurringId: chosenRecurringId(recMatch, linkRecurring, manualRecId),
      eventPick,
      note: noteDraft ?? tx?.notes ?? '',
    });
    if (wouldReset) {
      setSplitResetOpen(true);
      return;
    }
    setSplitOpen(true);
  };
  const confirmSplitReset = () => {
    splitResetArmed.current = true;
    setSplitResetOpen(false);
    setSplitOpen(true);
  };
  // kind + counterparty rows live ON the card now (user simplification);
  // a user-picked transfer REQUIRES a counterparty, so dismissing the
  // picker without choosing rolls the kind back to what it was
  // #133 C/#221: the ask is keyed by the PICKED category — its default
  // pin and its account types both derive from the bijection (the ATM
  // pair asks among cash wallets and pins the space's own)
  const [counterAskCat, setCounterAskCat] = useState<string | null>(null);
  const [counterOpen, setCounterOpen] = useState(false);
  const counterFallback = useRef<ReviewDraft | null>(null);
  const counterChosen = useRef(false);
  // #237 r2: a pick pointed at an EXISTING row — specific to this card,
  // so the bulk offer stands down while it does. The warning asks first
  // when similar transactions were about to ride along.
  const [pickedPeer, setPickedPeer] = useState<{ txId: string; linkedId: string } | null>(null);
  const [pickWarn, setPickWarn] = useState<{ n: number; stage: () => void } | null>(null);
  // #268 (user): the per-sibling counter-match queue a confirmed
  // row-level pick leaves behind (draft snapshot at confirm time)
  const [counterBulk, setCounterBulk] = useState<{
    items: SpaceTx[];
    draft: ReviewDraft;
    recurringId?: string;
    eventId?: string;
    note?: string;
    target: { id: string; name: string };
  } | null>(null);
  // #268 r2 (user): while that queue walks the siblings, the deck must
  // not advance behind it — the just-confirmed card stays frozen (a
  // stale snapshot, edits closed) until the queue is done
  const [heldTx, setHeldTx] = useState<SpaceTx | null>(null);
  // #237 r3: the card's Counter-transaction row opens the match sheet
  // directly — the fork after the counterparty pick is gone
  const [counterTxOpen, setCounterTxOpen] = useState(false);
  // per-visit only (user ruling): mid-review side steps happen in sheets
  // that keep the screen mounted, so state survives those — but leaving
  // review and coming back later starts the deck from the top again.
  // #275: the ONE exception is the create-category detour — its stash
  // restores the skipped set so the deck resumes on the same card.
  const returnState = useRef(takeReviewReturn());
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set(returnState.current?.skippedIds ?? []));
  // the card's STAGED decision (review redesign): user edits live here,
  // only Confirm writes; null = untouched, follow tx + prediction live
  const [stagedDraft, setStagedDraft] = useState<ReviewDraft | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  // #324 (user): the card's staged note — null = untouched (the field
  // shows the row's own note); written with the confirm, bulk included
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
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
  // #161: the user's own event gesture outranks the memory's offer
  const eventTouched = useRef(false);
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
  // #268 r2 (user): the deck keeps showing the confirmed card (the held
  // snapshot) while the counter queue runs
  const tx = shownCard(heldTx, remaining);
  const heldDeck = heldDeckProps(!!counterBulk);
  // #275: back from the create-category detour — the same card is up
  // (skipped restored above); reopen the category editor once so the
  // fresh category is one tap away
  useEffect(() => {
    const back = returnState.current;
    if (back?.reopenCats && tx?.id === back.txId) {
      returnState.current = null;
      setCatsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.id]);

  const prediction = useMemo(
    () => (tx && memory ? predictTx({ memory, merchant: tx.merchant, titleOverride: tx.titleOverride, description: tx.description, amountCents: tx.amountCents }) : null),
    [tx, memory],
  );

  // counterparty IBAN belonging to one of MY OWN accounts = money moving
  // between my accounts — a transfer by definition, pre-applied (user
  // report: credit-card top-ups showed up as expense + income pairs)
  // the funding account, named on the card (user request)
  const cardAccount = useQuery(store, async () => (tx ? store.get('account', tx.accountId) : undefined), [tx?.accountId]);
  // R1: the row's own account stamps its type — the kind row locks and
  // a counterparty pick keeps the stamp with the forced movement sub
  const ownStamp = accountStamp(cardAccount?.type);
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
    () => applyOwnCounterDefault(baseDraft, ownCounter, cats, tx?.amountCents ?? 0, ownStamp),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tx?.id, ownCounter, prediction?.catId, cats, ownStamp],
  );
  // #228 r3: a predicted transfer resolves against the space's accounts
  // — clue-matched counterparty, or Uncategorized when nothing matches
  const spaceAccounts = useSpaceAccounts();
  const resolvedDraft = useMemo(
    () => resolveTransferPrediction(ownTransferDraft, tx, spaceAccounts, cats, ownStamp),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownTransferDraft, tx?.id, spaceAccounts, cats, ownStamp],
  );
  // #161: the remembered pct SPREAD rides in when the memory's category
  // stood (the guard rules live in applyPredictedSpread)
  const spreadDraft = useMemo(
    () => applyPredictedSpread(resolvedDraft, prediction, tx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedDraft, prediction, tx?.id],
  );
  const draft = stagedDraft ?? spreadDraft;
  const draftCounter = useQuery(
    store,
    async () => (draft?.linkedAccountId ? store.get('account', draft.linkedAccountId) : undefined),
    [draft?.linkedAccountId],
  );
  // a loan/mortgage counterparty makes this a DEBT payment: the account
  // IS the loan (v2), so the card names the counterparty itself and
  // retires the recurring row — a payoff transfer is not a recurring
  // cost (user request 2026-07-29)
  const isLoanCounter = loanCounterOf(draftCounter) !== undefined;
  // #237 r3: the Counter-transaction row's ingredients — the SPACE's
  // view of the counter account, and the face of whatever leg stands
  // (a stored pair reads first and locks the row; review never
  // re-points a stored pair)
  const counterAcct = spaceAccounts?.find((a) => a.id === draft?.linkedAccountId);
  const counterBankFed = (counterAcct?.source ?? 'manual') !== 'manual';
  const peerFaceRow = useMemo(
    () => {
      const standingPeerId = tx?.transferPeerId ?? pickedPeer?.txId;
      return standingPeerId ? allTxs?.find((r) => r.id === standingPeerId) : undefined;
    },
    [tx?.transferPeerId, pickedPeer, allTxs],
  );
  const counterTxRow = counterTxDescriptor(tx, counterAcct, peerFaceRow, counterBankFed, lang, t, () => setCounterTxOpen(true));
  const events = useEvents();
  const activeEvents = useMemo(() => (events ?? []).filter((e) => e.archived !== 1), [events]);
  const pickedEvent = activeEvents.find((e) => e.id === eventPick);
  // #161: the memory's event offer — only an ACTIVE event of THIS space
  // qualifies, and only until the user touches the event row themselves
  const predictedEventId = useMemo(
    () => (prediction?.eventId && activeEvents.some((e) => e.id === prediction.eventId) ? prediction.eventId : null),
    [prediction, activeEvents],
  );
  useEffect(() => {
    if (!eventTouched.current) setEventPick(predictedEventId);
    // per-card offer: the prediction lands whenever it resolves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predictedEventId, tx?.id]);
  const cat = cats.byId(draft?.catId);
  const parentColor = cat.parentId ? cats.byId(cat.parentId).color : cat.color;
  // #126 r3: with a real split the parts carry the stories — the main
  // card drops its kind/recurring/event rows and shows just the money
  const multiPart = (draft?.splits?.filter((s) => s.catId !== REIMBURSED_ID).length ?? 0) > 1;

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
  // partitions (parts or a category spread, #211) only fit exact twins
  // (same amount), percentage ones scale to any amount so the whole
  // merchant group stays eligible
  const draftSplits = draft?.splits;
  const draftCats = draft?.cats;
  const similar = useMemo(() => {
    if (!tx || !queue) return [] as SpaceTx[];
    const key = merchantKey(tx.merchant);
    const mustMatchAmount =
      (!!draftSplits?.length && !splitsArePct(draftSplits)) ||
      (!!draftCats?.length && !draftCats.every((e) => e.pct != null));
    // skipped cards left the deck on purpose — bulk must not drag them
    // back in (user request: the count follows the visible queue)
    return queue.filter(
      (item) =>
        item.id !== tx.id &&
        !skipped.has(item.id) &&
        // #268 r2 (user rule): forward only — the deck walks oldest to
        // newest, so the offer reaches same-day-or-newer rows; an older
        // row syncing in mid-card never joins a decision it was not
        // visible for
        item.date >= tx.date &&
        // decisions are sign-bound (income vs expense, reimbursement
        // side): a -€1000 sibling must never inherit a "received
        // reimbursement" decision made on +€1000 (user ss 2026-07-28)
        Math.sign(item.amountCents) === Math.sign(tx.amountCents) &&
        merchantKey(item.merchant) === key &&
        (!mustMatchAmount || item.amountCents === tx.amountCents),
    );
  }, [tx, queue, draftSplits, draftCats, skipped]);

  // fresh card: reset the staged draft and offer the link. This runs
  // DURING render (previous-id ref pattern), not in an effect — a late
  // effect flush could undo user input that landed right after the card
  // swap (a real race under coverage instrumentation)
  useFreshCardReset(tx?.id, () => {
    setStagedDraft(null);
    setLinkRecurring(true);
    setManualRecId(null);
    setEventPick(null);
    setNoteDraft(null);
    setDescExpanded(false);
    setPartsAttention(false);
    setCounterRequired(false);
    setSplitResetOpen(false);
    splitResetArmed.current = false;
    setPickedPeer(null);
    setPickWarn(null);
    setCounterTxOpen(false);
    eventTouched.current = false;
  });
  // the pick is bound to ITS counter account — re-picking or detaching
  // the counterparty (or the editor clearing the link) drops it
  useEffect(() => {
    if (pickedPeer && draft?.linkedAccountId !== pickedPeer.linkedId) setPickedPeer(null);
  }, [draft?.linkedAccountId, pickedPeer]);
  // #309: answering the counterparty clears the red field on the spot
  useEffect(() => {
    if (draft?.linkedAccountId) setCounterRequired(false);
  }, [draft?.linkedAccountId]);
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

  // #326 (user): quick-creating the counterparty account mid-review —
  // the ask's Create door mounts the chooser itself, so the card stages
  // its facts here while it is up: title, currency, the amount as the
  // loan's payment, the date's day as the due day, and a monthly plan
  // when the merchant's similar rows keep a near-monthly rhythm.
  useEffect(() => {
    if (!tx) return undefined;
    setChooserLoanPrefill({
      name: txTitle(tx),
      currency: tx.currency,
      paymentCents: Math.abs(tx.amountCents),
      paymentDay: Math.min(28, Number(tx.date.slice(8, 10)) || 1),
      paymentEvery: guessCadence([tx.date, ...similar.map((s) => s.date)]),
    });
    return () => setChooserLoanPrefill(null);
    // similarKey stands in for the similar array's identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.id, similarKey]);

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
    // r7: a split container never takes the recurring's category — the
    // parts own their categories (and their own recurring links)
    if (multiPartSplits(draft)) return;
    if (draft.catId === chosenRec.catId || draft.catId === EXPECTED_REIMBURSE_ID) return;
    // the recurring owns ONE category — a staged spread steps aside too
    setStagedDraft(withCategory(withSplits({ ...draft, cats: undefined }, undefined), chosenRec.catId, cats));
    // once per selection — the pick itself is the trigger, not the draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenRec?.id, chosenRec?.catId]);
  const recurringAllowedCats = chosenRec?.catId ? [chosenRec.catId, EXPECTED_REIMBURSE_ID] : undefined;

  const counterRowDoors = buildCounterRowDoors({
    draft,
    locked: draft?.txType === 'adjustment' || !!recurringAllowedCats,
    amountCents: tx?.amountCents,
    cats,
    setCounterAskCat,
    counterFallback,
    setCounterOpen,
    counterChosen,
    setStagedDraft,
  });

  const showReason = !!tx && !stagedDraft && prediction?.catId === draft?.catId;
  const reasonLine =
    showReason && prediction ? t(REASON_KEYS[prediction.source], { n: prediction.evidence ?? 1 }) : null;

  // #211: the cats editor spreads the NET money — a settled `reimbursed`
  // entry is bookkeeping, held aside and re-attached on stage
  const spreadRowCount = draft?.cats?.filter((e) => e.catId !== REIMBURSED_ID).length ?? 0;
  const settledCatEntry = draft?.cats?.find((e) => e.catId === REIMBURSED_ID);
  const settledCatsCents = settledCatEntry?.amountCents ?? 0;

  /** the settled row's gross partition, rewritten around a single pick */
  const settledCatsFor = (catId: string) =>
    settledCatEntry
      ? [
          ...(Math.abs(tx?.amountCents ?? 0) - settledCatsCents > 0
            ? [{ catId, amountCents: Math.abs(tx?.amountCents ?? 0) - settledCatsCents }]
            : []),
          settledCatEntry,
        ]
      : undefined;

  /** #330 (user): the armed split-reset lands HERE, at the editor's
   *  Done — consumes the warning's arm, drops the staged event/
   *  recurring/note picks and hands back the card's untouched baseline
   *  to apply onto; a cancelled editor never reaches this */
  const takeSplitResetBase = (): ReviewDraft | null => {
    if (!splitResetArmed.current) return null;
    splitResetArmed.current = false;
    eventTouched.current = true; // a conscious reset — the offer stays down
    setEventPick(null);
    setManualRecId(null);
    setNoteDraft(null);
    return spreadDraft;
  };

  /** ONE category decides the card — the VALUES-collapse path (catId
   *  only): stages it with the ◆ machinery — Transfer stages nothing
   *  until its mandatory counterparty answers; families ask right away.
   *  #330: `from` applies onto the reset baseline instead of the draft. */
  const stageSingleCategory = (catId: string, from?: ReviewDraft | null) => {
    const src = from ?? draft;
    if (!src) return;
    const family = specialCatType(catId);
    // #133 E: the ◆ Transfer pick stages NOTHING yet — the mandatory
    // counterparty answers it (dismiss = rollback, an unlinked transfer
    // is unrepresentable)
    if (family === 'transfer' && !ownStamp) {
      counterFallback.current = src;
      setCounterAskCat(catId);
      setCounterOpen(true);
      return;
    }
    const next = { ...withCategory(withSplits(src, undefined), catId, cats), cats: settledCatsFor(catId) };
    // #228: a REGULAR pick ends any movement story — the counterparty
    // clears with it (category and counter are one fact)
    setStagedDraft(family || ownStamp ? next : { ...next, linkedAccountId: undefined });
    // #133 C: a ◆ family pick unfolds the counterparty question right
    // away — the pinned Default, a real account, or dismiss (bare is
    // legal; Confirm links the default, #221). #152 r2/#221: the
    // Funding pick asks WHICH funding account, its shared pot pinned.
    if (family && family !== 'transfer' && !next.linkedAccountId && !ownStamp) {
      setCounterAskCat(catId);
      counterFallback.current = null;
      setCounterOpen(true);
    }
  };

  /** the cats EDITOR's single entry — its counterparty was already
   *  answered inside the editor (or deliberately left bare), so nothing
   *  asks afterwards; the entry's link IS the (split) transaction's one
   *  counterparty (#228) and stages at the row level. #218: a BARE
   *  entry CLEARS the row link too — the editor owns the whole story. */
  const stageSingleEntry = (entry: CatsApplyEntry) => {
    if (!draft) return;
    const next = { ...withCategory(withSplits(draft, undefined), entry.catId, cats), cats: settledCatsFor(entry.catId) };
    setStagedDraft({ ...next, linkedAccountId: entry.linkedAccountId });
  };

  const confirm = async () => {
    // #268 r2 (user): a held deck accepts no further confirms
    if (!tx || !draft || counterBulk) return;
    if (!draftReady(draft)) {
      // r7: a blocked Confirm POINTS at what holds it back — the deck
      // badges the parts that still need a category
      if (multiPartSplits(draft)) setPartsAttention(true);
      return;
    }
    // #309 (user): a movement category REQUIRES its counterparty — no
    // more silently settling onto the family default at Confirm. The
    // refused click marks the field red; the ask's pinned Default row
    // stays the one-tap answer for those who mean it. The DEBT family
    // keeps its designed bare story (unassigned payments await a loan).
    if (
      isMovementCat(draft.catId) &&
      specialCatType(draft.catId) !== 'debtPayment' &&
      !draft.linkedAccountId &&
      !draft.cats?.length &&
      !draft.splits?.length
    ) {
      setCounterRequired(true);
      return;
    }
    // r7: a split container carries no recurring/event of its own — the
    // parts do (their links ride inside draft.splits)
    const container = !multiPartSplits(draft);
    // #237 r2: a pick on any PART is specific to this transaction — the
    // bulk apply stands down. #268 (user): a ROW-level pick keeps bulk
    // alive instead — the siblings walk a per-transaction match queue.
    const partPeers = (draft.splits ?? []).filter((s) => s.transferPeerId && s.catId !== REIMBURSED_ID);
    const bulk = partPeers.length > 0 ? [] : similar.filter((s) => bulkSelected.has(s.id));
    const recurringId = container && !isLoanCounter ? chosenRecurringId(recMatch, linkRecurring, manualRecId) : undefined;
    const eventId = container ? (eventPick ?? undefined) : undefined;
    // #324 (user): untouched or unchanged notes write nothing
    const note = stagedNoteFor(noteDraft, container, tx.notes);
    const queued = queuedCounterBulk(pickedPeer, bulk, draft, spaceAccounts, recurringId, eventId, note);
    // #268 r2 (user): "wait with animating until we are done with the
    // bulk update" — a coming queue freezes the deck on this card; the
    // exit flight plays when the queue finishes instead of now
    if (queued) setHeldTx(tx);
    else captureLeaving();
    // #221→#309: the bare-movement default fallback is GONE — the gate
    // above guarantees every movement confirm carries its picked link
    // (which may well BE the family default, chosen in the ask).
    await writeConfirmation({
      tx,
      draft,
      recurringId,
      eventId,
      note,
      bulk: pickedPeer ? [] : bulk,
      transform,
      pairPeerId: pickedPeer?.txId,
    });
    await pairReviewPicks({ store, repo, spaceId }, tx, pickedPeer?.txId, partPeers);
    if (queued) setCounterBulk(queued);
    // other billing cycles of a linked recurring pick up their link here
    void recurringOps.reconcile().catch(() => undefined);
    logConfirmActivity({ store, repo, spaceId }, tx, !!pickedPeer, bulk.length);
    hapticNotify('SUCCESS'); // §5: a physical tick on the native shells
  };

  // #268: one queue step — the sibling gets the whole decision through
  // the same sibling-field mapper bulk uses, plus its OWN peer on a pick
  const resolveCounterBulk = async (item: SpaceTx, peerId: string | null) => {
    if (!counterBulk) return;
    await transform(
      item,
      {
        ...bulkFieldsFor(item, counterBulk.draft, counterBulk.recurringId, counterBulk.eventId, counterBulk.note),
        ...(peerId ? { transferPeerId: peerId } : {}),
      },
      null,
    );
    if (peerId) await pairWithExistingRow(store, repo, spaceId, item, peerId, allTxs);
  };

  const { progress, sub } = progressState(initialCount, queue?.length, skipped.size);

  const emptyBecauseSkipped = queue && queue.length > 0 && remaining?.length === 0;

  // desktop affordances (D5): Enter confirms, ←/→ skips to the next card —
  // never while a sheet is open or the focus sits in an input
  useEffect(() => {
    if (!tx) return;
    const onKey = (e: KeyboardEvent) => {
      // #268 r2 (user): the held deck ignores the keyboard too
      if (counterBulk) return;
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
          /* D3 focus layout: the deck becomes a fixed 520px column,
             horizontally centered; #151 (user): TOP-anchored — vertical
             centering made the card float mid-screen. The pickers slide
             in as dimmed right-hand panels, so the card stays visible
             while editing. Skip/Confirm attach under the card instead
             of the far bottom. #151 r2: "desktop" starts where the
             SIDEBAR does (md), not at lg — a 900px window kept the
             mobile bottom-pinned buttons. */
          <div
            /* #268 r2 (user): a held deck is inert — the queue sheet owns
               the screen; no edit or skip reaches the frozen card */
            className={`relative flex min-h-0 flex-1 flex-col md:mx-auto md:w-[520px] md:flex-none md:pb-10${heldDeck.inertCls}`}
          >
            {leavingHtml && (
              <div
                aria-hidden
                className="m-card-out pointer-events-none absolute inset-x-0 top-0 z-10"
                // our own just-rendered markup, snapshotted for the exit flight
                dangerouslySetInnerHTML={{ __html: leavingHtml }} // NOSONAR
              />
            )}
            <div key={`card-${tx.id}`} ref={cardRef} className="m-card-in">
            {/* #268 r2 (user): data-held marks the frozen face while the
                counter queue covers the screen — the deck sits still */}
            <div
              className="mt-4 overflow-hidden rounded-card border border-line bg-surface"
              data-testid="review-card"
              data-held={heldDeck.marker}
            >
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

              {/* categories first (#219), and — #228 feedback — the
                  counterparty back as the card's OWN row: counter-first
                  stages the special category, removal resets it. The
                  recurring-owned card keeps its category, so no counter
                  door there; adjustments carry no counterparty at all.
                  Multi-part (#126 r3): these rows vanish — each PART
                  carries its own story on the deck. */}
              <div data-testid="review-cats">
                <CardCategoryRows
                  draft={draft}
                  fallbackCat={cat}
                  fallbackColor={parentColor}
                  currency={tx.currency}
                  onOpenCategories={() => setCatsOpen(true)}
                  onEditCounter={counterRowDoors.onEdit}
                  counterRequired={counterRequired}
                  counterTx={counterTxRow}
                />

                {!multiPart && (
                  <DebtOrRecurringRow
                    isLoanCounter={isLoanCounter}
                    recMatch={recMatch}
                    linkRecurring={linkRecurring}
                    manualRec={manualRec}
                    amountCents={tx.amountCents}
                    currency={tx.currency}
                    onEdit={() => setRecPickOpen(true)}
                  />
                )}

                {!multiPart && (
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
                )}

                {/* #324 (user): the note joins the review card — staged
                    like every other field, written on Confirm, and the
                    bulk update carries it to the selected siblings */}
                {!multiPart && (
                  <div className="flex w-full items-start gap-2.5 px-4 py-2.5">
                    <Icon name="note-text-outline" size={18} color="var(--m-ink-3)" style={{ marginTop: 8 }} />
                    {/* #324 r2 (user): a real white FIELD, not bare text in
                        the card — the standard input skin; the #327 inset
                        focus ring draws cleanly on the bg-surface box */}
                    <textarea
                      data-testid="review-notes"
                      value={noteDraft ?? tx.notes ?? ''}
                      onChange={(e) => {
                        setNoteDraft(e.target.value);
                        autoGrowNotes(e.currentTarget);
                      }}
                      placeholder={t('tx.notesPlaceholder')}
                      rows={1}
                      className="min-w-0 flex-1 resize-none rounded-input border border-line bg-surface px-3 py-2 text-[14px] leading-snug text-ink outline-none placeholder:text-ink-4"
                    />
                    <span className="text-[11px] text-ink-4" style={{ marginTop: 10 }}>{t('tx.notes')}</span>
                  </div>
                )}

                {/* #249 (user): the split door comes LAST — categories,
                    counterparty, recurring and event lead; splitting is
                    the escape hatch, not the second suggestion */}
                {!multiPart && (
                  <button
                    data-testid="review-split-row"
                    onClick={requestSplit}
                    className="m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-2.5 text-left text-[14px] text-ink"
                  >
                    <Icon name="call-split" size={18} color="var(--m-ink-3)" />
                    <span className="min-w-0 flex-1 truncate">{t('split.title')}</span>
                    <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
                  </button>
                )}
              </div>

              {/* contextual offers keep their chip shape under the rows.
                  #219: the green "between your own accounts" chip is gone
                  — the category row already names the link, and detaching
                  lives in the category editor's ask (#218) */}
              {settleMatch && draft && (
                <div className="px-4 pb-3">
                  <Chip
                    testId="review-settle-match"
                    selected={draft.txType === 'transfer'}
                    onClick={() => setStagedDraft(stageAsSettlement(draft, cats))}
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

            {/* #126: the split stands as stacked cards under the main one */}
            {draft && (
              <ReviewPartDeck
                key={tx.id}
                splits={draft.splits}
                rowType={draft.txType}
                tx={tx}
                activeEvents={activeEvents}
                // #289 (user): parts pick freely — a split confirm never
                // carries the recurring link anyway (container-only)
                allowedCatIds={undefined}
                lockedKind={!!ownStamp}
                recurrings={activeRecs}
                attention={partsAttention}
                onOpenValues={() => setSplitOpen(true)}
                onSplits={(next) => setStagedDraft(withSplits(draft, next))}
                onPickExisting={(stage) => stageWithBulkWarning(similar.length, stage, setPickWarn)}
              />
            )}

            {/* #237 r2: a PART-level pick silences the bulk offer.
                #268 (user): a row-level pick keeps it — confirm walks the
                siblings through their own counter-match queue. */}
            {!(draft?.splits ?? []).some((s) => s.transferPeerId) && (
              <BulkConfirmSection similar={similar} selected={bulkSelected} onChange={setBulkSelected} />
            )}
            </div>

            {/* mobile: pinned to the thumb at the bottom; md+: attached to the card */}
            <div className="mt-auto flex gap-3 pt-4 md:mt-0">
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
                // r7: a split whose parts are incomplete keeps the button
                // TAPPABLE — the tap marks the parts needing attention
                disabled={!draft || (!draftReady(draft) && !multiPartSplits(draft))}
                onClick={() => void confirm()}
              >
                <span className="truncate">
                  {/* multi-category: the list above already says it all */}
                  {draft?.catId && !draft.splits?.length && spreadRowCount <= 1
                    ? t('review.confirmAs', { name: catName(cat, t) })
                    : t('review.confirm')}
                </span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* #211: the split-TRANSACTION editor — pure money partition; the
          parts complete their stories on the deck below the card */}
      {tx && draft && (
        <SplitEditorSheet
          open={splitOpen}
          // #330 (user): closing without Done stands the armed reset down
          // — the staged decisions survive a cancelled split editor
          onOpenChange={(next) => {
            setSplitOpen(next);
            if (!next) splitResetArmed.current = false;
          }}
          tx={tx}
          // empty value: the editor itself seeds "current category owns the
          // full amount + one fresh row" — exactly the add-part start
          value={draft.splits}
          seedSingle
          seedCatId={draft.catId}
          // #330 (user): Done is where the warned reset finally lands —
          // the split applies onto the untouched baseline, not the draft
          onApply={(splits) => {
            setStagedDraft(withSplits(takeSplitResetBase() ?? draft, splits ?? undefined));
          }}
          onApplySingle={(catId) => stageSingleCategory(catId, takeSplitResetBase())}
        />
      )}
      {/* #211: the split-CATEGORIES editor — the chip's door. One entry
          is a plain category pick (a lone ◆ pick asks its counterparty
          inside the editor — the transaction-level answer, #228); a
          spread stages regular categories and drops the row-level link
          (a spread means no movement story). A settled `reimbursed`
          entry is bookkeeping: held aside here, re-attached on stage. */}
      {tx && draft && (
        <CatsSheet
          open={catsOpen}
          onOpenChange={setCatsOpen}
          subject={{
            id: tx.id,
            label: txTitle(tx),
            catId: draft.catId,
            // #228 feedback: the FULL partition rides in — the sheet
            // pins settled bookkeeping read-only and nets the gross
            cats: draft.cats?.length ? draft.cats : undefined,
            amountCents: Math.abs(tx.amountCents),
            linkedAccountId: draft.linkedAccountId,
            transferPeerId: tx.transferPeerId,
          }}
          currency={tx.currency}
          direction={tx.amountCents < 0 ? 'debit' : 'credit'}
          txType={draft.txType}
          allowedCatIds={recurringAllowedCats}
          title={t('split.catsTitle')}
          reason={reasonLine}
          includePct
          excludeAccountId={tx.accountId}
          askDisabled={!!ownStamp}
          // #275: the create-category door stashes the deck's place —
          // the detour returns to THIS card with the editor reopened
          onCreateCustomNav={() => setReviewReturn({ skippedIds: [...skipped], txId: tx.id, reopenCats: true })}
          onApply={(entries) => {
            if (entries.length === 1) {
              stageSingleEntry(entries[0]);
              return;
            }
            const full = settledCatEntry ? [...entries, settledCatEntry] : entries;
            const primary = entries.reduce((best, e) => (e.amountCents > best.amountCents ? e : best), entries[0]);
            setStagedDraft({ ...withCats(draft, full), catId: primary.catId, linkedAccountId: undefined });
          }}
        />
      )}
      {/* r7 (user rule): splitting resets the card's own decisions — a
          conscious continue, never a silent drop */}
      <Sheet open={splitResetOpen} onOpenChange={setSplitResetOpen} title={t('split.resetWarnTitle')} size="compact">
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-[13px] leading-relaxed text-ink-2">{t('split.resetWarnBody')}</p>
          <Button data-testid="split-reset-continue" onClick={confirmSplitReset}>
            {t('split.resetContinue')}
          </Button>
          <Button variant="outline" data-testid="split-reset-cancel" onClick={() => setSplitResetOpen(false)}>
            {t('action.cancel')}
          </Button>
        </div>
      </Sheet>
      {/* #237 r2 (user): pointing at an EXISTING counter transaction
          turns the pending bulk update off — the other siblings'
          counterparts can't be predicted; creating new legs bulk-applies
          fine. The sheet asks before the pick lands. */}
      <Sheet
        open={pickWarn !== null}
        onOpenChange={(next) => {
          if (!next) setPickWarn(null);
        }}
        title={t('review.pickBulkTitle')}
        size="form"
      >
        <p className="pb-4 text-[13px] leading-relaxed text-ink-2" data-testid="review-pick-warn">
          {t('review.pickBulkBody', { n: pickWarn?.n ?? 0 })}
        </p>
        <div className="flex flex-col gap-2">
          <Button
            data-testid="review-pick-continue"
            onClick={() => {
              pickWarn?.stage();
              setPickWarn(null);
            }}
          >
            {t('review.pickBulkGo')}
          </Button>
          <Button variant="outline" data-testid="review-pick-cancel" onClick={() => setPickWarn(null)}>
            {t('action.cancel')}
          </Button>
        </div>
      </Sheet>
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
              setCounterAskCat(null);
            }
          }}
          excludeAccountId={tx.accountId}
          currentLinkedId={draft.linkedAccountId}
          defaultFamily={askDefaultFamily(counterAskCat)}
          counterTypes={askCounterTypes(counterAskCat)}
          // #237 r3 (user): ONE tap — no fork sheet after the pick; the
          // card's Counter-transaction row owns the leg question now
          onChoose={(account) => {
            counterChosen.current = true;
            setStagedDraft(withLinkedAccount(draft, account, cats, tx?.amountCents, ownStamp));
          }}
          // #228 feedback: the card row's remove door — the counterparty
          // and the category are one fact, so removal resets the pick
          onDetach={counterRowDoors.onDetach}
        />
      )}
      {/* #237 r3: the card row's counter-transaction match sheet —
          suggestions first, the rest scrollable; create/await resets
          the pick; a pick with a standing bulk offer warns first.
          (counterAcct non-null already means the draft carries a link)
          #268 r2 (user): a held deck folds it away — the queue's own
          match sheet is the only one on screen */}
      {tx && counterAcct && !counterBulk && (
        <CounterMatchSheet
          open={counterTxOpen}
          onOpenChange={setCounterTxOpen}
          target={{ id: counterAcct.id, name: counterAcct.name }}
          anchor={{ id: tx.id, amountCents: tx.amountCents, date: tx.date }}
          rows={allTxs ?? []}
          onCreate={resetPickDoor(counterBankFed, false, () => setPickedPeer(null))}
          onWait={resetPickDoor(counterBankFed, true, () => setPickedPeer(null))}
          onPick={(pickedId) => {
            // #268 (user): a row-level pick no longer stands bulk down —
            // confirm walks the siblings through their own match queue
            setPickedPeer({ txId: pickedId, linkedId: counterAcct.id });
          }}
        />
      )}
      {/* #268 (user): the per-sibling counter-match queue a confirmed
          pick-existing leaves behind — each selected sibling picks its
          own counter row or links and waits */}
      {counterBulk && (
        <BulkCounterQueue
          queue={counterBulk.items}
          target={counterBulk.target}
          rows={allTxs ?? []}
          onResolve={(item, peerId) => void resolveCounterBulk(item as SpaceTx, peerId)}
          onDone={(resolved) => {
            if (resolved > 0) void logActivity(store, repo, spaceId, 'review', `+${resolved}`);
            // #268 r2 (user): release the hold — the deferred exit
            // flight plays now and the deck advances to the next card
            captureLeaving();
            setCounterBulk(null);
            setHeldTx(null);
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
          // #331 (user): a category picked upfront rides into the form
          initial={{ ...formFromTx(tx), catId: stagedRealCatId(draft?.catId) }}
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
                eventTouched.current = true;
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
                  eventTouched.current = true;
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
          onSaved={(id) => {
            eventTouched.current = true;
            setEventPick(id);
          }}
          onClose={() => setEventCreating(false)}
        />
      )}
    </div>
  );
}
