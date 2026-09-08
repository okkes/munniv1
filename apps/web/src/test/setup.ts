import { configure } from '@testing-library/react';
import { afterAll } from 'vitest';

// coverage instrumentation slows liveQuery round-trips well past RTL's
// 1s default — every findBy*/waitFor gets headroom instead of piecemeal
// per-test timeouts (repeated flake source)
configure({ asyncUtilTimeout: 5000 });

/**
 * Global vitest setup. Unmounting a screen closes the per-identity
 * Dexie database while its liveQuery observables may still be
 * in-flight; Dexie rejects those with DatabaseClosedError. That is
 * expected teardown noise in tests (production keeps the db open for
 * the app's lifetime), so it must not fail the run as an unhandled
 * rejection.
 *
 * Vitest only reports process-level rejections when its own listener is
 * the single one registered — a user listener takes responsibility. So
 * this filter swallows the known teardown noise and rethrows everything
 * else as an uncaught exception, which vitest still fails the run on.
 */
const isTeardownNoise = (reason: unknown): boolean =>
  (reason as { name?: string } | undefined)?.name === 'DatabaseClosedError';

// the app tsconfig has no node types — structural access is enough here
const proc = (globalThis as { process?: { on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown } })
  .process;
proc?.on('unhandledRejection', (reason) => {
  if (isTeardownNoise(reason)) return;
  throw reason;
});

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (isTeardownNoise(event.reason)) event.preventDefault();
  });
}

// react-modal-sheet's open transition polls document for its container
// class (waitForElement: 50ms × 20 ticks) from a fire-and-forget async —
// a sheet opened near the end of a file leaves that interval ticking
// into environment teardown, where `document` no longer exists
// (unhandled ReferenceError fails the run). Let every DOM file's
// teardown wait out the poll so it self-terminates in a live document.
if (typeof window !== 'undefined') {
  afterAll(() => new Promise((resolve) => setTimeout(resolve, 1200)));
}

// happy-dom's default viewport is 1024×768 — exactly the lg breakpoint,
// which would silently flip every unit test into desktop mode (side-panel
// sheets, master–detail panes, duplicate pane testids). Tests run as the
// phone by default; desktop behavior is opted into per test by stubbing
// matchMedia. (Domain tests run in node env — no window there.)
if (typeof window !== 'undefined') {
  (window as unknown as { happyDOM?: { setViewport?: (v: { width: number; height: number }) => void } }).happyDOM?.setViewport?.({
    width: 390,
    height: 844,
  });
}
