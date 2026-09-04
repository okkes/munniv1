/**
 * Touch affordance: resting a finger on any .m-tap element flashes its
 * pressed state, and a scroll taking over interrupts the animation —
 * the "almost clicked" hint that marks what is tappable. Browsers
 * suppress :active during scroll-intent on touch, so this is driven by
 * pointer events instead (mouse keeps plain :active from CSS).
 */
export function initPressFeedback(): void {
  let pressed: HTMLElement | null = null;
  let timer: number | undefined;

  const clear = () => {
    clearTimeout(timer);
    if (pressed) delete pressed.dataset.pressed;
    pressed = null;
  };

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse') return; // CSS :active covers mice
      const raw = e.target as Element;
      // touch pointers capture their hit-test target implicitly; a
      // long-press that opens the context menu (copy-link on an <a>)
      // swallows the matching pointerup, and the element then keeps
      // swallowing the NEXT touches too — every tap "pressed" the link
      // until the app was killed (user bug). Nothing needs capture, so
      // drop it up front.
      if (raw instanceof HTMLElement && raw.hasPointerCapture?.(e.pointerId)) {
        raw.releasePointerCapture(e.pointerId);
      }
      const target = raw.closest?.('.m-tap');
      if (!(target instanceof HTMLElement)) return;
      clear();
      // tiny delay: a fast flick should scroll without flashing every row;
      // a finger that actually rests gets the pressed look
      timer = window.setTimeout(() => {
        pressed = target;
        target.dataset.pressed = '';
      }, 60);
    },
    { passive: true },
  );
  document.addEventListener('pointerup', clear, { passive: true });
  // the browser fires pointercancel the moment scrolling takes the
  // gesture — exactly the "interrupted press" moment
  document.addEventListener('pointercancel', clear, { passive: true });
  document.addEventListener('scroll', clear, { capture: true, passive: true });
  // long-press context menu (copy link) and app switches (opening the
  // store's login browser) both suppress the trailing pointerup — the
  // pressed look must not survive them
  document.addEventListener('contextmenu', clear, { capture: true });
  document.addEventListener('visibilitychange', clear);
}
