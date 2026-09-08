import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Smooth expand/collapse for every tap-to-unfold section (user request:
 * folds were instant). The grid-rows 0fr→1fr trick animates to natural
 * height with no measuring. Children stay mounted through the CLOSING
 * transition (a brief tail) so the fold has something to shrink, then
 * unmount — queries and tests keep seeing closed sections as absent.
 */
export function Collapse({ open, children }: Readonly<{ open: boolean; children: ReactNode }>) {
  const [mounted, setMounted] = useState(open);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (open && !mounted) setMounted(true); // render-time, so opening never lags a frame
  useEffect(() => {
    if (open || !mounted) return;
    closeTimer.current = setTimeout(() => setMounted(false), 240);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open, mounted]);

  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out"
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
    >
      <div className="min-h-0 overflow-hidden">{mounted ? children : null}</div>
    </div>
  );
}
