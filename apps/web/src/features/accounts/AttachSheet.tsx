import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@/db/useQuery';
import type { GlobalAccount } from '@/application/accounts';
import { newestTxDate } from '@/application/accounts';
import { setSpaceAttachIntent } from './openHandoff';
import { detachFeedFromSpace } from '@/application/accountAttach';
import { purgeAccountRemnants } from '@/application/accountPurge';
import { logActivity } from '@/application/activity';
import { SharedSpaceBadge } from '@/features/spaces/SpaceSwitcher';
import { useData } from '@/app/data';
import { useLang } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import type { AccountRow, AccountSource } from '@/db/types';
import { BrandIconPicker } from '@/features/recurring/BrandIconPicker';
import { Button } from '@/ui/Button';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { deleteFeedAccount } from './feedGateway';

interface ImportBatchView {
  id: string;
  count: number;
  from: string;
  to: string;
  importedBy?: string;
}

/** where an account's data comes from, for the settings section */
export const SOURCE_KEYS: Record<AccountSource, TranslationKey> = {
  manual: 'acct.sourceManual',
  camt053: 'acct.sourceImport',
  gocardless: 'acct.sourceOpenBanking',
};

/** #176: the label honors WHICH open-banking provider fetches the row —
 *  Enable Banking rows read "Enable Banking", not "GoCardless"; legacy
 *  rows without the stamp are GoCardless by history */
export const sourceKeyFor = (account: Pick<AccountRow, 'source' | 'provider'>): TranslationKey =>
  account.source === 'gocardless' && account.provider === 'enablebanking'
    ? 'acct.sourceOpenBankingEb'
    : SOURCE_KEYS[account.source];

/**
 * The global view of one of YOUR feed accounts: name/icon, source, the
 * spaces it is currently attached to (detach-only — attaching happens on
 * each space's own accounts screen now, redesign 2026-07-22), and the
 * delete danger zone.
 */
export function AttachSheet({
  open,
  onOpenChange,
  entry,
  canEdit = true,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: GlobalAccount | null;
  /** false for accounts shared WITH me — I don't own their feed */
  canEdit?: boolean;
}>) {
  const { t } = useLang();
  const { store, repo, engine, spaceId } = useData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [detachSpaceId, setDetachSpaceId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [logoOpen, setLogoOpen] = useState(false);
  // #239: a global rename with space-level names standing asks first
  const [renameAsk, setRenameAsk] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  // #185: a big account deletes in visible stages — server first, then
  // the local purge; the confirm sheet's busy note names the current one
  const [deleteStage, setDeleteStage] = useState<'server' | 'local'>('server');

  const spaces = useQuery(store, async () => (await store.allRows('space')).filter((s) => s.deleted === 0), []);
  // LIVE link rows, not the entry snapshot: the checkboxes must flip the
  // moment a toggle writes to Dexie (user bug: they only updated after
  // leaving and re-entering the screen)
  const accountId = entry?.account.id;
  const liveLinks = useQuery(
    store,
    async () =>
      accountId ? (await store.allRows('accountLink')).filter((l) => l.deleted === 0 && l.accountId === accountId) : [],
    [accountId],
  );
  // LIVE account row for the same reason: an icon pick must show up while
  // the sheet stays open (user bug: it looked like nothing happened)
  const liveAccount = useQuery(store, async () => (accountId ? await store.get('account', accountId) : undefined), [
    accountId,
  ]);
  // #205: the newest transaction on the account, from raw rows
  const newestTx = useQuery(store, async () => (accountId ? newestTxDate(store, accountId) : undefined), [accountId]);

  // master plan IB: batches derive from the stamped rows — no extra table
  const batches =
    useQuery(
      store,
      async () => {
        if (!accountId) return [] as ImportBatchView[];
        const byBatch = new Map<string, ImportBatchView>();
        for (const tx of await store.allRows('transaction')) {
          if (tx.deleted !== 0 || tx.accountId !== accountId || !tx.importBatchId) continue;
          const batch = byBatch.get(tx.importBatchId) ?? {
            id: tx.importBatchId,
            count: 0,
            from: tx.date,
            to: tx.date,
            importedBy: tx.importedBy,
          };
          batch.count++;
          if (tx.date < batch.from) batch.from = tx.date;
          if (tx.date > batch.to) batch.to = tx.date;
          byBatch.set(tx.importBatchId, batch);
        }
        return [...byBatch.values()].sort((a, b) => b.to.localeCompare(a.to));
      },
      [accountId],
    ) ?? [];
  const [rollbackBatch, setRollbackBatch] = useState<ImportBatchView | null>(null);
  const rollback = async () => {
    if (!rollbackBatch) return;
    // a batch removes only rows IT created: rows this upload merely
    // re-encountered keep their first batch id and survive
    for (const tx of await store.allRows('transaction')) {
      if (tx.deleted === 0 && tx.importBatchId === rollbackBatch.id) await repo.remove('transaction', tx.spaceId, tx.id);
    }
    void logActivity(store, repo, spaceId, 'importRollback', `${rollbackBatch.count}`);
    setRollbackBatch(null);
  };

  useEffect(() => {
    if (open) setName(entry?.account.name ?? '');
  }, [open, entry?.account.name]);

  if (!entry?.feedSpaceId) return null;
  const { feedSpaceId } = entry;
  const account = liveAccount ?? entry.account;
  const viaBySpace = new Map((liveLinks ?? []).map((l) => [l.spaceId, l]));

  // display name + icon live on the feed's account row — the owner's
  // edit reaches every space the account is shared with (it's their
  // account); raw bank facts (iban, balance) stay untouched
  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== account.name) {
      void repo.upsert('account', account.spaceId, account.id, { name: trimmed });
      void logActivity(store, repo, spaceId, 'accountEdit', trimmed);
      // #239 (user): spaces may hold their OWN name for this account —
      // a global rename asks whether those follow or stay
      if ((liveLinks ?? []).some((l) => l.displayName)) setRenameAsk(trimmed);
    }
  };

  // #239: replace every space's own name with the fresh global one
  const renameEverywhere = () => {
    for (const link of liveLinks ?? []) {
      if (link.displayName) void repo.upsert('accountLink', link.spaceId, link.id, { displayName: null as never });
    }
    setRenameAsk(null);
  };

  const deleteAccount = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteFailed(false);
    setDeleteStage('server');
    try {
      // server first: consent revocation + cascade (or partial removal
      // when someone else still covers the account — server ruling)
      await deleteFeedAccount(feedSpaceId);
      // my synced mirrors tombstone through the normal outbox path; the
      // feed's local rows are purged directly — it is no longer ours
      setDeleteStage('local');
      for (const link of liveLinks ?? []) {
        await repo.remove('accountLink', link.spaceId, link.id);
      }
      // #279: the engine purge below is feed-keyed — member spaces keep
      // their txMeta overlays and legacy own rows unless swept here
      await purgeAccountRemnants(store, repo, account.id, feedSpaceId);
      await engine?.purgeSpace(feedSpaceId);
      void logActivity(store, repo, spaceId, 'accountRemove', account.name);
      setDeleteOpen(false);
      onOpenChange(false);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleteBusy(false);
    }
  };

  const detach = async () => {
    if (busy || !detachSpaceId) return;
    setBusy(detachSpaceId);
    try {
      await detachFeedFromSpace(store, repo, detachSpaceId, feedSpaceId, account.id);
      setDetachSpaceId(null);
    } catch {
      // offline or forbidden — the list simply doesn't change
    } finally {
      setBusy(null);
    }
  };

  // only the spaces this account currently feeds (archived = left the
  // space once; reviving happens on the space's own accounts screen)
  const attachedSpaces = (spaces ?? [])
    .map((space) => ({ space, via: viaBySpace.get(space.id) }))
    .filter((row) => !!row.via);
  // #318: the quick-attach door names the ACTIVE space
  const activeSpace = (spaces ?? []).find((s) => s.id === spaceId);

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange} title={account.name} size="tall" dragHandle>
      {canEdit && (
        <div className="mb-3 flex flex-col gap-2">
          <label className="flex items-center gap-3 text-[13px] text-ink-2">
            {t('acct.displayName')}
            <input
              data-testid="attach-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              className="h-10 min-w-0 flex-1 rounded-input border border-line bg-surface px-3 text-[13px] text-ink outline-none"
            />
          </label>
          <button
            data-testid="attach-change-icon"
            onClick={() => setLogoOpen(true)}
            className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-3 py-2.5 text-left text-[13px] text-ink"
          >
            {account.logo ? (
              <img src={account.logo} alt="" className="h-6 w-6 rounded object-contain" />
            ) : (
              <Icon name="bank-outline" size={20} color="var(--m-ink-3)" />
            )}
            <span className="flex-1">{t('acct.changeIcon')}</span>
            <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
          </button>
        </div>
      )}
      {/* #212 r2 (user): NO type here — a global account is just an
          account; each space decides what it is at attach time and can
          change it on its own accounts sheet */}
      <div className="mb-3 flex items-center justify-between px-1 text-[12px]" data-testid="attach-source">
        <span className="text-ink-4">{t('acct.source')}</span>
        <span className="text-ink-2">{t(sourceKeyFor(account))}</span>
      </div>
      {/* #205: where the DATA ends vs when the sync ran — two facts */}
      {account.dataThroughDate && (
        <div className="mb-3 flex items-center justify-between px-1 text-[12px]" data-testid="attach-datathrough">
          <span className="text-ink-4">{t('acct.dataThroughLabel')}</span>
          <span className="font-mono text-ink-2">{account.dataThroughDate}</span>
        </div>
      )}
      <div className="mb-3 flex items-center justify-between px-1 text-[12px]" data-testid="attach-newest-tx">
        <span className="text-ink-4">{t('acct.newestTx')}</span>
        <span className="font-mono text-ink-2">{newestTx ?? '—'}</span>
      </div>
      {/* only what the account currently feeds — attaching moved to each
          space's own accounts screen (checkboxes retired, user request) */}
      <p className="pb-2 text-[13px] text-ink-3">{t('acct.attachedSpaces')}</p>
      {attachedSpaces.length === 0 && (
        <p className="px-1 text-[13px] text-ink-4" data-testid="attach-none">
          {t('acct.notAttached')}
        </p>
      )}
      {/* #318 (user): a truly link-less account offers the CURRENT space
          by name — through the real flow: the intent pre-aims the space
          accounts screen, whose attach sheet opens on the final step
          (type pick + Attach, #310) — never a silent in-place attach */}
      {canEdit && liveLinks?.length === 0 && activeSpace && (
        <Button
          variant="outline"
          className="mt-2 w-full"
          data-testid="account-attach-here"
          onClick={() => {
            setSpaceAttachIntent(account.id);
            onOpenChange(false);
            void navigate({ to: '/spaces/$spaceId/accounts', params: { spaceId } });
          }}
        >
          <Icon name="link-plus" size={16} />
          {t('acct.attachHere', { space: activeSpace.name })}
        </Button>
      )}
      {attachedSpaces.length > 0 && (
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="attach-spaces">
          {attachedSpaces.map(({ space, via }) => (
            <div
              key={space.id}
              data-testid={`attach-space-${space.id}`}
              className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{space.name}</span>
              {/* #277: a shared space says so wherever it is listed */}
              {space.kind === 'shared' && <SharedSpaceBadge testId={`attach-space-shared-${space.id}`} />}
              {via?.historyFrom && <span className="font-mono text-[11px] text-ink-4">{via.historyFrom}</span>}
              {via?.archived ? (
                <span
                  className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-ink-2"
                  data-testid={`attach-archived-${space.id}`}
                >
                  {t('acct.archivedReconnect')}
                </span>
              ) : (
                <button
                  aria-label={t('acct.detach')}
                  data-testid={`attach-detach-${space.id}`}
                  disabled={busy !== null}
                  onClick={() => setDetachSpaceId(space.id)}
                  className="m-tap flex h-8 w-8 items-center justify-center border-none bg-transparent text-ink-4"
                >
                  <Icon name="link-off" size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {/* master plan IB: statement uploads as rollback-able batches —
          who uploaded what, and one tap to take a bad upload back out */}
      {canEdit && batches.length > 0 && (
        <>
          <div className="m-cap mt-4 mb-1 px-1">{t('imports.section')}</div>
          <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="attach-imports">
            {batches.map((batch) => (
              <div key={batch.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0">
                <Icon name="file-upload-outline" size={18} color="var(--m-ink-3)" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">
                    {t('imports.batch', { n: batch.count, from: batch.from, to: batch.to })}
                  </span>
                  {batch.importedBy && (
                    <span className="block text-[11px] text-ink-4">{t('imports.by', { name: batch.importedBy })}</span>
                  )}
                </span>
                <button
                  aria-label={t('imports.rollback')}
                  data-testid={`attach-rollback-${batch.id}`}
                  onClick={() => setRollbackBatch(batch)}
                  className="m-tap border-none bg-transparent text-negative"
                >
                  <Icon name="file-undo" size={18} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {/* danger zone: deletion exists for connected accounts too (user
          request) — syncing identities only, the server owns the cascade */}
      {canEdit && engine && (
        <Button
          variant="danger"
          className="mt-4 w-full"
          data-testid="attach-delete"
          onClick={() => {
            setDeleteFailed(false);
            setDeleteOpen(true);
          }}
        >
          {t('acct.deleteAccount')}
        </Button>
      )}
    </Sheet>
    {/* #241 (user ss): SIBLINGS, not children — a sheet nested inside
        another sheet's children portals FIRST and paints BELOW its
        parent (both live at z-50; body order decides). Beside the
        parent, the later sibling lands later in <body> and stacks on
        top — the EditAccountSheet pattern. */}
    <BrandIconPicker
      open={logoOpen}
      onOpenChange={setLogoOpen}
      initialQuery={account.name}
      onPick={({ logo }) => {
        void repo.upsert('account', account.spaceId, account.id, { logo: logo ?? (null as never) });
        void logActivity(store, repo, spaceId, 'accountEdit', account.name);
        setLogoOpen(false);
      }}
    />
    {/* #239: the global rename found space-level names — follow or keep? */}
    <Sheet
      open={renameAsk !== null}
      onOpenChange={(next) => {
        if (!next) setRenameAsk(null);
      }}
      title={t('acct.renameSpacesTitle')}
      size="compact"
    >
      <p className="pb-4 text-[13px] leading-relaxed text-ink-2" data-testid="attach-rename-ask">
        {t('acct.renameSpacesBody', { name: renameAsk ?? '' })}
      </p>
      <div className="flex flex-col gap-2">
        <Button data-testid="attach-rename-everywhere" onClick={renameEverywhere}>
          {t('acct.renameSpacesGo')}
        </Button>
        <Button variant="outline" data-testid="attach-rename-keep" onClick={() => setRenameAsk(null)}>
          {t('acct.renameSpacesKeep')}
        </Button>
      </div>
    </Sheet>
    {/* #288 (user ss): the destructive confirms are SIBLINGS too — nested
        in the sheet's children they portaled FIRST and the delete popup
        painted BEHIND the sheet (same #241 body-order rule as above) */}
    <DangerConfirmSheet
      open={rollbackBatch !== null}
      onOpenChange={(o) => !o && setRollbackBatch(null)}
      title={t('imports.rollback')}
      body={t('imports.rollbackBody', { n: rollbackBatch?.count ?? 0, from: rollbackBatch?.from ?? '', to: rollbackBatch?.to ?? '' })}
      onConfirm={() => void rollback()}
      testId="attach-rollback"
    />
    {/* aligned destructive confirm: sheet + cooldown, same as space side */}
    <DangerConfirmSheet
      open={detachSpaceId !== null}
      onOpenChange={(o) => !o && setDetachSpaceId(null)}
      title={t('acct.detachConfirmTitle')}
      body={t('acct.detachConfirmBodySpace', {
        account: account.name,
        space: (spaces ?? []).find((s) => s.id === detachSpaceId)?.name ?? '',
      })}
      busy={busy !== null}
      onConfirm={() => void detach()}
      testId="attach-detach"
    />
    <DangerConfirmSheet
      open={deleteOpen}
      onOpenChange={setDeleteOpen}
      title={t('acct.deleteConfirmTitle')}
      body={t('acct.deleteConfirmBody')}
      busy={deleteBusy}
      busyText={deleteStage === 'local' ? t('acct.deleteStageLocal') : t('acct.deleteStageServer')}
      error={deleteFailed ? t('acct.deleteFailed') : null}
      onConfirm={() => void deleteAccount()}
      testId="attach-delete"
    />
    </>
  );
}
