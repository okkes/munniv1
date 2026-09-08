import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Where you were in a list stays where you were (#131): opening a row
 * and coming back must not reset the scroll to the top. Every list
 * screen scrolls an INNER container (not the window), and unmounts on
 * navigation — so the position is remembered per list in
 * sessionStorage and restored on the next mount.
 *
 * Restoring retries across a few frames: the list's rows arrive from
 * live queries after the first paint, and a scrollTop set before the
 * content exists silently clamps to 0.
 *
 * `attachScrollMemory` is a ref callback (`ref={(el) =>
 * attachScrollMemory(el, 'debts')}`) so screens adopt it without
 * restructuring; the hook wraps it for screens that hold their own ref.
 */

const KEY_PREFIX = 'munni_scroll_';
/** frames to wait for the content to grow past the stored offset */
const RESTORE_ATTEMPTS = 20;

const active = new Map<string, () => void>();

export function attachScrollMemory(el: HTMLElement | null, id: string): void {
  // re-attachment (or unmount) always retires the previous listener
  active.get(id)?.();
  active.delete(id);
  if (!el) return;

  const storageKey = KEY_PREFIX + id;
  const stored = Number(sessionStorage.getItem(storageKey) ?? '0');
  let target: number | null = Number.isFinite(stored) && stored > 0 ? stored : null;

  let raf = 0;
  let attempts = 0;
  const tryRestore = () => {
    if (target === null) return;
    el.scrollTop = target;
    attempts += 1;
    // done once the content is tall enough to actually hold the spot
    if (Math.abs(el.scrollTop - target) <= 1 || attempts >= RESTORE_ATTEMPTS) {
      target = null;
      return;
    }
    raf = requestAnimationFrame(tryRestore);
  };
  raf = requestAnimationFrame(tryRestore);

  const onScroll = () => {
    // the restore's own scroll events must not overwrite the memory;
    // once it settles, every scroll is the user's and becomes the memory
    if (target === null) sessionStorage.setItem(storageKey, String(Math.round(el.scrollTop)));
  };
  el.addEventListener('scroll', onScroll, { passive: true });
  active.set(id, () => {
    cancelAnimationFrame(raf);
    el.removeEventListener('scroll', onScroll);
  });
}

export function useScrollMemory(ref: RefObject<HTMLElement | null>, id: string): void {
  useLayoutEffect(() => {
    attachScrollMemory(ref.current, id);
    return () => attachScrollMemory(null, id);
    // the id is stable per screen; the element lives for the screen's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}
