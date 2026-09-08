import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { config, publicOrigin } from '@/app/config';
import { isNativeApp } from '@/lib/platform';
import { LOCALES, useLang } from '@/i18n';
import { destroyIdentityData, useData } from '@/app/data';
import { logActivity } from '@/application/activity';
import { applyHistoryMove, historyMoveImpact } from '@/application/historyStart';
import type { HistoryMoveImpact } from '@/application/historyStart';
import { OFFLINE_REASON_KEYS, useOfflineReason } from '@/app/OfflineBanner';
import { oidcSignOut } from '@/app/authToken';
import { useSession } from '@/app/session';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Chip, Row } from '@/ui/primitives';
import { PinChallengeSheet } from '@/features/lock/PinChallengeSheet';
import { readLockConfig } from '@/features/lock/lock';
import { takeSettingsJump } from './settingsJump';
import { flashJumpTo } from '@/lib/flashJump';
import { Sheet } from '@/ui/Sheet';
import { useQuery } from '@/db/useQuery';
import { useMyRole } from '@/features/spaces/SpaceSharing';
import { SharedSpaceBadge } from '@/features/spaces/SpaceSwitcher';
import { PERIOD_KEYS } from '@/features/spaces/PeriodSettingsScreen';
import { DEFAULT_HISTORY_MONTHS, isoMonthsAgo } from '@/features/spaces/spaceDefaults';
import { CURRENCIES } from '@/domain/countries';
import { LAST_SYNC_KEY } from '@/sync/engine';
import type { SyncStatus } from '@/sync/engine';
import type { SpaceRow } from '@/db/types';

const SYNC_STATUS_KEYS = {
  idle: 'sync.synced',
  syncing: 'sync.syncing',
  offline: 'sync.offline',
  error: 'sync.error',
} as const;

/** live sync state + last successful sync — silent failures can't hide */
function SyncStatusRow() {
  const { t, lang } = useLang();
  const { store, engine } = useData();
  const [status, setStatus] = useState<SyncStatus>(engine?.getStatus() ?? 'idle');
  useEffect(() => engine?.onStatus(setStatus), [engine]);
  const lastSync = useQuery(store, async () => (await store.metaGet(LAST_SYNC_KEY))?.value as number | undefined, []);
  const offlineReason = useOfflineReason();

  if (!engine) return null;
  const healthy = status === 'idle' || status === 'syncing';
  // exactly two lines, always — the row used to grow/shrink as the status
  // flipped (idle → syncing → idle, reason appearing), which made the
  // whole settings list jump
  const lastSyncLabel = lastSync
    ? new Date(lastSync).toLocaleString(LOCALES[lang], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : t('sync.never');
  const subLine = offlineReason ? t(OFFLINE_REASON_KEYS[offlineReason]) : `${t('sync.lastSync')}: ${lastSyncLabel}`;
  return (
    <div className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] text-ink" data-testid="settings-sync-row">
      <Icon
        name={healthy ? 'cloud-check-outline' : 'cloud-alert-outline'}
        size={20}
        color={healthy ? 'var(--m-accent)' : 'var(--m-warning)'}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate" data-testid="settings-sync-status">
          {t(SYNC_STATUS_KEYS[status])}
        </span>
        <span
          className="block truncate text-[11px]"
          style={{ color: offlineReason ? 'var(--m-warning)' : 'var(--m-ink-4)' }}
          data-testid={offlineReason ? 'settings-sync-reason' : 'settings-sync-last'}
        >
          {subLine}
        </span>
      </span>
    </div>
  );
}

/** the active space as the screen's header card — tapping it opens the
 *  space's own settings (replaces the old "Settings" row + scope caption:
 *  the space the rows below belong to IS this card) */
function SpaceHeaderRow({ space, onClick }: Readonly<{ space: SpaceRow | undefined; onClick: () => void }>) {
  const { t } = useLang();
  return (
    <button
      data-testid="settings-space-row"
      onClick={onClick}
      className="m-tap mb-4 flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5 text-left"
    >
      {space?.picture ? (
        <img src={space.picture} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `color-mix(in srgb, ${space?.color ?? 'var(--m-accent)'} 16%, transparent)`,
            color: space?.color ?? 'var(--m-accent-deep)',
          }}
        >
          <Icon name={space?.icon ?? (space?.kind === 'shared' ? 'account-group-outline' : 'leaf')} size={22} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[15px] font-semibold text-ink">{space?.name ?? ''}</span>
          {/* #277: the card says when the scope is a SHARED space */}
          {space?.kind === 'shared' && <SharedSpaceBadge testId="settings-space-shared-badge" />}
        </span>
        <span className="block truncate text-[12px] text-ink-3">
          {t('settings.spaceCardSub')}
          {space?.kind === 'shared' && space.createdByName && <> · {t('space.createdBy', { name: space.createdByName })}</>}
        </span>
      </span>
      <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
    </button>
  );
}

/** #302 (user): the invite-lock setting — quick-link target (scroll +
 *  settle + flash on arrival) and PIN-protected on the way OPEN: with a
 *  lock configured, ENABLING invitations asks for the PIN first;
 *  locking the space back needs none. Module-level for S3776. */
function InviteLockRow({
  space,
  onWrite,
}: Readonly<{
  space: { id: string; inviteLock?: 0 | 1 };
  onWrite: (next: 0 | 1) => void;
}>) {
  const { t } = useLang();
  const [challengeOpen, setChallengeOpen] = useState(false);
  // the quick link's landing: consume the handoff once, then flash
  useEffect(() => {
    if (takeSettingsJump() !== 'invite-lock') return;
    const row = document.querySelector<HTMLElement>('[data-testid="settings-space-private-row"]');
    if (row) flashJumpTo(row);
  }, []);
  const toggle = (checked: boolean) => {
    if (!checked && readLockConfig()) {
      setChallengeOpen(true);
      return;
    }
    onWrite(checked ? 1 : 0);
  };
  return (
    <>
      <Row
        testId="settings-space-private-row"
        icon="lock-outline"
        title={t('space.inviteLockLabel')}
        sub={t('space.inviteLockSub')}
        trailing={
          <input
            type="checkbox"
            data-testid="settings-space-private-toggle"
            checked={space.inviteLock === 1}
            onChange={(e) => toggle(e.target.checked)}
            className="h-4 w-4 accent-[var(--m-accent)]"
          />
        }
      />
      <PinChallengeSheet
        open={challengeOpen}
        onOpenChange={setChallengeOpen}
        title={t('space.inviteUnlockTitle')}
        body={t('space.inviteUnlockBody')}
        onPass={() => onWrite(0)}
      />
    </>
  );
}

export function SettingsScreen() {
  const { t, lang } = useLang();
  const { store, repo, spaceId } = useData();
  const activeSpace = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const { identity, logout } = useSession();
  const navigate = useNavigate();
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // moving the history start is impactful (arc 5): the picked date stays
  // a DRAFT with its consequences counted out loud until Apply
  const [historyDraft, setHistoryDraft] = useState<string | null>(null);
  const [historyImpact, setHistoryImpact] = useState<HistoryMoveImpact | null>(null);
  // readers can look at the space's period/currency/history but not change them
  const myRole = useMyRole(spaceId, identity?.kind === 'user');
  const readOnly = myRole === 'reader';

  const updateSpace = async (changes: Partial<Pick<SpaceRow, 'currency' | 'historyStartDate'>>) => {
    if (!activeSpace || readOnly) return;
    await repo.upsert('space', activeSpace.id, activeSpace.id, changes);
    void logActivity(store, repo, activeSpace.id, 'spaceEdit', activeSpace.name);
  };

  const stageHistoryDate = (value: string) => {
    setHistoryDraft(value);
    setHistoryImpact(null);
    void historyMoveImpact(store, spaceId, value).then(setHistoryImpact);
  };
  const closeHistory = (open: boolean) => {
    setHistoryOpen(open);
    if (!open) {
      setHistoryDraft(null);
      setHistoryImpact(null);
    }
  };
  const applyHistory = async () => {
    if (!historyDraft || readOnly) return;
    await applyHistoryMove(store, repo, spaceId, historyDraft);
    setHistoryDraft(null);
    setHistoryImpact(null);
    setHistoryOpen(false);
  };
  // a jump further than ~a month back deserves the step-slowly hint
  const bigOlderJump =
    historyImpact?.direction === 'older' &&
    !!historyDraft &&
    (new Date(activeSpace?.historyStartDate ?? historyDraft).getTime() - new Date(historyDraft).getTime()) / 86_400_000 > 31;

  // extracted settings show their current value on the row (like the
  // language row in Global settings) — the list doubles as an overview
  const settingValue = (testId: string) => {
    if (!activeSpace) return undefined;
    if (testId === 'settings-period-row') {
      return <span className="text-[12px] text-ink-3">{t(PERIOD_KEYS[activeSpace.periodType])}</span>;
    }
    if (testId === 'settings-currency-row') {
      return (
        <span className="rounded-md bg-bg-2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-3" data-testid="settings-currency-value">
          {activeSpace.currency}
        </span>
      );
    }
    if (testId === 'settings-history-row') {
      const iso = activeSpace.historyStartDate ?? isoMonthsAgo(DEFAULT_HISTORY_MONTHS);
      return (
        <span className="text-[12px] text-ink-3">
          {new Date(`${iso}T00:00:00`).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      );
    }
    return undefined;
  };
  const signOut = async () => {
    const current = identity;
    logout();
    // user identities keep local data (sync is the source of truth);
    // offline profiles keep their data too (this device IS the truth) —
    // only the demo resets to its pristine dataset on sign-out
    if (current?.kind === 'user') {
      // native: the end-session round-trip opens in the system browser
      // view (same place sign-in ran — that's where Logto's session
      // cookie lives), so the landing must be the app's deep-link scheme
      // (munni://signed-out + munni-dev://signed-out, registered as post
      // sign-out redirect URIs); the deep-link handler brings the app to
      // the login screen. Web keeps its own origin.
      const postLogout = isNativeApp() ? `${publicOrigin()}/native-signed-out` : window.location.origin;
      if (!current.testAuth && (await oidcSignOut(postLogout))) return; // full OIDC logout redirects
      await navigate({ to: '/login' });
      return;
    }
    await navigate({ to: '/login' });
    if (current?.kind === 'demo') await destroyIdentityData(current);
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-settings">
      <AppBar large title={t('screen.settings')} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* the space card is the scope label: everything below until the
            "Everywhere" caption belongs to THIS space (user request — the
            old "This space · x" text + Settings row collapsed into it) */}
        <SpaceHeaderRow space={activeSpace} onClick={() => void navigate({ to: '/spaces/$spaceId', params: { spaceId } })} />
        {identity?.kind === 'user' && (
          <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface">
            <SyncStatusRow />
          </div>
        )}
        {/* the feature doors group by intent (redesign ruling):
            Plan / Track / Learn / Setup. */}
        {(
          [
            {
              capKey: 'settings.groupPlan',
              rows: [
                { testId: 'settings-budgets-row', icon: 'wallet-outline', labelKey: 'budgets.title', to: '/budgets' },
                { testId: 'settings-allocation-row', icon: 'cash-multiple', labelKey: 'alloc.title', to: '/allocate' },
              ],
            },
            {
              capKey: 'settings.groupTrack',
              rows: [
                // receipts are a SPACE view (v3 ruling): what you see here
                // depends on which connections this space includes
                { testId: 'settings-receipts-row', icon: 'receipt-text-outline', labelKey: 'receipts.title', to: '/receipts' },
                { testId: 'settings-events-row', icon: 'party-popper', labelKey: 'events.title', to: '/events' },
                // splits live here, not in Global (user remark): the group
                // itself is space-independent, but its attachment and the
                // transactions you pick from belong to the current space
                { testId: 'settings-splits-row', icon: 'account-cash-outline', labelKey: 'splits.title', to: '/splits', userOnly: true },
                { testId: 'settings-goals-row', icon: 'flag-outline', labelKey: 'goals.title', to: '/goals' },
                { testId: 'settings-debts-row', icon: 'hand-coin-outline', labelKey: 'debts.title', to: '/debts' },
              ],
            },
            {
              capKey: 'settings.groupLearn',
              rows: [
                { testId: 'settings-insights-row', icon: 'lightbulb-outline', labelKey: 'ins.title', to: '/insights' },
                { testId: 'settings-trends-row', icon: 'chart-bar', labelKey: 'trends.title', to: '/trends' },
              ],
            },
            {
              capKey: 'settings.groupSetup',
              rows: [
                // the space's accounts/members moved out of the (already
                // big) space-settings screen — user remark; period,
                // currency and history start were extracted next (same
                // remark: that screen kept only the space's identity)
                // wallet vs bank (arc 9): the space's own pocket, not the
                // global bank overview — the icons carry the distinction
                { testId: 'settings-space-accounts-row', icon: 'wallet-outline', labelKey: 'space.financialAccounts', to: '/spaces/$spaceId/accounts' },
                { testId: 'settings-space-members-row', icon: 'account-multiple-outline', labelKey: 'space.members', to: '/spaces/$spaceId/members', userOnly: true },
                { testId: 'settings-categories-row', icon: 'shape-outline', labelKey: 'screen.categories', to: '/categories' },
                { testId: 'settings-period-row', icon: 'calendar-month-outline', labelKey: 'space.periodTitle', to: '/spaces/$spaceId/period' },
                { testId: 'settings-currency-row', icon: 'cash-100', labelKey: 'space.ledgerCurrency', sheet: 'currency' },
                { testId: 'settings-history-row', icon: 'history', labelKey: 'space.historyStart', sheet: 'history' },
              ],
            },
          ] as const
        ).map((group, groupIndex) => (
          <div key={group.capKey}>
            <p className={`px-1 pb-1 text-[10px] font-semibold tracking-wide text-ink-4 uppercase ${groupIndex === 0 ? '' : 'pt-3'}`}>
              {t(group.capKey)}
            </p>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {group.rows
                .filter((row) => !('userOnly' in row) || identity?.kind === 'user')
                .map((row) => (
                  <Row
                    key={row.testId}
                    testId={row.testId}
                    icon={row.icon}
                    title={t(row.labelKey)}
                    trailing={settingValue(row.testId)}
                    onClick={() => {
                      if (!('sheet' in row)) {
                        void navigate({ to: row.to, params: { spaceId } });
                      } else if (row.sheet === 'currency') {
                        setCurrencyOpen(true);
                      } else {
                        setHistoryOpen(true);
                      }
                    }}
                  />
                ))}
              {/* #162: the private lock lives with the space's other
                  settings now — owner-only, applies immediately (LWW) */}
              {group.capKey === 'settings.groupSetup' && myRole === 'owner' && activeSpace && (
                <InviteLockRow
                  space={activeSpace}
                  onWrite={(next) => {
                    void repo.upsert('space', activeSpace.id, activeSpace.id, { inviteLock: next });
                    void logActivity(store, repo, activeSpace.id, 'spaceEdit', activeSpace.name);
                  }}
                />
              )}
            </div>
          </div>
        ))}

        <p className="m-cap mt-4 mb-1 px-1" data-testid="settings-scope-global">
          {t('settings.scopeGlobal')}
        </p>
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <Row
            testId="settings-global-row"
            icon="earth"
            title={t('settings.global')}
            sub={t('settings.globalSub')}
            onClick={() => void navigate({ to: '/settings/global' })}
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
          <button
            data-testid="settings-signout"
            onClick={() => void signOut()}
            className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left text-[15px] text-negative"
          >
            <Icon name="logout" size={20} />
            <span className="flex-1">{t('settings.signOut')}</span>
          </button>
          {/* account deletion moved to Global settings (user remark: too
              close to sign-out for comfort) */}
        </div>

        <div className="pt-6 pb-6 text-center text-[11px] text-ink-4">
          munni · v{__APP_VERSION__} · build {String(__BUILD_NUMBER__)}
          {config.channel !== 'production' && ` · ${config.channel || 'local'}`}
        </div>
      </div>

      {/* extracted space settings (user request): small single-purpose
          sheets — picking a value applies immediately (LWW makes it safe) */}
      <Sheet open={currencyOpen} onOpenChange={setCurrencyOpen} title={t('space.ledgerCurrency')} size="form" dragHandle>
        <div className="flex flex-col gap-3 pt-1">
          {/* "ledger" is deliberate (currency plan CD5): this anchors
              budgets, goals and period totals for every member — how
              amounts READ is the personal display currency on Profile */}
          <p className="text-[12px] text-ink-3">{t('space.ledgerCurrencyInfo')}</p>
          {readOnly && <p className="text-[12px] text-ink-3">{t('space.readerNote')}</p>}
          <div className="flex flex-wrap gap-2">
            {CURRENCIES.map((c) => (
              <Chip
                key={c}
                className="font-mono"
                testId={`space-currency-${c}`}
                disabled={readOnly}
                selected={activeSpace?.currency === c}
                onClick={() => {
                  void updateSpace({ currency: c });
                  setCurrencyOpen(false);
                }}
              >
                {c}
              </Chip>
            ))}
          </div>
        </div>
      </Sheet>

      <Sheet open={historyOpen} onOpenChange={closeHistory} title={t('space.historyStart')} size="form">
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-[12px] text-ink-3">{t('space.historyStartSub')}</p>
          {readOnly && <p className="text-[12px] text-ink-3">{t('space.readerNote')}</p>}
          <input
            data-testid="space-history-start"
            type="date"
            value={historyDraft ?? activeSpace?.historyStartDate ?? isoMonthsAgo(DEFAULT_HISTORY_MONTHS)}
            disabled={readOnly}
            onChange={(e) => {
              if (e.target.value) stageHistoryDate(e.target.value);
            }}
            className="h-12 w-full appearance-none rounded-input border border-line bg-surface px-4 text-left text-[15px] text-ink outline-none"
          />
          {/* the consequences, counted BEFORE anything happens (arc 5) */}
          {historyDraft && historyImpact && historyImpact.direction !== 'none' && (
            <div className="flex flex-col gap-2 rounded-card border border-line bg-bg-2 px-4 py-3" data-testid="space-history-impact">
              {historyImpact.direction === 'newer' ? (
                <>
                  {historyImpact.feedHiddenCount > 0 && (
                    <p className="text-[12px] text-ink-2">{t('space.historyHideCount', { n: historyImpact.feedHiddenCount })}</p>
                  )}
                  {historyImpact.manualDeleteCount > 0 && (
                    <p className="text-[12px] font-medium text-negative" data-testid="space-history-delete-warn">
                      {t('space.historyDeleteCount', { n: historyImpact.manualDeleteCount })}
                    </p>
                  )}
                  {historyImpact.feedHiddenCount === 0 && historyImpact.manualDeleteCount === 0 && (
                    <p className="text-[12px] text-ink-3">{t('space.historyNoImpact')}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[12px] text-ink-2" data-testid="space-history-surface-note">
                    {t('space.historySurfaceCount', { n: historyImpact.surfacedCount })}
                  </p>
                  {bigOlderJump && <p className="text-[12px] text-ink-3">{t('space.historyStepHint')}</p>}
                </>
              )}
              <Button size="sm" data-testid="space-history-apply" onClick={() => void applyHistory()}>
                {t('space.historyApply')}
              </Button>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
