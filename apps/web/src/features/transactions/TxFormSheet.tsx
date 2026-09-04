import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSpaceAccounts } from '@/application/transactions';
import { REIMBURSED_ID, UNCATEGORIZED_ID, autoSubFor, isMovementCat, specialCatType, stampMovementSub } from '@/domain/categories';
import { scaleCatsTo } from '@/domain/txSlices';
import { accountStamp, familyForCounter, movementCatFor } from '@/domain/txType';
import { defaultFamilyFor } from '@/domain/defaultAccounts';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { logActivity } from '@/application/activity';
import { setSpaceAddAccountIntent } from '@/features/spaces/spaceAccountsHandoff';
import { applyHistoryMove } from '@/application/historyStart';
import { catName, useCategories } from '@/features/categories/useCategories';
import { useRecurrings } from '@/application/recurring';
import { fmtCents, parseCents } from '@/lib/money';
import { Chip } from '@/ui/primitives';
import { focusEntryMode, nextAmountEntry } from '@/lib/amountRegister';
import type { AmountEntryMode } from '@/lib/amountRegister';
import type { AccountRow, RecurringRow, TransactionRow, TxSplitCat, TxType } from '@/db/types';
import { RecurringVisual } from '@/features/recurring/RecurringVisual';
import { typeDef } from '@/features/accounts/accountTypes';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { CatsSheet } from './PartCatsSheet';
import { minaSuggestedTx } from '@/features/mina/steps';
import { CounterpartySheet } from './TxKindSheet';

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
    state.adjustment, state.linkedAccountId, state.recurringId, state.cats,
  ]);

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

/** #133 D: the kind grid is gone — the counterparty row (always there,
 *  None by default) and the small Adjustment toggle are what remains of
 *  it on the manual form (S3776: out of the main component) */
function CounterAdjustRows({
  counterName,
  locked = false,
  adjustment,
  counterBlocker,
  onCounter,
  onToggleAdjustment,
}: Readonly<{
  counterName: string | undefined;
  /** R1: a stamped account owns its rows' meaning */
  locked?: boolean;
  adjustment: boolean;
  /** #309 (user): the save refused for THIS field — text under the row */
  counterBlocker?: string;
  onCounter: () => void;
  onToggleAdjustment: () => void;
}>) {
  const { t } = useLang();
  return (
    <>
      <button
        data-testid="txform-counter"
        onClick={locked ? undefined : onCounter}
        className={`m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink${blockerRing(!!counterBlocker)}`}
      >
        <Icon name="bank-transfer" size={20} color={counterBlocker ? 'var(--m-negative)' : 'var(--m-ink-3)'} />
        <span className={`flex-1${counterBlocker ? ' text-negative' : ''}`}>{counterName ?? t('tx.counterNone')}</span>
        <span className="text-xs text-ink-4">{t('tx.counterparty')}</span>
        <Icon name={locked ? 'lock-outline' : 'chevron-right'} size={locked ? 14 : 18} color="var(--m-ink-4)" />
      </button>
      <FormBlockerNote show={!!counterBlocker} text={counterBlocker ?? ''} testId="txform-save-blocker" />
      {/* C3: corrections stay a manual-row tool — a quiet toggle */}
      <button
        data-testid="txform-adjustment"
        onClick={onToggleAdjustment}
        className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-2.5 text-left text-[13px] text-ink-2"
      >
        <Icon name="tune-variant" size={18} color="var(--m-ink-3)" />
        <span className="flex-1">{t('txform.adjustment')}</span>
        <Icon name={adjustment ? 'checkbox-marked' : 'checkbox-blank-outline'} size={18} color={adjustment ? 'var(--m-accent-deep)' : 'var(--m-ink-4)'} />
      </button>
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
      adjustment: false,
      linkedAccountId: prefill?.linkedAccountId ?? null,
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
    adjustment: tx.adjustment === 1 || tx.txType === 'adjustment',
    linkedAccountId: tx.linkedAccountId ?? null,
    recurringId: tx.recurringId ?? null,
  };
}

/** the form's category row (#211, S3776: out of the component): a
 *  split CONTAINER owns no category — the row states the parts and
 *  stays inert (the detail's manage flow edits them); a whole row
 *  doors into the split-categories editor and names its spread */
function FormCategoryRow({
  tx,
  cat,
  cats,
  stagedCats,
  onOpen,
}: Readonly<{
  tx: TransactionRow | undefined;
  cat: ReturnType<ReturnType<typeof useCategories>['byId']>;
  cats: ReturnType<typeof useCategories>;
  stagedCats: TxSplitCat[] | null;
  onOpen: () => void;
}>) {
  const { t } = useLang();
  if (tx?.splits?.length) {
    return (
      <div
        data-testid="txform-category-parts"
        className="flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink-3"
      >
        <Icon name="call-split" size={20} color="var(--m-ink-4)" />
        <span className="flex-1">
          {t('split.partsSection')} · {tx.splits.filter((s) => s.catId !== REIMBURSED_ID).length}
        </span>
      </div>
    );
  }
  return (
    <button
      data-testid="txform-category"
      onClick={onOpen}
      className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink"
    >
      <Icon name={cat.icon} size={20} color={cat.color ?? cats.byId(cat.parentId).color} />
      <span className="flex-1">
        {stagedCats && stagedCats.length > 1
          ? stagedCats.map((entry) => catName(cats.byId(entry.catId), t)).join(' · ')
          : catName(cat, t)}
      </span>
      <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
    </button>
  );
}

/** #309 (user): a movement category without its decided other side —
 *  adjustments carry no counterparty at all, and the DEBT family keeps
 *  its designed bare story (the unassigned-payments bucket collects
 *  loan rows until a real loan claims them). (S3776: out of the component) */
const movementCounterMissing = (adjustment: boolean, catId: string | null, linkedAccountId: string | null): boolean =>
  !adjustment && !!catId && isMovementCat(catId) && specialCatType(catId) !== 'debtPayment' && !linkedAccountId;

/** #309: the ask pins the staged special's family default (S3776) */
const askDefaultFamily = (catId: string | null) =>
  catId && specialCatType(catId) ? (defaultFamilyFor(catId) ?? undefined) : undefined;

/** #195/#309: the blocker text when it names THIS field (S3776) */
const fieldBlocker = (field: string, current: string, text: string): string | undefined =>
  current === field ? text : undefined;

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
  stagedCats: TxSplitCat[] | null;
  linkedAccountId: string | null;
  recurringId: string | null;
}): Partial<Omit<TransactionRow, 'id' | 'spaceId'>> {
  // arc 2 locked doors: an uncategorized transfer-family row files under
  // the family's sign-picked sub instead of the hidden placeholder
  const familySub = args.catId === UNCATEGORIZED_ID && !args.stagedCats?.length ? autoSubFor(args.txType, args.signed) : undefined;
  // #211: a staged spread rides the write — rescaled if the amount moved
  // after spreading (the partition must always sum to the gross)
  const cats = args.stagedCats?.length ? rescaledCats(args.stagedCats, Math.abs(args.signed)) : undefined;
  return {
    accountId: args.accountId,
    date: args.date,
    amountCents: args.signed,
    currency: args.currency,
    merchant: args.merchant.trim(),
    catId: familySub ?? args.catId,
    txType: args.txType,
    // #133 D (C3): the manual correction marker survives the type's
    // retirement as its own stored flag
    adjustment: (args.txType === 'adjustment' ? 1 : 0) as 0 | 1,
    needsReview: 0 as const,
    ...(cats || args.tx?.cats?.length ? { cats: cats ?? (null as never) } : {}),
    ...(args.linkedAccountId || args.tx?.linkedAccountId ? { linkedAccountId: args.linkedAccountId ?? (null as never) } : {}),
    ...(args.recurringId || args.tx?.recurringId ? { recurringId: args.recurringId ?? (null as never) } : {}),
  };
}

/** the spread scaled onto a (possibly edited) amount — identity when it
 *  already sums; largest-remainder otherwise */
function rescaledCats(entries: TxSplitCat[], targetAbs: number): TxSplitCat[] | undefined {
  const sum = entries.reduce((total, e) => total + e.amountCents, 0);
  if (sum === targetAbs) return entries;
  const scaled = scaleCatsTo(entries, targetAbs);
  return scaled?.length ? scaled : undefined;
}

// applyFormCatMirrors retired (#228): spread entries carry no links —
// the form's one counterparty is its linkedAccountId state, and the
// row-level planMirrorChange in save() is the whole mirror story.

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
  recurrings: readonly Pick<RecurringRow, 'id' | 'name' | 'logo' | 'icon' | 'kind'>[];
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
            // #258 (user): the cost's own face, not a generic row
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <RecurringVisual rec={r} size={16} active={false} />
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{r.name}</span>
            </span>,
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

/** #228 (user): removing the counterparty resets a special category —
 *  the movement story ends with its account (S3776: out of the form) */
const detachedCatFor = (catId: string): string => (specialCatType(catId) ? UNCATEGORIZED_ID : catId);

/** #133: the form's effective type — the same derivation order the
 *  choke uses (adjustment > stamp > diamond category > counterparty >
 *  sign). Module-level for S3776. */
function formEffectiveType(
  adjustment: boolean,
  ownStamp: TxType | undefined,
  catId: string,
  linkedAccount: AccountRow | undefined,
  isExpense: boolean,
): TxType {
  if (adjustment) return 'adjustment';
  // #133 r5 bijection: the counter's KIND names the family
  const linkedType = linkedAccount ? familyForCounter(linkedAccount.type) : undefined;
  return ownStamp ?? specialCatType(catId) ?? linkedType ?? (isExpense ? 'expense' : 'income');
}

/** the space's start date IF the picked date falls before it (arc 5) —
 *  such a row would vanish behind the display gate the moment it saved,
 *  so a truthy return blocks save and renders the way out */
const blockingStartDate = (space: { historyStartDate?: string } | undefined, date: string): string | undefined =>
  space?.historyStartDate && date && date < space.historyStartDate ? space.historyStartDate : undefined;

/** the account field on the form: picked account, or the pick prompt */
function AccountFieldRow({ account, onOpen, bad = false }: Readonly<{ account: AccountRow | undefined; onOpen: () => void; bad?: boolean }>) {
  const { t } = useLang();
  return (
    <button
      data-testid="txform-account"
      onClick={onOpen}
      // S6811: buttons don't take aria-invalid — the ring + data flag
      // carry the "fix this field" signal instead
      data-invalid={bad || undefined}
      className={`m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink${blockerRing(bad)}`}
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
/** #269: the signed cents a manual save writes — target mode is the
 *  difference to the account's balance, delta mode the signed value
 *  (S3776/S3358: out of the component) */
function signedManualCents(adjustment: boolean, adjustTarget: boolean, cents: number, adjustBase: number, isExpense: boolean): number {
  if (adjustment && adjustTarget) return Math.abs(cents) - adjustBase;
  return isExpense ? -Math.abs(cents) : Math.abs(cents);
}

/** #269: the live balance delta — null while the field is empty (S3776) */
function adjustDeltaFor(adjustment: boolean, adjustTarget: boolean, cents: number | null, adjustBase: number, isExpense: boolean): number | null {
  if (!adjustment || cents === null || cents === 0) return null;
  return signedManualCents(adjustment, adjustTarget, cents, adjustBase, isExpense);
}

/** #195 r2: the (field, message) the blocker cascade names (S3776) */
function manualBlockerFor(args: {
  attempted: boolean;
  valid: boolean;
  merchant: string;
  cents: number | null;
  adjustNoop: boolean;
  effectiveAccount: string | null;
  counterMissing: boolean;
  startGateBlocking: string | undefined;
  t: ReturnType<typeof useLang>['t'];
}): [string, string] {
  const { t } = args;
  if (!args.attempted || args.valid) return ['', ''];
  if (!args.merchant.trim()) return ['merchant', t('form.needName')];
  if (args.cents === null || args.cents === 0) return ['amount', t('form.needAmount')];
  if (args.adjustNoop) return ['amount', t('txform.adjustNoop')];
  if (!args.effectiveAccount) return ['account', t('form.needAccount')];
  // #309 (user): a movement category refuses to save without its counter
  if (args.counterMissing) return ['counter', t('review.counterRequired')];
  // the start-gate card already explains itself — just point at it
  if (args.startGateBlocking) return ['form', t('form.fixErrors')];
  return ['form', t('form.needFields')];
}

/** #269 (user): the adjustment names its balance impact, and the typed
 *  number can mean the value OR the balance to land on (S3776) */
function AdjustmentPanel({
  show,
  adjustTarget,
  onMode,
  adjustDelta,
  adjustBase,
  currency,
}: Readonly<{
  /** on only while the checkbox is ticked AND an account is picked */
  show: boolean;
  adjustTarget: boolean;
  onMode: (target: boolean) => void;
  adjustDelta: number | null;
  adjustBase: number;
  currency: string;
}>) {
  const { t, lang } = useLang();
  if (!show) return null;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-bg-2 px-4 py-3" data-testid="txform-adjust-panel">
      <div className="flex gap-1.5">
        <Chip testId="txform-adjust-mode-delta" selected={!adjustTarget} onClick={() => onMode(false)}>
          {t('txform.adjustModeDelta')}
        </Chip>
        <Chip testId="txform-adjust-mode-target" selected={adjustTarget} onClick={() => onMode(true)}>
          {t('txform.adjustModeTarget')}
        </Chip>
      </div>
      <p className="text-[12px] text-ink-3" data-testid="txform-adjust-impact">
        {adjustDelta === null
          ? t('txform.adjustImpactIdle')
          : t('txform.adjustImpact', {
              from: fmtCents(adjustBase, currency, lang),
              to: fmtCents(adjustBase + adjustDelta, currency, lang),
              delta: fmtCents(adjustDelta, currency, lang, { sign: true }),
            })}
      </p>
    </div>
  );
}

/** #269: the category row — locked to Balance Adjustment while the
 *  checkbox is on (S3776: the swap lives out of the component) */
function FormCategorySlot({
  adjustment,
  tx,
  cat,
  cats,
  stagedCats,
  onOpen,
}: Readonly<{
  adjustment: boolean;
  tx: TransactionRow | undefined;
  cat: ReturnType<ReturnType<typeof useCategories>['byId']>;
  cats: ReturnType<typeof useCategories>;
  stagedCats: TxSplitCat[] | null;
  onOpen: () => void;
}>) {
  const { t } = useLang();
  if (!adjustment) return <FormCategoryRow tx={tx} cat={cat} cats={cats} stagedCats={stagedCats} onOpen={onOpen} />;
  return (
    <div
      className="flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-[15px] text-ink-3"
      data-testid="txform-adjust-cat"
    >
      <Icon name="scale-balance" size={20} color="var(--m-ink-3)" />
      <span className="flex-1">{catName(cats.byId('balanceAdjustment'), t)}</span>
      <Icon name="lock-outline" size={14} color="var(--m-ink-4)" />
    </div>
  );
}

/** #269: the recurring-link row — never on an adjustment (S3776) */
function RecurringLinkRow({
  adjustment,
  recurrings,
  recurringId,
  onOpen,
}: Readonly<{
  adjustment: boolean;
  recurrings: readonly Pick<RecurringRow, 'id' | 'name'>[] | undefined;
  recurringId: string | null;
  onOpen: () => void;
}>) {
  const { t } = useLang();
  if (adjustment || (recurrings?.length ?? 0) === 0) return null;
  return (
    <button
      data-testid="txform-recurring"
      onClick={onOpen}
      className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink"
    >
      <Icon name="autorenew" size={20} color="var(--m-ink-3)" />
      <span className={`flex-1 ${recurringId ? '' : 'text-ink-4'}`}>
        {recurrings?.find((r) => r.id === recurringId)?.name ?? t('recurring.linkNone')}
      </span>
      <span className="text-xs text-ink-4">{t('recurring.linkTitle')}</span>
      <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
    </button>
  );
}

export function TxFormSheet({ open, onOpenChange, tx, prefill }: TxFormSheetProps) {
  const { t } = useLang();
  const navigate = useNavigate();
  const { store, repo, spaceId } = useData();
  const cats = useCategories();
  const [amount, setAmount] = useState('');
  // register-style entry state for the amount field (lib/amountRegister)
  const [amountEntryMode, setAmountEntryMode] = useState<AmountEntryMode>('register');
  const [isExpense, setIsExpense] = useState(true);
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [catId, setCatId] = useState<string>(UNCATEGORIZED_ID);
  // #211: the split-CATEGORIES editor (the same sheet as review/detail) —
  // a spread stays ONE transaction; real splits are the detail's flow
  const [catsSheetOpen, setCatsSheetOpen] = useState(false);
  const [stagedCats, setStagedCats] = useState<TxSplitCat[] | null>(null);
  // #133 D: no kind — a counterparty makes it a transfer, the toggle
  // marks manual corrections (C3)
  const [adjustment, setAdjustment] = useState(false);
  // #269 (user): what the typed number MEANS while Adjustment is on —
  // the transaction's value (default) or the balance to land on
  const [adjustTarget, setAdjustTarget] = useState(false);
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(null);
  const [recurringId, setRecurringId] = useState<string | null>(null);
  const [counterOpen, setCounterOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // #195: tappable — an invalid tap names the blocker
  const [attempted, setAttempted] = useState(false);
  const baselineRef = useRef('');

  const allAccounts = useSpaceAccounts();
  const accounts = useMemo(() => allAccounts?.filter((a) => !a.archived), [allAccounts]);
  // manual rows before the space's history start are refused (arc 5) —
  // they would vanish behind the display gate the moment they saved
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  // tier rule: hand-typed rows belong on MANUAL accounts only — linked
  // feeds are the bank's and imported (camt/csv) accounts are the next
  // upload's; manual entries there would duplicate or contradict them.
  // #221: the DEFAULT accounts' ledgers are system-managed (mirror legs
  // + balance adjustments) — never a hand-entry target.
  const writable = useMemo(() => (accounts ?? []).filter((a) => a.source === 'manual' && !a.defaultFor), [accounts]);
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
    setAdjustment(initial.adjustment);
    setLinkedAccountId(initial.linkedAccountId);
    setRecurringId(initial.recurringId);
    setStagedCats(tx?.cats ?? null);
    setAttempted(false);
    // dirty baseline (user request 2026-08-01): a stray backdrop tap on
    // an EDITED form asks before dropping it; an untouched one closes
    baselineRef.current = formFingerprint({
      amount: initial.amount, isExpense: initial.isExpense, merchant: initial.merchant, date: initial.date,
      accountId: initial.accountId, catId: initial.catId, adjustment: initial.adjustment,
      linkedAccountId: initial.linkedAccountId, recurringId: initial.recurringId,
      cats: tx?.cats ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tx?.id]);

  const cat = cats.byId(catId);
  const effectiveAccount = accountId ?? soleAccountId(writable);
  const selectedAccount = writable.find((a) => a.id === effectiveAccount);
  const cents = parseCents(amount);
  const linkedAccount = (accounts ?? []).find((a) => a.id === linkedAccountId);
  // R1: a stamped account types every one of its rows; R3: a marked
  // special category pulls its type onto a standard row; otherwise the
  // kind resolves it (a tracked counterparty = plain transfer, R2)
  const ownStamp = accountStamp(selectedAccount?.type);
  const effectiveType = formEffectiveType(adjustment, ownStamp, catId, linkedAccount, isExpense);
  const startGateBlocking = blockingStartDate(space, date);
  // #269: the adjustment's balance story — current → after (target mode
  // derives the transaction's value from the difference to the balance)
  const adjustBase = selectedAccount?.balanceCents ?? 0;
  const adjustDelta = adjustDeltaFor(adjustment, adjustTarget, cents, adjustBase, isExpense);
  const adjustNoop = adjustTarget && adjustDelta === 0;
  // #309 (user): a movement category REQUIRES its counterparty here too —
  // the validator always had the gate, the form just never fed it
  const counterMissing = movementCounterMissing(adjustment, catId, linkedAccountId);
  const valid =
    isValidManualTx({ merchant, cents, account: effectiveAccount, date, counterMissing, beforeStart: !!startGateBlocking }) &&
    !adjustNoop;
  // #195 r2 (user): the note renders under the field it names — one
  // (field, text) pair at a time, the note scrolls itself into view
  const [blockerField, blockerText] = manualBlockerFor({
    attempted, valid, merchant, cents, adjustNoop, effectiveAccount, counterMissing, startGateBlocking, t,
  });

  const formCurrency = accounts?.find((a) => a.id === effectiveAccount)?.currency ?? 'EUR';

  const save = () => {
    if (!valid || !effectiveAccount || cents === null) return;
    // #269: target mode writes the DIFFERENCE to the named balance
    const signed = signedManualCents(adjustment, adjustTarget, cents, adjustBase, isExpense);
    const rowId = tx?.id ?? repo.newId();
    // Q8: a stamped row that names a counterparty is a movement — the
    // category is forced from the special account's own side; a bare
    // uncategorized one defaults there too (interest/fees are re-picks)
    const forcedCat = ownStamp && (linkedAccountId || catId === UNCATEGORIZED_ID) ? stampMovementSub(ownStamp, signed) : undefined;
    applyManualBalanceDeltas(repo, spaceId, manualBalanceDeltas(accounts, tx, effectiveAccount, signed));
    const prevLinked = tx?.linkedAccountId ?? undefined;
    const nextLinked = (adjustment ? null : linkedAccountId) ?? undefined; // mirrors manualTxFields' write
    void logActivity(store, repo, spaceId, tx ? 'txEdit' : 'txAdd', merchant.trim());
    // the form writes the raw row directly (not through writeTxTransform),
    // so the mirror-mint lifecycle must ride here too: a linked MANUAL
    // counter gets its leg minted (typed by its stamp, balance follows),
    // a retargeted or cleared counterparty retires the old mint — the
    // same engine as every other linkedAccountId writer (typed-splits v2)
    void (async () => {
      const fields = manualTxFields({
        tx,
        accountId: effectiveAccount,
        date,
        signed,
        currency: formCurrency,
        merchant: merchant.trim(),
        // #269: an adjustment IS its category — no spreads, no counter,
        // no recurring riding along
        catId: adjustment ? 'balanceAdjustment' : (forcedCat ?? catId),
        txType: effectiveType,
        stagedCats: adjustment ? null : stagedCats,
        linkedAccountId: adjustment ? null : linkedAccountId,
        recurringId: adjustment ? null : recurringId,
      });
      await repo.upsert('transaction', spaceId, rowId, fields);
      if (prevLinked !== nextLinked) {
        const { planMirrorChange } = await import('@/application/mirrorMint');
        const plan = await planMirrorChange(
          store,
          {
            id: rowId,
            accountId: effectiveAccount,
            amountCents: signed,
            date,
            currency: formCurrency,
            merchant: merchant.trim(),
            ...(tx?.loanCounted === 1 ? { loanCounted: 1 as const } : {}),
          },
          prevLinked,
          nextLinked,
          tx?.transferPeerId,
          undefined,
        );
        if (Object.hasOwn(plan.sourceFields, 'transferPeerId')) {
          await repo.upsert('transaction', spaceId, rowId, { transferPeerId: (plan.sourceFields.transferPeerId ?? null) as never });
        }
        await plan.execute(repo);
      }
    })().catch(() => undefined);
    onOpenChange(false);
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={tx ? t('txform.editTitle') : t('txform.addTitle')}
        size="tall"
        // #179: until the seed effect stamps a baseline, the form cannot
        // be dirty — the ref-in-effect pattern left '' behind on a blank
        // new form (no state change → no re-render → false discard ask)
        dirty={open && baselineRef.current !== '' && formFingerprint({ amount, isExpense, merchant, date, accountId, catId, adjustment, linkedAccountId, recurringId, cats: stagedCats }) !== baselineRef.current}
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
                // #179 (user): straight to the SPACE's accounts screen
                // with the add sheet opening on arrival — the global
                // overview hid manual creation two taps deep
                setSpaceAddAccountIntent();
                void navigate({ to: '/spaces/$spaceId/accounts', params: { spaceId } });
              }}
            >
              {t('txform.noAccountsCta')}
            </Button>
          </div>
        ) : (
        <div className="flex flex-col gap-3 pt-1">
          {/* direction + amount */}
          <div className="flex gap-2">
            {/* #327 r3 (user): halves own their corners — the inset
                focus ring follows the group's rounding */}
            <div className="flex overflow-hidden rounded-input border border-line">
              <button
                data-testid="txform-expense"
                onClick={() => setIsExpense(true)}
                className={`m-tap rounded-l-input border-none px-3 text-[13px] font-medium ${isExpense ? 'bg-negative-soft text-negative' : 'bg-surface text-ink-3'}`}
              >
                −
              </button>
              <button
                data-testid="txform-income"
                onClick={() => setIsExpense(false)}
                className={`m-tap rounded-r-input border-none px-3 text-[13px] font-medium ${isExpense ? 'bg-surface text-ink-3' : 'bg-accent-soft text-accent-deep'}`}
              >
                +
              </button>
            </div>
            <input
              data-testid="txform-amount"
              value={amount}
              onFocus={() => setAmountEntryMode(focusEntryMode(amount))}
              onChange={(e) => {
                // register-style entry (user request): digits fill cents
                // from the right; a comma or operator frees the field
                const next = nextAmountEntry(amountEntryMode, amount, e.target.value);
                setAmountEntryMode(next.mode);
                setAmount(next.text);
              }}
              inputMode="decimal"
              placeholder={`${t('txform.amount')} (EUR)`}
              aria-invalid={attempted && (cents === null || cents === 0)}
              className={`h-12 min-w-0 flex-1 rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && (cents === null || cents === 0))}`}
            />
          </div>
          <FormBlockerNote show={blockerField === 'amount'} text={blockerText} testId="txform-save-blocker" />

          <input
            data-testid="txform-merchant"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder={t('txform.merchant')}
            aria-invalid={attempted && !merchant.trim()}
            className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && !merchant.trim())}`}
          />
          <FormBlockerNote show={blockerField === 'merchant'} text={blockerText} testId="txform-save-blocker" />

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
                  // #259: the full move — every attachment's gate follows
                  // the space date (a bare space write left links behind)
                  void applyHistoryMove(store, repo, spaceId, date);
                }}
              >
                {t('txform.moveStart')}
              </Button>
            </div>
          )}

          {/* account — a full field + picker sheet (the chip strip felt
              odd, user 2026-07-31); open-banking accounts are not offered */}
          {writable.length > 0 && (
            <AccountFieldRow account={selectedAccount} onOpen={() => setAccountOpen(true)} bad={attempted && !effectiveAccount} />
          )}
          <FormBlockerNote show={blockerField === 'account'} text={blockerText} testId="txform-save-blocker" />
          {writable.length === 0 && (
            <p className="px-1 text-[12px] text-ink-4" data-testid="txform-no-manual-account">
              {t('txform.manualOnly')}
            </p>
          )}

          <CounterAdjustRows
            counterName={linkedAccount?.name}
            locked={!!ownStamp || adjustment}
            adjustment={adjustment}
            counterBlocker={fieldBlocker('counter', blockerField, blockerText)}
            onCounter={() => setCounterOpen(true)}
            onToggleAdjustment={() => {
              setAdjustment((v) => !v);
              setAdjustTarget(false);
            }}
          />

          {/* #269 (user): the adjustment names its balance impact, and the
              typed number can mean the value OR the balance to land on */}
          <AdjustmentPanel
            show={adjustment && !!selectedAccount}
            adjustTarget={adjustTarget}
            onMode={setAdjustTarget}
            adjustDelta={adjustDelta}
            adjustBase={adjustBase}
            currency={formCurrency}
          />

          {/* manual counter account: offer to write the other side too —
              without it "-100 to savings" updated only half the picture */}
          {/* the mirror checkbox retired 2026-08-05: a MANUAL counter's
              leg is always minted now — the special account's ledger IS
              the record (typed-splits v2) */}

          {/* category row — the split-categories editor (#211). A split
              CONTAINER owns no category of its own: the row states the
              parts and stays inert (the detail's manage flow edits them) */}
          <FormCategorySlot adjustment={adjustment} tx={tx} cat={cat} cats={cats} stagedCats={stagedCats} onOpen={() => setCatsSheetOpen(true)} />

          <RecurringLinkRow adjustment={adjustment} recurrings={recurrings} recurringId={recurringId} onOpen={() => setRecurringOpen(true)} />

          <FormBlockerNote show={blockerField === 'form'} text={blockerText} testId="txform-save-blocker" />
          <Button
            data-testid="txform-save"
            onClick={() => {
              if (!valid) {
                setAttempted(true);
                return;
              }
              save();
            }}
          >
            {tx ? t('action.save') : t('action.add')}
          </Button>
        </div>
        )}
      </Sheet>

      <CounterpartySheet
        open={counterOpen}
        onOpenChange={setCounterOpen}
        excludeAccountId={effectiveAccount ?? ''}
        currentLinkedId={linkedAccountId ?? undefined}
        // #309: a staged movement category pins its family Default in
        // the ask — the one-tap answer to the required-counter refusal
        // (same wiring as the detail screen's row)
        defaultFamily={askDefaultFamily(catId)}
        onChoose={(picked) => {
          setLinkedAccountId(picked.id);
          // #133 r5 bijection: a movement category follows the newly
          // picked counter's kind. #228 feedback: counter-FIRST — an
          // uncategorized row fills its special category right away
          // (a deliberate plain category is not this rule's business)
          if (specialCatType(catId) || catId === UNCATEGORIZED_ID) {
            setCatId(movementCatFor(picked.type, isExpense ? -1 : 1));
          }
        }}
        onDetach={() => {
          // the sheet shows the door only while a counterparty is linked
          setLinkedAccountId(null);
          setCatId(detachedCatFor(catId));
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

      {/* #211: the split-categories editor (same sheet as review/detail) —
          the spread stays ONE transaction; the amount typed so far is the
          money being partitioned. #228: a lone ◆ pick asks its
          counterparty inside the editor — the form-level answer */}
      <CatsSheet
        open={catsSheetOpen}
        onOpenChange={setCatsSheetOpen}
        subject={{
          id: tx?.id ?? 'new',
          label: merchant.trim() || undefined,
          catId,
          cats: stagedCats ?? undefined,
          amountCents: Math.abs(cents ?? 0),
          linkedAccountId: linkedAccountId ?? undefined,
        }}
        currency={formCurrency}
        direction={isExpense ? 'debit' : 'credit'}
        // #256 (user ss): the form's resolved type gates the picker like the
        // detail screen's does — a brokerage row stops offering Groceries
        txType={effectiveType}
        title={t('split.catsTitle')}
        includePct
        excludeAccountId={effectiveAccount ?? ''}
        askDisabled={!!ownStamp}
        onApply={(entries) => {
          if (entries.length === 1) {
            setStagedCats(null);
            setCatId(entries[0].catId);
            // a single entry's link (answered in the editor) IS the
            // row's counterparty — #218: a BARE entry clears it too
            setLinkedAccountId(entries[0].linkedAccountId ?? null);
            return;
          }
          setStagedCats(entries);
          const primary = entries.reduce((best, e) => (e.amountCents > best.amountCents ? e : best), entries[0]);
          setCatId(primary.catId);
          // the entries own their counterparties now — the whole-row
          // link moved into its entry when the spread was seeded
          setLinkedAccountId(null);
        }}
      />

    </>
  );
}
