import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useSpaceAccounts, useSpaceTransactions } from '@/application/transactions';
import { catName, useCategories } from '@/features/categories/useCategories';
import { REIMBURSED_ID } from '@/domain/categories';
import { orDefaultLabel, txTitle } from '@/lib/text';
import { EMPTY_FILTERS, FilterSheet, countActive } from './FilterSheet';
import type { SheetFilters } from './FilterSheet';
import { useLang } from '@/i18n';
import type { TransactionRow } from '@/db/types';
import { filterTxs, matchingPartIndexes } from '@/domain/txFilter';
import { hasUnsettledReimbursement, partNetCents } from '@/domain/reimbursement';
import { kindOf } from '@/domain/txKind';
import { HelpButton } from '@/features/help/HelpButton';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { useData } from '@/app/data';
import { useNewTransactions } from '@/application/newTxs';
import { readTxFilters, writeTxFilters } from './txFilters';
import { Icon } from '@/ui/Icon';
import { Chip, Pill } from '@/ui/primitives';
import { TxRow, type TxRowEdge } from '@/ui/TxRow';
import { TxPartRow } from '@/ui/TxPartRow';
import { SearchField } from '@/ui/SearchField';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { useScrollMemory } from '@/lib/scrollMemory';
import { TxFormSheet } from './TxFormSheet';

const DATE_FMT: Record<string, string> = { en: 'en-GB', nl: 'nl-NL', tr: 'tr-TR' };

/** the parts a filter singled out, standing alone (#126 r8) —
 *  module-level for S2004 */
function TxPartSoloRows({
  tx,
  parts,
  shownIdx,
  fmt,
  onOpen,
  highlight = '',
}: Readonly<{
  tx: TransactionRow;
  parts: readonly NonNullable<TransactionRow['splits']>[number][];
  shownIdx: readonly number[];
  fmt: ReturnType<typeof useDisplayMoney>['fmt'];
  onOpen: (partId: string | undefined) => void;
  highlight?: string;
}>) {
  const sign = tx.amountCents < 0 ? -1 : 1;
  return (
    <>
      {shownIdx.map((i) => (
        <TxPartRow
          key={parts[i].id ?? `${tx.id}-${i}`}
          tx={tx}
          part={parts[i]}
          index={i}
          amountText={fmt(sign * partNetCents(parts[i]), tx.currency, { date: tx.date })}
          onClick={() => onOpen(parts[i].id)}
          highlight={highlight}
        />
      ))}
    </>
  );
}

/** a split's parts standing IN the list (#126 r5; restyled r6, r9,
 *  then SUBTLER per the user's #198 inspiration): the header is a
 *  plain row — category icon, title, a quiet "N linked parts" pill,
 *  the FULL amount and a fold chevron — and the parts sit in a soft
 *  inset below it, each led by a small branch arrow. No accent band,
 *  no drawn spine. Module-level for S2004. */
function TxPartGroupRows({
  tx,
  parts,
  fmt,
  onOpen,
}: Readonly<{
  tx: TransactionRow;
  parts: readonly NonNullable<TransactionRow['splits']>[number][];
  fmt: ReturnType<typeof useDisplayMoney>['fmt'];
  onOpen: (partId: string | undefined) => void;
}>) {
  const { t } = useLang();
  const cats = useCategories();
  const [collapsed, setCollapsed] = useState(false);
  const sign = tx.amountCents < 0 ? -1 : 1;
  // #228: the header says what the whole is WORTH — part nets, so a
  // reimbursed part shrinks the group exactly like a settled whole row
  const totalCents = sign * parts.reduce((sum, part) => sum + partNetCents(part), 0);
  const headCat = cats.byId(tx.catId);
  const headColor = headCat.color ?? cats.byId(headCat.parentId ?? '').color ?? 'var(--m-ink-3)';
  return (
    <div className="py-0.5" data-testid={`tx-parts-${tx.id}`}>
      <div className="flex items-center">
        <button
          data-testid={`tx-parts-head-${tx.id}`}
          onClick={() => onOpen(undefined)}
          className="m-tap flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent px-1 py-2.5 text-left"
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ background: `color-mix(in srgb, ${headColor} 14%, transparent)` }}
          >
            <Icon name={headCat.icon} size={20} color={headColor} />
          </span>
          <span className="min-w-0 truncate text-[14px] font-medium text-ink">{txTitle(tx)}</span>
          <Pill tone="accent">{t('tx.linkedParts', { n: parts.length })}</Pill>
          <span className={`m-num ml-auto shrink-0 pl-2 text-[14px] font-semibold ${sign > 0 ? 'text-accent-deep' : 'text-ink'}`}>
            {fmt(totalCents, tx.currency, { date: tx.date })}
          </span>
        </button>
        <button
          aria-label={t('split.title')}
          data-testid={`tx-parts-toggle-${tx.id}`}
          onClick={() => setCollapsed((v) => !v)}
          className="m-tap shrink-0 border-none bg-transparent py-2 pr-1 pl-1 text-ink-3"
        >
          <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={15} />
        </button>
      </div>
      {/* #198 r2 (user): hairlines separate TRANSACTIONS, not the parts
          of one — the inset alone already groups them. r5 (user): the
          ROUNDED inset is the wanted look — the group's boundary toward
          the next transaction is the card's own straight hairline,
          which paints right below the box since r3's divider fix. */}
      {!collapsed && (
        <div className="mb-2 rounded-card bg-bg px-2">
          {parts.map((part, i) => {
            const partCat = cats.byId(part.catId);
            const partColor = partCat.color ?? cats.byId(partCat.parentId ?? '').color;
            return (
              <button
                key={part.id ?? i}
                data-testid={`tx-part-row-${tx.id}-${i}`}
                onClick={() => onOpen(part.id)}
                className="m-tap flex w-full min-w-0 items-center gap-2.5 border-none bg-transparent px-1 py-2 text-left"
              >
                <Icon name="subdirectory-arrow-right" size={15} color="var(--m-ink-4)" />
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: `color-mix(in srgb, ${partColor ?? 'var(--m-ink-4)'} 14%, transparent)` }}
                >
                  <Icon name={partCat.icon} size={15} color={partColor ?? 'var(--m-ink-3)'} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">
                    {orDefaultLabel(part.label, `${txTitle(tx)} – ${t('split.partN', { n: i + 1 })}`)}
                  </span>
                  <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
                    <span className="truncate">{catName(partCat, t)}</span>
                    {i === 0 && tx.needsReview === 1 && (
                      <span className="shrink-0 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                        {t('tx.unreviewed')}
                      </span>
                    )}
                  </span>
                </span>
                {/* #139: the amount wears exactly TxRow's face (#228: net) */}
                <span className={`m-num text-[14px] font-semibold ${sign > 0 ? 'text-accent-deep' : 'text-ink'}`}>
                  {fmt(sign * partNetCents(part), tx.currency, { date: tx.date })}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** the collapsed pair's note (S3776: out of the memo). Opposite-sign
 *  pairs read from the surviving negative leg; a same-sign wallet pair's
 *  surviving purchase reads the FUNDING direction from its hidden
 *  transfer leg (#237, user decision "a") — "Bank → PayPal".
 *  #237 r2: a ONE-WAY pair (only the other row carries the pointer)
 *  reads through the reverse index, so the surviving leg still says
 *  where the money came from. */
function peerNoteFor(
  item: TransactionRow,
  byId: Map<string, TransactionRow>,
  reverse: Map<string, TransactionRow>,
  accountNames: Map<string, string>,
): string | undefined {
  const peer = (item.transferPeerId ? byId.get(item.transferPeerId) : undefined) ?? reverse.get(item.id);
  if (!peer) return undefined;
  const sameSign = Math.sign(peer.amountCents) === Math.sign(item.amountCents);
  if (!sameSign && item.amountCents > 0) return undefined;
  const from = accountNames.get(sameSign ? peer.accountId : item.accountId);
  const to = accountNames.get(sameSign ? item.accountId : peer.accountId);
  return from && to ? `${from} → ${to}` : undefined;
}

/** #156 r2: where a row sits against its group card's rounded frame —
 *  only the selected/focused tint consumes it (TxRow) */
function edgeOf(index: number, count: number): TxRowEdge {
  if (count === 1) return 'both';
  if (index === 0) return 'first';
  if (index === count - 1) return 'last';
  return 'none';
}

function groupByDate(txs: TransactionRow[]): [string, TransactionRow[]][] {
  const groups = new Map<string, TransactionRow[]>();
  for (const tx of txs) {
    const list = groups.get(tx.date) ?? [];
    list.push(tx);
    groups.set(tx.date, list);
  }
  return [...groups.entries()];
}

export function TransactionsScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  // #140: seeded from the module snapshot — the lens survives the detour
  // into a transaction; a tab switch or fresh start finds it empty
  const [query, setQuery] = useState(() => readTxFilters().query);
  const [uncatOnly, setUncatOnly] = useState(() => readTxFilters().uncatOnly);
  const [unsettledOnly, setUnsettledOnly] = useState(() => readTxFilters().unsettledOnly);
  // #243 (user): see the linked legs on their own — pairs uncollapsed
  const [counterOnly, setCounterOnly] = useState(() => readTxFilters().counterOnly);
  // #148: home's "see all new" arrives with this lens on
  const [newOnly, setNewOnly] = useState(() => readTxFilters().newOnly);
  const [filters, setFilters] = useState<SheetFilters>(() => readTxFilters().filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const cats = useCategories();
  useEffect(() => {
    writeTxFilters({ query, uncatOnly, unsettledOnly, counterOnly, newOnly, filters });
  }, [query, uncatOnly, unsettledOnly, counterOnly, newOnly, filters]);

  const allTxs = useSpaceTransactions();
  // #148 r2: NEW = first-seen on this device within 24h (the same set
  // home's block lists) — not the unreviewed badge
  const { newIds } = useNewTransactions(allTxs);
  // desktop density (D2): the account column needs names, one lookup for all rows
  const accounts = useSpaceAccounts();
  // #181 (user): the empty state leads to the SPACE's own accounts screen
  const { spaceId } = useData();
  const accountNames = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts]);
  // credits net out what they refunded: one pass over the links for the whole list
  const givenByCredit = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of allTxs ?? []) {
      for (const link of item.reimbursements ?? []) {
        map.set(link.txId, (map.get(link.txId) ?? 0) + link.amountCents);
      }
    }
    return map;
  }, [allTxs]);
  // when embedded as a master pane (§4.2) the open detail's row lights up
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const openTxId = /^\/transactions\/([^/]+)$/.exec(pathname)?.[1];
  // the list remembers where you were (#131)
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollMemory(scrollRef, 'transactions');
  // #126 r5: a part row opens its own page
  const openPartPage = (txId: string, partId: string | undefined) =>
    void navigate({ to: '/transactions/$txId', params: { txId }, search: { part: partId } });

  // desktop keyboard (§4.5): `/` jumps to search unless already typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      e.preventDefault();
      document.querySelector<HTMLInputElement>('[data-testid="tx-search"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat(DATE_FMT[lang], { weekday: 'short', day: 'numeric', month: 'short' }).format(
      new Date(iso),
    );

  // a main category matches itself and all of its subs
  const catIds = useMemo(() => {
    const mains = [...filters.mainCatIds];
    if (mains.length === 0) return undefined;
    return new Set(mains.flatMap((id) => [id, ...cats.childrenOf(id).map((c) => c.id)]));
  }, [filters.mainCatIds, cats]);

  // filter FIRST, then newest-first capped at 200 — an old category match
  // must not vanish behind the recency cap
  const txs = useMemo(() => {
    if (!allTxs) return undefined;
    // filterTxs returns a fresh array — sorting it in place mutates no input
    let matched = filterTxs(allTxs, {
      query,
      accountIds: filters.accountIds,
      onlyUncategorized: uncatOnly,
      catIds,
      txTypes: filters.txTypes,
      from: filters.from,
      to: filters.to,
    });
    // quick filter (redesign): expected/received value still open
    if (unsettledOnly) matched = matched.filter(hasUnsettledReimbursement);
    // #148 r2: the "new" lens = rows first seen within the last 24h
    if (newOnly) matched = matched.filter((item) => newIds.has(item.id));
    // paired transfers are ONE event (arc 1): the incoming leg hides when
    // its outgoing peer is listed too — unless an account filter is on
    // (a per-account view needs its own leg for the running story).
    // #237 (user decision "a"): a SAME-SIGN wallet pair hides its
    // TRANSFER leg instead — the real purchase stays, counted once.
    // #243 r2 (user): the chip does NOT narrow — it shows the full list
    // with every pair's legs standing separately (collapse off).
    if (filters.accountIds.size === 0 && !counterOnly) {
      const byId = new Map(matched.map((item) => [item.id, item]));
      // #237 r2: one-way pairs collapse too — the pointed-at row reads
      // its peer through the reverse index
      const reverse = new Map<string, TransactionRow>();
      for (const row of matched) {
        if (row.transferPeerId && byId.has(row.transferPeerId)) reverse.set(row.transferPeerId, row);
      }
      matched = matched.filter((item) => {
        const peer = (item.transferPeerId ? byId.get(item.transferPeerId) : undefined) ?? reverse.get(item.id);
        if (!peer) return true;
        if (Math.sign(peer.amountCents) === Math.sign(item.amountCents)) {
          return !(kindOf(item.txType) === 'transfer' && kindOf(peer.txType) !== 'transfer');
        }
        return item.amountCents <= 0;
      });
    }
    matched.sort((a, b) => b.date.localeCompare(a.date));
    return matched.slice(0, 200);
  }, [allTxs, query, filters, uncatOnly, unsettledOnly, counterOnly, newOnly, newIds, catIds]);

  // the collapsed row says where the money went: "Checking → Savings".
  // #237: a same-sign wallet pair's surviving purchase reads the funding
  // direction from its hidden transfer leg — "Bank → PayPal"
  const peerNotes = useMemo(() => {
    if (filters.accountIds.size > 0) return new Map<string, string>();
    const byId = new Map((allTxs ?? []).map((item) => [item.id, item]));
    const reverse = new Map<string, TransactionRow>();
    for (const row of allTxs ?? []) {
      if (row.transferPeerId) reverse.set(row.transferPeerId, row);
    }
    const map = new Map<string, string>();
    for (const item of txs ?? []) {
      const note = peerNoteFor(item, byId, reverse, accountNames);
      if (note) map.set(item.id, note);
    }
    return map;
  }, [txs, allTxs, accountNames, filters.accountIds]);

  // display-currency lens: rows convert at their own day's fixing —
  // warm the rate cache for every date this list is about to show
  const { fmt, ensureDates } = useDisplayMoney();
  useEffect(() => {
    ensureDates([...new Set((txs ?? []).map((tx) => tx.date))]);
  }, [txs, ensureDates]);

  const groups = groupByDate(txs ?? []);
  const activeCount = countActive(filters);
  const filtering = !!query || uncatOnly || unsettledOnly || counterOnly || newOnly || !!catIds || activeCount > 0;

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-transactions">
      <AppBar
        large
        title={t('tab.transactions')}
        trailing={
          <>
            <HelpButton tourId="transactions" />
            <IconButton label={t('txform.addTitle')} testId="tx-add" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={22} />
            </IconButton>
          </>
        }
      />
      <TxFormSheet open={addOpen} onOpenChange={setAddOpen} />
      {/* search + filters */}
      <div className="shrink-0 px-5 pb-1">
        <SearchField testId="tx-search" value={query} onChange={setQuery} placeholder={t('tx.searchPlaceholder')} />
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {/* accounts/types/categories/dates live in the filter sheet —
              chips per account stopped scaling once feeds multiplied */}
          <Chip testId="tx-filter-open" selected={activeCount > 0} onClick={() => setFilterOpen(true)}>
            <Icon name="filter-variant" size={14} />
            {t('tx.filters')}
            {activeCount > 0 && (
              <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-on-brand" data-testid="tx-filter-count">
                {activeCount}
              </span>
            )}
          </Chip>
          {/* #148: the unreviewed lens home's "see all" arrives with */}
          <Chip testId="tx-filter-new" selected={newOnly} onClick={() => setNewOnly((v) => !v)}>
            {t('tx.newFilter')}
          </Chip>
          <Chip testId="tx-filter-uncat" tone="warning" selected={uncatOnly} onClick={() => setUncatOnly((v) => !v)}>
            {t('tx.uncategorizedFilter')}
          </Chip>
          <Chip testId="tx-filter-unsettled" selected={unsettledOnly} onClick={() => setUnsettledOnly((v) => !v)}>
            {t('tx.unsettledFilter')}
          </Chip>
          {/* #243 r2 (user): ALL transactions with pairs uncollapsed */}
          <Chip testId="tx-filter-counter" selected={counterOnly} onClick={() => setCounterOnly((v) => !v)}>
            <Icon name="swap-horizontal" size={14} />
            {t('tx.counterFilter')}
          </Chip>
          {activeCount > 0 && (
            <button
              data-testid="tx-filter-clear"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="m-tap flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-3"
            >
              <Icon name="close" size={12} />
              {t('tx.filtersReset')}
            </button>
          )}
        </div>
      </div>
      <FilterSheet open={filterOpen} onOpenChange={setFilterOpen} value={filters} onChange={setFilters} />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6" data-testid="tx-list">
        {txs && groups.length === 0 && (
          <EmptyState
            testId="tx-empty"
            icon={filtering ? 'magnify' : 'receipt-text-outline'}
            text={t(filtering ? 'tx.emptyFiltered' : 'tx.emptyList')}
            action={
              filtering ? undefined : (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="tx-empty-add-account"
                  onClick={() => void navigate({ to: '/spaces/$spaceId/accounts', params: { spaceId } })}
                >
                  <Icon name="bank-plus" size={16} />
                  {t('tx.emptyCta')}
                </Button>
              )
            }
          />
        )}
        {groups.map(([date, list]) => (
          <div key={date}>
            {/* sticky (D2): the group's date stays readable while its rows scroll */}
            <div className="m-cap sticky top-0 z-10 -mx-1 mt-4 mb-1 bg-bg px-2 py-1">{fmtDay(date)}</div>
            {/* #198: hairline dividers between rows — every tx list */}
            <div className="divide-y divide-line-2 rounded-card border border-line bg-surface px-3 py-1">
              {list.map((tx, listIndex) => {
                // #126 r5: a real split doesn't show its container in the
                // list — the sub-transactions stand as rows of their own,
                // the shared rail linking them; each opens its own page
                const rowParts = (tx.splits ?? []).filter((s) => s.catId !== REIMBURSED_ID);
                // #149: EVERY multi-part row branches — a flat category
                // spread is a split to the user, labels or not
                if (rowParts.length > 1) {
                  // r8 (user request): a filter that matches only SOME
                  // parts shows exactly those, aligned like normal rows
                  // with the split glyph — the band stays for full groups
                  const shown = matchingPartIndexes(tx, { catIds, txTypes: filters.txTypes, onlyUncategorized: uncatOnly });
                  if (shown.length < rowParts.length) {
                    return (
                      <TxPartSoloRows
                        key={tx.id}
                        tx={tx}
                        parts={rowParts}
                        shownIdx={shown}
                        fmt={fmt}
                        onOpen={(partId) => openPartPage(tx.id, partId)}
                        highlight={query}
                      />
                    );
                  }
                  return (
                    <TxPartGroupRows
                      key={tx.id}
                      tx={tx}
                      parts={rowParts}
                      fmt={fmt}
                      onOpen={(partId) => openPartPage(tx.id, partId)}
                    />
                  );
                }
                return (
                  <TxRow
                    key={tx.id}
                    tx={tx}
                    highlight={query}
                    selected={tx.id === openTxId}
                    edge={edgeOf(listIndex, list.length)}
                    accountName={accountNames.get(tx.accountId)}
                    givenCents={givenByCredit.get(tx.id) ?? 0}
                    transferNote={peerNotes.get(tx.id)}
                    onClick={() => void navigate({ to: '/transactions/$txId', params: { txId: tx.id } })}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
