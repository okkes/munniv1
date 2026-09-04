import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { txTitle } from '@/lib/text';
import { setDebtHandoff } from '@/features/debts/handoff';
import { DebtHandoffInterstitial } from '@/features/debts/DebtHandoffInterstitial';
import { useData } from '@/app/data';
import { propagateRecurringCategory, useRecurringOps } from '@/application/recurring';
import { useSpaceAccounts } from '@/application/transactions';
import { specialCatType } from '@/domain/categories';
import { counterTypesFor } from '@/domain/txType';
import { CategoryPicker } from '@/features/categories/CategoryPicker';
import { catName, useCategories } from '@/features/categories/useCategories';
import type { RecurringSuggestion } from '@/domain/detectRecurring';
import type { RecurringEvery, RecurringKind, RecurringRow } from '@/db/types';
import { BrandIconPicker } from './BrandIconPicker';
import { KIND_ICON } from './RecurringVisual';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';

const NOTIFY_CHOICES = [0, 1, 3, 7];

export interface FormState {
  id: string | null;
  name: string;
  kind: RecurringKind;
  amount: string; // major units as typed
  logo?: string;
  every: RecurringEvery;
  /** custom cadence: repeat every N units, anchored on firstDue */
  everyN: number;
  custom: boolean;
  firstDue: string; // ISO date, '' until picked
  dueDay: number;
  dueMonth: number;
  luxury: boolean;
  notify: number;
  active: boolean;
  merchantKey?: string;
  catId?: string;
  /** #274: counterparty account for a special category */
  linkedAccountId?: string;
}

export const emptyForm = (): FormState => ({
  id: null,
  name: '',
  kind: 'subscription',
  amount: '',
  every: 'month',
  everyN: 1,
  custom: false,
  firstDue: '',
  dueDay: 1,
  dueMonth: 1,
  luxury: false,
  notify: 0,
  active: true,
});

/** quick-add prefill (user request): the shortcut inside review / tx
 *  detail derives as much as possible from the transaction itself —
 *  name, amount and the due day from the transaction's own date */
export const formFromTx = (tx: { merchant: string; titleOverride?: string; amountCents: number; date: string }): FormState => ({
  ...emptyForm(),
  name: txTitle(tx),
  amount: (Math.abs(tx.amountCents) / 100).toFixed(2),
  firstDue: tx.date,
  dueDay: Math.min(28, Number(tx.date.slice(8, 10)) || 1),
  dueMonth: Number(tx.date.slice(5, 7)) || 1,
});

export const formFromRec = (rec: RecurringRow): FormState => ({
  id: rec.id,
  name: rec.name,
  kind: rec.kind,
  amount: (rec.amountCents / 100).toFixed(2),
  logo: rec.logo || undefined,
  every: rec.every,
  everyN: Math.max(1, rec.everyN ?? 1),
  custom: rec.every === 'week' || (rec.everyN ?? 1) > 1,
  firstDue: rec.since ?? '',
  dueDay: rec.dueDay,
  dueMonth: rec.dueMonth ?? 1,
  luxury: rec.luxury === 1,
  notify: rec.notifyDaysBefore ?? 0,
  active: rec.active === 1,
  merchantKey: rec.merchantKey,
  catId: rec.catId,
  linkedAccountId: rec.linkedAccountId,
});

export const formFromSuggestion = (s: RecurringSuggestion): FormState => ({
  ...emptyForm(),
  name: s.name,
  kind: s.every === 'year' ? 'fixed' : 'subscription',
  amount: (s.amountCents / 100).toFixed(2),
  every: s.every,
  dueDay: s.dueDay,
  merchantKey: s.merchantKey,
});

// #195: the first failing requirement names the blocker
const blockerKeyFor = (form: FormState): 'form.needName' | 'form.needAmount' | 'form.needDate' | null => {
  if (!form.name.trim()) return 'form.needName';
  if (!form.amount) return 'form.needAmount';
  if (form.custom && !form.firstDue) return 'form.needDate';
  return null;
};

/** stable reseed key: the record's identity, 'new' for drafts (S3776) */
const seedKeyOf = (initial: FormState | null): string | null => (initial === null ? null : (initial.id ?? 'new'));

/** #195 field rings, computed off the component (S3776) */
function recformRings(attempted: boolean, form: FormState | null) {
  if (!attempted || form === null) return { nameBad: false, amountBad: false, dateBad: false };
  return { nameBad: !form.name.trim(), amountBad: !form.amount, dateBad: !form.firstDue };
}

/** custom cadences anchor on the first due date; presets keep the
 *  no-auto-`since` rule so a cost added mid-period still counts for the
 *  whole current period (and accepted suggestions own their history) */
function cadenceFieldsFor(form: FormState) {
  if (form.custom) {
    return {
      every: form.every,
      everyN: Math.min(99, Math.max(1, Math.round(form.everyN) || 1)),
      since: form.firstDue,
      dueDay: Number(form.firstDue.slice(8, 10)),
      dueMonth: Number(form.firstDue.slice(5, 7)),
    };
  }
  return {
    every: form.every,
    everyN: 1, // overwrite a previous custom cadence
    since: '', // '' clears — an absent field would not sync
    dueDay: Math.min(31, Math.max(1, form.dueDay || 1)),
    ...(form.every === 'year' ? { dueMonth: Math.min(12, Math.max(1, form.dueMonth || 1)) } : {}),
  };
}

interface RecurringFormSheetProps {
  /** non-null opens the sheet with this draft; the sheet owns edits from there */
  initial: FormState | null;
  onClose: () => void;
  /** e.g. the detail screen leaves after its record was deleted */
  onDeleted?: () => void;
  /** create-and-return hosts (review, tx detail) get the saved row's id
   *  HERE — sniffing the live-query list after close is a lost race */
  onSaved?: (id: string) => void;
  /** #257: an accepted SUGGESTION hands off to the occurrence review
   *  (pick which charges belong) instead of blind auto-reconcile; hosts
   *  without one keep the old reconcile behavior */
  onAccepted?: (id: string) => void;
}

/**
 * The one create/edit form for recurring costs, shared by the recurring
 * tab (add), the detail screen (edit) and the suggestions screen
 * (accept). Owns its pickers and persistence.
 */
export function RecurringFormSheet({ initial, onClose, onDeleted, onSaved, onAccepted }: Readonly<RecurringFormSheetProps>) {
  const { t, lang } = useLang();
  const ops = useRecurringOps();
  const navigate = useNavigate();
  const { store, repo, spaceId } = useData();
  const cats = useCategories();
  const accounts = useSpaceAccounts();
  const [form, setForm] = useState<FormState | null>(null);
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  // #274: the counterparty pick for special categories
  const [counterPickerOpen, setCounterPickerOpen] = useState(false);
  const [debtIntent, setDebtIntent] = useState(false);
  // what the category was when the sheet opened -- propagation fires
  // only on a real change
  const initialCatIdRef = useRef<string | undefined>(undefined);
  const initialLinkRef = useRef<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // free-typed drafts so the '1' can be deleted while editing; clamped on blur
  const [dueDayText, setDueDayText] = useState('1');
  const [everyNText, setEveryNText] = useState('1');
  // #195: tappable — an invalid tap names the blocker
  const [attempted, setAttempted] = useState(false);

  // seed on open or when the underlying RECORD changes — never on object
  // identity: callers rebuild `initial` per render (formFromTx in review),
  // and on the native SQL backend every sync cycle re-emits fresh objects.
  // The identity-keyed reseed kept overwriting mid-typing edits (iOS ss).
  const seedKey = seedKeyOf(initial);
  const seededRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (seededRef.current === seedKey) return;
    seededRef.current = seedKey;
    initialCatIdRef.current = initial?.catId;
    initialLinkRef.current = initial?.linkedAccountId;
    setForm(initial);
    setDueDayText(String(initial?.dueDay ?? 1));
    setEveryNText(String(initial?.everyN ?? 1));
    setConfirmDelete(false);
    setAttempted(false);
    // dirty baseline (user request 2026-08-01): edited forms ask before
    // a stray dismissal drops them
    baselineRef.current = JSON.stringify(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);
  const baselineRef = useRef('');
  const dirty = form !== null && JSON.stringify(form) !== baselineRef.current;
  const blockerKey = form === null ? null : blockerKeyFor(form);
  // #274: which accounts the category's counter matrix allows
  const counterChoices = (() => {
    if (!form?.catId || !specialCatType(form.catId)) return [];
    const allowed = counterTypesFor(form.catId);
    return (accounts ?? []).filter((acct) => !allowed || allowed.includes(acct.type));
  })();
  // #195 rings, precomputed once (S3776: the JSX kept re-branching)
  const { nameBad, amountBad, dateBad } = recformRings(attempted, form);

  const save = async () => {
    if (form === null || blockerKeyFor(form) !== null) return;
    const amountCents = Math.round(Number.parseFloat(form.amount.replace(',', '.')) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return;
    const fromSuggestion = form.id === null && !!form.merchantKey;
    const cadence = cadenceFieldsFor(form);
    const savedId = await ops.save(form.id, {
      name: form.name.trim(),
      kind: form.kind,
      // #332 (user): fixed never saves luxury — heals pre-#332 records
      // whose hidden flag would otherwise silently persist through an edit
      luxury: form.luxury && form.kind !== 'fixed' ? 1 : 0,
      amountCents,
      icon: KIND_ICON[form.kind],
      logo: form.logo ?? '', // '' clears — an absent field would not sync
      ...cadence,
      active: form.active ? 1 : 0,
      notifyDaysBefore: form.notify || undefined,
      merchantKey: form.merchantKey,
      catId: form.catId ?? '', // '' clears -- an absent field would not sync
      linkedAccountId: form.linkedAccountId ?? '', // #274 — same clear rule
    });
    // the recurring OWNS its transactions' category (user rule
    // 2026-07-28): a changed category re-files every linked transaction;
    // #274: a changed counterparty rides the same propagation
    if (form.id && (form.catId !== initialCatIdRef.current || form.linkedAccountId !== initialLinkRef.current)) {
      await propagateRecurringCategory(store, repo, spaceId, form.id, form.catId, form.linkedAccountId || undefined).catch(
        () => undefined,
      );
    }
    onSaved?.(savedId);
    onClose();
    // an accepted suggestion should immediately own its past payments —
    // #257: hosts with an occurrence review take over (the user picks
    // which charges belong); others keep the blind reconcile
    if (fromSuggestion) {
      if (onAccepted) onAccepted(savedId);
      else await ops.reconcile();
    }
  };

  const removeCurrent = async () => {
    if (!form?.id) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await ops.remove(form.id);
    onClose();
    onDeleted?.();
  };

  return (
    <>
      <Sheet
        open={form !== null}
        onOpenChange={(open) => !open && onClose()}
        title={form?.id ? t('recurring.edit') : t('recurring.add')}
        size="tall"
        dirty={dirty}
      >
        {form && (
          <div className="flex flex-col gap-3 pt-1">
            <input
              data-testid="recform-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('recurring.name')}
              aria-invalid={nameBad}
              className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(nameBad)}`}
            />
            <div className="flex gap-2">
              {/* #332 (user): a fixed cost is never a luxury — picking it
                  clears the flag so no hidden-but-set value survives */}
              <Chip testId="recform-kind-fixed" selected={form.kind === 'fixed'} onClick={() => setForm({ ...form, kind: 'fixed', luxury: false })}>
                {t('recurring.kindFixed')}
              </Chip>
              <Chip testId="recform-kind-subscription" selected={form.kind === 'subscription'} onClick={() => setForm({ ...form, kind: 'subscription' })}>
                {t('recurring.kindSub')}
              </Chip>
              {/* a structural cost that pays something OFF is a DEBT —
                  picking it asks first on a fullscreen Mina moment, then
                  hands this form's facts over to debt creation (user
                  design 2026-07-28, fullscreen ask 2026-07-29) */}
              <Chip testId="recform-kind-debt" selected={false} onClick={() => setDebtIntent(true)}>
                {t('recurring.kindDebt')}
              </Chip>
            </div>

            {/* the recurring OWNS its transactions' category (user rule
                2026-07-28) — linked rows re-file here automatically */}
            <button
              data-testid="recform-cat"
              onClick={() => setCatPickerOpen(true)}
              className="m-tap flex h-11 w-full items-center gap-2 rounded-input border border-line bg-surface px-3 text-left text-[14px] text-ink"
            >
              <Icon name={form.catId ? cats.byId(form.catId).icon : 'shape-outline'} size={17} color="var(--m-accent-deep)" />
              <span className="min-w-0 flex-1 truncate">{form.catId ? catName(cats.byId(form.catId), t) : t('recurring.pickCat')}</span>
              <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
            </button>

            {/* #274 (user): a special category carries a counterparty —
                transactions attached to this recurring inherit it */}
            {form.catId && specialCatType(form.catId) && (
              <button
                data-testid="recform-counter"
                onClick={() => setCounterPickerOpen(true)}
                className="m-tap flex h-11 w-full items-center gap-2 rounded-input border border-line bg-surface px-3 text-left text-[14px] text-ink"
              >
                <Icon name="swap-horizontal" size={17} color="var(--m-accent-deep)" />
                <span className={`min-w-0 flex-1 truncate${form.linkedAccountId ? '' : ' text-ink-4'}`}>
                  {accounts?.find((a) => a.id === form.linkedAccountId)?.name ?? t('recurring.pickCounter')}
                </span>
                <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
              </button>
            )}

            <div className="m-cap px-1">{t('recurring.amount')}</div>
            <input
              data-testid="recform-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
              aria-invalid={amountBad}
              className={`h-12 w-full rounded-input border border-line bg-surface px-4 font-mono text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(amountBad)}`}
            />

            <div className="m-cap px-1">{t('recurring.iconTitle')}</div>
            <button
              data-testid="recform-logo-open"
              onClick={() => setBrandPickerOpen(true)}
              className="m-tap flex h-12 w-full items-center gap-3 rounded-input border border-line bg-surface px-4 text-left text-[14px]"
            >
              {form.logo ? (
                <img src={form.logo} alt="" className="h-6 w-6 object-contain" />
              ) : (
                <Icon name={KIND_ICON[form.kind]} size={18} color="var(--m-ink-3)" />
              )}
              <span className={`min-w-0 flex-1 truncate ${form.logo ? 'text-ink' : 'text-ink-3'}`}>
                {form.logo ? t('recurring.iconChosen') : t('recurring.iconNone')}
              </span>
              <Icon name="chevron-down" size={17} color="var(--m-ink-4)" />
            </button>

            <div className="m-cap px-1">{t('recurring.cadence')}</div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip
                testId="recform-every-month"
                selected={!form.custom && form.every === 'month'}
                onClick={() => setForm({ ...form, custom: false, every: 'month', everyN: 1 })}
              >
                {t('recurring.everyMonth')}
              </Chip>
              <Chip
                testId="recform-every-year"
                selected={!form.custom && form.every === 'year'}
                onClick={() => setForm({ ...form, custom: false, every: 'year', everyN: 1 })}
              >
                {t('recurring.everyYear')}
              </Chip>
              <Chip testId="recform-every-custom" selected={form.custom} onClick={() => setForm({ ...form, custom: true })}>
                {t('recurring.everyCustom')}
              </Chip>
            </div>
            {form.custom ? (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  {t('recurring.everyLabel')}
                  <input
                    data-testid="recform-everyn"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    value={everyNText}
                    onChange={(e) => setEveryNText(e.target.value)}
                    onBlur={() => {
                      const clamped = Math.min(99, Math.max(1, Math.round(Number(everyNText)) || 1));
                      setForm({ ...form, everyN: clamped });
                      setEveryNText(String(clamped));
                    }}
                    className="h-10 w-16 rounded-input border border-line bg-surface px-3 text-center text-[14px] text-ink outline-none"
                  />
                  <select
                    data-testid="recform-every-unit"
                    value={form.every}
                    onChange={(e) => setForm({ ...form, every: e.target.value as RecurringEvery })}
                    className="h-10 rounded-input border border-line bg-surface px-2 text-[13px] text-ink"
                  >
                    <option value="week">{t('recurring.unitWeeks')}</option>
                    <option value="month">{t('recurring.unitMonths')}</option>
                    <option value="year">{t('recurring.unitYears')}</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  {t('recurring.firstDue')}
                  <input
                    data-testid="recform-firstdue"
                    type="date"
                    value={form.firstDue}
                    onChange={(e) => setForm({ ...form, firstDue: e.target.value })}
                    aria-invalid={dateBad}
                    className={`h-10 rounded-input border border-line bg-surface px-3 text-[13px] text-ink outline-none${blockerRing(dateBad)}`}
                  />
                </label>
              </div>
            ) : (
              <label className="flex items-center gap-3 text-[13px] text-ink-2">
                {t('recurring.dueDay')}
                <input
                  data-testid="recform-dueday"
                  type="number"
                  min={1}
                  max={31}
                  value={dueDayText}
                  onChange={(e) => setDueDayText(e.target.value)}
                  onBlur={() => {
                    const clamped = Math.min(31, Math.max(1, Number(dueDayText) || 1));
                    setForm({ ...form, dueDay: clamped });
                    setDueDayText(String(clamped));
                  }}
                  className="h-10 w-20 rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none"
                />
                {form.every === 'year' && (
                  <>
                    {t('recurring.dueMonth')}
                    <select
                      data-testid="recform-duemonth"
                      value={form.dueMonth}
                      onChange={(e) => setForm({ ...form, dueMonth: Number(e.target.value) })}
                      className="h-10 rounded-input border border-line bg-surface px-2 text-[13px] text-ink"
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {new Date(2026, i, 1).toLocaleDateString(LOCALES[lang], { month: 'short' })}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </label>
            )}

            {/* #332 (user): fixed costs hide the luxury toggle entirely */}
            {form.kind !== 'fixed' && (
              <button
                data-testid="recform-luxury"
                onClick={() => setForm({ ...form, luxury: !form.luxury })}
                className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-ink">{t('recurring.luxury')}</span>
                  <span className="block text-[11px] text-ink-4">{t('recurring.luxuryHint')}</span>
                </span>
                <span
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${form.luxury ? 'justify-end bg-accent' : 'justify-start bg-bg-2'}`}
                >
                  <span className="h-5 w-5 rounded-full bg-surface shadow" />
                </span>
              </button>
            )}

            <div className="m-cap px-1">{t('recurring.notify')}</div>
            <div className="flex flex-wrap gap-2">
              {NOTIFY_CHOICES.map((n) => (
                <Chip key={n} testId={`recform-notify-${n}`} selected={form.notify === n} onClick={() => setForm({ ...form, notify: n })}>
                  {n === 0 ? t('recurring.notifyOff') : t('recurring.notifyDays', { n })}
                </Chip>
              ))}
            </div>

            {form.id && (
              <button
                data-testid="recform-active"
                onClick={() => setForm({ ...form, active: !form.active })}
                className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1 text-[14px] text-ink">{t('recurring.activeLabel')}</span>
                <span
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${form.active ? 'justify-end bg-accent' : 'justify-start bg-bg-2'}`}
                >
                  <span className="h-5 w-5 rounded-full bg-surface shadow" />
                </span>
              </button>
            )}

            <FormBlockerNote show={attempted && blockerKey !== null} text={blockerKey ? t(blockerKey) : ''} testId="recform-save-blocker" />
            <Button
              data-testid="recform-save"
              onClick={() => {
                if (blockerKey !== null) {
                  setAttempted(true);
                  return;
                }
                void save();
              }}
            >
              {form.id ? t('action.save') : t('action.add')}
            </Button>
            {form.id && (
              <Button variant="danger" data-testid="recform-delete" onClick={() => void removeCurrent()}>
                {confirmDelete ? t('action.confirm') : t('action.delete')}
              </Button>
            )}
          </div>
        )}
      </Sheet>

      <BrandIconPicker
        open={brandPickerOpen}
        onOpenChange={setBrandPickerOpen}
        initialQuery={form?.name ?? ''}
        onPick={({ logo }) => {
          if (form) setForm({ ...form, logo: logo ?? undefined });
        }}
      />
      <CategoryPicker
        open={catPickerOpen}
        onOpenChange={setCatPickerOpen}
        direction="debit"
        selectedId={form?.catId}
        onPick={(catId) => {
          // #274: a counter only means something under a special category
          if (form) setForm({ ...form, catId, ...(specialCatType(catId) ? {} : { linkedAccountId: undefined }) });
        }}
      />
      {/* #274 (user): the counterparty pick — accounts the category's
          matrix allows (sheet SIBLING, never nested — portal order) */}
      <Sheet open={counterPickerOpen} onOpenChange={setCounterPickerOpen} title={t('recurring.counterTitle')} size="form">
        <div className="flex flex-col gap-2 pt-1" data-testid="recform-counter-sheet">
          {counterChoices.map((acct) => (
            <button
              key={acct.id}
              data-testid={`recform-counter-acct-${acct.id}`}
              onClick={() => {
                if (form) setForm({ ...form, linkedAccountId: acct.id });
                setCounterPickerOpen(false);
              }}
              className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[14px] text-ink"
            >
              <Icon name="bank-outline" size={18} color="var(--m-accent-deep)" />
              <span className="min-w-0 flex-1 truncate">{acct.name}</span>
              {form?.linkedAccountId === acct.id && <Icon name="check" size={16} color="var(--m-accent-deep)" />}
            </button>
          ))}
          {counterChoices.length === 0 && (
            <p className="px-1 py-4 text-center text-[13px] text-ink-4" data-testid="recform-counter-empty">
              {t('recurring.counterEmpty')}
            </p>
          )}
          {form?.linkedAccountId && (
            <Button
              variant="outline"
              data-testid="recform-counter-clear"
              onClick={() => {
                if (form) setForm({ ...form, linkedAccountId: undefined });
                setCounterPickerOpen(false);
              }}
            >
              {t('recurring.counterNone')}
            </Button>
          )}
        </div>
      </Sheet>
      {debtIntent && form && (
        <DebtHandoffInterstitial
          onStay={() => setDebtIntent(false)}
          onContinue={() => {
            const cents = Math.round(Number.parseFloat(form.amount.replace(',', '.')) * 100);
            // v2: the recurring's amount and rhythm are the loan's
            // PAYMENT plan (they were never its original size)
            setDebtHandoff({
              name: form.name.trim() || undefined,
              paymentCents: Number.isFinite(cents) && cents > 0 ? cents : undefined,
              paymentEvery: form.every,
              // #190: the due day rides along into the payment plan
              paymentDay: form.every !== 'week' ? form.dueDay || undefined : undefined,
              merchantKey: form.merchantKey ?? undefined,
            });
            setDebtIntent(false);
            onClose();
            void navigate({ to: '/debts' });
          }}
        />
      )}
    </>
  );
}
