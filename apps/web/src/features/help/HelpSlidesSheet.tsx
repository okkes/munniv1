import { useEffect, useState } from 'react';
import { useLang } from '@/i18n';
import { tourById } from './tours';
import type { TourId } from './tours';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';

/**
 * Layer 2: the quick screening — a handful of illustrated slides,
 * skippable, done in a minute. Pure content, no app interaction.
 */
export function HelpSlidesSheet({
  tourId,
  onClose,
  onDone,
  onInteractive,
}: Readonly<{
  tourId: TourId | null;
  onClose: () => void;
  onDone: (tourId: TourId) => void;
  onInteractive: (tourId: TourId) => void;
}>) {
  const { t } = useLang();
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [tourId]);

  const tour = tourId ? tourById(tourId) : null;
  const slide = tour?.steps[Math.min(step, tour.steps.length - 1)];
  const last = tour ? step >= tour.steps.length - 1 : false;

  return (
    <Sheet open={tourId !== null} onOpenChange={(open) => !open && onClose()} title={tour ? t(tour.titleKey) : ''} size="tall">
      {tour && slide && (
        <div className="flex flex-col items-center gap-3 px-2 pt-2 text-center" data-testid="help-slides">
          <div className="text-[44px] leading-none" aria-hidden>
            {slide.illustration}
          </div>
          <p className="text-[16px] font-semibold text-ink" data-testid="help-slide-title">
            {t(slide.titleKey)}
          </p>
          <p className="min-h-16 text-[13px] leading-relaxed text-ink-2">{t(slide.bodyKey)}</p>
          <div className="flex gap-1.5 py-1" data-testid="help-dots">
            {tour.steps.map((s, i) => (
              <span key={s.titleKey} className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-accent' : 'bg-bg-2'}`} />
            ))}
          </div>
          <div className="flex w-full gap-2 pt-1">
            {step > 0 && (
              <Button variant="outline" className="flex-1" data-testid="help-back" onClick={() => setStep((s) => s - 1)}>
                {t('help.back')}
              </Button>
            )}
            <Button
              className="flex-1"
              data-testid="help-next"
              onClick={() => (last ? onDone(tour.id) : setStep((s) => s + 1))}
            >
              {t(last ? 'help.done' : 'help.next')}
            </Button>
          </div>
          {tour.screen && (
            <button
              data-testid="help-interactive"
              onClick={() => onInteractive(tour.id)}
              className="m-tap border-none bg-transparent pb-1 text-[13px] font-medium text-accent-deep"
            >
              {t('help.interactive')}
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
