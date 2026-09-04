import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { directionAllows } from '@/domain/categoryRules';
import { REIMBURSED_ID, isSpecialCategory, mainCatOf, specialCatType } from '@/domain/categories';
import { allowedSpecialCats } from '@/domain/txType';
import { kindOf } from '@/domain/txKind';
import { useLang } from '@/i18n';
import { Highlight } from '@/ui/Highlight';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { SearchField } from '@/ui/SearchField';
import { CollapsingSearch, useSearchCollapse } from '@/ui/CollapsingSearch';
import { catName, useCategories } from './useCategories';
import { SpecialCatMark } from './SpecialCatMark';

import type { AccountType, TxType } from '@/db/types';

interface CategoryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId?: string;
  onPick: (catId: string) => void;
  /** the transaction's side — hides categories of the opposite direction */
  direction?: 'debit' | 'credit';
  /** the transaction's type — a category must support it to be pickable */
  txType?: TxType;
  /** #133 r5: the row's own account type — with `direction` it runs the
   *  movement matrix, so a regular account's outgoing row only sees
   *  "Set aside" of the whole saving family (Interest/Fees live on the
   *  pot's own ledger, where the matrix runs sign-inverted). Omitted =
   *  no narrowing (pickers without row context). */
  sourceAccountType?: AccountType;
  /** categories other rows of a split already own — hidden here (user
   *  rule 2026-07-28: never offer picking the same category twice) */
  excludeIds?: readonly string[];
  /** ALLOWLIST: when set, only these ids are offered — a recurring-linked
   *  transaction picks between the recurring's category and expected
   *  reimbursement, nothing else (user rule 2026-07-28) */
  onlyIds?: readonly string[];
  /** #228 (user): a spread's rows offer no ◆ special-family categories —
   *  one special per (split) transaction and it spans the whole, so a
   *  multi-entry editor hides them (reimbursement, the one exception,
   *  stays pickable) */
  noSpecials?: boolean;
  /** #275: fired right before the create-custom door navigates away —
   *  hosts stash their return state (review keeps its place) */
  onCreateCustomNav?: () => void;
  /** #322 (user): a standing counterparty narrows the list — hosts that
   *  narrow pass this to render the detach door INSIDE the picker; the
   *  callback clears the counter through the host's own detach mechanics
   *  and the picker un-narrows in place */
  onClearCounter?: () => void;
}

/** Bottom sheet listing the catalog (built-in + custom) grouped by parent, with search. */
export function CategoryPicker({ open, onOpenChange, selectedId, onPick, direction, txType, sourceAccountType, excludeIds, onlyIds, noSpecials, onCreateCustomNav, onClearCounter }: Readonly<CategoryPickerProps>) {
  const { t } = useLang();
  const cats = useCategories();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  // #246 (user): one tap to see only the ◆ special categories
  const [specialOnly, setSpecialOnly] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    // #133 r5: with row context, movement-family subs narrow to the
    // matrix cell (source account type × money side); null = no context
    const allowedMovement = sourceAccountType && direction ? allowedSpecialCats(sourceAccountType, direction) : null;
    return cats.parents
      .map((parent) => {
        // #214 (user): a query that hits the PARENT's name keeps the whole
        // group — every surviving sub shows under the matched header
        const parentMatch = !!q && catName(parent, t).toLowerCase().includes(q);
        return {
        parent,
        children: cats
          .childrenOf(parent.id)
          // `reimbursed` is munni's own bookkeeping: settlement writes it,
          // people never pick it (user rule 2026-07-24)
          .filter((c) => c.id !== REIMBURSED_ID)
          .filter((c) => !direction || directionAllows(c.direction, direction))
          // the invariant: a transaction's category must speak its type.
          // R3 relax (typed-splits v2): STANDARD rows also see the marked
          // special families — picking one pulls the type along. #133 E:
          // the TRANSFER family joins them (kind rows are gone; the ◆
          // Transfer pick opens the mandatory counterparty ask) — only
          // stamped rows keep their narrowed lists
          .filter(
            (c) =>
              !txType ||
              c.txTypes.includes(txType) ||
              // #261: the Adjustment family is locked/special but never rides
              // the standard-row escape — its rows are system-minted only
              (kindOf(txType) === 'standard' && isSpecialCategory(c) && mainCatOf(c.id) !== 'adjustment'),
          )
          .filter((c) => !allowedMovement || specialCatType(c.id) === undefined || allowedMovement.has(c.id))
          .filter((c) => !noSpecials || specialCatType(c.id) === undefined)
          .filter((c) => !specialOnly || isSpecialCategory(c))
          .filter((c) => !excludeIds?.includes(c.id))
          .filter((c) => !onlyIds || onlyIds.includes(c.id))
          .filter((c) => !q || parentMatch || catName(c, t).toLowerCase().includes(q)),
        };
      })
      .filter((g) => g.children.length > 0);
  }, [cats, query, t, direction, txType, sourceAccountType, excludeIds, onlyIds, noSpecials, specialOnly]);

  const pick = (catId: string) => {
    onPick(catId);
    onOpenChange(false);
    setQuery('');
  };

  // #245 (user): the search rides along — #273 r2: 1:1 WITH the scroll
  // (no animation; the finger owns the motion); the list's cap grows by
  // exactly the freed height, so the tail always stays reachable.
  // #323 (user): the query doubles as the hook's resetKey — a filtered
  // (shorter) list must not inherit the unfiltered state's collapse slack
  const { offset: searchOffset, onListScroll, reset: resetCollapse } = useSearchCollapse(noSpecials ? 56 : 90, query);
  const listRef = useRef<HTMLDivElement>(null);
  // #273 r3 (user): reopening must start whole — field shown, list at
  // top. #329 (user): the ◆ lens resets with it — a filter toggled on
  // the LAST visit must not silently narrow the next one. #335 (user):
  // the search query clears too — a stale search must not greet the
  // reopen (as the #323 resetKey it also rewinds the collapse slack).
  useEffect(() => {
    if (!open) return;
    resetCollapse();
    setSpecialOnly(false);
    setQuery('');
    if (listRef.current) listRef.current.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // #323 (user): the hook dropped its offset on the query change — the
  // scroller rewinds with it so the shorter result list starts at its top
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('screen.categories')} size="tall" dragHandle>
      <CollapsingSearch offset={searchOffset} testId="catpicker-search-wrap">
        <SearchField testId="catpicker-search" value={query} onChange={setQuery} placeholder={t('cats.searchPlaceholder')} />
        {/* #246: the ◆ lens — hidden where specials are off the table */}
        {!noSpecials && (
          <div className="mt-2 flex gap-2">
            <Chip testId="catpicker-special-filter" selected={specialOnly} onClick={() => setSpecialOnly((v) => !v)}>
              <span aria-hidden className="inline-block h-[7px] w-[7px] rotate-45 rounded-[1.5px] bg-current" />
              {t('cats.special')}
            </Chip>
          </div>
        )}
      </CollapsingSearch>
      <div
        ref={listRef}
        className="mt-2 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
        style={{ maxHeight: 440 + searchOffset }}
        data-testid="catpicker-list"
        onScroll={onListScroll}
      >
      {/* #322 (user): the narrowed list says WHY and offers the way out —
          detaching the counterparty right here frees the whole catalog
          without a trip back to the counter row */}
      {onClearCounter && (
        <button
          data-testid="catpicker-clear-counter"
          onClick={onClearCounter}
          className="m-tap mt-1 flex w-full items-center gap-2 rounded-card border border-dashed border-line bg-transparent px-3 py-2.5 text-left text-[13px] font-medium text-accent-deep"
        >
          <Icon name="link-off" size={16} />
          {t('cats.clearCounter')}
        </button>
      )}
      {groups.map(({ parent, children }) => (
        <div key={parent.id}>
          <div className="m-cap mt-3 mb-1 flex items-center gap-1.5 px-1" style={{ color: parent.color }}>
            <Icon name={parent.icon} size={14} />
            {/* #187: Highlight emits <mark> fragments — inside a gapped flex
                row they'd each become flex items and the gap would split the
                word; the extra span keeps them one inline run */}
            <span className="min-w-0 truncate">
              <Highlight text={catName(parent, t)} query={query} />
            </span>
          </div>
          {children.map((cat) => (
            <button
              key={cat.id}
              data-testid={`catpicker-${cat.id}`}
              onClick={() => pick(cat.id)}
              className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-1 py-2.5 text-left text-[14px] text-ink"
            >
              <Icon name={cat.icon} size={19} color={cat.color ?? parent.color} />
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <SpecialCatMark cat={cat} color={cat.color ?? parent.color} />
                {/* #187: same one-flex-item wrap as the header above */}
                <span className="min-w-0 truncate">
                  <Highlight text={catName(cat, t)} query={query} />
                </span>
              </span>
              {selectedId === cat.id && <Icon name="check" size={18} color="var(--m-accent)" />}
            </button>
          ))}
        </div>
      ))}
      {/* end of the list (or an empty search): the flow must not dead-end —
          a door to creating a custom category keeps the user moving (user
          request) */}
      <div className="mt-3 mb-2 flex flex-col items-center gap-1 rounded-card border border-dashed border-line px-4 py-3 text-center">
        {groups.length === 0 && (
          <p className="text-[13px] text-ink-3" data-testid="catpicker-empty">
            {t('cats.noneFound')}
          </p>
        )}
        <button
          data-testid="catpicker-create-custom"
          onClick={() => {
            onCreateCustomNav?.(); // #275: hosts stash their way back
            onOpenChange(false);
            setQuery('');
            void navigate({ to: '/categories' });
          }}
          className="m-tap flex items-center gap-1.5 border-none bg-transparent text-[13px] font-semibold text-accent-deep"
        >
          <Icon name="plus" size={15} />
          {t('cats.createCustom')}
        </button>
      </div>
      </div>
    </Sheet>
  );
}
