import { useState } from 'react';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { changeAccountType, changeLinkedAccountType } from '@/application/accounts';
import { logActivity } from '@/application/activity';
import type { AccountLinkRow, AccountRow, AccountType } from '@/db/types';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { ACCOUNT_TYPES, typeDef } from './accountTypes';

/**
 * #212 (user): the account TYPE, visible after creation and changeable
 * behind a destructive confirm — the type decides the stamping rules,
 * so changing it resets every affected transaction back to review with
 * a fresh interpretation ("as if added for the first time"); balances,
 * links and pairs are physical facts and survive.
 *
 * r2: the type is a SPACE-scoped fact. A space-owned account carries it
 * on its row (no `link` prop — the manual editor's mode); an ATTACHED
 * account carries it on the accountLink, so pass the `link` and the
 * change lands on this space alone — other spaces keep their own
 * reading, and only THIS space's rows re-review.
 */
export function AccountTypeRow({
  account,
  link,
  readOnly,
}: Readonly<{ account: AccountRow; link?: AccountLinkRow; readOnly?: boolean }>) {
  const { t } = useLang();
  const { store, repo, spaceId } = useData();
  const [pickOpen, setPickOpen] = useState(false);
  const [pendingType, setPendingType] = useState<AccountType | null>(null);
  const [busy, setBusy] = useState(false);
  const current = link ? (link.type ?? account.type) : account.type;

  const confirm = async () => {
    if (!pendingType || busy) return;
    setBusy(true);
    try {
      if (link) await changeLinkedAccountType(store, repo, spaceId, link, pendingType);
      else await changeAccountType(store, repo, account, pendingType);
      void logActivity(store, repo, spaceId, 'accountEdit', `${account.name} → ${t(typeDef(pendingType).labelKey)}`);
      setPendingType(null);
      setPickOpen(false);
    } finally {
      setBusy(false);
    }
  };

  // funding pots and munni's own default ledgers never change type
  const locked = readOnly || current === 'funding' || !!account.defaultFor;

  return (
    <>
      <button
        data-testid="account-type-row"
        disabled={locked}
        onClick={() => setPickOpen(true)}
        className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[14px] text-ink disabled:opacity-60"
      >
        <Icon name={typeDef(current).icon} size={20} color="var(--m-ink-3)" />
        <span className="min-w-0 flex-1 truncate">{t(typeDef(current).labelKey)}</span>
        <span className="text-[11px] text-ink-4">{t('acct.typeRow')}</span>
        {!locked && <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />}
      </button>

      <Sheet open={pickOpen} onOpenChange={setPickOpen} title={t('acct.typeRow')} size="tall" dragHandle>
        <p className="pb-2 text-[12px] leading-relaxed text-ink-3">{t('acct.typeChangeHint')}</p>
        <div className="grid grid-cols-2 gap-2" data-testid="account-type-grid">
          {ACCOUNT_TYPES.filter((def) => def.type !== 'funding').map((def) => (
            <button
              key={def.type}
              data-testid={`account-type-pick-${def.type}`}
              onClick={() => {
                if (def.type === current) setPickOpen(false);
                else setPendingType(def.type);
              }}
              className={`m-tap flex flex-col items-start gap-2 rounded-card border p-4 text-left ${
                def.type === current ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface'
              }`}
            >
              <Icon name={def.icon} size={22} color="var(--m-accent)" />
              <span className="text-[13px] font-medium text-ink">{t(def.labelKey)}</span>
            </button>
          ))}
        </div>
      </Sheet>

      <DangerConfirmSheet
        open={pendingType !== null}
        onOpenChange={(next) => {
          if (!next) setPendingType(null);
        }}
        title={t('acct.typeChangeTitle')}
        body={t('acct.typeChangeBody', { type: pendingType ? t(typeDef(pendingType).labelKey) : '' })}
        confirmLabel={t('acct.typeChangeGo')}
        busy={busy}
        onConfirm={() => void confirm()}
        testId="account-type-confirm"
      />
    </>
  );
}
