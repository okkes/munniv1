import { useLang } from '@/i18n';
import { usePwa } from '@/app/pwa';
import { Icon } from './Icon';

/** "New version available" toast — PWAs don't update like store apps. */
export function UpdateToast() {
  const { t } = useLang();
  const { needRefresh, update, dismiss } = usePwa();
  if (!needRefresh) return null;
  return (
    <div
      data-testid="pwa-update-toast"
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-[60] mx-auto flex max-w-[480px] items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-lg"
    >
      <Icon name="update" size={20} color="var(--m-accent)" />
      <span className="flex-1 text-[13px] text-ink">{t('pwa.updateAvailable')}</span>
      <button onClick={update} data-testid="pwa-update-reload" className="m-tap rounded-lg bg-brand px-3 py-1.5 text-[13px] font-semibold text-on-brand">
        {t('pwa.reload')}
      </button>
      <button onClick={dismiss} aria-label={t('action.cancel')} className="m-tap text-ink-4">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
