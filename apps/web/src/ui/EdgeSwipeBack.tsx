import { useEffect } from 'react';
import { hasOpenSheet } from './Sheet';

// gesture tuning: iOS-like — must START at the very screen edge, travel
// mostly horizontally, and cover real distance before it counts
const EDGE_PX = 24;
const MIN_DX = 70;
const MAX_DY = 60;

/** screens with a visible back arrow opt in implicitly: every AppBar back
 *  button carries a `*-back` testid (DetailBackButton included) */
const backButtonPresent = () =>
  document.querySelector('[data-testid$="-back"]') !== null;

/**
 * App-wide edge-swipe back (user request): a horizontal swipe from the
 * left screen edge acts like the back arrow on any screen that shows
 * one. Sheets keep their own gestures — an open sheet stands down the
 * global one — and screens without a back arrow ignore it entirely, so
 * tab roots never navigate away by accident.
 */
export function EdgeSwipeBack() {
  useEffect(() => {
    let startX = -1;
    let startY = -1;
    let armed = false;

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      armed = touch.clientX <= EDGE_PX && !hasOpenSheet() && backButtonPresent();
      startX = touch.clientX;
      startY = touch.clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (!armed) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dy > MAX_DY) {
        armed = false; // wandered vertically — it's a scroll, not a back
        return;
      }
      if (dx >= MIN_DX) {
        armed = false;
        window.history.back();
      }
    };
    const onEnd = () => {
      armed = false;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);
  return null;
}
