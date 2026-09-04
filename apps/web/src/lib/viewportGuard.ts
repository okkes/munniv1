/**
 * iOS keyboard scroll guard. The app is a fixed full-height shell
 * (html/body overflow: hidden) whose document must never scroll — every
 * screen scrolls internally. iOS ignores overflow: hidden when it
 * focus-scrolls the layout viewport to reveal an input under the
 * keyboard (WebKit quirk), and that shift can stick after the keyboard
 * closes: the whole app sits displaced and open sheets look "tripped"
 * halfway up the screen. Snap the window back whenever it drifts; the
 * sheet's own keyboard avoidance does the actual lifting.
 */
export function installViewportGuard(): () => void {
  let raf = 0;
  const snapBack = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    });
  };
  window.addEventListener('scroll', snapBack);
  window.visualViewport?.addEventListener('scroll', snapBack);
  window.visualViewport?.addEventListener('resize', snapBack);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('scroll', snapBack);
    window.visualViewport?.removeEventListener('scroll', snapBack);
    window.visualViewport?.removeEventListener('resize', snapBack);
  };
}
