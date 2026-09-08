import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, shot, teardown } from '../helpers/base.js';

// Trends: category bars, cash flow and net worth (demo data).

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`tr-a1 three trend views render their charts [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await page.goto('/#/trends');
    await page.waitForSelector('[data-testid="trends-cat-chart"]');
    await expect(page.locator('[data-testid="trends-cat-current"]')).toContainText('€');
    await shot(page, k('63-trends-categories'));

    await page.click('[data-testid="trends-view-cashflow"]');
    await page.waitForSelector('[data-testid="trends-flow-chart"]');
    await shot(page, k('64-trends-cashflow'));

    await page.click('[data-testid="trends-view-networth"]');
    await page.waitForSelector('[data-testid="trends-worth-chart"]');
    await expect(page.locator('[data-testid="trends-worth-now"]')).toContainText('€');
    await shot(page, k('65-trends-networth'));
    await teardown(page, ctx, k('65-trends-networth'));
  });

  test(`tr-a2 category picker narrows the bars to one main [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await page.goto('/#/trends');
    await page.waitForSelector('[data-testid="trends-cat-chart"]');
    await page.click('[data-testid="trends-cat-picker"]');
    await page.click('[data-testid="trends-cat-consumption"]');
    await expect(page.locator('[data-testid="trends-cat-picker"]')).toContainText('Consumption');
    await shot(page, k('66-trends-picker'));
    await teardown(page, ctx, k('66-trends-picker'));
  });
}
