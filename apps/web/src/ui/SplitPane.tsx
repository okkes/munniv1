import type { ReactNode } from 'react';
import { Outlet, useChildMatches } from '@tanstack/react-router';
import { useLgViewport } from '@/lib/viewport';

/**
 * Master–detail panes (redesign §4.2), route-level since 2026-07-18:
 * the LIST route renders this layout and stays mounted while detail
 * child routes come and go through the Outlet — so opening a detail
 * smoothly shrinks the list aside and closing expands it back (user:
 * the old full remount read as a page refresh). Below lg (and in
 * tests) a matched detail fills the screen exactly as before.
 */
export function MasterDetailLayout({ list }: Readonly<{ list: ReactNode }>) {
  const panes = useLgViewport();
  const hasDetail = useChildMatches().length > 0;
  if (!panes) return hasDetail ? <Outlet /> : <>{list}</>;
  return (
    <div className="flex h-full min-h-0" data-testid="split-pane">
      <div
        className={`h-full min-w-0 shrink-0 transition-[width] duration-200 ease-out ${
          hasDetail ? 'w-[46%] max-w-[560px] border-r border-line' : 'w-full'
        }`}
      >
        {list}
      </div>
      <div className="h-full min-w-0 flex-1 overflow-hidden">
        {hasDetail && (
          <div className="m-pane-in h-full">
            <Outlet />
          </div>
        )}
      </div>
    </div>
  );
}
