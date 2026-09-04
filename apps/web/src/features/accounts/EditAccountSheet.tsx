import { useState } from 'react';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { logActivity } from '@/application/activity';
import { newestTxDate } from '@/application/accounts';
import { isDebtTracked } from '@/domain/debts';
import { fmtCents, parseCents } from '@/lib/money';
import type { AccountRow, RecurringEvery } from '@/db/types';
import { BrandIconPicker } from '@/features/recurring/BrandIconPicker';
import { Button } from '@/ui/Button';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { sourceKeyFor } from './AttachSheet';
import { AccountTypeRow } from './AccountTypeRow';
import { isLiability, manualBalanceDate, typeDef } from './accountTypes';
import { isCustomCadence, LoanCadenceControl, parsedDueDay } from './LoanCadenceControl';

/** an emptied field must CLEAR the row (null); undefined would drop from
 *  the op and leave the stale value standing */
const orClear = <T,>(value: T | undefined): T | null => value ?? null;

/** #269: the signed cents a save would ADD to the stored balance — null
 *  while the field is unparseable or matches the row (nothing to record) */
const balanceDelta = (account: AccountRow, balance: string, negative: boolean): number | null => {
  const cents = parseCents(balance || '');
  if (cents === null) return null;
  const signed = negative ? -Math.abs(cents) : Math.abs(cents);
  return signed === account.balanceCents ? null : signed - account.balanceCents;
};

/** the sheet's whole draft, computed from the row (S3776: the seeding
 *  branches live out of the component) */
const seedFrom = (account: AccountRow) => ({
  name: account.name,
  balance: (Math.abs(account.balanceCents) / 100).toFixed(2),
  negative: account.balanceCents < 0 || (account.balanceCents === 0 && isLiability(account.type)),
  logo: account.logo || undefined,
  iban: account.iban ?? '',
  original: account.originalCents ? (account.originalCents / 100).toFixed(2) : '',
  apr: account.interestPctYear === undefined ? '' : String(account.interestPctYear),
  payment: account.paymentCents ? (account.paymentCents / 100).toFixed(2) : '',
  payDay: account.paymentDay ? String(account.paymentDay) : '',
  payEvery: account.paymentEvery ?? ('month' as RecurringEvery),
  payEveryN: Math.max(1, account.paymentEveryN ?? 1),
  payCustom: isCustomCadence(account.paymentEvery, account.paymentEveryN),
  note: account.note ?? '',
  // the switch shows the EFFECTIVE state (type default or explicit)
  track: isDebtTracked(account),
});

/**
 * The one editing surface for an account — name, balance (with an
 * explicit −/+ sign: an overpaid credit card IS positive, user ruling
 * 2026-07-31), icon, delete. Liability types carry their debt story
 * here too (loans v2): interest, original size, payment plan, note and
 * the "track as debt" switch. Bank-fed accounts keep name/icon/story
 * editable but their balance is the bank's and the row can't be
 * deleted from here. Writes target the ACCOUNT's own space.
 */
/** dirty vs the row-derived seed (S3776: out of the component) */
function editedVsSeed(
  seed: ReturnType<typeof seedFrom>,
  now: {
    name: string; balance: string; negative: boolean; iban: string; original: string; apr: string;
    payment: string; payDay: string; payEvery: RecurringEvery; payEveryN: number; note: string; track: boolean;
  },
  manual: boolean,
  liability: boolean,
): boolean {
  if (now.name !== seed.name) return true;
  if (manual && (now.balance !== seed.balance || now.negative !== seed.negative)) return true;
  if (!liability) return false;
  return (
    now.iban !== seed.iban || now.original !== seed.original || now.apr !== seed.apr ||
    now.payment !== seed.payment || now.payDay !== seed.payDay || now.payEvery !== seed.payEvery ||
    now.payEveryN !== seed.payEveryN || now.note !== seed.note || now.track !== seed.track
  );
}

export function EditAccountSheet({ account, onClose }: Readonly<{ account: AccountRow | null; onClose: () => void }>) {
  const { t, lang } = useLang();
  const { store, repo } = useData();
  const [seedId, setSeedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [negative, setNegative] = useState(false);
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const [logoOpen, setLogoOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // the debt story (loans v2) — liability accounts only
  const [iban, setIban] = useState('');
  const [original, setOriginal] = useState('');
  const [apr, setApr] = useState('');
  const [payment, setPayment] = useState('');
  const [payDay, setPayDay] = useState('');
  const [payEvery, setPayEvery] = useState<RecurringEvery>('month');
  const [payEveryN, setPayEveryN] = useState(1);
  const [payCustom, setPayCustom] = useState(false);
  const [note, setNote] = useState('');
  const [track, setTrack] = useState(false);

  // seed during render, keyed on the account id (house rule: no effect —
  // a late flush could clobber typing that landed right after the open)
  if (account && account.id !== seedId) {
    setSeedId(account.id);
    const seed = seedFrom(account);
    setName(seed.name);
    setBalance(seed.balance);
    setNegative(seed.negative);
    setLogo(seed.logo);
    setIban(seed.iban);
    setOriginal(seed.original);
    setApr(seed.apr);
    setPayment(seed.payment);
    setPayDay(seed.payDay);
    setPayEvery(seed.payEvery);
    setPayEveryN(seed.payEveryN);
    setPayCustom(seed.payCustom);
    setNote(seed.note);
    setTrack(seed.track);
  }
  if (!account && seedId !== null) setSeedId(null); // reopening reseeds

  const manual = account?.source === 'manual';
  const liability = !!account && isLiability(account.type);
  // #269: the delta the save would record as an adjustment row — the
  // note below the field makes the side effect known BEFORE saving
  const adjustDelta = account && manual ? balanceDelta(account, balance, negative) : null;
  // #205: the newest transaction on the account, for the About section
  const newest = useQuery(store, async () => (account ? newestTxDate(store, account.id) : undefined), [account?.id]);

  // dirty vs the row-derived seed: an untouched sheet closes freely, an
  // edited one asks (user request 2026-08-01); the logo saves on pick
  // and stays out of the comparison
  const seedNow = account ? seedFrom(account) : null;
  const dirty =
    !!seedNow &&
    editedVsSeed(seedNow, { name, balance, negative, iban, original, apr, payment, payDay, payEvery, payEveryN, note, track }, manual, liability);

  /** what the liability form asks of the row — empties null-clear */
  const storyChanges = (): Partial<AccountRow> => {
    const originalCents = parseCents(original);
    const paymentCents = parseCents(payment);
    const aprNumber = Number.parseFloat(apr.replace(',', '.'));
    const hasPayment = !!paymentCents && paymentCents > 0;
    return {
      ...(manual ? { iban: orClear(iban.trim() || undefined) as never } : {}),
      originalCents: orClear(originalCents && originalCents > 0 ? originalCents : undefined) as never,
      // 0% is a real answer; only the EMPTY field means "remind me"
      interestPctYear: orClear(Number.isFinite(aprNumber) && aprNumber >= 0 ? aprNumber : undefined) as never,
      paymentCents: orClear(hasPayment ? paymentCents : undefined) as never,
      paymentEvery: orClear(hasPayment ? payEvery : undefined) as never,
      paymentEveryN: orClear(hasPayment && payEveryN > 1 ? payEveryN : undefined) as never,
      // #190: the due day rides the plan; weekly plans carry none
      paymentDay: orClear(hasPayment && payEvery !== 'week' ? parsedDueDay(payDay) : undefined) as never,
      note: orClear(note.trim() || undefined) as never,
      trackAsDebt: track ? 1 : 0,
    };
  };

  const save = () => {
    if (!account || !name.trim()) return;
    const changes: Partial<AccountRow> = { name: name.trim() };
    if (manual) {
      const delta = balanceDelta(account, balance, negative);
      if (delta !== null) {
        changes.balanceCents = account.balanceCents + delta;
        changes.balanceAsOf = manualBalanceDate();
        // #269 (grown from #221's defaults-only rule): EVERY manual
        // balance edit records its delta as an adjustment row, so the
        // ledger explains the jump instead of silently rewriting
        void repo.upsert('transaction', account.spaceId, repo.newId(), {
          accountId: account.id,
          date: manualBalanceDate(),
          amountCents: delta,
          currency: account.currency,
          merchant: t('cat.balanceAdjustment'),
          txType: 'adjustment',
          adjustment: 1,
          catId: 'balanceAdjustment',
          needsReview: 0,
        });
      }
    }
    void repo.upsert('account', account.spaceId, account.id, { ...changes, ...(liability ? storyChanges() : {}) });
    void logActivity(store, repo, account.spaceId, 'accountEdit', name.trim());
    onClose();
  };

  const remove = () => {
    if (!account) return;
    void repo.remove('account', account.spaceId, account.id);
    void logActivity(store, repo, account.spaceId, 'accountRemove', account.name);
    setConfirmRemove(false);
    onClose();
  };

  return (
    <>
      <Sheet open={!!account} onOpenChange={(open) => !open && onClose()} title={t('acct.editAccount')} size={liability ? 'tall' : 'form'} dirty={dirty}>
        <div className="flex flex-col gap-3 pt-1">
          {/* #208: labeled sections, the overview's caption style — the
              form reads as Basics / Balance / loan story / About */}
          <div className="m-cap px-1">{t('acct.sectionBasics')}</div>
          <label className="text-[12px] text-ink-3">
            {t('acct.accountName')}
            <input
              data-testid="acctedit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none"
            />
          </label>
          <button
            data-testid="acctedit-change-icon"
            onClick={() => setLogoOpen(true)}
            className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink"
          >
            {logo ? (
              <img src={logo} alt="" className="h-6 w-6 rounded object-contain" />
            ) : (
              <Icon name={account ? typeDef(account.type).icon : 'bank-outline'} size={20} color="var(--m-ink-3)" />
            )}
            <span className="flex-1">{t('acct.changeIcon')}</span>
            <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
          </button>
          {/* #212: the type, visible and changeable (destructive) */}
          {account && <AccountTypeRow account={account} />}
          {manual && (
            <>
              <div className="m-cap px-1 pt-1">{t('acct.sectionBalance')}</div>
              <div className="flex gap-2">
                {/* #327 r3 (user): halves own their corners — the inset
                    focus ring follows the group's rounding */}
                <div className="flex overflow-hidden rounded-input border border-line">
                  <button
                    data-testid="acctedit-neg"
                    onClick={() => setNegative(true)}
                    className={`m-tap rounded-l-input border-none px-3 text-[13px] font-medium ${negative ? 'bg-negative-soft text-negative' : 'bg-surface text-ink-3'}`}
                  >
                    −
                  </button>
                  <button
                    data-testid="acctedit-pos"
                    onClick={() => setNegative(false)}
                    className={`m-tap rounded-r-input border-none px-3 text-[13px] font-medium ${negative ? 'bg-surface text-ink-3' : 'bg-accent-soft text-accent-deep'}`}
                  >
                    +
                  </button>
                </div>
                <input
                  data-testid="acctedit-balance"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                  inputMode="decimal"
                  placeholder={`${t('acct.balanceNow')} (${account?.currency ?? 'EUR'})`}
                  className="h-12 min-w-0 flex-1 rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4"
                />
              </div>
              {account && adjustDelta !== null && (
                <p className="px-1 text-[11px] leading-snug text-warning" data-testid="acctedit-adjust-note">
                  {t('acct.adjustNote', { delta: fmtCents(adjustDelta, account.currency, lang, { sign: true }) })}
                </p>
              )}
              {account?.balanceAsOf && (
                <p className="px-1 text-[11px] leading-snug text-ink-4" data-testid="acctedit-balance-asof">
                  {t('acct.balanceAsOf', { date: account.balanceAsOf })}
                </p>
              )}
            </>
          )}
          {liability && (
            <>
              {/* the debt story (loans v2): the account IS the loan */}
              <div className="m-cap px-1 pt-1">{t('debts.loanDetails')}</div>
              {manual && (
                <input
                  data-testid="acctedit-iban"
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  placeholder={t('debts.iban')}
                  className="h-12 w-full rounded-input border border-line bg-surface px-4 font-mono text-[13px] text-ink outline-none placeholder:text-ink-4"
                />
              )}
              <div className="flex gap-2">
                <label className="min-w-0 flex-1 text-[12px] text-ink-3">
                  {t('debts.original')}
                  <input
                    data-testid="acctedit-original"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={original}
                    onChange={(e) => setOriginal(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 h-12 w-full rounded-input border border-line bg-surface px-4 font-mono text-[14px] text-ink outline-none placeholder:text-ink-4"
                  />
                </label>
                <label className="min-w-0 flex-1 text-[12px] text-ink-3">
                  {t('debts.apr')}
                  <input
                    data-testid="acctedit-apr"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    value={apr}
                    onChange={(e) => setApr(e.target.value)}
                    placeholder="0.0"
                    className="mt-1 h-12 w-full rounded-input border border-line bg-surface px-4 font-mono text-[14px] text-ink outline-none placeholder:text-ink-4"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <label className="min-w-0 flex-[2] text-[12px] text-ink-3">
                  {t('debts.payment')}
                  <input
                    data-testid="acctedit-payment"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={payment}
                    onChange={(e) => setPayment(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 h-12 w-full rounded-input border border-line bg-surface px-4 font-mono text-[14px] text-ink outline-none placeholder:text-ink-4"
                  />
                </label>
                {/* #190: the plan's due day, like recurring */}
                <label className="min-w-0 flex-1 text-[12px] text-ink-3">
                  {t('debts.dueDay')}
                  <input
                    data-testid="acctedit-payday"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="31"
                    value={payDay}
                    onChange={(e) => setPayDay(e.target.value)}
                    placeholder="—"
                    className="mt-1 h-12 w-full rounded-input border border-line bg-surface px-4 font-mono text-[14px] text-ink outline-none placeholder:text-ink-4"
                  />
                </label>
              </div>
              <LoanCadenceControl
                value={{ every: payEvery, everyN: payEveryN }}
                custom={payCustom}
                onChange={(next, isCustom) => {
                  setPayEvery(next.every);
                  setPayEveryN(next.everyN);
                  setPayCustom(isCustom);
                }}
                testIdPrefix="acctedit"
              />
              <textarea
                data-testid="acctedit-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('debts.note')}
                rows={2}
                className="w-full resize-none rounded-input border border-line bg-surface px-4 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-4"
              />
              {/* membership switch: a loan/mortgage is a debt by nature,
                  a credit card only when the user says so */}
              <label className="flex items-center justify-between rounded-input border border-line bg-surface px-4 py-3 text-[14px] text-ink">
                <span>{t('debts.trackAsDebt')}</span>
                <input
                  data-testid="acctedit-track-debt"
                  type="checkbox"
                  checked={track}
                  onChange={(e) => setTrack(e.target.checked)}
                  className="h-5 w-5 accent-[var(--m-accent)]"
                />
              </label>
            </>
          )}
          {account && (
            <>
              <div className="m-cap px-1 pt-1">{t('acct.sectionAbout')}</div>
              <div className="overflow-hidden rounded-card border border-line bg-surface">
                <div className="flex items-center justify-between gap-3 border-b border-line-2 px-4 py-3 text-[13px] last:border-0" data-testid="acctedit-source">
                  <span className="text-ink-3">{t('acct.source')}</span>
                  <span className="text-ink-2">{t(sourceKeyFor(account))}</span>
                </div>
                {/* #205: where the data ends and the last real movement */}
                {account.dataThroughDate && (
                  <div className="flex items-center justify-between gap-3 border-b border-line-2 px-4 py-3 text-[13px] last:border-0" data-testid="acctedit-datathrough">
                    <span className="text-ink-3">{t('acct.dataThroughLabel')}</span>
                    <span className="font-mono text-[12px] text-ink">{account.dataThroughDate}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 border-b border-line-2 px-4 py-3 text-[13px] last:border-0" data-testid="acctedit-newest-tx">
                  <span className="text-ink-3">{t('acct.newestTx')}</span>
                  <span className="font-mono text-[12px] text-ink">{newest ?? '—'}</span>
                </div>
              </div>
            </>
          )}
          <Button data-testid="acctedit-save" onClick={save} disabled={!name.trim()}>
            {t('action.save')}
          </Button>
          {/* #221: the default accounts are the space's fixtures — no
              delete door; their balance stays adjustable above */}
          {manual && !account?.defaultFor && (
            <Button variant="danger" data-testid="acctedit-delete" onClick={() => setConfirmRemove(true)}>
              {t('action.delete')}
            </Button>
          )}
        </div>
      </Sheet>
      <BrandIconPicker
        open={logoOpen}
        onOpenChange={setLogoOpen}
        initialQuery={account?.name ?? ''}
        onPick={({ logo: picked }) => {
          if (account) {
            void repo.upsert('account', account.spaceId, account.id, { logo: picked ?? (null as never) });
            void logActivity(store, repo, account.spaceId, 'accountEdit', account.name);
            setLogo(picked ?? undefined);
          }
          setLogoOpen(false);
        }}
      />
      {/* aligned destructive confirm (user request): one-tap deletes are
          gone everywhere — sheet + cooldown, same as space/store/bank */}
      <DangerConfirmSheet
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('acct.deleteConfirmTitle')}
        body={t('acct.deleteManualBody')}
        onConfirm={remove}
        testId="acctedit-remove"
      />
    </>
  );
}
