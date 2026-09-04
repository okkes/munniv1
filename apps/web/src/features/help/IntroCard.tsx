import { useQuery } from '@/db/useQuery';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useHelp } from './HelpContext';
import { useTipsDisabled } from './tipsPref';
import type { TourId } from './tours';
import { Icon } from '@/ui/Icon';

/**
 * Layer 1: the passive nudge — a dismissible one-liner the first time a
 * screen with a tour opens. Never nags again once dismissed or once the
 * tour was seen (device-level meta, tutorials are per person). Screens
 * mid-task pass idle={false} so the lesson never interrupts live work
 * (§2K) — the ? in the bar stays the always-available door.
 */
export function IntroCard({ tourId, idle = true }: Readonly<{ tourId: TourId; idle?: boolean }>) {
  const { t } = useLang();
  const { store } = useData();
  const { openSlides } = useHelp();
  // null = looked and found nothing; undefined = still loading
  const dismissed = useQuery(store, async () => (await store.metaGet(`introDismissed_${tourId}`)) ?? null, [tourId]);
  const seen = useQuery(store, async () => (await store.metaGet(`tutorialSeen_${tourId}`)) ?? null, [tourId]);

  const tipsOff = useTipsDisabled();
  const loaded = dismissed !== undefined && seen !== undefined;
  const hidden = Boolean(dismissed?.value) || Boolean(seen?.value);
  if (tipsOff || !idle || !loaded || hidden) return null;

  return (
    <div
      className="mt-3 flex items-center gap-3 rounded-card border border-accent/40 bg-accent-soft/40 px-4 py-2.5"
      data-testid={`intro-card-${tourId}`}
    >
      <Icon name="school-outline" size={18} color="var(--m-accent-deep)" />
      <span className="min-w-0 flex-1 text-[13px] text-ink-2">{t('help.intro')}</span>
      <button
        data-testid="intro-start"
        onClick={() => openSlides(tourId)}
        className="m-tap border-none bg-transparent text-[13px] font-semibold text-accent-deep"
      >
        {t('help.start')}
      </button>
      <button
        aria-label={t('action.dismiss')}
        data-testid="intro-dismiss"
        onClick={() => void store.metaPut(`introDismissed_${tourId}`, true)}
        className="m-tap flex h-7 w-7 items-center justify-center rounded-full border-none bg-transparent"
      >
        <Icon name="close" size={16} color="var(--m-ink-4)" />
      </button>
    </div>
  );
}
