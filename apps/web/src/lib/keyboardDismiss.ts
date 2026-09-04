/**
 * Mobile keyboard dismissal (user requests 2026-08-05):
 *
 * 1. A touch-drag hides the on-screen keyboard — on SEARCH fields only
 *    (#312 r5, user): scrolling a result list means reading, so the
 *    keyboard goes; multi-field forms keep it while the user scrolls
 *    between inputs. Browsers only blur when a tap lands on another
 *    focusable, so search lists under an open keyboard left it
 *    standing. Listening to touchmove (not scroll) keeps focus-driven
 *    auto-scrolls from closing the keyboard the moment a field is
 *    tapped: the browser's reveal scroll fires scroll events but never
 *    touchmove.
 *
 * 2. Enter on a field that goes nowhere (search-as-you-type, notes)
 *    hides the keyboard — nothing submits, but reaching for Enter is
 *    muscle memory, so honor it by closing the keyboard. Shift+Enter
 *    still inserts newlines in textareas for hardware keyboards; IME
 *    confirmations (isComposing) pass through untouched.
 *
 * Both behaviors are coarse-pointer only — desktop pointer users keep
 * the exact current behavior (Enter shortcuts, focus retention).
 */

/** far enough that a wobbly tap never reads as a scroll */
const DRAG_THRESHOLD_PX = 12;

/** input types that summon NO on-screen keyboard (kept in step with
 *  AppLayout's tab-bar heuristic) — blurring a checkbox on drag would
 *  only fight its toggle */
const KEYBOARDLESS_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color']);

const isEditable = (el: EventTarget | null): el is HTMLElement =>
  el instanceof HTMLElement &&
  ((el.tagName === 'INPUT' && !KEYBOARDLESS_INPUTS.has((el as HTMLInputElement).type)) ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable);

const coarsePointer = (): boolean => window.matchMedia?.('(pointer: coarse)')?.matches ?? false;

export function installKeyboardDismiss(): () => void {
  let start: { x: number; y: number } | null = null;

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    start = t ? { x: t.clientX, y: t.clientY } : null;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!start || !coarsePointer()) return;
    const active = document.activeElement;
    if (!isEditable(active)) return;
    // #312 r5 (user): only SEARCH fields lose their keyboard to a
    // scroll — there, scrolling means reading the results. Multi-field
    // forms (a loan's inputs) keep the keyboard while the user scrolls
    // between fields.
    if (!active.closest('[data-search-dismiss]')) return;
    // a drag inside the focused field is caret/selection work — and
    // scrolling a long note must not close its own keyboard
    if (e.target instanceof Node && active.contains(e.target)) return;
    const t = e.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - start.x) < DRAG_THRESHOLD_PX && Math.abs(t.clientY - start.y) < DRAG_THRESHOLD_PX) return;
    active.blur();
    start = null; // one blur per gesture
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    // modified Enter keeps its meaning (Shift+Enter = newline on a
    // hardware keyboard attached to a tablet)
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!coarsePointer()) return;
    if (isEditable(e.target)) e.target.blur();
  };

  // capture: element-level stopPropagation (color wheel, drag blockers)
  // must not be able to starve the dismissal
  window.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
  window.addEventListener('keydown', onKeyDown);
  return () => {
    window.removeEventListener('touchstart', onTouchStart, true);
    window.removeEventListener('touchmove', onTouchMove, true);
    window.removeEventListener('keydown', onKeyDown);
  };
}
