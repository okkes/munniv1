import { useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { isNativeApp } from '@/lib/platform';
import { useHelp } from './HelpContext';
import { TOURS } from './tours';
import { WhatsNewSheet } from './WhatsNew';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Icon } from '@/ui/Icon';
import { Row } from '@/ui/primitives';

/** Settings → Help & tutorials: every tour, rerunnable any time. */
export function HelpIndexScreen() {
  const { t } = useLang();
  const { store } = useData();
  const { openSlides } = useHelp();
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const seen = useQuery(store, async () => {
    const keys = TOURS.map((tour) => `tutorialSeen_${tour.id}`);
    const rows = await Promise.all(keys.map((key) => store.metaGet(key)));
    return new Set(TOURS.filter((_, i) => Boolean(rows[i]?.value)).map((tour) => tour.id));
  }, []);

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-help">
      <AppBar
        title={t('help.title')}
        leading={
          <IconButton label={t('action.back')} testId="help-back-btn" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <p className="px-1 pb-3 text-[12px] text-ink-3">{t('help.indexSub')}</p>
        {/* the release notes stay reachable after the Home nudge is gone */}
        <div className="mb-3 overflow-hidden rounded-card border border-line bg-surface">
          <Row
            testId="help-whatsnew-row"
            icon="bullhorn-variant-outline"
            iconColor="var(--m-accent-deep)"
            title={t('whatsnew.title')}
            onClick={() => setWhatsNewOpen(true)}
          />
          {/* the illustrated guide ships with the app as a static page */}
          <Row
            testId="help-guide-row"
            icon="book-open-page-variant-outline"
            iconColor="var(--m-accent-deep)"
            title={t('help.userGuide')}
            // native: window.open('_blank') renders a blank webview (user
            // report) — navigate in place instead; the guide's own
            // "back to the app" link returns here
            onClick={() =>
              isNativeApp()
                ? globalThis.location.assign(`${import.meta.env.BASE_URL}guide/`)
                : window.open(`${import.meta.env.BASE_URL}guide/`, '_blank', 'noopener')
            }
          />
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {/* replay the Mina first-run (user ruling: replayable; its
              revert ledger lets a run be undone at the wrap) */}
          <Row
            testId="help-mina-replay"
            icon="compass-outline"
            iconColor="var(--m-accent-deep)"
            title={t('mina.replay')}
            onClick={() => window.dispatchEvent(new Event('mina:start'))}
          />
          {/* the install walkthrough is meaningless inside the native shell */}
          {TOURS.filter((tour) => tour.id !== 'install' || !isNativeApp()).map((tour) => (
            <Row
              key={tour.id}
              testId={`help-tour-${tour.id}`}
              icon={tour.icon}
              iconColor="var(--m-ink-2)"
              title={t(tour.titleKey)}
              trailing={
                seen?.has(tour.id) ? (
                  <span className="flex items-center gap-1 text-[11px] text-accent-deep">
                    <Icon name="check" size={14} />
                    {t('help.seen')}
                  </span>
                ) : undefined
              }
              onClick={() => openSlides(tour.id)}
            />
          ))}
        </div>
      </div>
      <WhatsNewSheet open={whatsNewOpen} onOpenChange={setWhatsNewOpen} />
    </div>
  );
}
