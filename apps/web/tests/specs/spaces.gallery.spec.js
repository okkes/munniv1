import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, gotoSpaces, shot, teardown } from '../helpers/base.js';

// --- Tests ------------------------------------------------------------------

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`spaces-a1 list shows demo space active [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await gotoSpaces(page);
    await expect(page.locator('[data-testid="space-row-demo_space"]')).toContainText('Demo');
    await expect(page.locator('[data-testid="space-row-demo_space"]')).toContainText('Active space');
    await shot(page, k('22-spaces-list'));
    await teardown(page, ctx, k('22-spaces-list'));
  });

  test(`spaces-a2 create space switches scope; switching back restores data [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await gotoSpaces(page);
    await page.click('[data-testid="spaces-add"]');
    await page.fill('[data-testid="space-create-name"]', 'Holiday Fund');
    await page.waitForTimeout(400);
    await shot(page, k('23-spaces-create') + '--s1');
    await page.click('[data-testid="space-create-save"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="screen-spaces"]')).toContainText('Holiday Fund');
    // new space is active and empty: home total is €0.00
    await page.click('[data-testid="tab-home"]');
    await expect(page.locator('[data-testid="home-total-balance"]')).toContainText('0.00');
    await shot(page, k('23-spaces-create') + '--s2');
    // switch back to Demo: totals return
    await gotoSpaces(page);
    await page.click('[data-testid="space-row-demo_space"]');
    await page.click('[data-testid="tab-home"]');
    await expect(page.locator('[data-testid="home-total-balance"]')).toContainText('8,080.55');
    await shot(page, k('23-spaces-create'));
    await teardown(page, ctx, k('23-spaces-create'));
  });

  test(`spaces-a3 rename; delete guards active and last space [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await gotoSpaces(page);
    // deleting the only/active space is blocked
    await page.click('[data-testid="space-edit-demo_space"]');
    await page.click('[data-testid="space-edit-delete"]');
    await expect(page.locator('[data-testid="space-delete-error"]')).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, k('24-spaces-guards') + '--s1');
    // rename works
    await page.fill('[data-testid="space-edit-name"]', 'Household');
    await page.click('[data-testid="space-edit-save"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="space-row-demo_space"]')).toContainText('Household');
    await shot(page, k('24-spaces-guards'));
    await teardown(page, ctx, k('24-spaces-guards'));
  });
}
