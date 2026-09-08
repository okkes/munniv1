import { useSpaceAccounts } from '@/application/transactions';
import type { SpaceAccount } from '@/db/joined';
import type { TxType } from '@/db/types';
import { institutionLogoUrl } from '@/features/accounts/useInstitutionLogos';
import { typeDef } from '@/features/accounts/accountTypes';
import { catName, useCategories } from '@/features/categories/useCategories';
import { useLang } from '@/i18n';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';

/**
 * Filter state owned by the transactions screen; the sheet only edits
 * it. Sets are additive within a section and sections combine with AND
 * (pick two accounts + a category = that category on either account).
 * #320 (user): the type/kind chips left the sheet — `txTypes` stays in
 * the contract (the screen still applies it) but nothing writes it here.
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

/** #320 (user): each chip wears the account's face — the bank logo
 *  where one exists (the AccountsScreen row recipe), else the type icon
 *  in the account's color; a dead logo URL swaps to the icon */
function AccountChipFace({ account }: Readonly<{ account: SpaceAccount }>) {
  const logo = account.logo ?? institutionLogoUrl(account.bankId);
  const icon = <Icon name={typeDef(account.type).icon} size={13} color={account.color ?? 'var(--m-ink-3)'} />;
  if (!logo) return icon;
  return (
    <>
      <img
        src={logo}
        alt=""
        className="h-4 w-4 rounded object-contain"
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          e.currentTarget.nextElementSibling?.classList.remove('hidden');
        }}
      />
      <span className="hidden">{icon}</span>
    </>
  );
}

/** one selectable group of account chips (#320: defaults split out) */
function AccountChips({
  list,
  value,
  onChange,
  testId,
}: Readonly<{
  list: SpaceAccount[];
  value: SheetFilters;
  onChange: (next: SheetFilters) => void;
  testId?: string;
}>) {
  return (
    <div className="flex flex-wrap gap-2" data-testid={testId}>
      {list.map((a) => (
        <Chip
          key={a.id}
          testId={`filter-account-${a.id}`}
          selected={value.accountIds.has(a.id)}
          onClick={() => onChange({ ...value, accountIds: toggled(value.accountIds, a.id) })}
        >
          <AccountChipFace account={a} /> {a.name}
        </Chip>
      ))}
    </div>
  );
}

export function FilterSheet({
  open,
  onOpenChange,
  value,
  onChange,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: SheetFilters;
  onChange: (next: SheetFilters) => void;
}>) {
  const { t } = useLang();
  const cats = useCategories();
  const accounts = useSpaceAccounts();
  // #320 (user): the space's default pots stand apart from the accounts
  // people actually made — two labeled groups
  const realAccounts = (accounts ?? []).filter((a) => !a.defaultFor);
  const defaultAccounts = (accounts ?? []).filter((a) => !!a.defaultFor);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('tx.filters')} size="tall">
      <div className="flex flex-col gap-3 pb-2">
        {/* #320 r2 (user): "All accounts" over MORE accounts (the defaults)
            below read odd — this caption is the filter's own key; the global
            overview keeps its shared title */}
        <div className="m-cap px-1">{t('tx.filterAccountsCap')}</div>
        <AccountChips list={realAccounts} value={value} onChange={onChange} />
        {defaultAccounts.length > 0 && (
          <>
            <div className="m-cap px-1">{t('tx.filterDefaultsCap')}</div>
            <AccountChips list={defaultAccounts} value={value} onChange={onChange} testId="filter-defaults-group" />
          </>
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
