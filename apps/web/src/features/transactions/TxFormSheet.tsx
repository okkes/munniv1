import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSpaceAccounts } from '@/application/transactions';
import { UNCATEGORIZED_ID, autoSubFor } from '@/domain/categories';
import { typeForLinkedAccount } from '@/domain/txType';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { logActivity } from '@/application/activity';
import { createCounterTransaction } from '@/application/transferMatch';
import { catName, useCategories } from '@/features/categories/useCategories';
import { useRecurrings } from '@/application/recurring';
import { fmtCents, parseCents } from '@/lib/money';
import type { AccountRow, TransactionRow, TxSplit, TxType } from '@/db/types';
import { typeDef } from '@/features/accounts/accountTypes';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { CategoryPicker } from '@/features/categories/CategoryPicker';
import { SplitEditorSheet } from './SplitEditorSheet';
import { primaryCatId } from '@/domain/splits';
import { kindOf } from '@/domain/txKind';
import { minaSuggestedTx } from '@/features/mina/steps';
import type { TxKind } from '@/domain/txKind';
import { CounterpartySheet, TX_KIND_VISUAL, TxKindSheet, kindDetail } from './TxKindSheet';

interface TxFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** present = edit an existing (manual) transaction */
  tx?: TransactionRow;
  /** a caller-staged payment (arc 3: the debt detail's "add payment"
   *  door): the form opens as a transfer onto this counterparty */
  prefill?: { linkedAccountId: string; merchant?: string };
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** one string per form state — the dirty guard compares it to the
 *  seeded baseline (order fixed; JSON keeps null/undefined distinct) */
const formFingerprint = (state: Record<string, unknown>): string =>
  JSON.stringify([
    state.amount, state.isExpense, state.merchant, state.date, state.accountId, state.catId,
    state.kind, state.linkedAccountId, state.bareType, state.recurringId, state.splits,
  ]);

/**
 * The kind resolves the stored technical type (user simplification):
 * standard by the sign toggle, transfer by the counterparty's account
 * type (plain 'transfer' while the mandatory pick is still open),
 * adjustment as itself.
 */
const typeForKind = (kind: TxKind, isExpense: boolean, counterType: TxType | null): TxType => {
  if (kind === 'adjustment') return 'adjustment';
  if (kind === 'transfer') return counterType ?? 'transfer';
  return isExpense ? 'expense' : 'income';
};

type BalanceAccount = { id: string; source: string; balanceCents: number };

/**
 * Manual accounts keep a LIVE balance (user bug: it froze at the stated
 * amount): every manual write adjusts the touched account(s) by the
 * row's delta. Bank-linked balances stay the bank's; CAMT gets
 * corrected on import.
 */
function manualBalanceDeltas(
  accounts: readonly BalanceAccount[] | undefined,
  tx: TransactionRow | undefined,
  targetId: string,
  signed: number,
): Array<{ account: BalanceAccount; delta: number }> {
  // merge per account id: an edit on the SAME account collapses into
  // one net delta, a moved row touches two accounts
  const deltas = new Map<string, number>();
  if (tx) deltas.set(tx.accountId, -tx.amountCents);
  deltas.set(targetId, (deltas.get(targetId) ?? 0) + signed);

  const out: Array<{ account: BalanceAccount; delta: number }> = [];
  for (const [id, delta] of deltas) {
    const account = accounts?.find((a) => a.id === id);
    if (account?.source === 'manual' && delta !== 0) out.push({ account, delta });
  }
  return out;
}

/** write the deltas through the repo — kept out of the component (S3776) */
function applyManualBalanceDeltas(
  repo: { upsert: (entity: 'account', spaceId: string, id: string, fields: { balanceCents: number }) => Promise<unknown> },
  spaceId: string,
  entries: ReturnType<typeof manualBalanceDeltas>,
): void {
  for (const { account, delta } of entries) {
    void repo.upsert('account', spaceId, account.id, { balanceCents: account.balanceCents + delta });
  }
}

/** the kind row + (transfers only) the mandatory counterparty row —
 *  the manual form's face of the simplified model (S3776: out of the
 *  main component) */
function KindRows({
  kind,
  detailType,
  counterName,
  onKind,
  onCounter,
}: Readonly<{
  kind: TxKind;
  detailType: TxType | null;
  counterName: string | undefined;
  onKind: () => void;
  onCounter: () => void;
}>) {
  const { t } = useLang();
  return (
    <>
      {/* kind row (user simplification): standard / transfer / adjustment
          — the third option exists exactly here, on hand-entered rows */}
      <button
        data-testid="txform-kind"
        onClick={onKind}
        className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink"
      >
        <Icon name={TX_KIND_VISUAL[kind].icon} size={20} color={TX_KIND_VISUAL[kind].color} />
        <span className="flex-1">
          {t(`tx.kind.${kind}`)}
          {detailType && <span className="text-[12px] text-ink-4"> · {t(`tx.type.${detailType}`)}</span>}
        </span>
        <span className="text-xs text-ink-4">{t('tx.kindTitle')}</span>
        <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
      </button>
      {kind === 'transfer' && (
        <button
          data-testid="txform-counter"
          onClick={onCounter}
          className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink"
        >
          <Icon name="bank-transfer" size={20} color="var(--m-ink-3)" />
          <span className={`flex-1 ${counterName ? '' : 'text-warning'}`}>
            {counterName ?? t('tx.counterAccountPick')}
          </span>
          <span className="text-xs text-ink-4">{t('tx.counterparty')}</span>
          <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
        </button>
      )}
    </>
  );
}

/** what the form opens with: the edited row's values, a caller-staged
 *  payment, or a blank slate (S3776: the branch lives out of the
 *  component) */
function initialFormState(tx: TransactionRow | undefined, prefill?: TxFormSheetProps['prefill']) {
  if (!tx) {
    // Mina's demo suggestion pre-fills (category included — user
    // remark); the user edits freely and the act accepts ANY values
    const suggested = minaSuggestedTx();
    return {
      amount: suggested?.amount ?? '',
      isExpense: true,
      merchant: prefill?.merchant ?? suggested?.merchant ?? '',
      date: todayIso(),
      accountId: null,
      catId: suggested?.catId ?? UNCATEGORIZED_ID,
      kind: (prefill ? 'transfer' : 'standard') as TxKind,
      linkedAccountId: prefill?.linkedAccountId ?? null,
      bareType: null as TxType | null,
      recurringId: null,
    };
  }
  return {
    amount: (Math.abs(tx.amountCents) / 100).toFixed(2).replace('.', ','),
    isExpense: tx.amountCents < 0,
    merchant: tx.merchant,
    date: tx.date,
    accountId: tx.accountId,
    catId: tx.catId ?? UNCATEGORIZED_ID,
    kind: kindOf(tx.txType),
    linkedAccountId: tx.linkedAccountId ?? null,
    // a counterless transfer-family row (the arc-2 bare exit) reopens
    // with its typed label intact instead of demanding a counterparty
    bareType: kindOf(tx.txType) === 'transfer' && !tx.linkedAccountId ? tx.txType : null,
    recurringId: tx.recurringId ?? null,
  };
}

/** the split editor needs a SpaceTx shape; a NEW manual tx builds one
 *  from the live form state (S3776: out of the component) */
function buildPseudoTx(
  tx: TransactionRow | undefined,
  form: {
    accountId: string;
    date: string;
    cents: number | null;
    isExpense: boolean;
    currency: string;
    merchant: string;
    catId: string;
    txType: TxType;
  },
): never {
  const abs = Math.abs(form.cents ?? 0);
  return (tx ?? {
    id: 'new',
    spaceId: '',
    accountId: form.accountId,
    date: form.date,
    amountCents: form.isExpense ? -abs : abs,
    currency: form.currency,
    merchant: form.merchant,
    catId: form.catId,
    txType: form.txType,
    needsReview: 0,
  }) as never;
}

/** save gate: real merchant, positive amount, an account, a date not
 *  before the space starts (arc 5), and — for transfers — a decided
 *  other side */
const isValidManualTx = (args: {
  merchant: string;
  cents: number | null;
  account: string | null;
  date: string;
  counterMissing: boolean;
  beforeStart: boolean;
}): boolean =>
  !!args.merchant.trim() && args.cents !== null && args.cents > 0 && !!args.account && !!args.date && !args.counterMissing && !args.beforeStart;

/** the row the manual form writes (S3776: field assembly out of the
 *  component). Explicit nulls clear previously set links on edit —
 *  undefined would drop out of the op and leave the old value standing. */
function manualTxFields(args: {
  tx: TransactionRow | undefined;
  accountId: string;
  date: string;
  signed: number;
  currency: string;
  merchant: string;
  catId: string;
  txType: TxType;
  stagedSplits: TxSplit[] | null;
  linkedAccountId: string | null;
  recurringId: string | null;
}): Partial<Omit<TransactionRow, 'id' | 'spaceId'>> {
  // arc 2 locked doors: an uncategorized transfer-family row files under
  // the family's sign-picked sub instead of the hidden placeholder
  const familySub = args.catId === UNCATEGORIZED_ID && !args.stagedSplits?.length ? autoSubFor(args.txType, args.signed) : undefined;
  return {
    accountId: args.accountId,
    date: args.date,
    amountCents: args.signed,
    currency: args.currency,
    merchant: args.merchant,
    catId: familySub ?? args.catId,
    txType: args.txType,
    needsReview: 0 as const,
    // splits staged in the unified editor travel with the write
    ...(args.stagedSplits?.length ? { splits: args.stagedSplits } : {}),
    ...(args.linkedAccountId || args.tx?.linkedAccountId ? { linkedAccountId: args.linkedAccountId ?? (null as never) } : {}),
    ...(args.recurringId || args.tx?.recurringId ? { recurringId: args.recurringId ?? (null as never) } : {}),
  };
}

const optionRow = (selected: boolean, onClick: () => void, content: React.ReactNode, testId: string) => (
  <button
    key={testId}
    data-testid={testId}
    onClick={onClick}
    className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
  >
    {content}
    {selected && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
  </button>
);

/** the stacked recurring-link picker (S3776: out of the main form) */
function RecurringPickSheet({
  open,
  onOpenChange,
  recurrings,
  recurringId,
  onPick,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recurrings: readonly { id: string; name: string }[];
  recurringId: string | null;
  onPick: (id: string | null) => void;
}>) {
  const { t } = useLang();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('recurring.linkTitle')} size="form" dragHandle>
      <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="txform-recurring-options">
        {optionRow(
          !recurringId,
          () => onPick(null),
          <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{t('recurring.linkNone')}</span>,
          'txform-recurring-none',
        )}
        {recurrings.map((r) =>
          optionRow(
            recurringId === r.id,
            () => onPick(r.id),
            <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{r.name}</span>,
            `txform-recurring-${r.id}`,
          ),
        )}
      </div>
    </Sheet>
  );
}

/** the stacked account picker: name, type, masked number, balance —
 *  replaces the chip strip (user redesign 2026-07-31) */
function AccountPickSheet({
  open,
  onOpenChange,
  accounts,
  selectedId,
  onPick,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: readonly AccountRow[];
  selectedId: string | null;
  onPick: (id: string) => void;
}>) {
  const { t, lang } = useLang();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('txform.account')} size="form" dragHandle>
      <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="txform-account-options">
        {accounts.map((account) => (
          <button
            key={account.id}
            data-testid={`txform-account-${account.id}`}
            onClick={() => {
              onPick(account.id);
              onOpenChange(false);
            }}
            className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
          >
            <Icon name={typeDef(account.type).icon} size={18} color="var(--m-ink-2)" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-ink">{account.name}</span>
              <span className="block truncate text-[11px] text-ink-4">
                {t(typeDef(account.type).labelKey)}
                {account.iban ? ` · …${account.iban.slice(-4)}` : ''}
              </span>
            </span>
            <span className="m-num text-[12px] text-ink-3">{fmtCents(account.balanceCents, account.currency, lang)}</span>
            {selectedId === account.id && <Icon name="check" size={17} color="var(--m-accent-deep)" />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** exactly ONE manual account picks itself; with several, the user
 *  chooses explicitly — a silent first-account default booked rows on
 *  the wrong account (user redesign 2026-07-31) */
const soleAccountId = (writable: readonly AccountRow[]): string | null => (writable.length === 1 ? writable[0].id : null);

/** a transfer's other side is decided by an account OR the bare
 *  "no counter account" label (arc 2) — undecided blocks save */
const counterUndecided = (kind: TxKind, linkedAccount: AccountRow | undefined, bareType: TxType | null): boolean =>
  kind === 'transfer' && !linkedAccount && !bareType;

/** the space's start date IF the picked date falls before it (arc 5) —
 *  such a row would vanish behind the display gate the moment it saved,
 *  so a truthy return blocks save and renders the way out */
const blockingStartDate = (space: { historyStartDate?: string } | undefined, date: string): string | undefined =>
  space?.historyStartDate && date && date < space.historyStartDate ? space.historyStartDate : undefined;

/** the counter row's face: the account's name, or the bare label */
const counterFieldLabel = (
  linkedName: string | undefined,
  bareType: TxType | null,
  t: ReturnType<typeof useLang>['t'],
): string | undefined => linkedName ?? (bareType ? t('tx.counterNone') : undefined);

/** the account field on the form: picked account, or the pick prompt */
function AccountFieldRow({ account, onOpen }: Readonly<{ account: AccountRow | undefined; onOpen: () => void }>) {
  const { t } = useLang();
  return (
    <button
      data-testid="txform-account"
      onClick={onOpen}
      className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink"
    >
      <Icon name={account ? typeDef(account.type).icon : 'bank-outline'} size={20} color="var(--m-ink-3)" />
      <span className={`min-w-0 flex-1 truncate ${account ? '' : 'text-warning'}`}>{account?.name ?? t('txform.pickAccount')}</span>
      <span className="text-xs text-ink-4">{t('txform.account')}</span>
      <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
    </button>
  );
}

/**
 * Create or edit a manual transaction. Bank-imported rows (importRef set)
 * never reach this sheet — their amount/date are the bank's truth — and
 * automatically synced accounts (open banking) never take manual rows:
 * the bank feed is their single source of truth (user rule).
 */
export function TxFormSheet({ open, onOpenChange, tx, prefill }: TxFormSheetProps) {
  const { t } = useLang();
  const navigate = useNavigate();
  const { store, repo, spaceId } = useData();
  const cats = useCategories();
  const [amount, setAmount] = useState('');
  const [isExpense, setIsExpense] = useState(true);
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [catId, setCatId] = useState<string>(UNCATEGORIZED_ID);
  const [pickerOpen, setPickerOpen] = useState(false);
  // unified category editor (user request: same as review — type and
  // counterparty live INSIDE the category sheet now)
  const [splitOpen, setSplitOpen] = useState(false);
  const [stagedSplits, setStagedSplits] = useState<TxSplit[] | null>(null);
  // the simplified kind (user redesign): standard / transfer / adjustment;
  // a transfer saves with a counterparty OR a bare family label (arc 2)
  const [kind, setKind] = useState<TxKind>('standard');
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(null);
  const [bareType, setBareType] = useState<TxType | null>(null);
  const [recurringId, setRecurringId] = useState<string | null>(null);
  const [kindOpen, setKindOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // manual counterparty: the other side can be written in the same
  // stroke (user: "-100 to savings updated only half the picture")
  const [mirrorCounter, setMirrorCounter] = useState(true);
  const baselineRef = useRef('');

  const allAccounts = useSpaceAccounts();
  const accounts = useMemo(() => allAccounts?.filter((a) => !a.archived), [allAccounts]);
  // manual rows before the space's history start are refused (arc 5) —
  // they would vanish behind the display gate the moment they saved
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  // tier rule: hand-typed rows belong on MANUAL accounts only — linked
  // feeds are the bank's and imported (camt/csv) accounts are the next
  // upload's; manual entries there would duplicate or contradict them
  const writable = useMemo(() => (accounts ?? []).filter((a) => a.source === 'manual'), [accounts]);
  const recurrings = useRecurrings();

  // (re)fill when opened — keyed on the row's ID, not the object:
  // background writes (sync, migrations) re-emit the same row as a
  // fresh object every cycle on the native SQL backend, and an
  // identity-keyed reseed overwrote what the user was typing (iOS ss)
  useEffect(() => {
    if (!open) return;
    const initial = initialFormState(tx, prefill);
    setAmount(initial.amount);
    setIsExpense(initial.isExpense);
    setMerchant(initial.merchant);
    setDate(initial.date);
    setAccountId(initial.accountId);
    setCatId(initial.catId);
    setKind(initial.kind);
    setLinkedAccountId(initial.linkedAccountId);
    setBareType(initial.bareType);
    setRecurringId(initial.recurringId);
    setStagedSplits(tx?.splits ?? null);
    setMirrorCounter(true);
    // dirty baseline (user request 2026-08-01): a stray backdrop tap on
    // an EDITED form asks before dropping it; an untouched one closes
    baselineRef.current = formFingerprint({
      amount: initial.amount, isExpense: initial.isExpense, merchant: initial.merchant, date: initial.date,
      accountId: initial.accountId, catId: initial.catId, kind: initial.kind,
      linkedAccountId: initial.linkedAccountId, bareType: initial.bareType, recurringId: initial.recurringId,
      splits: tx?.splits ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tx?.id]);

  const cat = cats.byId(catId);
  const effectiveAccount = accountId ?? soleAccountId(writable);
  const selectedAccount = writable.find((a) => a.id === effectiveAccount);
  const cents = parseCents(amount);
  const linkedAccount = (accounts ?? []).find((a) => a.id === linkedAccountId);
  // the counterparty derives the type; the bare exit (arc 2) names it directly
  const effectiveType: TxType = typeForKind(kind, isExpense, linkedAccount ? typeForLinkedAccount(linkedAccount.type) : bareType);
  const counterMissing = counterUndecided(kind, linkedAccount, bareType);
  const startGateBlocking = blockingStartDate(space, date);
  const kindDetailType = kindDetail(effectiveType);
  const valid = isValidManualTx({ merchant, cents, account: effectiveAccount, date, counterMissing, beforeStart: !!startGateBlocking });

  const formCurrency = accounts?.find((a) => a.id === effectiveAccount)?.currency ?? 'EUR';
  // the editor needs a SpaceTx shape; a NEW manual tx builds it from the
  // live form state (controlled mode only reads amount/cat/currency)
  const pseudoTx = buildPseudoTx(tx, {
    accountId: effectiveAccount ?? '',
    date,
    cents,
    isExpense,
    currency: formCurrency,
    merchant: merchant.trim(),
    catId,
    txType: effectiveType,
  });

  const save = () => {
    if (!valid || !effectiveAccount || cents === null) return;
    const signed = isExpense ? -Math.abs(cents) : Math.abs(cents);
    const rowId = tx?.id ?? repo.newId();
    applyManualBalanceDeltas(repo, spaceId, manualBalanceDeltas(accounts, tx, effectiveAccount, signed));
    // loans v2 (review finding): the edit form writes the raw row
    // directly, so the loan link coupling must ride here too — a
    // retargeted or cleared counterparty moves the manual loans exactly
    // like the same gesture in the detail screen. The mirror path stays
    // exempt: createCounterTransaction skips liability counters now.
    const prevLinked = tx?.linkedAccountId ?? undefined;
    const nextLinked = linkedAccountId ?? undefined; // mirrors manualTxFields' write
    if (prevLinked !== nextLinked) {
      void import('@/application/loanBalance')
        .then(({ applyLoanLinkDelta }) =>
          applyLoanLinkDelta(store, repo, { amountCents: signed, date, transferPeerId: tx?.transferPeerId, loanCounted: tx?.loanCounted }, prevLinked, nextLinked),
        )
        .catch(() => undefined);
    }
    void logActivity(store, repo, spaceId, tx ? 'txEdit' : 'txAdd', merchant.trim());
    void repo.upsert(
      'transaction',
      spaceId,
      rowId,
      manualTxFields({
        tx,
        accountId: effectiveAccount,
        date,
        signed,
        currency: formCurrency,
        merchant: merchant.trim(),
        catId,
        txType: effectiveType,
        stagedSplits,
        linkedAccountId,
        recurringId,
      }),
    );
    // the checked mirror writes the OTHER side onto the manual counter
    // account in the same stroke (peered both ways, balance follows)
    if (!tx && mirrorCounter && kind === 'transfer' && linkedAccount?.source === 'manual') {
      void createCounterTransaction(
        store,
        repo,
        {
          id: rowId,
          spaceId,
          accountId: effectiveAccount,
          date,
          amountCents: signed,
          currency: formCurrency,
          merchant: merchant.trim(),
          txType: effectiveType,
          needsReview: 0,
        } as Parameters<typeof createCounterTransaction>[2],
        linkedAccount.id,
      ).catch(() => undefined);
    }
    onOpenChange(false);
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={tx ? t('txform.editTitle') : t('txform.addTitle')}
        size="tall"
        dirty={open && formFingerprint({ amount, isExpense, merchant, date, accountId, catId, kind, linkedAccountId, bareType, recurringId, splits: stagedSplits }) !== baselineRef.current}
      >
        {/* no manual account yet: explain WHY the form can't work and
            hand over a one-tap path to fix it (user UX request) */}
        {writable.length === 0 && !tx ? (
          <div className="flex flex-col items-center gap-3 px-4 pt-8 text-center" data-testid="txform-no-accounts">
            <Icon name="bank-plus" size={40} color="var(--m-ink-4)" />
            <p className="text-[15px] font-medium text-ink">{t('txform.noAccountsTitle')}</p>
            <p className="text-[13px] leading-relaxed text-ink-3">{t('txform.noAccountsBody')}</p>
            <Button
              className="mt-2 w-full"
              data-testid="txform-add-account"
              onClick={() => {
                onOpenChange(false);
                void navigate({ to: '/accounts' });
              }}
            >
              {t('txform.noAccountsCta')}
            </Button>
          </div>
        ) : (
        <div className="flex flex-col gap-3 pt-1">
          {/* direction + amount */}
          <div className="flex gap-2">
            <div className="flex overflow-hidden rounded-input border border-line">
              <button
                data-testid="txform-expense"
                onClick={() => setIsExpense(true)}
                className={`m-tap border-none px-3 text-[13px] font-medium ${isExpense ? 'bg-negative-soft text-negative' : 'bg-surface text-ink-3'}`}
              >
                −
              </button>
              <button
                data-testid="txform-income"
                onClick={() => setIsExpense(false)}
                className={`m-tap border-none px-3 text-[13px] font-medium ${isExpense ? 'bg-surface text-ink-3' : 'bg-accent-soft text-accent-deep'}`}
              >
                +
              </button>
            </div>
            <input
              data-testid="txform-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder={`${t('txform.amount')} (EUR)`}
              className="h-12 min-w-0 flex-1 rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4"
            />
          </div>

          <input
            data-testid="txform-merchant"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder={t('txform.merchant')}
            className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4"
          />

          {/* the webview's own picker indicator sat misaligned (user
              report) — hide it and draw our chevron where it belongs */}
          <div className="relative">
            <input
              data-testid="txform-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-12 w-full appearance-none rounded-input border border-line bg-surface px-4 pr-10 text-[15px] text-ink outline-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:opacity-0"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
              <Icon name="chevron-down" size={18} color="var(--m-ink-4)" />
            </span>
          </div>
          {/* before the space starts (arc 5): refuse with the way out —
              one tap moves the start back to this very date */}
          {startGateBlocking && (
            <div className="flex flex-col gap-2 rounded-card border border-line bg-bg-2 px-4 py-3" data-testid="txform-before-start">
              <p className="text-[12px] text-negative">{t('txform.beforeStart', { date: startGateBlocking })}</p>
              <Button
                size="sm"
                variant="outline"
                data-testid="txform-move-start"
                onClick={() => {
                  void repo.upsert('space', spaceId, spaceId, { historyStartDate: date });
                  void logActivity(store, repo, spaceId, 'spaceEdit', space?.name ?? '');
                }}
              >
                {t('txform.moveStart')}
              </Button>
            </div>
          )}

          {/* account — a full field + picker sheet (the chip strip felt
              odd, user 2026-07-31); open-banking accounts are not offered */}
          {writable.length > 0 && <AccountFieldRow account={selectedAccount} onOpen={() => setAccountOpen(true)} />}
          {writable.length === 0 && (
            <p className="px-1 text-[12px] text-ink-4" data-testid="txform-no-manual-account">
              {t('txform.manualOnly')}
            </p>
          )}

          <KindRows
            kind={kind}
            detailType={kindDetailType}
            counterName={counterFieldLabel(linkedAccount?.name, bareType, t)}
            onKind={() => setKindOpen(true)}
            onCounter={() => setCounterOpen(true)}
          />

          {/* manual counter account: offer to write the other side too —
              without it "-100 to savings" updated only half the picture */}
          {!tx && kind === 'transfer' && linkedAccount?.source === 'manual' && (
            <label className="flex items-center gap-2 px-1 text-[13px] text-ink-2">
              <input
                type="checkbox"
                data-testid="txform-mirror"
                checked={mirrorCounter}
                onChange={(e) => setMirrorCounter(e.target.checked)}
              />
              {t('txform.mirrorCreate', { name: linkedAccount.name })}
            </label>
          )}

          {/* category row — opens the SAME unified editor as review */}
          <button
            data-testid="txform-category"
            onClick={() => setSplitOpen(true)}
            className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink"
          >
            <Icon name={cat.icon} size={20} color={cat.color ?? cats.byId(cat.parentId).color} />
            <span className="flex-1">{catName(cat, t)}</span>
            <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
          </button>

          {/* recurring link (only when the space has recurring costs) */}
          {(recurrings?.length ?? 0) > 0 && (
            <button
              data-testid="txform-recurring"
              onClick={() => setRecurringOpen(true)}
              className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink"
            >
              <Icon name="autorenew" size={20} color="var(--m-ink-3)" />
              <span className={`flex-1 ${recurringId ? '' : 'text-ink-4'}`}>
                {recurrings?.find((r) => r.id === recurringId)?.name ?? t('recurring.linkNone')}
              </span>
              <span className="text-xs text-ink-4">{t('recurring.linkTitle')}</span>
              <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
            </button>
          )}

          <Button data-testid="txform-save" onClick={save} disabled={!valid}>
            {tx ? t('action.save') : t('action.add')}
          </Button>
        </div>
        )}
      </Sheet>

      {/* stacked: the kind picker — a transfer immediately continues
          into the mandatory counterparty pick */}
      <TxKindSheet
        open={kindOpen}
        onOpenChange={setKindOpen}
        current={kind}
        allowAdjustment
        onPick={(next) => {
          setKind(next);
          if (next === 'transfer') {
            setCounterOpen(true);
          } else {
            setLinkedAccountId(null);
            setBareType(null);
          }
        }}
      />
      <CounterpartySheet
        open={counterOpen}
        onOpenChange={setCounterOpen}
        excludeAccountId={effectiveAccount ?? ''}
        currentLinkedId={linkedAccountId ?? undefined}
        onChoose={(picked) => {
          setLinkedAccountId(picked.id);
          setBareType(null);
        }}
        onBare={(type) => {
          setBareType(type);
          setLinkedAccountId(null);
        }}
      />

      {/* stacked: account picker */}
      <AccountPickSheet
        open={accountOpen}
        onOpenChange={setAccountOpen}
        accounts={writable}
        selectedId={effectiveAccount}
        onPick={(id) => setAccountId(id)}
      />

      {/* stacked: recurring cost */}
      <RecurringPickSheet
        open={recurringOpen}
        onOpenChange={setRecurringOpen}
        recurrings={recurrings ?? []}
        recurringId={recurringId}
        onPick={(id) => {
          setRecurringId(id);
          setRecurringOpen(false);
        }}
      />

      {/* the unified category editor (same component as review) — type
          and counterparty ride along as context rows */}
      <SplitEditorSheet
        open={splitOpen}
        onOpenChange={setSplitOpen}
        tx={pseudoTx}
        value={stagedSplits ?? undefined}
        txType={effectiveType}
        seedSingle
        seedCatId={catId}
        direction={isExpense ? 'debit' : 'credit'}
        onApply={(splits) => {
          setStagedSplits(splits);
          if (splits?.length) setCatId(primaryCatId(splits) ?? catId);
        }}
        onApplySingle={(picked) => {
          setStagedSplits(null);
          setCatId(picked);
        }}
      />

      <CategoryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedId={catId}
        onPick={setCatId}
        direction={isExpense ? 'debit' : 'credit'}
      />
    </>
  );
}
