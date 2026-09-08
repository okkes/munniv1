import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useSpaceAccounts } from '@/application/transactions';
import { useData } from '@/app/data';
import { typeDef } from '@/features/accounts/accountTypes';
import { AddAccountChooser } from '@/features/accounts/AddAccountChooser';
import { TX_KINDS, kindOf } from '@/domain/txKind';
import type { TxKind } from '@/domain/txKind';
import { typeForLinkedAccount } from '@/domain/txType';
import type { AccountType, TxType } from '@/db/types';
import { useLang } from '@/i18n';
import { fmtCents } from '@/lib/money';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { TX_TYPE_VISUAL } from './TxTypeSheet';

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

/** the family members offered by the "no counter account" exit —
 *  funding included (user correction 2026-08-01): money for a shared
 *  bank account held with family or friends is only ever picked by name */
const BARE_TYPES: readonly TxType[] = ['saving', 'investment', 'debtPayment', 'funding', 'transfer'];

/**
 * The counterparty picker for transfers (user redesign): searchable like
 * the recurring/event pickers, with a quick-create door — a missing
 * savings pot or loan becomes a manual account without leaving the flow.
 * The "no counter account" exit (arc 2) replaces the old hard rule: the
 * user can name the family member directly — the row is typed and files
 * the locked sub by sign, but stays a reporting label that moves no
 * other balance.
 */
export function CounterpartySheet({
  open,
  onOpenChange,
  excludeAccountId,
  currentLinkedId,
  onChoose,
  onBare,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeAccountId: string;
  currentLinkedId?: string;
  onChoose: (account: { id: string; type: AccountType }) => void;
  onBare?: (type: TxType) => void;
}>) {
  const { t, lang } = useLang();
  const { store, spaceId } = useData();
  const allAccounts = useSpaceAccounts();
  const [bareOpen, setBareOpen] = useState(false);
  // the FULL creation flow (bank connect / statement import / manual),
  // one sheet deeper — search and quick-create retired (user redesign
  // 2026-08-01: the field confused, and Create covers the missing-
  // account case properly)
  const [chooserOpen, setChooserOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBareOpen(false);
  }, [open]);

  const candidates = useMemo(
    () => (allAccounts ?? []).filter((a) => a.id !== excludeAccountId && !a.archived),
    [allAccounts, excludeAccountId],
  );

  // a loan account is a DEBT's backing account (1:1, user design
  // 2026-07-28): transferring to it IS paying that debt off — the row
  // says which one, so picking the account is picking the debt
  const debts = useQuery(store, async () => (await store.bySpace('debt', spaceId)).filter((d) => d.deleted === 0), [spaceId]);
  const debtByAccount = useMemo(() => new Map((debts ?? []).filter((d) => d.accountId).map((d) => [d.accountId!, d])), [debts]);

  const choose = (account: { id: string; type: AccountType }) => {
    onChoose(account);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('tx.counterparty')} size="form">
      <p className="pb-2 text-[12px] text-ink-3">{t('tx.counterAccountHint')}</p>
      {!bareOpen && (
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="counter-accounts">
          {candidates.map((account) => (
            <button
              key={account.id}
              data-testid={`counter-pick-${account.id}`}
              onClick={() => choose({ id: account.id, type: account.type })}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
            >
              <Icon name={typeDef(account.type).icon} size={18} color="var(--m-ink-2)" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">{account.name}</span>
                {/* what picking this account MAKES the transaction */}
                <span className="block text-[11px] text-ink-4">
                  {t(`tx.type.${typeForLinkedAccount(account.type)}`)}
                  {debtByAccount.has(account.id) && (
                    <span className="text-accent-deep" data-testid={`counter-debt-${account.id}`}>
                      {' '}· {t('tx.paysDebt', { name: debtByAccount.get(account.id)!.name })}
                    </span>
                  )}
                </span>
              </span>
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
      )}
      {/* the ONE creation door (user redesign 2026-08-01): the full
          chooser — bank connect, statement import (in place) or manual */}
      {!bareOpen && (
        <button
          data-testid="counter-full-setup"
          onClick={() => setChooserOpen(true)}
          className="m-tap mt-2 flex w-full items-center gap-2 rounded-card border border-dashed border-line bg-transparent px-4 py-3 text-left text-[14px] font-medium text-accent-deep"
        >
          <Icon name="plus-circle-outline" size={18} />
          {t('tx.counterFullSetup')}
        </button>
      )}
      {/* the "no counter account" exit (arc 2): label the movement without
          modeling the other side — the caller types the row directly */}
      {!bareOpen && onBare && (
        <button
          data-testid="counter-none"
          onClick={() => setBareOpen(true)}
          className="m-tap mt-2 flex w-full items-center gap-2 rounded-card border border-dashed border-line bg-transparent px-4 py-3 text-left text-[14px] font-medium text-ink-2"
        >
          <Icon name="link-off" size={18} />
          {t('tx.counterNone')}
        </button>
      )}
      {bareOpen && onBare && (
        <div className="mt-1" data-testid="counter-bare-options">
          <p className="px-1 pb-2 text-[12px] text-ink-3">{t('tx.counterNoneHint')}</p>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {BARE_TYPES.map((type) => (
              <button
                key={type}
                data-testid={`counter-bare-${type}`}
                onClick={() => {
                  onBare(type);
                  onOpenChange(false);
                }}
                className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
              >
                <Icon name={TX_TYPE_VISUAL[type].icon} size={18} color={TX_TYPE_VISUAL[type].color} />
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{t(`tx.type.${type}`)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <AddAccountChooser
        open={chooserOpen}
        onOpenChange={setChooserOpen}
        onCreated={(account) => choose(account)}
      />
    </Sheet>
  );
}
