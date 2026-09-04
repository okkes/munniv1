import { useEffect, useState } from 'react';
import { useSpaceTransactions, useTxTransform } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { useLang } from '@/i18n';
import { fmtCents, parseCents } from '@/lib/money';
import { balanceLastRow, pctRemainder, primaryCatId, resolveSplitsFor, splitRemainderCents, splitsArePct, validatePctSplits, validateSplits } from '@/domain/splits';
import { givenCents, netAmountCents, netCreditCents, totalReimbursedCents } from '@/domain/reimbursement';
import { REIMBURSED_ID, UNCATEGORIZED_ID } from '@/domain/categories';
import { catName, useCategories } from '@/features/categories/useCategories';
import { CategoryPicker } from '@/features/categories/CategoryPicker';
import type { TxSplit } from '@/db/types';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';

/** one row in the unified editor = a plain category, always valid */
function sheetError(options: {
  seedSingle: boolean;
  rowCount: number;
  mode: 'amount' | 'pct';
  referenceCents: number;
  splits: TxSplit[];
}): ReturnType<typeof validateSplits> {
  if (options.seedSingle && options.rowCount === 1) return null;
  if (options.mode === 'pct') return validatePctSplits(options.splits);
  return validateSplits(options.referenceCents, options.splits);
}

interface Row {
  /** stable key for React list rendering (rows have no natural id) */
  key: string;
  catId: string;
  amount: string; // user-facing text, EU decimals
}

let rowCounter = 0;
const newRow = (catId: string, amount: string): Row => ({ key: `r${rowCounter++}`, catId, amount });

/** categories the OTHER rows already own — hidden in the picker; a
 *  split across "Rent" and "Rent" is never meaningful (user ss) */
const excludedCatIds = (rows: Row[], pickerFor: number | null): string[] | undefined =>
  pickerFor === null ? undefined : rows.filter((x, j) => j !== pickerFor && x.catId !== UNCATEGORIZED_ID).map((x) => x.catId);

const toText = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const toPctText = (pct: number) => String(pct).replace('.', ',');
const parsePct = (text: string): number => {
  const n = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/** Editor partitioning a transaction across categories — in euros (must
 *  sum exactly) or percentages (must reach 100, scales to any amount).
 *  Controlled mode (review draft): `value`+`onApply` make the sheet
 *  report the partition instead of writing it. */
export function SplitEditorSheet({
  open,
  onOpenChange,
  tx,
  value,
  txType,
  onApply,
  seedSingle = false,
  seedCatId,
  direction,
  onApplySingle,
  reason,
  allowedCatIds,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tx: SpaceTx;
  /** controlled mode: the draft's splits instead of the tx's */
  value?: TxSplit[];
  /** controlled mode: the draft's type gates the per-slice category picker */
  txType?: SpaceTx['txType'];
  /** controlled mode: null = clear the split */
  onApply?: (splits: TxSplit[] | null) => void;
  /** empty start seeds ONE row (current category, full amount) instead
   *  of the classic two — the review card's unified editor */
  seedSingle?: boolean;
  /** seedSingle: the CURRENT category (review keeps it on the draft, not
   *  the raw tx — seeding from tx.catId showed Uncategorized, user bug) */
  seedCatId?: string;
  /** money direction override: the ADD form knows expense/income before
   *  any amount exists (amountCents 0 read as credit and hid expense
   *  categories in the picker) */
  direction?: 'debit' | 'credit';
  /** seedSingle mode: saving with one row reports the plain category */
  onApplySingle?: (catId: string) => void;
  /** why the current category was suggested (review card) — shown inline */
  reason?: string | null;
  /** recurring-linked rows pick between the recurring's category and
   *  expected reimbursement only (user rule 2026-07-28) */
  allowedCatIds?: readonly string[];
}>) {
  const { t, lang } = useLang();
  const transform = useTxTransform();
  const cats = useCategories();
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<'amount' | 'pct'>('amount');
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  // focusing an amount empties it so typing replaces instead of appending
  // (user request); blurring an untouched empty field restores the value
  const [focusStash, setFocusStash] = useState<{ index: number; amount: string } | null>(null);

  const allTxs = useSpaceTransactions();
  // redesign (docs/reimbursement-redesign.md): stored slices are GROSS
  // with the settled value in a `reimbursed` slice. The editor still asks
  // for the NET partition — the user's real categories — and the
  // reimbursed slice is held aside here and re-attached on save.
  const settledCents =
    tx.amountCents < 0 ? totalReimbursedCents(tx) : givenCents(allTxs ?? [], tx.id);
  // controlled mode edits the draft's splits; write-through edits the tx's
  const source = onApply ? value : tx.splits?.filter((s) => s.catId !== REIMBURSED_ID);
  const netCents = tx.amountCents < 0 ? netAmountCents(tx) : netCreditCents(tx, givenCents(allTxs ?? [], tx.id));
  const referenceCents = onApply ? tx.amountCents : netCents;
  useEffect(() => {
    if (!open) return;
    if (source?.length) {
      const pctMode = splitsArePct(source);
      setMode(pctMode ? 'pct' : 'amount');
      setRows(source.map((s) => newRow(s.catId, pctMode ? toPctText(s.pct!) : toText(s.amountCents))));
    } else if (seedSingle) {
      // review's unified editor (user redesign): open on JUST the current
      // category owning the full amount — rows are added explicitly
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

  const splits: TxSplit[] =
    mode === 'pct'
      ? rows.map((r) => ({ catId: r.catId, amountCents: 0, pct: parsePct(r.amount) }))
      : rows.map((r) => ({ catId: r.catId, amountCents: parseCents(r.amount) ?? 0 }));
  const remainder = mode === 'pct' ? pctRemainder(splits) : splitRemainderCents(referenceCents, splits);
  const error = sheetError({ seedSingle, rowCount: rows.length, mode, referenceCents, splits });

  // a mid-edit TYPE change can strand categories that don't speak the
  // new type (user ss: Income + Maintenance) — flag them and hold Done
  const effectiveType = txType ?? tx.txType;
  const rowConflicts = rows.map((r) => {
    if (r.catId === UNCATEGORIZED_ID) return false;
    const speaks = cats.byId(r.catId).txTypes;
    return !!speaks && !speaks.includes(effectiveType);
  });
  const hasTypeConflict = rowConflicts.some(Boolean);

  // an empty or zero row must be finished before ANOTHER row appears
  // (user request: + Add category waits for the current one)
  const rowUnfinished = (index: number) => {
    if (rows[index].catId === UNCATEGORIZED_ID) return true;
    const value = mode === 'pct' ? parsePct(rows[index].amount) : (parseCents(rows[index].amount) ?? 0);
    return value <= 0;
  };
  const addBlocked = rows.some((_, i) => rowUnfinished(i));

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
    if (error || hasTypeConflict) return;
    // a lone row in the unified editor means "just this category" — no
    // split is stored, the category rides through onApplySingle
    if (seedSingle && rows.length === 1) {
      onApplySingle?.(rows[0].catId);
      onOpenChange(false);
      return;
    }
    // pct splits keep their percentages AND a materialized partition, so
    // every reader (budgets, drills, exports) stays simple.
    // needsReview is NOT touched: saving a split mid-review must keep the
    // card on screen until the user confirms (user request)
    const stored = mode === 'pct' ? resolveSplitsFor(referenceCents, splits) : splits;
    if (onApply) {
      onApply(stored);
    } else {
      // the settled value rides along untouched — gross invariant kept
      const withSettled = settledCents > 0 ? [...stored, { catId: REIMBURSED_ID, amountCents: settledCents }] : stored;
      void transform(tx, {
        splits: withSettled,
        catId: primaryCatId(stored),
      });
    }
    onOpenChange(false);
  };

  const clearSplit = () => {
    if (onApply) {
      onApply(null);
    } else if (settledCents > 0) {
      // "no split" on a settled tx still needs the gross partition:
      // one slice for the chosen category, one for the settled value
      const catId = primaryCatId(splits) ?? tx.catId ?? UNCATEGORIZED_ID;
      const rest = Math.max(0, Math.abs(tx.amountCents) - settledCents);
      void transform(tx, {
        splits: [...(rest > 0 ? [{ catId, amountCents: rest }] : []), { catId: REIMBURSED_ID, amountCents: settledCents }],
        catId,
      });
    } else {
      void transform(tx, {
        splits: null as never, // explicit null clears the field
        catId: primaryCatId(splits) ?? tx.catId,
      });
    }
    onOpenChange(false);
  };

  const autoBalance = () => {
    if (mode === 'pct') {
      setRows((r) => {
        const open = 100 - r.slice(0, -1).reduce((sum, row) => sum + parsePct(row.amount), 0);
        return r.map((row, i) => (i === r.length - 1 ? { ...row, amount: toPctText(Math.max(0, open)) } : row));
      });
      return;
    }
    setRows((r) => {
      const abs = r.map((row) => ({ catId: row.catId, amountCents: parseCents(row.amount) ?? 0 }));
      return balanceLastRow(referenceCents, abs).map((s, i) => ({ ...r[i], catId: s.catId, amount: toText(s.amountCents) }));
    });
  };

  const setRowAmount = (index: number, amount: string) =>
    setRows((r) => r.map((x, j) => (j === index ? { ...x, amount } : x)));
  const removeRow = (index: number) => setRows((r) => r.filter((_, j) => j !== index));
  const addRow = () => setRows((r) => [...r, newRow(UNCATEGORIZED_ID, '0,00')]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={t('split.title')} size="tall">
        <div className="flex flex-col gap-2 pt-1" data-testid="split-editor">
          {/* the prediction's provenance, shown in the open (user request:
              no more hiding it behind an info button) */}
          {reason && (
            <div className="flex items-center gap-1.5 rounded-xl bg-bg-2 px-3 py-2 text-[12px] text-ink-3" data-testid="split-reason">
              <Icon name="lightbulb-outline" size={14} color="var(--m-ink-4)" />
              {reason}
            </div>
          )}
          {/* exact euros for one charge, percentages when the shape repeats */}
          <div className="flex gap-1.5">
            <Chip className="flex-1" testId="split-mode-amount" selected={mode === 'amount'} onClick={() => switchMode('amount')}>
              {t('split.modeAmount')}
            </Chip>
            <Chip className="flex-1" testId="split-mode-pct" selected={mode === 'pct'} onClick={() => switchMode('pct')}>
              {t('split.modePct')}
            </Chip>
          </div>
          {rows.map((row, i) => (
            <div key={row.key} className="flex items-center gap-2">
              <button
                data-testid={`split-cat-${i}`}
                onClick={() => setPickerFor(i)}
                className={`m-tap flex h-11 min-w-0 flex-1 items-center gap-2 rounded-input border bg-surface px-3 text-left text-[14px] text-ink ${
                  rowConflicts[i] ? 'border-negative' : 'border-line'
                }`}
              >
                <Icon name={cats.byId(row.catId).icon} size={17} color={cats.byId(cats.byId(row.catId).parentId ?? '').color ?? cats.byId(row.catId).color} />
                <span className="truncate">{catName(cats.byId(row.catId), t)}</span>
              </button>
              <input
                data-testid={`split-amount-${i}`}
                value={row.amount}
                onChange={(e) => setRowAmount(i, e.target.value)}
                onFocus={() => {
                  setFocusStash({ index: i, amount: row.amount });
                  setRowAmount(i, '');
                }}
                onBlur={() => {
                  // left empty = the user clicked away — bring the value back
                  if (focusStash?.index === i && rows[i]?.amount.trim() === '') setRowAmount(i, focusStash.amount);
                  setFocusStash(null);
                }}
                inputMode="decimal"
                className="h-11 w-24 rounded-input border border-line bg-surface px-3 text-right text-[14px] text-ink outline-none"
              />
              {rows.length > (seedSingle ? 1 : 2) && (
                <button
                  aria-label={t('action.delete')}
                  data-testid={`split-remove-${i}`}
                  onClick={() => removeRow(i)}
                  className="m-tap border-none bg-transparent text-ink-4"
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          ))}

          {/* finish the open row first (user request): no new row while
              one is still uncategorized or worth nothing */}
          <button
            data-testid="split-add-row"
            onClick={addRow}
            disabled={addBlocked}
            className="m-tap flex items-center gap-1.5 border-none bg-transparent px-1 py-1 text-[13px] font-medium text-accent-deep disabled:opacity-40"
          >
            <Icon name="plus" size={16} />
            {t('split.addRow')}
          </button>

          {hasTypeConflict && (
            <p className="rounded-card bg-negative-soft px-3 py-2 text-[12px] leading-relaxed text-negative" data-testid="split-type-conflict">
              {t('split.typeConflict', { type: t(`tx.type.${effectiveType}`) })}
            </p>
          )}

          {remainder !== 0 && (
            <button
              data-testid="split-remainder"
              onClick={autoBalance}
              className={`m-tap rounded-card border-none px-3 py-2 text-left text-[13px] ${
                remainder > 0 ? 'bg-warning-soft text-warning' : 'bg-negative-soft text-negative'
              }`}
            >
              {remainder > 0
                ? t('split.remaining', { amount: mode === 'pct' ? `${remainder}%` : fmtCents(remainder, tx.currency, lang) })
                : t('split.over', { amount: mode === 'pct' ? `${-remainder}%` : fmtCents(-remainder, tx.currency, lang) })}
            </button>
          )}

          {/* "Done", not "Save": in review this only stages the draft — the
              card's Confirm is the real write (user: Save felt misleading) */}
          <Button data-testid="split-save" onClick={save} disabled={!!error || hasTypeConflict}>
            {t('split.done')}
          </Button>
          {!!source?.length && (
            <Button variant="outline" data-testid="split-clear" onClick={clearSplit}>
              {t('split.clear')}
            </Button>
          )}
        </div>
      </Sheet>
      <CategoryPicker
        open={pickerFor !== null}
        onOpenChange={(next) => {
          if (!next) setPickerFor(null);
        }}
        direction={direction ?? (tx.amountCents < 0 ? 'debit' : 'credit')}
        // add-form mode (direction given): filter by direction only — the
        // fallback type follows the category and would hide the other
        // direction's categories before one is picked (old form behavior)
        txType={direction ? undefined : (txType ?? tx.txType)}
        selectedId={pickerFor === null ? undefined : rows[pickerFor]?.catId}
        excludeIds={excludedCatIds(rows, pickerFor)}
        onlyIds={allowedCatIds}
        onPick={(catId) => {
          if (pickerFor !== null) setRows((r) => r.map((x, j) => (j === pickerFor ? { ...x, catId } : x)));
        }}
      />
    </>
  );
}
