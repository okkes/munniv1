/**
 * #153 (user): desktop mice without a horizontal wheel — vertical
 * wheeling over a horizontal-only scroller (icon strips, chip rows,
 * filter bars) drives it sideways. ONE bubble-phase listener covers the
 * whole app; the first scrollable ancestor decides: a vertical scroller
 * keeps the wheel, a horizontal one consumes it, and at either end the
 * event falls through so the page keeps scrolling naturally.
 */
export function wheelToHorizontal(e: WheelEvent): void {
  // ctrl+wheel is zoom; pure-horizontal wheels already work
  if (e.deltaY === 0 || e.ctrlKey || e.defaultPrevented) return;
  let el = e.target instanceof Element ? e.target : null;
  for (; el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) return;
    const cs = getComputedStyle(el);
    const scrollsY = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
    if (scrollsY) return;
    const scrollsX = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
    if (scrollsX) {
      const before = el.scrollLeft;
      el.scrollLeft = before + e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault();
      return;
    }
  }
}
