import { useEffect, useRef, useState } from 'react';
import { useData } from '@/app/data';
import type { SpaceTx } from '@/application/transactions';
import { useLang } from '@/i18n';
import { evalAmountCents, fmtCents, parseCents } from '@/lib/money';
import { nextAmountEntry } from '@/lib/amountRegister';
import type { AmountEntryMode } from '@/lib/amountRegister';
import { txTitle } from '@/lib/text';
import { balanceTargetIndex, pctRemainder, resolveSplitsFor, splitRemainderCents, splitsArePct, validatePctSplits, validateSplits } from '@/domain/splits';
import { REIMBURSED_ID, UNCATEGORIZED_ID } from '@/domain/categories';
import type { TxSplit, TxType } from '@/db/types';
import { Button } from '@/ui/Button';
import { FormBlockerNote } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { InfoHint } from '@/ui/InfoHint';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';

/** the partition must always add up — a lone row included: it means
 *  "no split", which is only sound when it still covers the WHOLE
 *  (50% typed on a single row held Done armed — user report #126 r3).
 *  Parts may share a category (#126 r6): two full sub-transactions with
 *  the same category differ by note/event/identity. */
function sheetError(options: {
  mode: 'amount' | 'pct';
  referenceCents: number;
  splits: TxSplit[];
}): ReturnType<typeof validateSplits> {
  if (options.splits.length === 1) {
    const off =
      options.mode === 'pct' ? pctRemainder(options.splits) : splitRemainderCents(options.referenceCents, options.splits);
    return off === 0 ? null : 'notBalanced';
  }
  const error =
    options.mode === 'pct' ? validatePctSplits(options.splits) : validateSplits(options.referenceCents, options.splits);
  return error === 'duplicateCategory' ? null : error;
}

/** a part's category entries beyond the first (v2.1 spread) — the
 *  values editor never edits them, but a stored spread must survive a
 *  resave untouched */
interface EntryDraft {
  key: string;
  catId: string;
  amount: string;
}

interface Row {
  /** stable key for React list rendering (rows have no natural id) */
  key: string;
  catId: string;
  amount: string; // user-facing text, EU decimals
  // typed parts (v2): identity + story carried through the editor
  id?: string;
  label: string;
  /** the part's own type; undefined = inherits the row's */
  txType?: TxType;
  linkedAccountId?: string;
  transferPeerId?: string;
  eventId?: string;
  extraCats: EntryDraft[];
}

let rowCounter = 0;
const newKey = () => `r${rowCounter++}`;
const newRow = (catId: string, amount: string, part?: Partial<Omit<Row, 'key'>>): Row => ({
  key: newKey(),
  catId,
  amount,
  label: '',
  extraCats: [],
  ...part,
});

/** the part's face when the user typed nothing: "<title> – split N" */
const defaultLabel = (title: string, index: number, t: ReturnType<typeof useLang>['t']): string =>
  `${title} – ${t('split.partN', { n: index + 1 })}`;

/** the amount an emptied-then-abandoned field falls back to, or the
 *  evaluated arithmetic (87,40-25 → 62,40); null keeps what's typed */
function blurredAmount(raw: string, stashed: string | undefined, amountMode: boolean): string | null {
  if (stashed !== undefined && raw.trim() === '') return stashed;
  if (!amountMode) return null;
  const evaluated = evalAmountCents(raw);
  return evaluated !== null && evaluated >= 0 ? toText(evaluated) : null;
}

/** the typed-part story a row carries into the stored slice */
const partFields = (r: Row): Partial<TxSplit> => ({
  ...(r.id ? { id: r.id } : {}),
  ...(r.label.trim() ? { label: r.label.trim() } : {}),
  ...(r.txType ? { txType: r.txType } : {}),
  ...(r.linkedAccountId ? { linkedAccountId: r.linkedAccountId } : {}),
  ...(r.transferPeerId ? { transferPeerId: r.transferPeerId } : {}),
  ...(r.eventId ? { eventId: r.eventId } : {}),
});

/** the stored slice a row becomes: a plain part, or one keeping its
 *  stored category spread (amount = the spread's sum, catId = the
 *  largest entry as the compat shadow) */
function rowToSplit(r: Row): TxSplit {
  const main = { catId: r.catId, amountCents: parseCents(r.amount) ?? 0 };
  const extras = r.extraCats.map((x) => ({ catId: x.catId, amountCents: parseCents(x.amount) ?? 0 }));
  if (extras.length === 0) return { ...main, ...partFields(r) };
  const entries = [main, ...extras];
  const primary = entries.reduce((best, e) => (e.amountCents > best.amountCents ? e : best), entries[0]);
  return {
    catId: primary.catId,
    amountCents: entries.reduce((sum, e) => sum + e.amountCents, 0),
    cats: entries,
    ...partFields(r),
  };
}

/** the unassigned/overshoot pill — tap fills the row being worked on
 *  (out of the editor for S3776). onArm fires on pointerdown, BEFORE
 *  the focused field's blur restores its stashed value — that's how the
 *  pill knows which row the user meant (#130 round 2). */
function RemainderPill({
  remainder,
  mode,
  currency,
  onArm,
  onBalance,
}: Readonly<{ remainder: number; mode: 'amount' | 'pct'; currency: string; onArm: () => void; onBalance: () => void }>) {
  const { t, lang } = useLang();
  const shown = (cents: number) => (mode === 'pct' ? `${cents}%` : fmtCents(cents, currency, lang));
  return (
    <button
      data-testid="split-remainder"
      onPointerDown={onArm}
      onClick={onBalance}
      className={`m-tap rounded-card border-none px-3 py-2 text-left text-[13px] ${
        remainder > 0 ? 'bg-warning-soft text-warning' : 'bg-negative-soft text-negative'
      }`}
    >
      {remainder > 0 ? t('split.remaining', { amount: shown(remainder) }) : t('split.over', { amount: shown(-remainder) })}
    </button>
  );
}

/** #126 v2: the values-only row — the split as pure money: label +
 *  amount, exact euros or percentages. Categories, kinds and events are
 *  the part deck's / part pages' job. */
function ValuesRow({
  row,
  index,
  removable,
  title,
  onLabel,
  handlers,
}: Readonly<{
  row: Row;
  index: number;
  removable: boolean;
  title: string;
  onLabel: (index: number, label: string) => void;
  handlers: EntryHandlers;
}>) {
  const { t } = useLang();
  return (
    <div className="flex items-center gap-2">
      <input
        data-testid={`split-label-${index}`}
        value={row.label}
        placeholder={defaultLabel(title, index, t)}
        onChange={(e) => onLabel(index, e.target.value)}
        className="h-11 min-w-0 flex-1 rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-4"
      />
      <input
        data-testid={`split-amount-${index}`}
        value={row.amount}
        onChange={(e) => handlers.onAmount(index, e.target.value)}
        onFocus={(e) => handlers.onAmountFocus(index, e.currentTarget)}
        onBlur={() => handlers.onAmountBlur(index)}
        inputMode="decimal"
        className="h-11 w-24 rounded-input border border-line bg-surface px-3 text-right text-[14px] text-ink outline-none"
      />
      {removable && (
        <button
          aria-label={t('action.delete')}
          data-testid={`split-remove-${index}`}
          onClick={() => handlers.onRemove(index)}
          className="m-tap border-none bg-transparent text-ink-4"
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

/** shared entry handlers, bundled once (out of the editor for S3776) */
interface EntryHandlers {
  onAmount: (index: number, amount: string) => void;
  /** the element rides along so the deferred focus-empty (#134) can
   *  stand down when focus already moved elsewhere */
  onAmountFocus: (index: number, el?: HTMLInputElement) => void;
  onAmountBlur: (index: number) => void;
  onRemove: (index: number) => void;
}

const toText = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const toPctText = (pct: number) => String(pct).replace('.', ',');
const parsePct = (text: string): number => {
  const n = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/**
 * The split-TRANSACTION editor (#211: nothing but that anymore — a
 * multi-category assignment is the CatsSheet's job): the partition as
 * pure money — label + amount per part, exact euros or percentages.
 * Controlled mode (review draft): `value`+`onApply` make the sheet
 * report the partition instead of writing it.
 */
export function SplitEditorSheet({
  open,
  onOpenChange,
  tx,
  value,
  onApply,
  seedSingle = false,
  seedCatId,
  onApplySingle,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tx: SpaceTx;
  /** the staged partition being edited (the caller owns the write) */
  value?: TxSplit[];
  /** null = clear the split */
  onApply: (splits: TxSplit[] | null) => void;
  /** empty start seeds ONE row (current category, full amount) instead
   *  of the classic two — collapsing back to it means "no split" */
  seedSingle?: boolean;
  /** seedSingle: the CURRENT category (review keeps it on the draft, not
   *  the raw tx — seeding from tx.catId showed Uncategorized, user bug) */
  seedCatId?: string;
  /** seedSingle mode: saving with one row reports the plain category */
  onApplySingle?: (catId: string) => void;
}>) {
  const { t } = useLang();
  const { repo } = useData();
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<'amount' | 'pct'>('amount');
  // focusing an amount empties it so typing replaces instead of appending
  // (user request); blurring an untouched empty field restores the value
  const [focusStash, setFocusStash] = useState<{ index: number; amount: string } | null>(null);
  // register-style entry for the focused amount (lib/amountRegister) —
  // one field is focused at a time, so one mode is enough
  const [entryMode, setEntryMode] = useState<AmountEntryMode>('register');
  // #130 r2: the pill's pointerdown runs BEFORE the focused field blurs
  // (and restores its stash) — capture WHICH field the user meant here
  const pendingBalanceTarget = useRef<number | null>(null);
  const armBalance = () => {
    pendingBalanceTarget.current = focusStash?.index ?? null;
  };

  // #195: tappable — an invalid tap arms the aria/error state
  const [attempted, setAttempted] = useState(false);
  const source = value;
  const referenceCents = tx.amountCents;
  useEffect(() => {
    if (!open) return;
    setAttempted(false);
    if (source?.length) {
      // #216: settled `reimbursed` slices carry no pct by design — they
      // must not flip a %-shaped partition back to amount mode
      const pctMode = splitsArePct(source.filter((s) => s.catId !== REIMBURSED_ID));
      setMode(pctMode ? 'pct' : 'amount');
      setRows(
        source.map((s) => {
          const spread = s.cats?.length ? s.cats : undefined;
          const main = spread?.[0];
          return newRow(main?.catId ?? s.catId, pctMode ? toPctText(s.pct!) : toText(main?.amountCents ?? s.amountCents), {
            id: s.id,
            label: s.label ?? '',
            txType: s.txType,
            linkedAccountId: s.linkedAccountId,
            transferPeerId: s.transferPeerId,
            eventId: s.eventId,
            extraCats: (spread?.slice(1) ?? []).map((c) => ({ key: newKey(), catId: c.catId, amount: toText(c.amountCents) })),
          });
        }),
      );
    } else if (seedSingle) {
      // open on JUST the current category owning the full amount —
      // parts are added explicitly (user redesign)
      setMode('amount');
      setRows([newRow(seedCatId ?? tx.catId ?? UNCATEGORIZED_ID, toText(Math.abs(referenceCents)))]);
    } else {
      setMode('amount');
      // start from the current category + an empty second row
      setRows([newRow(tx.catId ?? UNCATEGORIZED_ID, toText(Math.abs(referenceCents))), newRow(UNCATEGORIZED_ID, '0,00')]);
    }
    // deliberately only on open (or a card swap): the sheet owns its
    // rows while open. Keyed by tx.id, NOT the object — background
    // writes (sync, migrations) re-emit the same row as a fresh object
    // and must never wipe rows the user is mid-editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tx.id]);

  /** a row's total in the mode's units — a stored spread sums its entries */
  const rowValue = (r: Row): number => {
    if (mode === 'pct') return parsePct(r.amount);
    const main = parseCents(r.amount) ?? 0;
    return main + r.extraCats.reduce((sum, x) => sum + (parseCents(x.amount) ?? 0), 0);
  };
  const splits: TxSplit[] =
    mode === 'pct'
      ? rows.map((r) => ({ catId: r.catId, amountCents: 0, pct: parsePct(r.amount), ...partFields(r) }))
      : rows.map((r) => rowToSplit(r));
  const remainder = mode === 'pct' ? pctRemainder(splits) : splitRemainderCents(referenceCents, splits);
  const error = sheetError({ mode, referenceCents, splits });

  // an empty or zero entry must be finished before ANOTHER one appears
  // (user request: + Add part waits for the current one)
  const addBlocked = rows.some((r) => rowValue(r) <= 0);

  const switchMode = (next: 'amount' | 'pct') => {
    if (next === mode) return;
    setMode(next);
    const abs = Math.abs(referenceCents);
    if (next === 'pct') {
      // carry the current euro shape over as rounded percentages
      setRows((r) =>
        r.map((row) => {
          const cents = parseCents(row.amount) ?? 0;
          return { ...row, amount: abs > 0 ? toPctText(Math.round((cents / abs) * 100)) : '0' };
        }),
      );
    } else {
      // pct → euros must land EXACTLY on the total: rounding each row on
      // its own left a ±1 cent remainder (50/50 of €34.99 → "€0.01 too
      // much", user ss). resolveSplitsFor is the same partition the save
      // path stores — tabbing back shows precisely what saving would.
      setRows((r) => {
        const pctSplits = r.map((row) => ({ catId: row.catId, amountCents: 0, pct: parsePct(row.amount) }));
        const resolved = resolveSplitsFor(abs, pctSplits);
        return r.map((row, i) => ({ ...row, amount: toText(Math.abs(resolved[i]?.amountCents ?? 0)) }));
      });
    }
  };

  const save = () => {
    if (error) return;
    // a lone row means "just this category" — no split is stored, the
    // category rides through onApplySingle
    if (seedSingle && rows.length === 1) {
      onApplySingle?.(rows[0].catId);
      onOpenChange(false);
      return;
    }
    // pct splits keep their percentages AND a materialized partition, so
    // every reader (budgets, drills, exports) stays simple.
    // needsReview is NOT touched: saving a split mid-review must keep the
    // card on screen until the user confirms (user request)
    // Typed parts get a STABLE id at save (typed-splits v2): the mint
    // engine, per-part events and detail navigation key on it, and two
    // devices editing the same array converge on the same identities.
    const stored = (mode === 'pct' ? resolveSplitsFor(referenceCents, splits) : splits).map((s) => ({
      ...s,
      id: s.id ?? repo.newId(),
    }));
    onApply(stored);
    onOpenChange(false);
  };

  const clearSplit = () => {
    onApply(null);
    onOpenChange(false);
  };

  const autoBalance = () => {
    // the field the pill was tapped FROM wins (#130 r2); else the first
    // empty row; else the last as the correction slot
    const forced = pendingBalanceTarget.current;
    pendingBalanceTarget.current = null;
    setRows((r) => {
      const values = r.map(rowValue);
      const target = forced ?? balanceTargetIndex(values);
      const total = mode === 'pct' ? 100 : Math.abs(referenceCents);
      const open = total - values.reduce((sum, v, i) => (i === target ? sum : sum + v), 0);
      const next = mode === 'pct' ? toPctText(Math.max(0, open)) : toText(Math.max(0, open));
      // the balanced row's stored spread no longer matches its new
      // amount — it collapses to the shadow category (values flow rule)
      return r.map((row, i) => (i === target ? { ...row, amount: next, extraCats: [] } : row));
    });
  };

  const entryAmount = (index: number): string => rows[index]?.amount ?? '';
  const patchAmount = (index: number, amount: string) =>
    setRows((r) => r.map((x, j) => (j === index ? { ...x, amount } : x)));
  const setRowLabel = (index: number, label: string) =>
    setRows((r) => r.map((x, j) => (j === index ? { ...x, label } : x)));
  const removeEntry = (index: number) => setRows((r) => r.filter((_, j) => j !== index));
  // a new part takes the current remainder — the natural next slice
  // (user design: adding a split copies the info and offers what's left)
  const addRow = () =>
    setRows((r) => [...r, newRow(UNCATEGORIZED_ID, mode === 'amount' ? toText(Math.max(remainder, 0)) : toPctText(Math.max(remainder, 0)))]);

  const blurEntry = (index: number) => {
    const stashed = focusStash?.index === index ? focusStash?.amount : undefined;
    const next = blurredAmount(entryAmount(index), stashed, mode === 'amount');
    if (next !== null) patchAmount(index, next);
    setFocusStash(null);
  };

  const entryHandlers: EntryHandlers = {
    onAmount: (index, raw) => {
      // register-style entry (user request): digits fill cents from the
      // right — euros only; percentages keep plain typing
      if (mode !== 'amount') {
        patchAmount(index, raw);
        return;
      }
      const next = nextAmountEntry(entryMode, entryAmount(index), raw);
      setEntryMode(next.mode);
      patchAmount(index, next.text);
    },
    onAmountFocus: (index, el) => {
      // the register is armed right away…
      setEntryMode('register');
      // …but the empty-for-typing happens ONE FRAME LATER (#134): iOS
      // WebKit stalls the caret for seconds when the input's value swaps
      // in the same beat as focus. If focus already moved on (spam-
      // switching fields), the deferred empty stands down.
      const amount = entryAmount(index);
      requestAnimationFrame(() => {
        // another editable already took focus (spam-switch): stand down.
        // (Synthetic test focus leaves activeElement on body — proceed.)
        const active = document.activeElement;
        if (el && active !== el && active instanceof HTMLElement && active.matches('input, textarea')) return;
        // typing already replaced the value inside this frame: keep it
        if (el && el.value !== amount) return;
        setFocusStash({ index, amount });
        patchAmount(index, '');
      });
    },
    onAmountBlur: blurEntry,
    onRemove: removeEntry,
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('split.title')} size="tall">
      <div className="flex flex-col gap-2 pt-1" data-testid="split-editor">
        {/* #210 (user): split categories is the everyday tool — the
            transaction split is for parts that need lives of their own */}
        <p className="px-1 text-[12px] leading-relaxed text-ink-3" data-testid="split-vs-cats-hint">
          {t('split.vsCatsHint')}
        </p>
        {/* exact euros for one charge, percentages when the shape repeats.
            #283: the #209 what-the-modes-mean paragraph folds behind the
            hint beside the chips instead of standing open */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip className="flex-1" testId="split-mode-amount" selected={mode === 'amount'} onClick={() => switchMode('amount')}>
            {t('split.modeAmount')}
          </Chip>
          <Chip className="flex-1" testId="split-mode-pct" selected={mode === 'pct'} onClick={() => switchMode('pct')}>
            {t('split.modePct')}
          </Chip>
          <InfoHint text={t('split.modeHint')} testId="split-mode-hint" />
        </div>
        {rows.map((row, i) => (
          <ValuesRow
            key={row.key}
            row={row}
            index={i}
            removable={rows.length > (seedSingle ? 1 : 2)}
            title={txTitle(tx)}
            onLabel={setRowLabel}
            handlers={entryHandlers}
          />
        ))}

        {/* finish the open row first (user request): no new row while
            one is still worth nothing */}
        <button
          data-testid="split-add-row"
          onClick={addRow}
          disabled={addBlocked}
          className="m-tap flex items-center gap-1.5 border-none bg-transparent px-1 py-1 text-[13px] font-medium text-accent-deep disabled:opacity-40"
        >
          <Icon name="plus" size={16} />
          {t('split.addPart')}
        </button>

        {remainder !== 0 && (
          <RemainderPill remainder={remainder} mode={mode} currency={tx.currency} onArm={armBalance} onBalance={autoBalance} />
        )}

        {/* "Done", not "Save": in review this only stages the draft — the
            card's Confirm is the real write (user: Save felt misleading).
            translateZ pins the buttons to their own compositor layer:
            adding a row shifts them down while Done flips to disabled
            opacity, and iOS kept painting the OLD enabled button at the
            old spot as a dark ghost band (user ss r6). */}
        <div className="flex flex-col gap-2" style={{ transform: 'translateZ(0)' }}>
          {/* the remainder pill above already explains an unbalanced split —
              the note steps in only for pill-less errors (e.g. a zero row) */}
          <FormBlockerNote show={attempted && !!error && remainder === 0} text={t('form.fixErrors')} testId="split-save-blocker" />
          <Button
            data-testid="split-save"
            aria-invalid={attempted && !!error}
            onClick={() => {
              if (error) {
                setAttempted(true);
                return;
              }
              save();
            }}
          >
            {t('split.done')}
          </Button>
          {!!source?.length && (
            <Button variant="outline" data-testid="split-clear" onClick={clearSplit}>
              {t('split.clear')}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
