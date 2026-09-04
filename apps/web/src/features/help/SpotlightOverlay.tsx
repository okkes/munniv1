import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '@/i18n';
import type { Tour } from './tours';
import { Button } from '@/ui/Button';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const FIND_TRIES = 12; // ~1.5s for screen transitions to land the anchor
const PAD = 6;

/**
 * Layer 3: the "try it yourself" walkthrough — dims the screen, cuts a
 * hole around the real element and explains it. Steps whose anchor is
 * missing (empty states) show their sample illustration instead of
 * being skipped (ruling: no empty-state tours).
 */
export function SpotlightOverlay({
  tour,
  step,
  onStep,
  onEnd,
}: Readonly<{
  tour: Tour;
  step: number;
  onStep: (step: number) => void;
  onEnd: () => void;
}>) {
  const { t } = useLang();
  const current = tour.steps[step];
  const [phase, setPhase] = useState<'looking' | 'found' | 'missing'>('looking');
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!current.anchor) {
      setPhase('missing');
      setRect(null);
      return;
    }
    setPhase('looking');
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const el = document.querySelector(`[data-testid="${current.anchor}"]`);
      if (el) {
        el.scrollIntoView?.({ block: 'center' });
        const r = el.getBoundingClientRect();
        setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
        setPhase('found');
        return;
      }
      tries += 1;
      if (tries >= FIND_TRIES) setPhase('missing');
      else timer = setTimeout(look, 125);
    };
    look();
    return () => clearTimeout(timer);
  }, [current.anchor, step]);

  const advance = () => {
    if (step + 1 >= tour.steps.length) {
      onEnd();
    } else {
      onStep(step + 1);
    }
  };

  const tapForward = () => {
    if (current.advanceOn !== 'tap' || !current.anchor) return;
    const el = document.querySelector<HTMLElement>(`[data-testid="${current.anchor}"]`);
    el?.click();
    advance();
  };

  const spotlight = phase === 'found' && rect !== null;

  // card placement is measured, not CSS-anchored: bottom-anchoring above
  // a TALL anchor (the review card) pushed the card's top clean off the
  // screen (user ss 2026-07-28) — measure the card, place it under/over
  // the anchor, then clamp inside the viewport + status-bar safe area
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const vh = globalThis.innerHeight || 800;
    const h = el.offsetHeight;
    let top: number;
    if (!rect) top = vh * 0.3;
    else if (rect.top + rect.height < vh / 2) top = rect.top + rect.height + 12;
    else top = rect.top - 12 - h;
    top = Math.min(top, vh - h - 12);
    el.style.top = `max(calc(env(safe-area-inset-top, 0px) + 8px), ${Math.round(top)}px)`;
  }, [rect, phase, step]);

  return createPortal(
    <div className="fixed inset-0 z-[120]" data-testid="spotlight-overlay">
      {/* backdrop with a cutout (four panes when anchored, full when not) */}
      {spotlight ? (
        <>
          <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: Math.max(0, rect.top) }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ top: rect.top + rect.height }} />
          <div className="absolute left-0 bg-black/55" style={{ top: rect.top, height: rect.height, width: Math.max(0, rect.left) }} />
          <div className="absolute right-0 bg-black/55" style={{ top: rect.top, height: rect.height, left: rect.left + rect.width }} />
          <button
            aria-label={t(current.titleKey)}
            data-testid="spotlight-target"
            onClick={tapForward}
            className="absolute rounded-xl border-2 border-accent bg-transparent"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, cursor: current.advanceOn === 'tap' ? 'pointer' : 'default' }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      {/* the step card (top written by the measuring effect above) */}
      <div
        ref={cardRef}
        data-testid="spotlight-card"
        className="absolute inset-x-4 rounded-card border border-line bg-surface p-4 shadow-xl"
      >
        {phase === 'missing' && (
          <div className="pb-1 text-center text-[34px] leading-none" aria-hidden>
            {current.illustration}
          </div>
        )}
        <p className="text-[14px] font-semibold text-ink" data-testid="spotlight-title">
          {t(current.titleKey)}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{t(current.bodyKey)}</p>
        {phase === 'missing' && current.anchor && (
          <p className="mt-1 text-[11px] text-ink-4" data-testid="spotlight-sample-note">
            {t('help.sample')}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-1 gap-1.5" data-testid="spotlight-dots">
            {tour.steps.map((s, i) => (
              <span key={s.titleKey} className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-accent' : 'bg-bg-2'}`} />
            ))}
          </div>
          <button data-testid="spotlight-end" onClick={onEnd} className="m-tap border-none bg-transparent text-[12px] text-ink-4">
            {t('help.end')}
          </button>
          {!(spotlight && current.advanceOn === 'tap') && (
            <Button size="sm" data-testid="spotlight-next" onClick={advance}>
              {t(step + 1 >= tour.steps.length ? 'help.done' : 'help.next')}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
