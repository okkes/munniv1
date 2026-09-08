import { useQuery } from '@/db/useQuery';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { isNativeApp } from '@/lib/platform';
import { useHelp } from './HelpContext';
import { useTipsDisabled } from './tipsPref';
import { Icon } from '@/ui/Icon';

/** true when munni already runs as an installed app */
const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);

/**
 * Browser-tab-only nudge to install munni as a PWA. Installed apps get
 * a clean full-height viewport (no browser bars fighting the tab bar)
 * and — critically for a local-first app — exemption from iOS's
 * clear-storage-after-7-idle-days rule. Dismissal is device-level and
 * forever; the walkthrough stays available under Help → Install as app.
 */
export function InstallHint() {
  const { t } = useLang();
  const { store } = useData();
  const { openSlides } = useHelp();
  // null = looked and found nothing; undefined = still loading
  const dismissed = useQuery(store, async () => (await store.metaGet('installHintDismissed')) ?? null, []);
  const tipsOff = useTipsDisabled();

  // the native shell IS the installed app — a PWA nudge there is absurd
  if (isNativeApp() || tipsOff || dismissed === undefined || Boolean(dismissed?.value) || isStandalone()) return null;

  return (
    <div
      className="mt-3 flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3"
      data-testid="install-hint"
    >
      <Icon name="cellphone-arrow-down" size={20} color="var(--m-accent-deep)" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{t('install.title')}</span>
        <span className="block text-[11px] text-ink-3">{t('install.body')}</span>
      </span>
      <button
        data-testid="install-hint-how"
        onClick={() => openSlides('install')}
        className="m-tap shrink-0 border-none bg-transparent text-[13px] font-semibold text-accent-deep"
      >
        {t('install.how')}
      </button>
      <button
        aria-label={t('action.dismiss')}
        data-testid="install-hint-dismiss"
        onClick={() => void store.metaPut('installHintDismissed', true)}
        className="m-tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-none bg-transparent"
      >
        <Icon name="close" size={16} color="var(--m-ink-4)" />
      </button>
    </div>
  );
}
