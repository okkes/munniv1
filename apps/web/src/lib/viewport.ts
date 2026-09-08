import { useSyncExternalStore } from 'react';

/**
 * The one desktop breakpoint decision (redesign §4): at lg the app gains
 * side panels and master–detail panes. Shared so Sheet and SplitPane can
 * never disagree about where "desktop" begins.
 */
const LG_QUERY = '(min-width: 1024px)';

const subscribeLg = (listener: () => void) => {
  const mql = typeof window === 'undefined' ? undefined : window.matchMedia?.(LG_QUERY);
  mql?.addEventListener?.('change', listener);
  return () => mql?.removeEventListener?.('change', listener);
};
const readLg = () => (typeof window === 'undefined' ? false : (window.matchMedia?.(LG_QUERY)?.matches ?? false));

/** true on lg+ viewports; false during SSR and in unit tests */
export const useLgViewport = (): boolean => useSyncExternalStore(subscribeLg, readLg, () => false);

/**
 * Scroll only the NEAREST real scroller (overflow-y auto/scroll) to
 * center `el` in the visible band. Never scrollIntoView: that also
 * scrolls overflow-HIDDEN ancestors — inside a sheet it sheared the
 * container and clipped its header (user ss 2026-07-28). The band
 * respects the visualViewport so a keyboard-shrunk browser viewport
 * centers against what is actually on screen.
 */
/**
 * Nearest ancestor whose computed overflow-y allows scrolling — unlike
 * the reveal walk it does NOT require overflow to exist yet: the caller
 * may be about to CREATE it (keyboard bottom padding on iOS, where the
 * layout viewport never shrinks and a bottom field has no slack).
 */
export function nearestScrollport(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * iOS Safari/PWA never resizes the LAYOUT viewport for the keyboard —
 * only the visual viewport shrinks — so a screen scroller has no slack
 * to reveal a bottom field into (the notes textarea sat behind the
 * keyboard, user ss 2026-07-31). While a screen-level editable is
 * focused, the nearest scrollport borrows bottom padding equal to the
 * keyboard inset. Measurement-driven: on Android/native the layout
 * resizes with the keyboard, the inset reads ~0 and this is a no-op.
 */
let paddedScrollport: { el: HTMLElement; prev: string } | null = null;

export function restoreScrollportPad(): void {
  if (!paddedScrollport) return;
  paddedScrollport.el.style.paddingBottom = paddedScrollport.prev;
  paddedScrollport = null;
}

export function padScrollportForKeyboard(target: HTMLElement): void {
  const vv = window.visualViewport;
  const inset = Math.max(0, window.innerHeight - (vv?.height ?? window.innerHeight));
  if (inset < 40) return; // no keyboard-without-resize in play
  const scroller = nearestScrollport(target);
  if (!scroller) return;
  if (paddedScrollport && paddedScrollport.el !== scroller) restoreScrollportPad();
  paddedScrollport ??= { el: scroller, prev: scroller.style.paddingBottom };
  scroller.style.paddingBottom = `${inset + 16}px`;
}

export function revealInScroller(el: HTMLElement): void {
  const vv = window.visualViewport;
  const viewTop = vv?.offsetTop ?? 0;
  const viewBottom = viewTop + (vv?.height ?? window.innerHeight);
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    if (node.scrollHeight > node.clientHeight + 4) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        const box = node.getBoundingClientRect();
        const bandTop = Math.max(box.top, viewTop);
        const bandBottom = Math.min(box.bottom, viewBottom);
        const target = el.getBoundingClientRect();
        const delta = target.top + target.height / 2 - (bandTop + bandBottom) / 2;
        if (bandBottom > bandTop && Math.abs(delta) > 8) {
          node.scrollTo({ top: node.scrollTop + delta, behavior: 'smooth' });
        }
        return; // nearest scroller only — never shear outer containers
      }
    }
    node = node.parentElement;
  }
}
