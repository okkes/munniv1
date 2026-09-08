import { useMemo, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { globalAsEntry, useSpaceReceipts, viewAsEntry } from '@/application/receiptLinks';
import type { ReceiptEntry } from '@/application/receiptLinks';
import { useSpaceStoreConnLinks, useUnmatchedReceipts } from '@/application/stores';
import { fmtCents } from '@/lib/money';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Chip } from '@/ui/primitives';
import { Icon } from '@/ui/Icon';
import { SearchField } from '@/ui/SearchField';
import { ReceiptViewSheet } from './ReceiptViewSheet';

const SOURCE_ICON: Record<string, string> = {
  photo: 'camera-outline',
  ah: 'storefront-outline',
  jumbo: 'storefront-outline',
  bol: 'package-variant-closed',
  coolblue: 'package-variant-closed',
  mediamarkt: 'package-variant-closed',
  amazon: 'package-variant-closed',
};

/** brand names stay brand names; only the photo bucket is translated */
const SOURCE_NAMES: Record<string, string> = {
  ah: 'Albert Heijn',
  jumbo: 'Jumbo',
  bol: 'bol.com',
  coolblue: 'Coolblue',
  mediamarkt: 'MediaMarkt',
  amazon: 'Amazon',
};

/** store, merchant, item names and the amount's digits are all searchable */
function entryMatches(entry: ReceiptEntry, q: string, amountQ: string | null): boolean {
  const receipt = entry.data;
  const haystack = [receipt.merchant ?? '', receipt.source, ...(receipt.items?.map((i) => i.name) ?? [])]
    .join(' ')
    .toLowerCase();
  if (haystack.includes(q)) return true;
  return !!amountQ && String(Math.abs(receipt.totalCents)).includes(amountQ);
}

/**
 * Receipts v3 home (R7): everything the space sees — snapshot-linked
 * receipts, legacy rows and the owner's still-unmatched store pulls —
 * searchable by name/item/amount, filterable by linked-state and by
 * connection instance, grouped by store.
 */
export function ReceiptsScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [instanceFilter, setInstanceFilter] = useState<string | null>(null);

  const views = useSpaceReceipts();
  const unmatched = useUnmatchedReceipts();
  const connLinks = useSpaceStoreConnLinks();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const currency = space?.currency ?? 'EUR';

  const entries = useMemo(() => {
    const linked = (views ?? []).map(viewAsEntry);
    const open = (unmatched ?? []).map(globalAsEntry);
    const all = [...linked, ...open];
    all.sort((a, b) => b.data.date.localeCompare(a.data.date));
    return all;
  }, [views, unmatched]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replaceAll(/[\s.,€-]/g, '');
    const amountQ = /^\d+$/.test(digits) && digits.length > 0 ? digits : null;
    const visible = entries.filter(
      (entry) =>
        (!unlinkedOnly || !entry.txId) &&
        (!instanceFilter || entry.data.instanceId === instanceFilter) &&
        (!q || entryMatches(entry, q, amountQ)),
    );
    const bySource = new Map<string, ReceiptEntry[]>();
    for (const entry of visible) {
      const list = bySource.get(entry.data.source) ?? [];
      list.push(entry);
      bySource.set(entry.data.source, list);
    }
    // stores first (alphabetical), the photo bucket last
    return [...bySource.entries()].sort(([a], [b]) => {
      if (a === 'photo') return 1;
      if (b === 'photo') return -1;
      return a.localeCompare(b);
    });
  }, [entries, query, unlinkedOnly, instanceFilter]);

  // keep the sheet live: deletions/links flow straight into the view
  const current = useMemo(() => entries.find((e) => e.data.id === selected) ?? null, [entries, selected]);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' });
  const unlinkedCount = entries.filter((e) => !e.txId).length;

  const renderRow = (entry: ReceiptEntry) => {
    const receipt = entry.data;
    return (
      <button
        key={receipt.id}
        data-testid={`receipt-row-${receipt.id}`}
        onClick={() => setSelected(receipt.id)}
        className="m-tap flex w-full items-center gap-3 border-b border-line-2 px-4 py-3 text-left last:border-0"
      >
        <Icon name={SOURCE_ICON[receipt.source] ?? 'receipt-text-outline'} size={18} color="var(--m-ink-3)" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{receipt.merchant ?? t('receipt.sourcePhoto')}</span>
          <span className="block text-[11px] text-ink-4">
            {fmtDate(receipt.date)}
            {receipt.items?.length ? ` · ${receipt.items.length} ${t('receipt.items')}` : ''}
          </span>
        </span>
        {!entry.txId && (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning" data-testid={`receipt-unmatched-${receipt.id}`}>
            {t('receipts.unmatched')}
          </span>
        )}
        <span className="m-num text-[13px] font-semibold text-ink">{fmtCents(receipt.totalCents, currency, lang)}</span>
      </button>
    );
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-receipts">
      <AppBar
        title={t('receipts.title')}
        leading={
          <IconButton label={t('action.back')} testId="receipts-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <IconButton label={t('receipts.connectedStores')} testId="receipts-stores" onClick={() => void navigate({ to: '/shopping' })}>
            <Icon name="storefront-outline" size={20} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <SearchField
          testId="receipts-search"
          value={query}
          onChange={setQuery}
          placeholder={t('receipts.searchPlaceholder')}
          className="mb-2"
        />
        {(unlinkedCount > 0 || (connLinks ?? []).length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {unlinkedCount > 0 && (
              <Chip testId="receipts-filter-unlinked" selected={unlinkedOnly} onClick={() => setUnlinkedOnly((v) => !v)}>
                {t('receipts.unlinkedOnly', { n: unlinkedCount })}
              </Chip>
            )}
            {/* one chip per included connection instance (R7 filters) */}
            {(connLinks ?? []).map((link) => (
              <Chip
                key={link.instanceId}
                testId={`receipts-filter-${link.instanceId}`}
                selected={instanceFilter === link.instanceId}
                onClick={() => setInstanceFilter((v) => (v === link.instanceId ? null : link.instanceId))}
              >
                {link.displayName}
              </Chip>
            ))}
          </div>
        )}

        {groups.length > 0 ? (
          groups.map(([source, rows]) => (
            <div key={source}>
              <div className="m-cap mt-3 mb-1 flex items-center gap-1.5 px-1">
                <Icon name={SOURCE_ICON[source] ?? 'receipt-text-outline'} size={13} />
                {SOURCE_NAMES[source] ?? t('receipt.sourcePhoto')} · {rows.length}
              </div>
              <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid={`receipts-group-${source}`}>
                {rows.map(renderRow)}
              </div>
            </div>
          ))
        ) : (
          views && (
            <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center" data-testid="receipts-empty">
              <Icon name="receipt-text-outline" size={34} color="var(--m-ink-4)" />
              <p className="text-[14px] font-medium text-ink-2">{t('receipts.emptyTitle')}</p>
              <p className="text-[12px] text-ink-4">{t('receipts.emptyBody')}</p>
            </div>
          )
        )}
      </div>
      <ReceiptViewSheet entry={current} currency={currency} onClose={() => setSelected(null)} />
    </div>
  );
}
