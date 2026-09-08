/**
 * iOS keyboard reveal (#129): focusing a field low on the screen left it
 * BURIED under the keyboard. WebKit runs its scroll-into-view the moment
 * a field takes focus — while the viewport is still full height — and
 * only THEN does the keyboard shrink the webview (Capacitor shell,
 * resize "native") or inset the visual viewport (Safari/PWA). Nothing
 * re-scrolls after the shrink, so the field ends up hidden. Android
 * resizes first and re-scrolls, which is why it behaves.
 *
 * The fix is one late pass: whenever the visual viewport resizes (the
 * keyboard arriving) or focus moves while it's already up, check the
 * focused editable and scroll it back into the visible half if the
 * keyboard swallowed it. scrollIntoView walks nested overflow parents,
 * which our screens use everywhere.
 *
 * Viewport injected for tests (happy-dom has no visualViewport).
 */

const isEditable = (el: EventTarget | null): el is HTMLElement =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

/** the keyboard animation window — reveal after it settles */
const FOCUS_SETTLE_MS = 300;
/** breathing room between the field and the keyboard's edge */
const MARGIN_PX = 8;

interface ViewportLike {
  readonly height: number;
  readonly offsetTop: number;
  addEventListener: (type: 'resize', listener: () => void) => void;
  removeEventListener: (type: 'resize', listener: () => void) => void;
}

export function installKeyboardReveal(viewport: ViewportLike | null = globalThis.visualViewport): () => void {
  if (!viewport) return () => {};
  let settle: ReturnType<typeof setTimeout> | undefined;

  const reveal = () => {
    const active = document.activeElement;
    if (!isEditable(active)) return;
    const rect = active.getBoundingClientRect();
    // the visible band in layout coordinates: the visual viewport can
    // both shrink (keyboard) and shift (iOS pins it below the URL bar)
    const visibleTop = viewport.offsetTop;
    const visibleBottom = viewport.offsetTop + viewport.height;
    if (rect.bottom > visibleBottom - MARGIN_PX || rect.top < visibleTop) {
      active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  const schedule = () => {
    clearTimeout(settle);
    settle = setTimeout(reveal, FOCUS_SETTLE_MS);
  };

  // keyboard shows/hides → the viewport resizes → one settled pass;
  // focus hopping between fields under an OPEN keyboard never resizes,
  // so focusin schedules its own pass
  viewport.addEventListener('resize', schedule);
  window.addEventListener('focusin', schedule);
  return () => {
    clearTimeout(settle);
    viewport.removeEventListener('resize', schedule);
    window.removeEventListener('focusin', schedule);
  };
}
