import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

/**
 * Pointer-driven row reorder for the customize screens, v3. The pressed
 * row hides, a floating GHOST follows the finger, the other rows slide
 * out of the way, and on release the ghost SETTLES into its slot before
 * the move commits (user request — the instant snap left "did it land
 * where I wanted?" doubt).
 *
 * Engine notes (all three learned from device runs, user ss 2026-07-28):
 * - listeners live on WINDOW while a drag is live — element-scoped
 *   events died with pointer capture the moment the browser reclaimed
 *   the gesture, freezing the ghost mid-screen (iOS + Android);
 * - row rects are CACHED at drag start — a rect read per row per move
 *   forced layout on every event and melted mobile main threads;
 * - the ghost is positioned imperatively — React state changes only
 *   when the hovered slot changes, never per move.
 */
interface DragState {
  from: number;
  over: number;
  height: number;
}

type Rect = { top: number; bottom: number; left: number; width: number; height: number };

export interface DragReorder {
  drag: { from: number; over: number } | null;
  /** mount-time rect for the floating clone; `top` is driven
   *  imperatively afterwards (per-frame follow + settle) */
  ghostRect: { left: number; width: number; height: number } | null;
  setRowRef: (index: number) => (el: HTMLElement | null) => void;
  setGhostRef: (el: HTMLDivElement | null) => void;
  /** slide/fade styling for row `index` while a drag is live */
  rowStyle: (index: number) => CSSProperties;
  /** spread onto the drag handle of row `index` */
  handleProps: (index: number) => {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    style: { touchAction: 'none' };
  };
}

/** keep long lists draggable end-to-end: nudge the nearest scrollable
 *  ancestor while the pointer rides the viewport edges */
function findScrollParent(anchor: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = anchor;
  while (node && node !== document.body) {
    const canScroll = node.scrollHeight > node.clientHeight + 4;
    if (canScroll && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

const SETTLE_MS = 170;
const EDGE = 56;

export function useDragReorder(count: number, onMove: (from: number, to: number) => void): DragReorder {
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const ghostEl = useRef<HTMLDivElement | null>(null);
  const rects = useRef<Rect[]>([]);
  const pointerY = useRef(0);
  const stateRef = useRef<DragState | null>(null);
  const settling = useRef(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghostRect, setGhostRect] = useState<DragReorder['ghostRect']>(null);
  const active = drag !== null;

  const setRowRef = (index: number) => (el: HTMLElement | null) => {
    rowRefs.current[index] = el;
  };
  const setGhostRef = (el: HTMLDivElement | null) => {
    ghostEl.current = el;
    const current = stateRef.current;
    if (el && current) el.style.top = `${pointerY.current - current.height / 2}px`;
  };

  useEffect(() => {
    if (!active) return;
    const scroller = findScrollParent(rowRefs.current[stateRef.current?.from ?? 0]);

    const positionGhost = () => {
      const current = stateRef.current;
      const el = ghostEl.current;
      if (el && current) el.style.top = `${pointerY.current - current.height / 2}px`;
    };
    const overAt = (y: number): number => {
      for (let i = 0; i < rects.current.length; i += 1) {
        const r = rects.current[i];
        if (y < r.top + r.height / 2) return i;
      }
      return rects.current.length - 1;
    };
    const retarget = () => {
      const current = stateRef.current;
      if (!current || settling.current) return;
      const over = overAt(pointerY.current);
      if (over !== current.over) {
        stateRef.current = { ...current, over };
        setDrag(stateRef.current);
      }
    };
    const finish = () => {
      stateRef.current = null;
      settling.current = false;
      setDrag(null);
      setGhostRect(null);
    };
    let settleTimer = 0;
    const settleInto = (commit: boolean) => {
      const current = stateRef.current;
      if (!current || settling.current) return;
      settling.current = true;
      const el = ghostEl.current;
      if (el) {
        // the vacated slot's viewport top: rows between origin and the
        // hovered slot are slid one row-height toward the hole
        let target = rects.current[current.from]?.top ?? 0;
        if (commit && current.over !== current.from) {
          target =
            current.from < current.over
              ? (rects.current[current.over]?.bottom ?? 0) - current.height
              : (rects.current[current.over]?.top ?? 0);
        }
        // the ghost doesn't just land — it DRESSES DOWN into a plain row
        // while settling, so the accent border/shadow never pops off
        // abruptly at the end (user request)
        el.style.transition = `top ${SETTLE_MS}ms ease, background-color ${SETTLE_MS}ms ease, border-color ${SETTLE_MS}ms ease, box-shadow ${SETTLE_MS}ms ease`;
        el.style.top = `${target}px`;
        el.style.backgroundColor = 'var(--m-bg)';
        el.style.borderColor = 'transparent';
        el.style.boxShadow = 'none';
      }
      settleTimer = window.setTimeout(() => {
        const done = stateRef.current;
        if (commit && done && done.over !== done.from) onMoveRef.current(done.from, done.over);
        finish();
      }, el ? SETTLE_MS : 0);
    };
    const onPointerMove = (e: PointerEvent) => {
      pointerY.current = e.clientY;
      positionGhost();
      retarget();
    };
    const onUp = () => settleInto(true);
    // the browser reclaimed the pointer — that is a CANCEL, never a drop
    const onCancel = () => settleInto(false);
    // the drag owns every touch until the finger lifts — without this,
    // Android reclaims the gesture as a scroll mid-drag
    const blockTouch = (ev: TouchEvent) => {
      if (ev.cancelable) ev.preventDefault();
    };

    // holding still near an edge must keep scrolling — hence a rAF loop;
    // the cached rects shift WITH the content so slot math stays honest
    let raf = requestAnimationFrame(function tick() {
      if (scroller && !settling.current) {
        const rect = scroller.getBoundingClientRect();
        let dy = 0;
        if (pointerY.current < rect.top + EDGE) dy = -Math.ceil((rect.top + EDGE - pointerY.current) / 6);
        else if (pointerY.current > rect.bottom - EDGE) dy = Math.ceil((pointerY.current - (rect.bottom - EDGE)) / 6);
        if (dy !== 0) {
          const before = scroller.scrollTop;
          scroller.scrollTop += dy;
          const moved = scroller.scrollTop - before;
          if (moved !== 0) {
            rects.current = rects.current.map((r) => ({ ...r, top: r.top - moved, bottom: r.bottom - moved }));
            retarget();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    });

    positionGhost();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', blockTouch, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', blockTouch);
    };
  }, [active]);

  const handleProps = (index: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (stateRef.current || settling.current) return; // one drag at a time
      e.preventDefault(); // no selection/native gestures from the handle
      const snapshot: Rect[] = [];
      for (let i = 0; i < count; i += 1) {
        const el = rowRefs.current[i];
        const r = el?.getBoundingClientRect();
        snapshot.push(r ? { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height } : { top: 0, bottom: 0, left: 0, width: 0, height: 0 });
      }
      rects.current = snapshot;
      const rect = snapshot[index];
      const height = rect.height || 44;
      pointerY.current = e.clientY;
      stateRef.current = { from: index, over: index, height };
      setDrag(stateRef.current);
      setGhostRect({ left: rect.left, width: rect.width, height });
    },
    style: { touchAction: 'none' as const },
  });

  // rows between the origin and the hovered slot slide one row-height
  // toward the hole; the origin row stays put but HIDES entirely — at
  // 0.3 opacity its text shone through the row sliding over it and the
  // list read as glitched (user ss)
  const rowStyle = (index: number): CSSProperties => {
    if (!drag) return { transition: 'transform 160ms ease' };
    const base: CSSProperties = { transition: 'transform 160ms ease' };
    if (index === drag.from) return { ...base, opacity: 0 };
    if (drag.from < drag.over && index > drag.from && index <= drag.over) {
      return { ...base, transform: `translateY(-${drag.height}px)` };
    }
    if (drag.from > drag.over && index >= drag.over && index < drag.from) {
      return { ...base, transform: `translateY(${drag.height}px)` };
    }
    return base;
  };

  return { drag: drag && { from: drag.from, over: drag.over }, ghostRect, setRowRef, setGhostRef, rowStyle, handleProps };
}
