// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installViewportGuard } from './viewportGuard';

/**
 * The shell must never stay scrolled (iOS keyboard focus-scroll ignores
 * overflow: hidden and can leave the app displaced — "tripped" sheets).
 */
describe('installViewportGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));

  it('snaps a drifted window back to the origin', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 120 });
    const uninstall = installViewportGuard();

    window.dispatchEvent(new Event('scroll'));
    await raf();

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    uninstall();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('stays quiet at the origin and stops listening after uninstall', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const uninstall = installViewportGuard();

    window.dispatchEvent(new Event('scroll')); // scrollY is 0 — nothing to fix
    await raf();
    expect(scrollTo).not.toHaveBeenCalled();

    uninstall();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 80 });
    window.dispatchEvent(new Event('scroll'));
    await raf();
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
});
