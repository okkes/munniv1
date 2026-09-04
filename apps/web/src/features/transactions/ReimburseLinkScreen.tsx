import { Fragment, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useSpaceTransactions } from '@/application/transactions';
import type { SpaceTx } from '@/application/transactions';
import { LOCALES, useLang } from '@/i18n';
import { fmtCents, parseCents } from '@/lib/money';
import { cleanBankText } from '@/lib/text';
import { filterTxs } from '@/domain/txFilter';
import { clampReimbursement, creditPartGivenCents, creditRemainingCents, givenCents, isReimbContainer, remainingCents, settledCats } from '@/domain/reimbursement';
import { reimbEarmarkCents, suggestCounterparts } from '@/domain/reimburseMatch';
import { catName, useCategories } from '@/features/categories/useCategories';
import { useReimburseLinks } from './useReimburseLinks';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { TxRow } from '@/ui/TxRow';
import { TxPartRow } from '@/ui/TxPartRow';
import { SearchField } from '@/ui/SearchField';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { CollapsingSearch, useSearchCollapse } from '@/ui/CollapsingSearch';
import { REIMBURSED_ID, UNCATEGORIZED_ID } from '@/domain/categories';
import type { TxSplit } from '@/db/types';

const toText = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

interface ImpactLine {
  catId: string;
  before: number;
  after: number;
}

interface ImpactSide {
  title: string;
  lines: ImpactLine[];
}

/** #233 r3: the preview diffs the REAL settlement engine — settledCats
 *  before vs after — so spreads, earmarks and the claimant carve-out
 *  all preview exactly what the save would write. Module for S3776. */
function impactLinesFor(
  subject: { amountCents: number; catId?: string; cats?: { catId: string; amountCents: number }[] },
  beforeCents: number,
  afterCents: number,
  nameOf: (catId: string) => string,
): ImpactLine[] {
  const before = settledCats(subject, beforeCents, nameOf);
  const after = settledCats(subject, afterCents, nameOf);
  const at = (list: { catId: string; amountCents: number }[], id: string) =>
    list.find((slice) => slice.catId === id)?.amountCents ?? 0;
  const ids = [...new Set([...before, ...after].map((slice) => slice.catId))];
  // read in the after-partition's order, the bookkeeping slice last
  const order = [...after.filter((slice) => slice.catId !== REIMBURSED_ID).map((slice) => slice.catId), REIMBURSED_ID];
  ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return ids
    .map((catId) => ({ catId, before: at(before, catId), after: at(after, catId) }))
    .filter((line) => line.before !== line.after);
}

function impactSides(args: {
  expense: SpaceTx;
  expensePartId?: string;
  credit: SpaceTx;
  creditPartId?: string;
  cents: number;
  allTxs: SpaceTx[];
  nameOf: (catId: string) => string;
}): ImpactSide[] {
  const { expense, credit, cents, allTxs, nameOf } = args;
  const ePart = args.expensePartId ? (expense.splits ?? []).find((part) => part.id === args.expensePartId) : undefined;
  const eSubject = ePart ? { amountCents: ePart.amountCents, catId: ePart.catId, cats: ePart.cats } : expense;
  const eAlready = (expense.reimbursements ?? [])
    .filter((link) => (ePart ? link.partId === args.expensePartId : true))
    .reduce((sum, link) => sum + link.amountCents, 0);
  const cPart = args.creditPartId ? (credit.splits ?? []).find((part) => part.id === args.creditPartId) : undefined;
  const cGiven =
    cPart && args.creditPartId ? creditPartGivenCents(allTxs, credit.id, args.creditPartId) : givenCents(allTxs, credit.id);
  // the credit self-files as Reimbursed exactly like the save would
  const selfFiles =
    !cPart &&
    !isReimbContainer(credit) &&
    (!credit.catId || credit.catId === UNCATEGORIZED_ID || credit.needsReview === 1);
  const cSubject = cPart
    ? { amountCents: cPart.amountCents, catId: cPart.catId, cats: cPart.cats }
    : { ...credit, catId: selfFiles ? REIMBURSED_ID : credit.catId };
  return [
    { title: cleanBankText(expense.merchant), lines: impactLinesFor(eSubject, eAlready, eAlready + cents, nameOf) },
    { title: cleanBankText(credit.merchant), lines: impactLinesFor(cSubject, cGiven, cGiven + cents, nameOf) },
  ];
}

/** #197: what a split expense's PART still expects back — its magnitude
 *  minus the links already targeting it */
const partOpenCents = (row: SpaceTx, part: TxSplit): number =>
  Math.max(
    0,
    Math.abs(part.amountCents) -
      (row.reimbursements ?? []).filter((r) => r.partId === part.id).reduce((sum, r) => sum + r.amountCents, 0),
  );

/** #197 (both directions): a split row offers its PARTS to link against
 *  — the root container is never a target. The caller supplies the
 *  side's own open-value math. Module-level for S3776. */
function ReimbPartRows({
  row,
  testId,
  hint,
  money,
  openOf,
  onPick,
  highlight = '',
}: Readonly<{
  row: SpaceTx;
  testId: string;
  hint?: string;
  money: (cents: number) => string;
  /** the part's linkable value on THIS side (expense: still expected;
   *  credit: still giveable) */
  openOf: (row: SpaceTx, part: TxSplit) => number;
  onPick: (row: SpaceTx, part: TxSplit, openCents: number) => void;
  highlight?: string;
}>) {
  const parts = (row.splits ?? []).map((part, idx) => ({ part, idx })).filter((e) => e.part.catId !== REIMBURSED_ID);
  const sign = row.amountCents < 0 ? -1 : 1;
  return (
    <div key={`${testId}-${row.id}`}>
      {parts.map((e, ordinal) => {
        const open = openOf(row, e.part);
        if (open <= 0) return null;
        return (
          <div key={e.part.id ?? e.idx} data-testid={`${testId}-${row.id}-part-${e.idx}`}>
            <TxPartRow
              tx={row}
              part={e.part}
              index={ordinal}
              showDate
              amountText={money(sign * open)}
              onClick={() => onPick(row, e.part, open)}
              highlight={highlight}
            />
          </div>
        );
      })}
      {hint && <div className="-mt-1 px-1 pb-1.5 text-[11px] text-accent-deep">{hint}</div>}
    </div>
  );
}

/**
 * Full-screen counterpart picker for reimbursement links (user redesign
 * 2026-07-28, replaces the cramped sheet): searchable like the main
 * transactions list (title + amount, with highlight), with a "suggested"
 * segment on top — the 1–2 rows scoring highest on timing, P2P repayment
 * wording, reimbursement bookkeeping and size. Tapping a row opens the
 * amount sheet; the prefill follows the row's reimbursement EARMARK when
 * it has one (the expected/received slice value), else its open value.
 */
export function ReimburseLinkScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { txId } = useParams({ strict: false }) as { txId: string };
  // #126 r5: opened from a part page → the link targets that part
  const { part: partId } = useSearch({ strict: false }) as { part?: string };
  const allTxs = useSpaceTransactions();
  const tx = useMemo(() => allTxs?.find((row) => row.id === txId), [allTxs, txId]);
  const { link, giveableCents } = useReimburseLinks(allTxs);

  const [query, setQuery] = useState('');
  // #197: picking a PART carries its id — the link lands on that part,
  // never on the root container (partId = expense side, creditPartId =
  // the split credit's funding part)
  // #233: maxCents is the pair's honest ceiling — saving above it now
  // ERRORS instead of silently shrinking to the clamp
  const [chosen, setChosen] = useState<{ row: SpaceTx; partId?: string; creditPartId?: string; maxCents: number } | null>(null);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const cats = useCategories();

  // the search bar rides along — #273: through the shared GLIDING
  // collapse (deliberate up-travel rule + measured max-height, so the
  // list flows into the freed space instead of jumping past a void)
  const { offset: searchOffset, onListScroll } = useSearchCollapse(56);

  const anchorIsExpense = (tx?.amountCents ?? 0) < 0;
  const givenOf = (id: string) => givenCents(allTxs ?? [], id);

  // an expense looks at credits with value left; a credit looks at
  // expenses still open — the same space-scoped pools the section used
  const candidates = useMemo(() => {
    if (!tx) return [];
    const pool = (allTxs ?? []).filter((row) => row.id !== tx.id);
    return anchorIsExpense
      ? pool.filter((row) => row.amountCents > 0 && creditRemainingCents(row, givenOf(row.id)) > 0)
      : pool.filter((row) => row.amountCents < 0 && remainingCents(row) > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTxs, tx?.id, anchorIsExpense]);

  const suggested = useMemo(
    () => (tx ? suggestCounterparts(tx, candidates, givenOf) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tx, candidates],
  );

  const listed = useMemo(() => {
    const matched = filterTxs(candidates, { query });
    return [...matched].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  }, [candidates, query]);

  const openValueOf = (row: SpaceTx): number =>
    row.amountCents > 0 ? giveableCents(row) : remainingCents(row);

  const pick = (row: SpaceTx) => {
    const expense = anchorIsExpense ? tx! : row;
    const credit = anchorIsExpense ? row : tx!;
    // the prefill follows the EARMARK side of the pair: what the credit
    // can fund, clamped by what the expense still expects back (its own
    // expected-reimbursement slice when it carries one)
    const expected = reimbEarmarkCents(expense);
    const need = expected === null ? remainingCents(expense) : Math.min(remainingCents(expense), Math.max(0, expected - (expense.reimbursements ?? []).reduce((s, r) => s + r.amountCents, 0)));
    const prefill = clampReimbursement(expense, giveableCents(credit), Math.max(need, 0) || giveableCents(credit));
    setChosen({ row, maxCents: clampReimbursement(expense, giveableCents(credit), Number.MAX_SAFE_INTEGER) });
    setAmount(toText(prefill));
    setAmountError(null);
  };

  // #197: an EXPENSE part pick (credit anchor) — the prefill is the
  // part's open value, clamped by what this credit can still give
  const pickPart = (row: SpaceTx, part: TxSplit, openCents: number) => {
    const prefill = clampReimbursement(row, giveableCents(tx!), Math.min(openCents, giveableCents(tx!)) || openCents);
    setChosen({ row, partId: part.id, maxCents: clampReimbursement(row, giveableCents(tx!), openCents) });
    setAmount(toText(prefill));
    setAmountError(null);
  };

  // #197 (the other side): a CREDIT part pick (expense anchor) — the
  // prefill is what that part can still fund, clamped by the expense
  const pickCreditPart = (row: SpaceTx, part: TxSplit, openCents: number) => {
    const prefill = clampReimbursement(tx!, openCents, Math.min(openCents, remainingCents(tx!)) || openCents);
    setChosen({ row, creditPartId: part.id, maxCents: clampReimbursement(tx!, openCents, Number.MAX_SAFE_INTEGER) });
    setAmount(toText(prefill));
    setAmountError(null);
  };

  // #197: what ONE part of a split credit can still give — its own
  // magnitude minus the links naming it, never more than the whole
  // credit has left
  const creditPartOpen = (row: SpaceTx, part: TxSplit): number =>
    Math.min(
      giveableCents(row),
      Math.max(0, Math.abs(part.amountCents) - (part.id ? creditPartGivenCents(allTxs ?? [], row.id, part.id) : 0)),
    );

  // #233 r2 (user): the per-side category impact of the typed amount,
  // live while it is a saveable value — over-max keeps the error path
  const impactCents = parseCents(amount) ?? 0;
  const impact = useMemo(() => {
    if (!tx || !chosen || impactCents <= 0 || impactCents > chosen.maxCents) return null;
    return impactSides({
      expense: anchorIsExpense ? tx : chosen.row,
      expensePartId: anchorIsExpense ? partId : chosen.partId,
      credit: anchorIsExpense ? chosen.row : tx,
      creditPartId: anchorIsExpense ? chosen.creditPartId : partId,
      cents: impactCents,
      allTxs: allTxs ?? [],
      nameOf: (catId) => catName(cats.byId(catId), t),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx, chosen, impactCents, anchorIsExpense, partId, allTxs, cats]);

  const confirm = () => {
    if (!tx || !chosen) return;
    const cents = parseCents(amount) ?? 0;
    // #233 (user): an over-the-ceiling amount INTERRUPTS the save and
    // says the max — silently shrinking to the clamp taught nothing
    if (cents <= 0) {
      setAmountError(t('form.needAmount'));
      return;
    }
    if (cents > chosen.maxCents) {
      setAmountError(t('reimb.maxError', { max: fmtCents(chosen.maxCents, tx.currency, lang) }));
      return;
    }
    // the part target lives on the EXPENSE side's split — from the
    // expense anchor it rides the ?part param; the CREDIT part rides
    // the pick (expense anchor) or the ?part param (credit anchor's
    // own part page, #197)
    if (anchorIsExpense) link(tx, chosen.row, cents, partId, chosen.creditPartId);
    else link(chosen.row, tx, cents, chosen.partId, partId);
    setChosen(null);
    // REPLACE, not back: pressing back on the detail afterwards must not
    // resurface a stale picker — a part-born link returns to its part
    void navigate({ to: '/transactions/$txId', params: { txId }, search: partId ? { part: partId } : {}, replace: true });
  };

  const rowFor = (row: SpaceTx, testId: string, hint?: string) => {
    // #197 (both directions): a split row offers its PARTS, never the
    // root — expenses their still-expected parts, credits their
    // still-giveable ones
    const rowParts = (row.splits ?? []).filter((s) => s.catId !== REIMBURSED_ID);
    if (rowParts.length > 1) {
      return (
        <ReimbPartRows
          key={`${testId}-${row.id}`}
          row={row}
          testId={testId}
          hint={hint}
          money={(cents) => fmtCents(cents, row.currency, lang)}
          openOf={anchorIsExpense ? creditPartOpen : partOpenCents}
          onPick={anchorIsExpense ? pickCreditPart : pickPart}
          highlight={query}
        />
      );
    }
    return (
      <div key={`${testId}-${row.id}`} data-testid={`${testId}-${row.id}`}>
        <TxRow
          tx={row}
          showDate
          hideUnreviewed
          highlight={query}
          amountOverrideCents={row.amountCents > 0 ? openValueOf(row) : -openValueOf(row)}
          onClick={() => pick(row)}
        />
        {hint && <div className="-mt-1 px-1 pb-1.5 text-[11px] text-accent-deep">{hint}</div>}
      </div>
    );
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-reimb-link">
      <AppBar
        title={t(anchorIsExpense ? 'reimb.link' : 'reimb.linkOut')}
        leading={
          <IconButton label={t('action.back')} testId="reimb-link-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      {/* the origin transaction stays PINNED above the list (user
          request 2026-07-31) — the one fact the whole screen is about */}
      {tx && (
        <div className="shrink-0 border-b border-line-2 px-5 pb-2 text-[12px] text-ink-3" data-testid="reimb-link-anchor">
          {cleanBankText(tx.merchant)} · {fmtCents(tx.amountCents, tx.currency, lang, { sign: true })}
        </div>
      )}
      {/* #273: the field lives ABOVE the scroller and collapses smoothly —
          the sticky+translate version left its slot as a void */}
      <CollapsingSearch offset={searchOffset}>
        <div className="px-5 pt-1 pb-2">
          <SearchField
            testId="reimb-link-search"
            value={query}
            onChange={setQuery}
            placeholder={t('tx.searchPlaceholder')}
          />
        </div>
      </CollapsingSearch>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6" onScroll={onListScroll}>

        {/* the smart segment stands down while the user searches */}
        {!query && suggested.length > 0 && (
          <>
            <div className="m-cap mt-2 mb-1 flex items-center gap-1.5 px-1 text-accent-deep">
              <Icon name="lightbulb-outline" size={13} />
              {t('reimb.suggested')}
            </div>
            <div className="mb-3 divide-y divide-line-2 overflow-hidden rounded-card border border-accent/40 bg-surface px-3" data-testid="reimb-link-suggested">
              {suggested.map(({ tx: row }) => rowFor(row, 'reimb-suggest', t('reimb.suggestedWhy')))}
            </div>
          </>
        )}

        <div className="m-cap mt-2 mb-1 px-1">{t(anchorIsExpense ? 'reimb.allCredits' : 'reimb.allExpenses')}</div>
        <div className="divide-y divide-line-2 overflow-hidden rounded-card border border-line bg-surface px-3" data-testid="reimb-link-list">
          {listed.map((row) => rowFor(row, 'reimb-pick'))}
          {listed.length === 0 && <div className="px-1 py-4 text-center text-[12px] text-ink-4">—</div>}
        </div>
      </div>

      {/* the amount sheet: how much of the pair actually links */}
      {/* #233 r4 (user): both sides sit IN the sheet now — the title
          names the ACT, not one of the two rows */}
      <Sheet open={chosen !== null} onOpenChange={(next) => !next && setChosen(null)} title={t('reimb.confirmTitle')} size="form">
        <div className="flex flex-col gap-3 pt-1" data-testid="reimb-confirm">
          {/* #270 r2 (user): BOTH transactions' face — title, date and
              amount of each side of the link */}
          {chosen && tx && (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 gap-y-1 rounded-input bg-bg px-3 py-2"
              data-testid="reimb-confirm-pair"
            >
              {/* #233 r4 (user): dates align as their OWN column, like
                  the amounts */}
              {[tx, chosen.row].map((row) => (
                <Fragment key={row.id}>
                  <span className="min-w-0 truncate text-[12px] text-ink-2" data-testid="reimb-confirm-side">
                    {cleanBankText(row.merchant)}
                  </span>
                  <span className="text-right text-[12px] text-ink-4">
                    {new Date(row.date).toLocaleDateString(LOCALES[lang], { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <span className="m-num text-right text-[12px] text-ink-3">{fmtCents(row.amountCents, row.currency, lang, { sign: true })}</span>
                </Fragment>
              ))}
            </div>
          )}
          <input
            data-testid="reimb-amount"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountError(null);
            }}
            aria-invalid={!!amountError}
            inputMode="decimal"
            placeholder={t('reimb.amountLabel')}
            className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none${blockerRing(!!amountError)}`}
          />
          <FormBlockerNote show={!!amountError} text={amountError ?? ''} testId="reimb-amount-error" />
          {impact && tx && (
            <div className="rounded-input bg-bg px-3 py-2.5" data-testid="reimb-impact">
              <p className="pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-4">{t('reimb.impactCaption')}</p>
              {impact.map((side) => (
                <div key={side.title} className="pt-2 first:pt-0">
                  <p className="truncate pb-1 text-[11px] font-medium text-ink-3">{side.title}</p>
                  {/* #233 r3 (user): icon + name, amounts in aligned
                      columns — the whole diff readable at a glance */}
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 gap-y-1">
                    {side.lines.map((line) => {
                      const cat = cats.byId(line.catId);
                      const color = cat.color ?? cats.byId(cat.parentId ?? '').color ?? 'var(--m-ink-3)';
                      return (
                        <Fragment key={line.catId}>
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-full"
                            style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}
                          >
                            <Icon name={cat.icon} size={13} color={color} />
                          </span>
                          <span className="min-w-0 truncate text-[12.5px] text-ink-2" data-testid="reimb-impact-line">
                            {catName(cat, t)}
                          </span>
                          <span className="m-num text-right text-[12.5px] text-ink-4">
                            {fmtCents(line.before, tx.currency, lang)}
                          </span>
                          <span className="text-[12px] text-ink-4"> → </span>
                          <span className="m-num text-right text-[12.5px] font-medium text-ink">
                            {fmtCents(line.after, tx.currency, lang)}
                          </span>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button data-testid="reimb-save" onClick={confirm}>
            {t('action.save')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
