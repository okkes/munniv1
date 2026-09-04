import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useSpaceAccounts, useSpaceTransactions } from '@/application/transactions';
import { useData } from '@/app/data';
import { typeDef } from '@/features/accounts/accountTypes';
import { AddAccountChooser } from '@/features/accounts/AddAccountChooser';
import { TX_KINDS, kindOf } from '@/domain/txKind';
import type { TxKind } from '@/domain/txKind';
import { accountStamp, typeForLinkedAccount } from '@/domain/txType';
import { counterDuplicates, counterOpenRows, counterSameSignCandidates } from '@/domain/counterMatch';
import { FAMILY_ACCOUNT_TYPE, NAME_KEYS, defaultAccountId, ensureDefaultAccount } from '@/application/defaultAccounts';
import type { DefaultFamily } from '@/application/defaultAccounts';
import type { AccountType, TransactionRow, TxType } from '@/db/types';
import { LOCALES, useLang } from '@/i18n';
import { fmtCents } from '@/lib/money';
import { txTitle } from '@/lib/text';
import { Icon } from '@/ui/Icon';
import { InfoHint } from '@/ui/InfoHint';
import { SearchField } from '@/ui/SearchField';
import { Pill } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { TxRow } from '@/ui/TxRow';

/** the three choices a person actually makes (user simplification) */
export const TX_KIND_VISUAL: Record<TxKind, { icon: string; color: string }> = {
  standard: { icon: 'cash-multiple', color: '#27AE60' },
  transfer: { icon: 'swap-horizontal', color: '#2980B9' },
  adjustment: { icon: 'tune-variant', color: '#7F8C8D' },
};

/**
 * "Standard · Expense" / "Transfer · Saving": the kind carries the
 * resolved technical type along as quiet context. Plain transfers and
 * adjustments add nothing — the kind already says it all.
 */
export function kindDetail(txType: TxType): TxType | null {
  const kind = kindOf(txType);
  if (kind === 'standard') return txType;
  if (kind === 'transfer' && txType !== 'transfer') return txType;
  return null;
}

/**
 * The kind picker: three rows with a sentence each. Adjustment is a
 * manual-bookkeeping tool and only offered on hand-entered rows (user
 * rule); bank rows can never be "corrections".
 */
export function TxKindSheet({
  open,
  onOpenChange,
  current,
  allowAdjustment,
  onPick,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: TxKind;
  allowAdjustment: boolean;
  onPick: (kind: TxKind) => void;
}>) {
  const { t } = useLang();
  const kinds = TX_KINDS.filter((k) => k !== 'adjustment' || allowAdjustment);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('tx.kindTitle')} size="form">
      <div className="flex flex-col" data-testid="txkind-options">
        {kinds.map((kind) => (
          <button
            key={kind}
            data-testid={`txkind-${kind}`}
            onClick={() => {
              onPick(kind);
              onOpenChange(false);
            }}
            className="m-tap flex items-start gap-3 border-none bg-transparent px-1 py-3 text-left"
          >
            <span
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={{ background: `color-mix(in srgb, ${TX_KIND_VISUAL[kind].color} 14%, transparent)` }}
            >
              <Icon name={TX_KIND_VISUAL[kind].icon} size={17} color={TX_KIND_VISUAL[kind].color} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-ink">{t(`tx.kind.${kind}`)}</span>
              <span className="block text-[12px] leading-snug text-ink-3">{t(`tx.kind.${kind}Sub`)}</span>
            </span>
            {current === kind && <Icon name="check" size={18} color="var(--m-accent)" />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * The counterparty question (#133 step B): the accounts munni tracks
 * plus the ONE creation door — and, on a ◆ family ask, the "Default —
 * no setup" row pinned on top (minted lazily on first accept). Bank-fed
 * accounts wear a badge: picking one means Transfer, the real arriving
 * row pairs with it. Picking a MANUAL account forks — quick-create the
 * counterpart (the mint), or point at the row that is already there
 * (the pick-existing door; nothing minted, nothing moves).
 */
export function CounterpartySheet({
  open,
  onOpenChange,
  excludeAccountId,
  currentLinkedId,
  onChoose,
  defaultFamily,
  counterTypes,
  anchor,
  onDetach,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeAccountId: string;
  currentLinkedId?: string;
  /** the pick — `peer` set means the user pointed at an EXISTING row on
   *  the counter account: carry it in the SAME write (no mint), and the
   *  caller pairs the reciprocal via pairWithExistingRow */
  onChoose: (account: { id: string; type: AccountType }, peer?: { txId: string }) => void;
  /** #133 B: a ◆ family ask pins the "Default — no setup" row on top */
  defaultFamily?: DefaultFamily;
  /** #133 r5: the account types this ask may offer — the asking
   *  category's side of the bijection ("Set aside" lists savings
   *  accounts only, plain Transfer only regular ones). undefined =
   *  every tracked account qualifies (the generic doors, which file
   *  the category from whatever kind gets picked). */
  counterTypes?: readonly AccountType[];
  /** #133 B: the row being linked — enables the pick-existing fork on
   *  manual counterparties */
  anchor?: { id: string; amountCents: number; date: string };
  /** #218 (user): detach the current counterparty — offered only when
   *  one is linked; the caller clears the link (and a transfer
   *  category resets, since an unlinked transfer is unrepresentable) */
  onDetach?: () => void;
}>) {
  const { t, lang } = useLang();
  const { store, repo, spaceId } = useData();
  const allAccounts = useSpaceAccounts();
  const allTxs = useSpaceTransactions();
  // the FULL creation flow (bank connect / statement import / manual),
  // one sheet deeper — search and quick-create retired (user redesign
  // 2026-08-01: the field confused, and Create covers the missing-
  // account case properly)
  const [chooserOpen, setChooserOpen] = useState(false);
  // #133 B, widened by #237: the counter-match fork — pick the row that
  // is already there, or explicitly create/await the counterpart
  const [forkFor, setForkFor] = useState<CounterForkTarget | null>(null);

  const candidates = useMemo(
    // the family defaults never list as ordinary rows — the pinned
    // Default entry is their one face (approved design). #133 r5: an
    // asking category narrows the list to ITS account types — the
    // counterparty must make sense for the category (user rule).
    () =>
      (allAccounts ?? []).filter(
        (a) => a.id !== excludeAccountId && !a.archived && !a.defaultFor && (!counterTypes || counterTypes.includes(a.type)),
      ),
    [allAccounts, excludeAccountId, counterTypes],
  );

  // a loan account is a DEBT's backing account (1:1, user design
  // 2026-07-28): transferring to it IS paying that debt off — the row
  // says which one, so picking the account is picking the debt
  const debts = useQuery(store, async () => (await store.bySpace('debt', spaceId)).filter((d) => d.deleted === 0), [spaceId]);
  const debtByAccount = useMemo(() => new Map((debts ?? []).filter((d) => d.accountId).map((d) => [d.accountId!, d])), [debts]);

  const choose = (account: { id: string; type: AccountType }, peer?: { txId: string }) => {
    onChoose(account, peer);
    setForkFor(null);
    onOpenChange(false);
  };

  // Default — no setup: mint (idempotently) and pick in one tap
  const pickDefault = async () => {
    if (!defaultFamily) return;
    const id = await ensureDefaultAccount(store, repo, spaceId, defaultFamily);
    choose({ id, type: FAMILY_ACCOUNT_TYPE[defaultFamily] });
  };

  // #237 (user): no more silent mints. A MANUAL counter always opens the
  // match sheet — pick the row that is already there, or explicitly
  // create the leg. A bank-fed counter opens it only when it has
  // something to offer (opposite twins, or the wallet's same-sign rows);
  // otherwise the link simply awaits the feed. Funding pots and rows
  // that don't exist yet (no anchor: the create form) choose directly.
  const tap = (account: { id: string; type: AccountType; name: string; source?: string }) => {
    const target = counterForkTarget(account, anchor, allTxs ?? []);
    if (target) setForkFor(target);
    else choose({ id: account.id, type: account.type });
  };

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange} title={t('tx.counterparty')} size="form">
      <p className="pb-2 text-[12px] text-ink-3">
        {t(counterTypes?.length === 1 && counterTypes[0] === 'funding' ? 'tx.counterFundingHint' : 'tx.counterAccountHint')}
      </p>
      {/* the ◆ family ask leads with Default (#133 ruling 1) */}
      {defaultFamily && (
        <button
          data-testid="counter-default"
          onClick={() => void pickDefault()}
          className="m-tap mb-2 flex w-full items-center gap-3 rounded-card border border-accent/40 bg-accent-soft/20 px-4 py-3 text-left"
        >
          <Icon name={typeDef(FAMILY_ACCOUNT_TYPE[defaultFamily]).icon} size={18} color="var(--m-accent-deep)" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-ink">{t(NAME_KEYS[defaultFamily])}</span>
            <span className="block text-[11px] text-ink-4">{t('tx.counterDefaultSub')}</span>
          </span>
          {currentLinkedId === defaultAccountId(spaceId, defaultFamily) && (
            <Icon name="check" size={17} color="var(--m-accent-deep)" />
          )}
        </button>
      )}
      <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="counter-accounts">
          {candidates.map((account) => (
            <button
              key={account.id}
              data-testid={`counter-pick-${account.id}`}
              onClick={() => tap(account)}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
            >
              <Icon name={typeDef(account.type).icon} size={18} color="var(--m-ink-2)" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">{account.name}</span>
                {/* what the COUNTER ledger will record (its R1 stamp;
                    #152: a funding pot records funding, not transfer) */}
                <span className="block text-[11px] text-ink-4">
                  {t(`tx.type.${accountStamp(account.type) ?? typeForLinkedAccount(account.type)}`)}
                  {debtByAccount.has(account.id) && (
                    <span className="text-accent-deep" data-testid={`counter-debt-${account.id}`}>
                      {' '}· {t('tx.paysDebt', { name: debtByAccount.get(account.id)!.name })}
                    </span>
                  )}
                </span>
              </span>
              {/* C2: a bank-fed pick means Transfer — the real arriving
                  row on the other side pairs with it */}
              {account.source !== 'manual' && <Pill tone="info">{t('tx.counterBankBadge')}</Pill>}
              <span className="m-num text-[12px] text-ink-3">{fmtCents(account.balanceCents, account.currency, lang)}</span>
              {currentLinkedId === account.id && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
            </button>
          ))}
          {candidates.length === 0 && (
            <p className="px-4 py-3 text-[13px] text-ink-4" data-testid="counter-empty">
              {t('tx.counterNoMatch')}
            </p>
          )}
        </div>
      {/* #218 (user): the way OUT — detach the linked counterparty to
          free the category choice again */}
      {onDetach && currentLinkedId && (
        <button
          data-testid="counter-detach"
          onClick={() => {
            onDetach();
            onOpenChange(false);
          }}
          className="m-tap mt-2 flex w-full items-center gap-2 rounded-card border border-line bg-transparent px-4 py-3 text-left text-[14px] font-medium text-negative"
        >
          <Icon name="link-off" size={18} />
          {t('tx.counterDetach')}
        </button>
      )}
      {/* the ONE creation door (user redesign 2026-08-01): the full
          chooser — bank connect, statement import (in place) or manual */}
      <button
        data-testid="counter-full-setup"
        onClick={() => setChooserOpen(true)}
        className="m-tap mt-2 flex w-full items-center gap-2 rounded-card border border-dashed border-line bg-transparent px-4 py-3 text-left text-[14px] font-medium text-accent-deep"
      >
        <Icon name="plus-circle-outline" size={18} />
        {t('tx.counterFullSetup')}
      </button>
      {/* R2: no bare exit anymore — the untracked stories live on the
          marked special categories of standard rows */}
      <p className="px-1 pt-2 text-[12px] leading-snug text-ink-4" data-testid="counter-special-hint">
        {t('tx.counterSpecialHint')}
      </p>
    </Sheet>
    {/* #241: SIBLINGS, not children — nested sheets portal before their
        parent and paint below it (flat z-50, body order decides) */}
    <AddAccountChooser
      open={chooserOpen}
      onOpenChange={setChooserOpen}
      onCreated={(account) => choose(account)}
    />
    {/* #133 B / #237: the counter-match fork — pick, create or await */}
    {anchor && (
      <CounterMatchSheet
        open={forkFor !== null}
        onOpenChange={(next) => {
          if (!next) setForkFor(null);
        }}
        target={forkFor}
        anchor={anchor}
        rows={allTxs ?? []}
        onCreate={forkFor?.createAllowed ? () => choose({ id: forkFor.id, type: forkFor.type }) : undefined}
        onWait={forkFor?.bankFed ? () => choose({ id: forkFor.id, type: forkFor.type }) : undefined}
        onPick={(txId) => {
          if (forkFor) choose({ id: forkFor.id, type: forkFor.type }, { txId });
        }}
      />
    )}
    </>
  );
}

/** what the counter-match fork is aimed at (#237) */
export interface CounterForkTarget {
  id: string;
  type: AccountType;
  name: string;
  createAllowed: boolean;
  bankFed: boolean;
}

/** #237 (user rule): the fork opens for every MANUAL counter (silent
 *  mints retire — creating the leg is an explicit choice), and for a
 *  bank-fed counter that has rows to point at. Null = choose directly:
 *  funding pots (nothing ever shows there), bank-fed counters with
 *  nothing to offer (the feed delivers), or no anchor (the row being
 *  created does not exist yet). */
export function counterForkTarget(
  account: { id: string; type: AccountType; name: string; source?: string },
  anchor: { id: string; amountCents: number; date: string } | undefined,
  rows: readonly TransactionRow[],
): CounterForkTarget | null {
  if (!anchor) return null;
  const bankFed = (account.source ?? 'manual') !== 'manual';
  const createAllowed = !bankFed && account.type !== 'funding';
  if (bankFed) {
    const offerable =
      counterDuplicates(rows, account.id, anchor).length > 0 ||
      counterSameSignCandidates(rows, account.id, anchor).length > 0;
    if (!offerable) return null;
  } else if (!createAllowed) {
    return null; // funding: no rows to point at, nothing to mint
  }
  return { id: account.id, type: account.type, name: account.name, createAllowed, bankFed };
}

/**
 * #237: the counter-match sheet — the one place a counterpart gets
 * chosen. r3 (user): reimbursement-style — 1–3 suggestions on top (near
 * twins; the wallet's same-sign rows when no twin exists, user decision
 * "a"), the REST of the account's open rows always scrollable below,
 * and the explicit create/await exits. Reused by the CounterpartySheet
 * fork, the review card's Counter-transaction row and the detail
 * screen's pair doors.
 */
export function CounterMatchSheet({
  open,
  onOpenChange,
  target,
  anchor,
  rows,
  onCreate,
  onWait,
  onPick,
  contextRow,
  progress,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { id: string; name: string } | null;
  anchor: { id: string; amountCents: number; date: string };
  rows: readonly TransactionRow[];
  /** the explicit mint door — manual, non-funding counters only */
  onCreate?: () => void;
  /** bank-fed: link now, the feed delivers the other side later */
  onWait?: () => void;
  onPick: (txId: string) => void;
  /** #268 (user): a bulk queue names WHICH transaction is matching */
  contextRow?: TransactionRow;
  /** "2/5" alongside the context row */
  progress?: string;
}>) {
  const { t, lang } = useLang();
  // #255: search narrows both lists — by title or by price
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  const near = target ? counterDuplicates(rows, target.id, anchor) : [];
  const sameSign = target && near.length === 0 ? counterSameSignCandidates(rows, target.id, anchor) : [];
  // 1–3 suggestions (user sizing) — everything else scrolls below
  const allSuggested = [...near, ...sameSign].slice(0, 3);
  const listed = new Set(allSuggested.map((row) => row.id));
  const allRest = target ? counterOpenRows(rows, target.id, anchor.id, 50).filter((row) => !listed.has(row.id)) : [];
  const matches = (row: TransactionRow): boolean => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    if (txTitle(row).toLowerCase().includes(needle)) return true;
    // #267 r2 (user): a leading +/- constrains the direction here too
    let sign = 0;
    if (needle.startsWith('+')) sign = 1;
    else if (needle.startsWith('-')) sign = -1;
    if (sign !== 0 && Math.sign(row.amountCents) !== sign) return false;
    const bare = sign === 0 ? needle : needle.slice(1).trim();
    return (Math.abs(row.amountCents) / 100).toFixed(2).includes(bare.replace(',', '.'));
  };
  const suggested = allSuggested.filter(matches);
  const rest = allRest.filter(matches);
  // #255: the height fits the content — doors + a few suggestions never
  // earned the tall shape's white void (locked at open, unfiltered counts)
  const size = allRest.length > 0 ? 'tall' : 'form';
  const pick = (txId: string) => {
    onPick(txId);
    onOpenChange(false);
  };
  const door = (testId: string, icon: string, title: string, sub: string, onTap: () => void) => (
    <button
      data-testid={testId}
      onClick={() => {
        onTap();
        onOpenChange(false);
      }}
      className="m-tap mb-2 flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
    >
      <Icon name={icon} size={18} color="var(--m-accent-deep)" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-ink">{title}</span>
        <span className="block text-[11px] leading-snug text-ink-4">{sub}</span>
      </span>
    </button>
  );
  const rowList = (items: readonly TransactionRow[], prefix: string, accent = false) => (
    <div
      className={`divide-y divide-line-2 overflow-hidden rounded-card border bg-surface px-3 ${accent ? 'border-accent/40' : 'border-line'}`}
    >
      {items.map((row) => (
        <div key={row.id} data-testid={`${prefix}-${row.id}`}>
          {/* #255 r2: the search's hits light up like everywhere else */}
          <TxRow tx={row} showDate hideUnreviewed highlight={query} onClick={() => pick(row.id)} />
        </div>
      ))}
    </div>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={target?.name ?? ''} size={size}>
      {target && (
        <div className="flex flex-col pt-1" data-testid="counter-fork">
          {/* #268 (user): while a bulk queue walks the siblings, the sheet
              says exactly WHICH transaction it is matching right now */}
          {contextRow && (
            <div className="mb-2 rounded-card border border-accent/40 bg-accent-soft/30 px-3 py-2" data-testid="counter-queue-context">
              <div className="m-cap flex flex-wrap items-center gap-1 pb-0.5 text-accent-deep">
                <span>
                  {t('tx.counterQueueFor')}
                  {progress ? ` · ${progress}` : ''}
                </span>
                {/* #268 r2 (user): WHY every sibling asks again — the
                    picked counter row is spoken for, so each transaction
                    needs its own pick (or links and waits) */}
                <InfoHint text={t('tx.counterQueueWhy')} testId="counter-queue-why" />
              </div>
              <p className="truncate text-[13px] font-medium text-ink">{txTitle(contextRow)}</p>
              <p className="text-[12px] text-ink-3">
                {new Date(contextRow.date).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' })}
                {' · '}
                {fmtCents(contextRow.amountCents, contextRow.currency, lang, { sign: true })}
              </p>
            </div>
          )}
          {onCreate && door('counter-fork-create', 'plus-circle-outline', t('tx.counterForkCreate'), t('tx.counterForkCreateSub'), onCreate)}
          {/* #255 r2 (user): "link and wait" is the one honest exit —
              the separate None door confused more than it solved */}
          {onWait && door('counter-fork-wait', 'clock-outline', t('tx.counterForkWait'), t('tx.counterForkWaitSub'), onWait)}
          {(allSuggested.length > 0 || allRest.length > 0) && (
            <SearchField
              testId="counter-match-search"
              value={query}
              onChange={setQuery}
              placeholder={t('tx.counterSearchPlaceholder')}
              height="h-10"
              textSize="text-[13px]"
              className="mb-1"
            />
          )}
          {suggested.length > 0 && (
            <>
              <div className="m-cap mt-2 mb-1 flex items-center gap-1.5 px-1 text-accent-deep">
                <Icon name="lightbulb-outline" size={13} />
                {t('tx.counterForkPickHint')}
              </div>
              {sameSign.length > 0 && (
                <p className="px-1 pb-1 text-[12px] leading-snug text-ink-4" data-testid="counter-samesign-hint">
                  {t('tx.counterSameSignHint')}
                </p>
              )}
              {rowList(suggested, 'counter-dup', true)}
            </>
          )}
          {rest.length > 0 && (
            <>
              <div className="m-cap mt-3 mb-1 px-1">{t('tx.counterAllRows')}</div>
              {/* fixed px so the browse list scrolls INSIDE the sheet (sheet rules) */}
              <div className="max-h-[280px] overflow-y-auto overscroll-contain" data-testid="counter-all-list">
                {rowList(rest, 'counter-open')}
              </div>
            </>
          )}
          {suggested.length === 0 && rest.length === 0 && (
            <p className="px-1 pt-2 text-[13px] text-ink-4" data-testid="counter-fork-empty">
              {t(query ? 'tx.counterSearchNoHit' : 'tx.counterForkNoRows')}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

/**
 * #268 (user): a bulk apply that carried a SPECIFIC counter pick cannot
 * copy that pick — each sibling gets its own match sheet in turn, the
 * context block naming which transaction is matching. Every step either
 * picks an existing row or links-and-waits; dismissing the sheet stops
 * the queue and leaves the remaining siblings untouched.
 */
export function BulkCounterQueue({
  queue,
  target,
  rows,
  onResolve,
  onDone,
}: Readonly<{
  queue: readonly TransactionRow[];
  target: { id: string; name: string } | null;
  rows: readonly TransactionRow[];
  /** peerId = the picked existing row; null = link-and-wait */
  onResolve: (tx: TransactionRow, peerId: string | null) => void;
  /** fires once — queue exhausted or dismissed early */
  onDone: (resolved: number) => void;
}>) {
  const [index, setIndex] = useState(0);
  const resolvedRef = useRef(0);
  // a pick closes the inner sheet — that close must not read as dismiss
  const advancingRef = useRef(false);
  const current = queue[index];
  if (!current) return null;
  const advance = () => {
    advancingRef.current = true;
    resolvedRef.current += 1;
    if (index + 1 >= queue.length) onDone(resolvedRef.current);
    else setIndex(index + 1);
  };
  return (
    <CounterMatchSheet
      key={current.id}
      open
      onOpenChange={(next) => {
        if (!next && !advancingRef.current) onDone(resolvedRef.current);
        advancingRef.current = false;
      }}
      target={target}
      anchor={{ id: current.id, amountCents: current.amountCents, date: current.date }}
      rows={rows}
      contextRow={current}
      progress={`${index + 1}/${queue.length}`}
      onWait={() => {
        onResolve(current, null);
        advance();
      }}
      onPick={(txId) => {
        onResolve(current, txId);
        advance();
      }}
    />
  );
}
