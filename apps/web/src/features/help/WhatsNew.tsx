import { LOCALES, useLang } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { WHATS_NEW } from './releaseNotes';

/** the release-notes sheet — reachable any time from Help */
export function WhatsNewSheet({ open, onOpenChange }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const { t, lang } = useLang();
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('whatsnew.title')} size="tall" dragHandle>
      <div className="flex flex-col gap-4 pt-1" data-testid="whatsnew-list">
        {WHATS_NEW.map((entry) => (
          <div key={entry.version}>
            <div className="m-cap mb-1 px-1">
              v{entry.version} · {fmtDate(entry.date)}
            </div>
            <div className="rounded-card border border-line bg-surface px-4 py-1">
              {entry.items.map((item) => (
                <div key={item.en} className="flex gap-2.5 border-b border-line-2 py-2.5 last:border-0">
                  <Icon name="star-four-points-outline" size={15} color="var(--m-accent-deep)" />
                  <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-2">{item[lang]}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// The one-line Home nudge retired with arc 6: release news now lands as
// a row in the bell's Notifications tab (NotificationsBell appends one
// inbox entry per version; the row opens this sheet and marks it seen).
