import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLang } from '@/i18n';
import { useData } from './data';
import { Icon } from '@/ui/Icon';
import type { SyncStatus } from '@/sync/engine';
import { getProtocolIssue } from '@/lib/api';
import type { ProtocolIssue } from '@/lib/protocol';
import { isSessionExpired, subscribeSessionExpiry } from './sessionExpiry';
import { oidcSignIn } from './authToken';
import { callbackUri } from '@/features/auth/logto';

/**
 * Why sync is failing for a signed-in user right now:
 * - 'session-expired'  — the sign-in grant is spent (#222): the server
 *   is fine, but every call is unauthorized until a fresh sign-in
 * - 'no-network'       — the device has no connectivity at all
 * - 'unreachable'      — the network is up but the munni server can't be
 *   reached (server down, DNS, or a firewall/filter blocking it)
 * - 'client-outdated'  — the server no longer speaks this app version
 * - 'server-outdated'  — this app needs a newer server (native apps ship
 *   on their own cadence; the handshake keeps a mismatch from corrupting
 *   data — lib/protocol.ts)
 * null when everything is fine — and always null for demo/offline
 * identities, whose local-only mode is a choice, not an error.
 */
export type OfflineReason = 'session-expired' | 'no-network' | 'unreachable' | ProtocolIssue;

export function resolveOfflineReason(
  hasEngine: boolean,
  onLine: boolean,
  status: SyncStatus,
  compat: ProtocolIssue | null = null,
  sessionExpired = false,
): OfflineReason | null {
  if (!hasEngine) return null;
  // an expired session outranks everything: the network and server are
  // fine — saying "unreachable" sent the user chasing the wrong problem
  if (sessionExpired) return 'session-expired';
  // a version mismatch is the most specific answer — the server IS
  // reachable, syncing is deliberately refused
  if (compat) return compat;
  if (!onLine) return 'no-network'; // definitive — show before any sync attempt fails
  if (status === 'offline' || status === 'error') return 'unreachable';
  return null;
}

export function useOfflineReason(): OfflineReason | null {
  const { engine } = useData();
  const [status, setStatus] = useState<SyncStatus>(engine?.getStatus() ?? 'idle');
  const [onLine, setOnLine] = useState(navigator.onLine);
  const [compat, setCompat] = useState<ProtocolIssue | null>(getProtocolIssue());
  const sessionExpired = useSyncExternalStore(subscribeSessionExpiry, isSessionExpired);
  useEffect(
    () =>
      engine?.onStatus((next) => {
        setStatus(next);
        // every sync attempt refreshes /health — re-read its verdict
        setCompat(getProtocolIssue());
      }),
    [engine],
  );
  useEffect(() => {
    const update = () => setOnLine(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return resolveOfflineReason(!!engine, onLine, status, compat, sessionExpired);
}

export const OFFLINE_REASON_KEYS = {
  'session-expired': 'sync.reasonSessionExpired',
  'no-network': 'sync.reasonNoNetwork',
  unreachable: 'sync.reasonUnreachable',
  'client-outdated': 'sync.reasonClientOutdated',
  'server-outdated': 'sync.reasonServerOutdated',
} as const;

const REASON_ICON: Record<OfflineReason, string> = {
  'session-expired': 'account-lock-outline',
  'no-network': 'wifi-off',
  unreachable: 'cloud-alert-outline',
  'client-outdated': 'cloud-alert-outline',
  'server-outdated': 'cloud-alert-outline',
};

// sessionStorage so a dismissal lasts for this visit only — closing and
// reopening the app brings the banner back (the user's requested behavior)
const DISMISS_KEY = 'munni_offline_banner_dismissed';

/** Slim strip above the tab bar: you are offline, and this is why. */
export function OfflineBanner() {
  const { t } = useLang();
  const reason = useOfflineReason();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');
  if (!reason || dismissed) return null;
  const expired = reason === 'session-expired';
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-t border-line bg-warning-soft px-4 py-2"
      data-testid="offline-banner"
      data-reason={reason}
    >
      <Icon name={REASON_ICON[reason]} size={15} color="var(--m-warning)" />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">
        {/* "Offline — saved on this device" would be a lie here: the
            network is fine, the SESSION is spent (#222) */}
        {!expired && <span className="font-medium">{t('sync.offlineBanner')} </span>}
        {t(OFFLINE_REASON_KEYS[reason])}
      </span>
      {expired && (
        <button
          data-testid="offline-banner-signin"
          onClick={() => void oidcSignIn(callbackUri())}
          className="m-tap shrink-0 rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-on-brand"
        >
          {t('sync.signInAgain')}
        </button>
      )}
      <button
        aria-label={t('action.dismiss')}
        data-testid="offline-banner-dismiss"
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        className="m-tap -my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-none bg-transparent"
      >
        <Icon name="close" size={15} color="var(--m-ink-3)" />
      </button>
    </div>
  );
}

/** Quiet pill for the Home app bar: keeps signalling offline after the
 *  banner was dismissed, without shouting. */
export function OfflineIndicator() {
  const { t } = useLang();
  const reason = useOfflineReason();
  if (!reason) return null;
  const expired = reason === 'session-expired';
  return (
    <span
      data-testid="home-offline-indicator"
      title={t(OFFLINE_REASON_KEYS[reason])}
      className="flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[11px] font-medium text-ink-2"
    >
      <Icon name={expired ? 'account-lock-outline' : 'wifi-off'} size={12} color="var(--m-warning)" />
      {expired ? t('sync.signInAgain') : t('sync.offlineShort')}
    </span>
  );
}
