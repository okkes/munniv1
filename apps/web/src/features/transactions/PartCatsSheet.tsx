import { useEffect, useRef, useState } from 'react';
import { useLang } from '@/i18n';
import { fmtCents, parseCents } from '@/lib/money';
import { nextAmountEntry } from '@/lib/amountRegister';
import type { AmountEntryMode } from '@/lib/amountRegister';
import { REIMBURSED_ID, UNCATEGORIZED_ID, specialCatType } from '@/domain/categories';
import { defaultFamilyFor } from '@/domain/defaultAccounts';
import { counterTypesFor, movementCatFor, movementCatsForCounter } from '@/domain/txType';
import { kindOf } from '@/domain/txKind';
import { resolveSplitsFor } from '@/domain/splits';
import { useSpaceAccounts } from '@/application/transactions';
import type { DefaultFamily } from '@/application/defaultAccounts';
import { catName, useCategories } from '@/features/categories/useCategories';
import { CategoryPicker } from '@/features/categories/CategoryPicker';
import { CounterpartySheet } from './TxKindSheet';
import type { AccountType, TxSplit, TxSplitCat, TxType } from '@/db/types';
import { Button } from '@/ui/Button';
import { FormBlockerNote } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { InfoHint } from '@/ui/InfoHint';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';

/** one category's share of the part while editing. The link fields are
 *  SINGLE-entry transit only (#228): the one counterparty a (split)
 *  transaction has rides the lone entry out to the caller, which lands
 *  it at the row/part level — a multi-entry spread never carries any. */
interface CatEntry {
  key: string;
  catId: string;
  amount: string; // user-facing text in the mode's units, EU decimals
  linkedAccountId?: string;
  transferPeerId?: string;
}

/** what the editor hands back: plain entries, plus — on the SINGLE
 *  entry only — the subject-level counterparty decision (#228) */
export interface CatsApplyEntry extends TxSplitCat {
  linkedAccountId?: string;
  transferPeerId?: string;
}

/** #133 r4: does this category ask a counterparty, and which face of
 *  the sheet answers it? #221: EVERY ask pins its default — the transfer
 *  family gets the default bank account, the ATM pair its cash wallet,
 *  funding its shared pot. #133 r5: every ask lists only the account
 *  types its category can mean (the bijection). Transfer stays the
 *  mandatory ask (dismiss rolls back — bare transfer is
 *  unrepresentable); the pinned default is its one-tap answer. */
function counterAskFor(catId: string): { defaultFamily?: DefaultFamily; counterTypes?: readonly AccountType[]; mandatory: boolean } | null {
  const family = specialCatType(catId);
  if (!family) return null;
  return {
    defaultFamily: defaultFamilyFor(catId) ?? undefined,
    counterTypes: counterTypesFor(catId),
    mandatory: family === 'transfer',
  };
}

/** the link fields the SINGLE entry carries out of the editor */
const entryLink = (entry: Pick<CatEntry, 'linkedAccountId' | 'transferPeerId'>): Partial<CatsApplyEntry> => ({
  ...(entry.linkedAccountId ? { linkedAccountId: entry.linkedAccountId } : {}),
  ...(entry.transferPeerId ? { transferPeerId: entry.transferPeerId } : {}),
});

/** #218: a pick the LINKED counter can also mean keeps the link (credit
 *  card: transfer ⇄ debt payment). #228: the mirror key is the row/part
 *  itself now, so the peer simply rides — the mirror files by ITS
 *  counter's kind and needs no re-key. Null = not a keep. (S3776) */
function keepLinkPatch(
  prev: CatEntry | undefined,
  catId: string,
  accounts: readonly { id: string; type: AccountType }[] | undefined,
): Partial<CatEntry> | null {
  const counterType = accounts?.find((a) => a.id === prev?.linkedAccountId)?.type;
  if (!prev?.linkedAccountId || !counterType || !counterTypesFor(catId)?.includes(counterType)) return null;
  return { catId };
}

/** #218: with a counterparty on the entry the picker narrows to what
 *  that counter can mean; undefined = no narrowing (S3776) */
function counterNarrowFor(
  accounts: readonly { id: string; type: AccountType }[] | undefined,
  entry: CatEntry | undefined,
  direction: 'debit' | 'credit',
): string[] | undefined {
  const type = accounts?.find((a) => a.id === entry?.linkedAccountId)?.type;
  return type ? [...movementCatsForCounter(type, direction)] : undefined;
}

/** #218: an UNSTAMPED subject's derived transfer-kind type must not
 *  gate the picker — the matrix and the counter narrowing govern.
 *  Stamps and adjustments keep their deliberate narrow lists. (S3776) */
const pickerTxTypeFor = (askDisabled: boolean, txType: TxType | undefined): TxType | undefined =>
  !askDisabled && txType && kindOf(txType) === 'transfer' ? undefined : txType;

// showsCounterLine retired (#228 feedback): the counterparty wears its
// own property row on every surface (detail, part page, review card) —
// the editor no longer displays it under the category. The pick-time
// ASK on a lone ◆ pick stays: it IS the subject-level answer.

/** #218/#228 (user): detaching the counterparty RESETS the category —
 *  a special category and its counter are one story, so removing the
 *  account starts the question over (S3776) */
const detachPatch = (catId: string | undefined): Partial<CatEntry> => ({
  linkedAccountId: undefined,
  transferPeerId: undefined,
  ...(specialCatType(catId ?? '') ? { catId: UNCATEGORIZED_ID } : {}),
});

/** #133 r5/#218: the answered account's KIND names the category —
 *  counterparty-first fills a fresh entry, a matching ask is a no-op,
 *  and a Create-door kind mismatch refiles honestly (S3776) */
const answeredCatFor = (current: CatEntry | undefined, accountType: AccountType, sign: 1 | -1): string | undefined =>
  current && (current.catId === UNCATEGORIZED_ID || specialCatType(current.catId)) ? movementCatFor(accountType, sign) : undefined;

let entryCounter = 0;
const newKey = () => `pc${entryCounter++}`;
const toText = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const toPctText = (pct: number) => String(pct).replace('.', ',');
const parsePct = (text: string): number => {
  const n = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/** the part patch a finished spread becomes: one entry collapses back to
 *  a plain category, several keep the spread with the largest entry as
 *  the compat shadow (v2.1 storage rule). #228: a spread's categories
 *  are regular — the part-level link clears with it (the counterparty
 *  belongs to a movement story, and the spread just ended it). Settled
 *  `reimbursed` bookkeeping the subject carried always re-attaches —
 *  only the reimbursement link itself can remove it. */
export function catsPatch(entries: CatsApplyEntry[], settled: readonly TxSplitCat[] = []): Partial<TxSplit> {
  if (entries.length <= 1) {
    const catId = entries[0]?.catId ?? UNCATEGORIZED_ID;
    return {
      catId,
      cats: settled.length ? [{ catId, amountCents: entries[0]?.amountCents ?? 0 }, ...settled] : undefined,
    };
  }
  const primary = entries.reduce((best, entry) => (entry.amountCents > best.amountCents ? entry : best), entries[0]);
  return {
    catId: primary.catId,
    cats: [
      ...entries.map((entry) => ({ catId: entry.catId, amountCents: entry.amountCents, ...(entry.pct !== undefined ? { pct: entry.pct } : {}) })),
      ...settled,
    ],
    linkedAccountId: undefined,
    transferPeerId: undefined,
  };
}

/** the subject's settled `reimbursed` entries — bookkeeping the editor
 *  pins read-only and every apply re-attaches (#228 feedback) */
export const settledEntriesOf = (cats: readonly TxSplitCat[] | undefined): TxSplitCat[] =>
  (cats ?? []).filter((c) => c.catId === REIMBURSED_ID).map((c) => ({ catId: c.catId, amountCents: c.amountCents }));

/** rewrite a subject's partition around ONE category, keeping the
 *  settled bookkeeping (#228: the counterparty doors pick/reset the
 *  category — the reimbursement's slice is never theirs to drop) */
export const catsAroundSingle = (
  subject: { amountCents: number; cats?: TxSplitCat[] },
  catId: string,
): TxSplitCat[] | undefined => {
  const settled = settledEntriesOf(subject.cats);
  return settled.length ? [{ catId, amountCents: subjectNetCents(subject) }, ...settled] : undefined;
};

/** the full apply for a part's category edit: the cats patch plus the R3
 *  type pull — a single ◆ special pick pulls the part's own type, an
 *  ordinary single pick clears a stale pulled one (a counterparty-backed
 *  transfer type stays deliberate). Spreads never pull. #228: the single
 *  entry's counterparty (answered inside the editor) IS the part's own
 *  link — a bare single pick clears a stale one. */
export function partCatsApplyPatch(slice: TxSplit | undefined, entries: CatsApplyEntry[]): Partial<TxSplit> {
  const patch = catsPatch(entries, settledEntriesOf(slice?.cats));
  if (entries.length !== 1) return patch;
  const entry = entries[0];
  const link = { linkedAccountId: entry.linkedAccountId, transferPeerId: entry.transferPeerId };
  const pulled = specialCatType(entry.catId);
  if (pulled) return { ...patch, ...link, txType: pulled };
  return slice?.txType && !slice.linkedAccountId ? { ...patch, ...link, txType: undefined } : { ...patch, ...link };
}

/** whose money the sheet spreads: a container PART or — #211 — the
 *  whole transaction itself; both carry the same category anatomy */
export interface CatsSubject {
  /** stable identity for the reseed effect (part id / tx id) */
  id?: string;
  label?: string;
  catId?: string;
  /** the FULL partition — settled `reimbursed` entries included; the
   *  sheet pins those read-only and edits only the real ones */
  cats?: TxSplitCat[];
  /** the subject's GROSS money — the sheet nets any settled value the
   *  partition carries before balancing */
  amountCents: number;
  /** #228: the subject's ONE counterparty — seeds the lone entry so its
   *  link shows; a spread never carries it */
  linkedAccountId?: string;
  transferPeerId?: string;
}

const seedEntries = (subject: CatsSubject, pctMode: boolean): CatEntry[] => {
  const real = (subject.cats ?? []).filter((c) => c.catId !== REIMBURSED_ID);
  const base: TxSplitCat[] = real.length
    ? real
    : [{ catId: subject.catId ?? UNCATEGORIZED_ID, amountCents: subjectNetCents(subject) }];
  // #228: the subject's one counterparty belongs to the LONE entry only —
  // a spread's rows never wear links
  const single = base.length === 1;
  return base.map((entry) => ({
    key: newKey(),
    catId: entry.catId,
    amount: pctMode && entry.pct !== undefined ? toPctText(entry.pct) : toText(entry.amountCents),
    ...(single ? { linkedAccountId: subject.linkedAccountId, transferPeerId: subject.transferPeerId } : {}),
  }));
};

/** what the editor actually partitions: the gross minus the settled
 *  bookkeeping (that slice belongs to the reimbursement link alone) */
const subjectNetCents = (subject: Pick<CatsSubject, 'amountCents' | 'cats'>): number =>
  Math.max(
    0,
    Math.abs(subject.amountCents) - settledEntriesOf(subject.cats).reduce((sum, c) => sum + c.amountCents, 0),
  );

/** a %-typed spread reopens in % — the stored pct is the user's shape.
 *  #216: the settled `reimbursed` bookkeeping entry never carries a pct
 *  and must not flip a %-shaped spread back to amounts. */
const seedsAsPct = (subject: CatsSubject): boolean => {
  const real = (subject.cats ?? []).filter((entry) => entry.catId !== REIMBURSED_ID);
  return real.length > 0 && real.every((entry) => entry.pct != null);
};

/**
 * #126 r6/r7 (user request): money spreads across categories with the
 * SAME editor logic the whole transaction had before splitting existed:
 * category + amount rows, exact euros or percentages, register-style
 * entry, and the leftover pill that fills the field it was tapped from
 * (#130). #211 made it THE split-categories editor — the row's own
 * spread and a part's spread are the same gesture; the split-transaction
 * editor is a different door entirely. #228 (user): only ONE special
 * category per (split) transaction, and it spans the whole — a lone ◆
 * pick asks its counterparty on the spot (the subject-level answer);
 * a spread offers regular and reimbursement categories only. Mixing a
 * special with others means splitting the TRANSACTION instead.
 */
export function CatsSheet({
  open,
  onOpenChange,
  subject,
  currency,
  direction,
  txType,
  allowedCatIds,
  title,
  reason,
  includePct = false,
  excludeAccountId,
  askDisabled = false,
  anchor,
  onCreateCustomNav,
  onApply,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** whose money is being spread; undefined while closed */
  subject?: CatsSubject;
  currency: string;
  direction: 'debit' | 'credit';
  /** gates the picker; undefined = direction-only (the add form) */
  txType?: TxType;
  allowedCatIds?: readonly string[];
  /** row-level callers say "Split categories"; parts keep their title */
  title?: string;
  /** why the current category was suggested (review) — shown inline */
  reason?: string | null;
  /** row-level spreads keep their % shape for the #141 sibling offer */
  includePct?: boolean;
  /** #133 r4: the owning account — its own rows never list as candidates */
  excludeAccountId: string;
  /** R1: a stamped account's rows never ask (the stamp owns the story) */
  askDisabled?: boolean;
  /** the row being spread — enables the pick-existing fork on manual
   *  counterparties (row-level editors only; the lone entry anchors) */
  anchor?: { id: string; date: string };
  /** #275: forwarded to the picker's create-custom door */
  onCreateCustomNav?: () => void;
  onApply: (entries: CatsApplyEntry[]) => void;
}>) {
  const { t, lang } = useLang();
  const cats = useCategories();
  const accounts = useSpaceAccounts();
  const [entries, setEntries] = useState<CatEntry[]>([]);
  const [mode, setMode] = useState<'amount' | 'pct'>('amount');
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  // #133 r4: which entry's counterparty question is open, and — on a ◆
  // Transfer pick — the category to roll back to if the ask is dismissed
  // (an unlinked transfer is unrepresentable, same rule as whole rows)
  const [counterFor, setCounterFor] = useState<number | null>(null);
  const rollbackRef = useRef<{ index: number; catId: string; linkedAccountId?: string; transferPeerId?: string } | null>(null);
  // focusing empties the field so typing replaces; blurring an untouched
  // empty field restores the stashed value (split-editor behavior)
  const [focusStash, setFocusStash] = useState<{ index: number; amount: string } | null>(null);
  const [entryMode, setEntryMode] = useState<AmountEntryMode>('register');
  // #130: the pill's pointerdown runs BEFORE the focused field blurs —
  // capture WHICH field the user meant here
  const pendingTarget = useRef<number | null>(null);

  // #228 feedback: the settled `reimbursed` bookkeeping is pinned, read-
  // only — the user removes the reimbursement LINK to get rid of it; the
  // editable entries partition what is left
  const settled = settledEntriesOf(subject?.cats);
  const refCents = subject ? subjectNetCents(subject) : 0;
  // #195: tappable — an invalid tap arms the aria/error state
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    if (!open || !subject) return;
    const pctMode = includePct && seedsAsPct(subject);
    setMode(pctMode ? 'pct' : 'amount');
    setEntries(seedEntries(subject, pctMode));
    setCounterFor(null);
    setAttempted(false);
    rollbackRef.current = null;
    // deliberately only on open: the sheet owns its rows while open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subject?.id]);

  const valueOf = (entry: CatEntry) => (mode === 'pct' ? parsePct(entry.amount) : (parseCents(entry.amount) ?? 0));
  /** the entry's share in CENTS — anchors the pick-existing fork */
  const centsOf = (entry: CatEntry) => {
    if (entries.length === 1) return refCents; // spans the whole
    if (mode === 'pct') return Math.round((parsePct(entry.amount) / 100) * refCents);
    return parseCents(entry.amount) ?? 0;
  };
  const remainder = (mode === 'pct' ? 100 : refCents) - entries.reduce((sum, entry) => sum + valueOf(entry), 0);
  const unpicked = entries.some((entry) => entry.catId === UNCATEGORIZED_ID);
  const duplicate = new Set(entries.map((entry) => entry.catId)).size !== entries.length;
  // #133 r4 safety net: a Transfer entry without its counterparty is
  // unrepresentable — the mandatory ask normally guarantees this
  const transferUnlinked = entries.some(
    (entry) => specialCatType(entry.catId) === 'transfer' && !entry.linkedAccountId && !askDisabled,
  );
  // ONE entry means "just this category" — it spans the whole by
  // definition (the add form has no amount yet, review parity keeps
  // the single pick one tap)
  const ready =
    (entries.length === 1
      ? !unpicked
      : entries.length > 0 && remainder === 0 && !unpicked && !duplicate && entries.every((entry) => valueOf(entry) > 0)) &&
    !transferUnlinked;
  // #228 (user): a special category spans the whole (split) transaction
  // — no rows can join it. Splitting the TRANSACTION is the way to
  // combine it with anything else.
  const specialClaims = entries.length === 1 && !!specialCatType(entries[0].catId);
  // finish the open entry first (split-editor rule): no new row while
  // one is still uncategorized or worth nothing
  const addBlocked = specialClaims || entries.some((entry) => entry.catId === UNCATEGORIZED_ID || valueOf(entry) <= 0);

  const patchEntry = (index: number, patch: Partial<CatEntry>) =>
    setEntries((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /** euros ⇄ percentages, the split editor's exact conversion rules */
  const switchMode = (next: 'amount' | 'pct') => {
    if (next === mode) return;
    setMode(next);
    if (next === 'pct') {
      setEntries((rows) =>
        rows.map((row) => {
          const cents = parseCents(row.amount) ?? 0;
          return { ...row, amount: refCents > 0 ? toPctText(Math.round((cents / refCents) * 100)) : '0' };
        }),
      );
    } else {
      setEntries((rows) => {
        const pctSplits = rows.map((row) => ({ catId: row.catId, amountCents: 0, pct: parsePct(row.amount) }));
        const resolved = resolveSplitsFor(refCents, pctSplits);
        return rows.map((row, i) => ({ ...row, amount: toText(Math.abs(resolved[i]?.amountCents ?? 0)) }));
      });
    }
  };

  const onAmount = (index: number, raw: string) => {
    // register-style entry is a euros affordance; percentages type plain
    if (mode === 'pct') {
      patchEntry(index, { amount: raw });
      return;
    }
    const next = nextAmountEntry(entryMode, entries[index]?.amount ?? '', raw);
    setEntryMode(next.mode);
    patchEntry(index, { amount: next.text });
  };
  const onFocus = (index: number, el?: HTMLInputElement) => {
    // the register arms right away; the empty-for-typing happens ONE
    // FRAME LATER (#134): iOS WebKit stalls the caret when the value
    // swaps in the same beat as focus. Stand down if focus moved on.
    setEntryMode('register');
    const amount = entries[index]?.amount ?? '';
    requestAnimationFrame(() => {
      // another editable already took focus (spam-switch): stand down.
      // (Synthetic test focus leaves activeElement on body — proceed.)
      const active = document.activeElement;
      if (el && active !== el && active instanceof HTMLElement && active.matches('input, textarea')) return;
      // typing already replaced the value inside this frame: keep it
      if (el && el.value !== amount) return;
      setFocusStash({ index, amount });
      patchEntry(index, { amount: '' });
    });
  };
  const onBlur = (index: number) => {
    if (focusStash?.index === index && (entries[index]?.amount ?? '').trim() === '') {
      patchEntry(index, { amount: focusStash.amount });
    }
    setFocusStash(null);
  };

  const balance = () => {
    const forced = pendingTarget.current;
    pendingTarget.current = null;
    setEntries((rows) => {
      const values = rows.map((row) => (mode === 'pct' ? parsePct(row.amount) : (parseCents(row.amount) ?? 0)));
      const firstEmpty = values.indexOf(0);
      const target = forced ?? (firstEmpty === -1 ? rows.length - 1 : firstEmpty);
      const others = values.reduce((sum, v, i) => (i === target ? sum : sum + v), 0);
      const open = Math.max(0, (mode === 'pct' ? 100 : refCents) - others);
      return rows.map((row, i) =>
        i === target ? { ...row, amount: mode === 'pct' ? toPctText(open) : toText(open) } : row,
      );
    });
  };

  const addEntry = () =>
    setEntries((rows) => [
      ...rows,
      {
        key: newKey(),
        catId: UNCATEGORIZED_ID,
        amount: mode === 'pct' ? toPctText(Math.max(remainder, 0)) : toText(Math.max(remainder, 0)),
      },
    ]);
  const removeEntry = (index: number) => setEntries((rows) => rows.filter((_, i) => i !== index));

  const apply = () => {
    if (!ready) return;
    // Done CLOSES the sheet (like every editor) — the callers only
    // stage/write; in a real browser a lingering open sheet would
    // shield everything underneath (the review-a2 CI catch)
    const emit = (out: CatsApplyEntry[]) => {
      onApply(out);
      onOpenChange(false);
    };
    // the single entry spans the whole — its typed amount is decorative;
    // #228: only the LONE entry carries the subject-level counterparty
    if (entries.length === 1) {
      emit([{ catId: entries[0].catId, amountCents: refCents, ...entryLink(entries[0]) }]);
      return;
    }
    if (mode === 'pct') {
      const resolved = resolveSplitsFor(
        refCents,
        entries.map((entry) => ({ catId: entry.catId, amountCents: 0, pct: parsePct(entry.amount) })),
      );
      emit(
        resolved.map((slice) => ({
          catId: slice.catId,
          amountCents: Math.abs(slice.amountCents),
          // the % shape survives on row spreads (#141: pct scales to any
          // sibling; exact euros reach only exact twins)
          ...(includePct && slice.pct !== undefined ? { pct: slice.pct } : {}),
        })),
      );
      return;
    }
    emit(entries.map((entry) => ({ catId: entry.catId, amountCents: parseCents(entry.amount) ?? 0 })));
  };

  const shownRemainder = mode === 'pct' ? `${remainder}%` : fmtCents(Math.abs(remainder), currency, lang);
  // #133 r5: the owning account's type is the picker's context — the
  // matrix narrows the movement subs to the ones this row can mean
  const sourceType = (accounts ?? []).find((a) => a.id === excludeAccountId)?.type;
  const pickedCatId = pickerFor === null ? undefined : entries[pickerFor]?.catId;
  // #218 (user): with a counterparty already on the entry the picker
  // narrows to what THAT counter can mean (credit card: transfer or
  // debt payment) — anything else needs the detach door first
  const pickerEntry = pickerFor === null ? undefined : entries[pickerFor];
  const counterNarrowedIds = counterNarrowFor(accounts, pickerEntry, direction);
  const pickerTxType = pickerTxTypeFor(askDisabled, txType);
  const excluded = entries
    .filter((_, i) => i !== pickerFor)
    .map((entry) => entry.catId)
    .filter((catId) => catId !== UNCATEGORIZED_ID);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={title ?? t('split.partCatsTitle')} size="tall">
        {/* data-counter: the lone entry's answered counterparty — the
            ask writes invisible state (#228: no counter line), and the
            tests need a deterministic signal that the answer landed */}
        <div
          className="flex flex-col gap-2 pt-1"
          data-testid="part-cats-editor"
          data-counter={(entries.length === 1 ? entries[0].linkedAccountId : undefined) ?? ''}
        >
          {/* the prediction's provenance, shown in the open (review) */}
          {reason && (
            <div className="flex items-center gap-1.5 rounded-xl bg-bg-2 px-3 py-2 text-[12px] text-ink-3" data-testid="split-reason">
              <Icon name="lightbulb-outline" size={14} color="var(--m-ink-4)" />
              {reason}
            </div>
          )}
          {/* whose money is being spread */}
          <div className="flex items-center justify-between gap-2 rounded-xl bg-bg-2 px-3 py-2 text-[12px] text-ink-3">
            <span className="min-w-0 truncate">{subject?.label ?? t('split.catsTitle')}</span>
            <span className="m-num shrink-0 font-semibold text-ink">{fmtCents(refCents, currency, lang)}</span>
          </div>
          {/* exact euros or percentages — the whole-transaction editor's
              two gears, unchanged for parts (#126 r7) */}
          {/* #283: the #209 what-the-modes-mean paragraph folds behind
              the hint beside the chips instead of standing open */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip className="flex-1" testId="part-cat-mode-amount" selected={mode === 'amount'} onClick={() => switchMode('amount')}>
              {t('split.modeAmount')}
            </Chip>
            <Chip className="flex-1" testId="part-cat-mode-pct" selected={mode === 'pct'} onClick={() => switchMode('pct')}>
              {t('split.modePct')}
            </Chip>
            <InfoHint text={t('split.modeHint')} testId="part-cat-mode-hint" />
          </div>
          {/* #228 feedback: the settled bookkeeping stands FIRST, pinned
              and untouchable — removing the reimbursement link is the
              only way to remove it */}
          {settled.map((entry, i) => (
            <div
              key={`settled-${entry.catId}-${entry.amountCents}`}
              data-testid={`part-cat-settled-${i}`}
              className="flex items-center gap-2 opacity-60"
            >
              <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-input border border-line bg-bg-2 px-3 text-[14px] text-ink-2">
                <Icon name={cats.byId(entry.catId).icon} size={17} color="var(--m-ink-4)" />
                <span className="min-w-0 flex-1 truncate">{catName(cats.byId(entry.catId), t)}</span>
                <Icon name="lock-outline" size={13} color="var(--m-ink-4)" />
              </div>
              <div className="m-num flex h-11 w-24 items-center justify-end rounded-input border border-line bg-bg-2 px-3 text-right text-[14px] text-ink-3">
                {toText(entry.amountCents)}
              </div>
            </div>
          ))}
          {entries.map((entry, i) => (
            <div key={entry.key} className="flex items-center gap-2">
              <button
                data-testid={`part-cat-${i}`}
                onClick={() => setPickerFor(i)}
                className="m-tap flex h-11 min-w-0 flex-1 items-center gap-2 rounded-input border border-line bg-surface px-3 text-left text-[14px] text-ink"
              >
                <Icon
                  name={cats.byId(entry.catId).icon}
                  size={17}
                  color={cats.byId(cats.byId(entry.catId).parentId ?? '').color ?? cats.byId(entry.catId).color}
                />
                <span className="truncate">{catName(cats.byId(entry.catId), t)}</span>
              </button>
              <input
                data-testid={`part-cat-amount-${i}`}
                value={entry.amount}
                onChange={(e) => onAmount(i, e.target.value)}
                onFocus={(e) => onFocus(i, e.currentTarget)}
                onBlur={() => onBlur(i)}
                inputMode="decimal"
                className="h-11 w-24 rounded-input border border-line bg-surface px-3 text-right text-[14px] text-ink outline-none"
              />
              {entries.length > 1 && (
                <button
                  aria-label={t('action.delete')}
                  data-testid={`part-cat-remove-${i}`}
                  onClick={() => removeEntry(i)}
                  className="m-tap border-none bg-transparent text-ink-4"
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          ))}
          <button
            data-testid="part-cat-add"
            onClick={addEntry}
            disabled={addBlocked}
            className="m-tap flex items-center gap-1.5 border-none bg-transparent px-1 py-1 text-[13px] font-medium text-accent-deep disabled:opacity-40"
          >
            <Icon name="plus" size={16} />
            {t('split.addRow')}
          </button>
          {/* #228: why the add door is shut — the special category owns
              the whole (split) transaction */}
          {specialClaims && (
            <p className="px-1 text-[12px] leading-snug text-ink-4" data-testid="part-cat-one-special">
              {t('split.oneSpecialHint')}
            </p>
          )}
          {remainder !== 0 && (
            <button
              data-testid="part-cat-remainder"
              onPointerDown={() => {
                pendingTarget.current = focusStash?.index ?? null;
              }}
              onClick={balance}
              className={`m-tap rounded-card border-none px-3 py-2 text-left text-[13px] ${
                remainder > 0 ? 'bg-warning-soft text-warning' : 'bg-negative-soft text-negative'
              }`}
            >
              {remainder > 0
                ? t('split.remaining', { amount: shownRemainder })
                : t('split.over', { amount: shownRemainder })}
            </button>
          )}
          {/* the remainder pill above already explains an unbalanced
              partition — the note covers the pill-less blocks (unpicked,
              duplicate, zero row, unlinked transfer) */}
          <FormBlockerNote show={attempted && !ready && remainder === 0} text={t('form.fixErrors')} testId="part-cat-save-blocker" />
          <Button
            data-testid="part-cat-save"
            aria-invalid={attempted && !ready}
            onClick={() => {
              if (!ready) {
                setAttempted(true);
                return;
              }
              apply();
            }}
          >
            {t('split.done')}
          </Button>
        </div>
      </Sheet>
      <CategoryPicker
        open={pickerFor !== null}
        onOpenChange={(next) => {
          if (!next) setPickerFor(null);
        }}
        direction={direction}
        txType={pickerTxType}
        sourceAccountType={sourceType}
        selectedId={pickedCatId}
        excludeIds={excluded}
        onlyIds={allowedCatIds ?? counterNarrowedIds}
          onCreateCustomNav={onCreateCustomNav}
        noSpecials={entries.length > 1}
        // #322 (user): when the COUNTER narrows the list (never a host
        // allowlist), the picker offers the detach door in place — the
        // same reset the counter row's detach runs, and the un-narrowed
        // catalog appears without leaving the sheet
        onClearCounter={
          !allowedCatIds && counterNarrowedIds && pickerFor !== null
            ? () => {
                patchEntry(pickerFor, detachPatch(entries[pickerFor]?.catId));
                rollbackRef.current = null;
              }
            : undefined
        }
        onPick={(catId) => {
          if (pickerFor === null) return;
          const prev = entries[pickerFor];
          if (prev?.catId === catId) return;
          // #218: a pick the linked counter can also mean keeps the link
          const kept = keepLinkPatch(prev, catId, accounts);
          if (kept) {
            patchEntry(pickerFor, kept);
            return;
          }
          // a NEW category starts a fresh story — the old entry's link
          // never rides along; a lone ◆ pick asks its counterparty right
          // away — the subject-level question (#228)
          patchEntry(pickerFor, { catId, linkedAccountId: undefined, transferPeerId: undefined });
          const ask = askDisabled || entries.length > 1 ? null : counterAskFor(catId);
          if (ask) {
            // ◆ Transfer is mandatory: dismissing the ask rolls the pick
            // back; families and funding may stay bare (deliberate)
            rollbackRef.current = ask.mandatory
              ? { index: pickerFor, catId: prev?.catId ?? UNCATEGORIZED_ID, linkedAccountId: prev?.linkedAccountId, transferPeerId: prev?.transferPeerId }
              : null;
            setCounterFor(pickerFor);
          }
        }}
      />
      <EntryCounterAsk
        counterFor={counterFor}
        setCounterFor={setCounterFor}
        entries={entries}
        patchEntry={patchEntry}
        rollbackRef={rollbackRef}
        askDisabled={askDisabled}
        excludeAccountId={excludeAccountId}
        direction={direction}
        anchor={anchor}
        centsOf={centsOf}
      />
    </>
  );
}

/** #133 r4/#218: the per-entry counterparty question — the same sheet
 *  every surface uses, scoped to ONE entry's money; open/dismiss/
 *  answer/detach plumbing self-contained (S3776) */
function EntryCounterAsk({
  counterFor,
  setCounterFor,
  entries,
  patchEntry,
  rollbackRef,
  askDisabled,
  excludeAccountId,
  direction,
  anchor,
  centsOf,
}: Readonly<{
  counterFor: number | null;
  setCounterFor: (next: number | null) => void;
  entries: CatEntry[];
  patchEntry: (index: number, patch: Partial<CatEntry>) => void;
  rollbackRef: { current: { index: number; catId: string; linkedAccountId?: string; transferPeerId?: string } | null };
  askDisabled: boolean;
  excludeAccountId: string;
  direction: 'debit' | 'credit';
  anchor?: { id: string; date: string };
  centsOf: (entry: CatEntry) => number;
}>) {
  const counterEntry = counterFor === null ? undefined : entries[counterFor];
  const counterAsk = counterEntry && !askDisabled ? counterAskFor(counterEntry.catId) : null;
  return (
    <CounterpartySheet
      open={counterFor !== null}
      onOpenChange={(next) => {
        if (next) return;
        const rollback = rollbackRef.current;
        if (rollback) {
          patchEntry(rollback.index, {
            catId: rollback.catId,
            linkedAccountId: rollback.linkedAccountId,
            transferPeerId: rollback.transferPeerId,
          });
          rollbackRef.current = null;
        }
        setCounterFor(null);
      }}
      excludeAccountId={excludeAccountId}
      currentLinkedId={counterEntry?.linkedAccountId}
      defaultFamily={counterAsk?.defaultFamily}
      counterTypes={counterAsk?.counterTypes}
      onDetach={
        counterEntry?.linkedAccountId
          ? () => {
              if (counterFor === null) return;
              patchEntry(counterFor, detachPatch(entries[counterFor]?.catId));
              rollbackRef.current = null;
            }
          : undefined
      }
      anchor={
        anchor && counterEntry
          ? {
              id: anchor.id,
              amountCents: direction === 'debit' ? -centsOf(counterEntry) : centsOf(counterEntry),
              date: anchor.date,
            }
          : undefined
      }
      onChoose={(account, peer) => {
        if (counterFor === null) return;
        // #133 r5/#218: the answered account's kind names the category
        const derived = answeredCatFor(entries[counterFor], account.type, direction === 'debit' ? -1 : 1);
        patchEntry(counterFor, {
          ...(derived ? { catId: derived } : {}),
          linkedAccountId: account.id,
          transferPeerId: peer?.txId,
        });
        rollbackRef.current = null;
      }}
    />
  );
}
