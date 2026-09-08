import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, teardown } from '../helpers/base.js';

// #135: the CI half of leak detection — chromium drives the SAME shared
// code every platform ships (iOS WebKit included), cycles the main
// screens hard, and asserts the JS heap settles instead of climbing.
// The production half is lib/memWatch (GlitchTip, where a heap API
// exists). Thresholds are generous: this catches LEAKS, not churn.

const CYCLES = 6;
const MAX_GROWTH_BYTES = 30 * 1024 * 1024;

for (const V of VARIANTS) {
  test(`leak-a1 heap settles across screen cycles [${V.id}]`, async ({ browser }) => {
    // eight tab laps with double-GC pauses outrun the default 30s on CI
    test.setTimeout(150_000);
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });

    const cycle = async () => {
      await page.click('[data-testid="tab-transactions"]');
      await page.waitForSelector('[data-testid="tx-list"]');
      await page.click('[data-testid="tab-recurring"]');
      await page.click('[data-testid="tab-portfolio"]');
      await page.click('[data-testid="tab-settings"]');
      await page.click('[data-testid="tab-home"]');
      await page.waitForSelector('[data-testid="home-total-balance"]');
    };

    const cdp = await ctx.newCDPSession(page);
    const settledHeap = async () => {
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      await page.waitForTimeout(250);
      await cdp.send('HeapProfiler.collectGarbage');
      return page.evaluate(() => performance.memory.usedJSHeapSize);
    };

    // warm caches/lazy chunks first so the measured window is steady state
    await cycle();
    await cycle();
    const start = await settledHeap();
    for (let i = 0; i < CYCLES; i++) await cycle();
    const end = await settledHeap();

    expect(end - start).toBeLessThan(MAX_GROWTH_BYTES);
    await teardown(page, ctx, `70-leak-cycles--${V.id}`);
  });
}
