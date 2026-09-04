import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { directionAllows } from '@/domain/categoryRules';
import { REIMBURSED_ID } from '@/domain/categories';
import { useLang } from '@/i18n';
import { Highlight } from '@/ui/Highlight';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { catName, useCategories } from './useCategories';

import type { TxType } from '@/db/types';

interface CategoryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId?: string;
  onPick: (catId: string) => void;
  /** the transaction's side — hides categories of the opposite direction */
  direction?: 'debit' | 'credit';
  /** the transaction's type — a category must support it to be pickable */
  txType?: TxType;
  /** categories other rows of a split already own — hidden here (user
   *  rule 2026-07-28: never offer picking the same category twice) */
  excludeIds?: readonly string[];
  /** ALLOWLIST: when set, only these ids are offered — a recurring-linked
   *  transaction picks between the recurring's category and expected
   *  reimbursement, nothing else (user rule 2026-07-28) */
  onlyIds?: readonly string[];
}

/** Bottom sheet listing the catalog (built-in + custom) grouped by parent, with search. */
export function CategoryPicker({ open, onOpenChange, selectedId, onPick, direction, txType, excludeIds, onlyIds }: Readonly<CategoryPickerProps>) {
  const { t } = useLang();
  const cats = useCategories();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cats.parents
      .map((parent) => ({
        parent,
        children: cats
          .childrenOf(parent.id)
          // `reimbursed` is munni's own bookkeeping: settlement writes it,
          // people never pick it (user rule 2026-07-24)
          .filter((c) => c.id !== REIMBURSED_ID)
          .filter((c) => !direction || directionAllows(c.direction, direction))
          // the invariant: a transaction's category must speak its type
          .filter((c) => !txType || c.txTypes.includes(txType))
          .filter((c) => !excludeIds?.includes(c.id))
          .filter((c) => !onlyIds || onlyIds.includes(c.id))
          .filter((c) => !q || catName(c, t).toLowerCase().includes(q)),
      }))
      .filter((g) => g.children.length > 0);
  }, [cats, query, t, direction, txType, excludeIds, onlyIds]);

  const pick = (catId: string) => {
    onPick(catId);
    onOpenChange(false);
    setQuery('');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('screen.categories')} size="tall" dragHandle>
      <input
        data-testid="catpicker-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('cats.searchPlaceholder')}
        className="mb-2 h-11 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4"
      />
      {groups.map(({ parent, children }) => (
        <div key={parent.id}>
          <div className="m-cap mt-3 mb-1 flex items-center gap-1.5 px-1" style={{ color: parent.color }}>
            <Icon name={parent.icon} size={14} />
            {catName(parent, t)}
          </div>
          {children.map((cat) => (
            <button
              key={cat.id}
              data-testid={`catpicker-${cat.id}`}
              onClick={() => pick(cat.id)}
              className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-1 py-2.5 text-left text-[14px] text-ink"
            >
              <Icon name={cat.icon} size={19} color={cat.color ?? parent.color} />
              <span className="flex-1">
                <Highlight text={catName(cat, t)} query={query} />
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
    </Sheet>
  );
}
