import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, UIEvent } from 'react';

/**
 * #273 r2 (user): the ride-along search moves 1:1 WITH the scroll — as
 * if it were list content, not a fixed header. A little downward travel
 * hides a little of the field; upward travel reveals it by exactly the
 * scrolled amount. No animation, no thresholds — the finger owns the
 * motion. This pair is the one mechanic for every scroll-away search:
 *
 * - `useSearchCollapse` accumulates the scroll delta into an offset in
 *   [0, field height]; rubber-band frames (top bounce, bottom
 *   overscroll) never count.
 * - `CollapsingSearch` clips its measured content by that offset and
 *   slides it, so the list below flows into the freed space in the same
 *   frame the finger moves.
 */
export function useSearchCollapse(searchH: number, resetKey?: unknown) {
  const [offset, setOffset] = useState(0);
  const lastScrollTop = useRef(0);
  // #273 r3 (user): a sheet that stays mounted reopens with the field
  // collapsed from last time — hosts reset on open
  const reset = () => {
    setOffset(0);
    lastScrollTop.current = 0;
  };
  // #323 (user): filtering shrinks the content while the offset still
  // held the field collapsed — the stale slack left phantom scroll range
  // that rubber-banded at the list's end forever. A resetKey change (the
  // query) restores the whole field; hosts rewind their scroller with it.
  const keyRef = useRef(resetKey);
  useEffect(() => {
    if (Object.is(keyRef.current, resetKey)) return;
    keyRef.current = resetKey;
    setOffset(0);
    lastScrollTop.current = 0;
  }, [resetKey]);
  const onListScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const top = el.scrollTop;
    const delta = top - lastScrollTop.current; // > 0 → scrolling down
    lastScrollTop.current = Math.max(0, top);
    const maxTop = el.scrollHeight - el.clientHeight;
    // rubber band: bounce frames at either end must not eat the field
    if (top < 0 || top > maxTop) return;
    // #323 (user): collapsing frees exactly as much viewport as it hides,
    // so near the end of a SHORT (filtered) list unchecked growth would
    // overshoot the content — the browser clamps back and the tug-of-war
    // bounces forever. Growth spends at most the scroll room still below.
    const step = delta > 0 ? Math.min(delta, Math.max(0, maxTop - top)) : delta;
    setOffset((prev) => Math.min(searchH, Math.max(0, prev + step)));
  };
  return { offset, searchH, onListScroll, reset };
}

export function CollapsingSearch({
  offset,
  children,
  testId,
}: Readonly<{ offset: number; children: ReactNode; testId?: string }>) {
  const inner = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (inner.current) setMeasured(inner.current.scrollHeight);
  }, [children]);
  // `|| 200`: environments without layout (tests) measure 0 — the field
  // must still show fully at offset 0
  const full = measured || 200;
  const height = Math.max(0, full - offset);
  return (
    <div
      data-testid={testId}
      className="overflow-hidden"
      style={{
        height,
        pointerEvents: height === 0 ? 'none' : undefined,
      }}
    >
      {/* the content slides away under the clip — a real scroll-out */}
      <div ref={inner} style={{ transform: offset ? `translateY(-${offset}px)` : undefined }}>
        {children}
      </div>
    </div>
  );
}
