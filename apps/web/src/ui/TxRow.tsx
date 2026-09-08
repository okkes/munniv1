import { LOCALES, useLang } from '@/i18n';
import { txTitle } from '@/lib/text';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { netAmountCents, netCreditCents } from '@/domain/reimbursement';
import type { TransactionRow } from '@/db/types';
import { catName, useCategories } from '@/features/categories/useCategories';
import type { TFunc } from '@/i18n';
import { Highlight } from './Highlight';
import { Icon } from './Icon';
import { Pill } from './primitives';

/**
 * Split-aware row visual: a single category (or one split taking the
 * full amount) shows that category; several splits under ONE parent
 * show the parent; splits across different parents show a neutral
 * "mixed" mark.
 */
function txVisual(
  tx: Pick<TransactionRow, 'catId' | 'splits'>,
  cats: ReturnType<typeof useCategories>,
  t: TFunc,
): { icon: string; color: string; label: string } {
  const slices = (tx.splits ?? []).filter((s) => s.amountCents !== 0);
  const distinctCatIds = [...new Set(slices.map((s) => s.catId))];
  if (distinctCatIds.length > 1) {
    const parents = [...new Set(distinctCatIds.map((id) => cats.byId(id).parentId ?? id))];
    if (parents.length > 1) return { icon: 'shape', color: 'var(--m-ink-3)', label: t('tx.splitMixed') };
    const parentCat = cats.byId(parents[0]);
    return { icon: parentCat.icon, color: parentCat.color ?? 'var(--m-ink-3)', label: catName(parentCat, t) };
  }
  const cat = cats.byId(distinctCatIds.length === 1 ? distinctCatIds[0] : tx.catId);
  const parent = cat.parentId ? cats.byId(cat.parentId) : undefined;
  return { icon: cat.icon, color: cat.color ?? parent?.color ?? 'var(--m-ink-3)', label: catName(cat, t) };
}

export function TxRow({
  tx,
  onClick,
  highlight = '',
  showDate = false,
  hideCategory = false,
  hideUnreviewed = false,
  amountOverrideCents,
  selected = false,
  accountName,
  givenCents = 0,
  transferNote,
}: {
  tx: TransactionRow;
  onClick?: () => void;
  highlight?: string;
  /** lists without date group headers (Home) show it inline */
  showDate?: boolean;
  /** lists already scoped to one category (drill) skip the redundant name */
  hideCategory?: boolean;
  /** bulk review sheet: every row is unreviewed — the badge is noise */
  hideUnreviewed?: boolean;
  /** scoped lists (drill) show their slice as the headline amount */
  amountOverrideCents?: number;
  /** master–detail panes mark the row whose detail is open (§4.2) */
  selected?: boolean;
  /** desktop density (D2): the account surfaces as an md+ column */
  accountName?: string;
  /** cents this credit gave away as reimbursements (derived by the list) */
  givenCents?: number;
  /** collapsed transfer pair: "From → To" replaces the category line */
  transferNote?: string;
}) {
  const { t, lang } = useLang();
  const cats = useCategories();
  // display-currency lens (currency plan): rows convert at their OWN
  // day's rate — historically honest lists; without a preference this
  // is plain fmtCents
  const { fmt } = useDisplayMoney();
  const { icon: iconName, color, label: categoryLabel } = txVisual(tx, cats, t);

  // reimbursements change what a transaction really cost — lists show
  // the net truth, with the gross quietly struck through beside it;
  // credits net out what they refunded elsewhere the same way
  const net = tx.amountCents > 0 ? netCreditCents(tx, givenCents) : netAmountCents(tx);
  const display = amountOverrideCents ?? net;
  const positive = display > 0;
  const reimbursed = net !== tx.amountCents;

  return (
    <button
      onClick={onClick}
      data-testid={`tx-row-${tx.id}`}
      className={`m-tap flex w-full items-center gap-3 rounded-xl border-none px-1 py-2.5 text-left md:py-2 ${
        selected ? 'bg-accent-soft/50' : 'bg-transparent'
      }`}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      >
        <Icon name={iconName} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">
          <Highlight text={txTitle(tx)} query={highlight} />
        </span>
        <span className="block truncate text-xs text-ink-3">
          {showDate && (
            <span className="text-ink-4">
              {new Date(tx.date).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' })}
              {!hideCategory && ' · '}
            </span>
          )}
          {transferNote ? (
            <span data-testid={`tx-row-pair-${tx.id}`}>
              <Icon name="swap-horizontal" size={11} /> {transferNote}
            </span>
          ) : (
            !hideCategory && categoryLabel
          )}
          {tx.pending === 1 && (
            <Pill className={hideCategory && !showDate ? '' : 'ml-1.5'}>{t('tx.pendingBadge')}</Pill>
          )}
          {tx.needsReview === 1 && !hideUnreviewed && (
            <Pill tone="warning" className={hideCategory && !showDate ? '' : 'ml-1.5'}>
              {t('tx.unreviewed')}
            </Pill>
          )}
        </span>
      </span>
      {accountName && (
        <span className="hidden max-w-[180px] shrink-0 truncate text-right text-[12px] text-ink-4 md:block">
          {accountName}
        </span>
      )}
      <span className="shrink-0 text-right">
        <span className={`m-num block text-[14px] font-semibold ${positive ? 'text-accent-deep' : 'text-ink'}`}>
          {fmt(display, tx.currency, { sign: true, date: tx.date })}
        </span>
        {amountOverrideCents === undefined && reimbursed && (
          <span className="m-num block text-[11px] text-ink-4 line-through">
            {fmt(tx.amountCents, tx.currency, { sign: true, date: tx.date })}
          </span>
        )}
        {amountOverrideCents !== undefined && amountOverrideCents !== net && (
          <span className="m-num block text-[11px] text-ink-4">{fmt(net, tx.currency, { sign: true, date: tx.date })}</span>
        )}
      </span>
    </button>
  );
}
