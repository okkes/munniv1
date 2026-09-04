import { useSpaceAccounts } from '@/application/transactions';
import { TRANSFER_TYPES, TX_KINDS } from '@/domain/txKind';
import type { TxKind } from '@/domain/txKind';
import type { TxType } from '@/db/types';
import { catName, useCategories } from '@/features/categories/useCategories';
import { useLang } from '@/i18n';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';

/**
 * Filter state owned by the transactions screen; the sheet only edits
 * it. Sets are additive within a section and sections combine with AND
 * (pick two accounts + 'expense' = expenses on either account).
 */
export interface SheetFilters {
  accountIds: ReadonlySet<string>;
  txTypes: ReadonlySet<TxType>;
  /** MAIN category ids — the screen expands them to include subs */
  mainCatIds: ReadonlySet<string>;
  from?: string;
  to?: string;
}

export const EMPTY_FILTERS: SheetFilters = { accountIds: new Set(), txTypes: new Set(), mainCatIds: new Set() };

export const countActive = (f: SheetFilters): number =>
  f.accountIds.size + f.txTypes.size + f.mainCatIds.size + (f.from || f.to ? 1 : 0);

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** what each KIND chip means in stored-type terms (user simplification:
 *  people filter by kind; the transfer family unfolds on demand) */
const KIND_FILTER_TYPES: Record<TxKind, readonly TxType[]> = {
  standard: ['income', 'expense'],
  transfer: TRANSFER_TYPES,
  adjustment: ['adjustment'],
};

/** kind chip toggle: any member selected → drop the whole family,
 *  otherwise select all of it (detail chips then narrow) */
function kindToggled(set: ReadonlySet<TxType>, kind: TxKind): Set<TxType> {
  const family = KIND_FILTER_TYPES[kind];
  const next = new Set(set);
  if (family.some((type) => next.has(type))) for (const type of family) next.delete(type);
  else for (const type of family) next.add(type);
  return next;
}

export function FilterSheet({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: SheetFilters;
  onChange: (next: SheetFilters) => void;
}) {
  const { t } = useLang();
  const cats = useCategories();
  const accounts = useSpaceAccounts();

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('tx.filters')} size="tall">
      <div className="flex flex-col gap-3 pb-2">
        <div className="m-cap px-1">{t('acct.financialAccounts')}</div>
        <div className="flex flex-wrap gap-2">
          {(accounts ?? []).map((a) => (
            <Chip
              key={a.id}
              testId={`filter-account-${a.id}`}
              selected={value.accountIds.has(a.id)}
              onClick={() => onChange({ ...value, accountIds: toggled(value.accountIds, a.id) })}
            >
              {a.name}
            </Chip>
          ))}
        </div>

        <div className="m-cap px-1">{t('tx.kindTitle')}</div>
        <div className="flex flex-wrap gap-2">
          {TX_KINDS.map((kind) => (
            <Chip
              key={kind}
              testId={`filter-kind-${kind}`}
              selected={KIND_FILTER_TYPES[kind].some((type) => value.txTypes.has(type))}
              onClick={() => onChange({ ...value, txTypes: kindToggled(value.txTypes, kind) })}
            >
              {t(`tx.kind.${kind}`)}
            </Chip>
          ))}
        </div>
        {/* power detail (user choice "kinds + detail"): a selected
            Transfer kind unfolds its exact family members */}
        {TRANSFER_TYPES.some((type) => value.txTypes.has(type)) && (
          <div className="flex flex-wrap gap-2 pl-3" data-testid="filter-transfer-detail">
            {TRANSFER_TYPES.map((type) => (
              <Chip
                key={type}
                testId={`filter-type-${type}`}
                selected={value.txTypes.has(type)}
                onClick={() => onChange({ ...value, txTypes: toggled(value.txTypes, type) })}
              >
                {t(`tx.type.${type}`)}
              </Chip>
            ))}
          </div>
        )}

        <div className="m-cap px-1">{t('screen.categories')}</div>
        <div className="flex flex-wrap gap-2">
          {cats.parents.map((main) => (
            <Chip
              key={main.id}
              testId={`filter-cat-${main.id}`}
              selected={value.mainCatIds.has(main.id)}
              onClick={() => onChange({ ...value, mainCatIds: toggled(value.mainCatIds, main.id) })}
            >
              <Icon name={main.icon} size={13} /> {catName(main, t)}
            </Chip>
          ))}
        </div>

        <div className="m-cap px-1">{t('tx.dateRange')}</div>
        <div className="flex items-center gap-2">
          <input
            data-testid="filter-from"
            type="date"
            value={value.from ?? ''}
            onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
            className="h-10 min-w-0 flex-1 rounded-input border border-line bg-surface px-3 text-[13px] text-ink outline-none"
          />
          <span className="text-ink-4">–</span>
          <input
            data-testid="filter-to"
            type="date"
            value={value.to ?? ''}
            onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
            className="h-10 min-w-0 flex-1 rounded-input border border-line bg-surface px-3 text-[13px] text-ink outline-none"
          />
        </div>

        <div className="mt-2 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            data-testid="filter-reset"
            onClick={() => onChange(EMPTY_FILTERS)}
          >
            {t('tx.filtersReset')}
          </Button>
          <Button className="flex-1" data-testid="filter-done" onClick={() => onOpenChange(false)}>
            {t('action.done')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
