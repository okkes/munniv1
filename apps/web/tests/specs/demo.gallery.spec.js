import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, shot, teardown } from '../helpers/base.js';

// --- Tests ------------------------------------------------------------------

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`demo-a1 login screen then continue as demo [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V);
    await expect(page.locator('[data-testid="login-demo-btn"]')).toBeVisible();
    await shot(page, k('06-demo-login') + '--s1');
    await page.click('[data-testid="login-demo-btn"]');
    await page.waitForSelector('[data-testid="home-total-balance"]');
    // checking €3,420.55 + savings €8,150.00 − the v2 loans €3,490.00
    await expect(page.locator('[data-testid="home-total-balance"]')).toContainText('8,080.55');
    await shot(page, k('06-demo-login'));
    await teardown(page, ctx, k('06-demo-login'));
  });

  test(`demo-a2 seeded transactions list [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await page.click('[data-testid="tab-transactions"]');
    await expect(page.locator('[data-testid="tx-list"]')).toBeVisible();
    // seeded dataset contains recurring Spotify + salary from Demo Corp BV
    await expect(page.locator('[data-testid="tx-list"]')).toContainText('Spotify');
    await shot(page, k('07-demo-tx-list'));
    await teardown(page, ctx, k('07-demo-tx-list'));
  });

  test(`demo-a3 sign out resets demo and returns to login [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await page.click('[data-testid="tab-settings"]');
    await shot(page, k('08-demo-signout') + '--s1');
    await page.click('[data-testid="settings-signout"]');
    await expect(page.locator('[data-testid="screen-login"]')).toBeVisible();
    // the demo database is wiped on sign-out; next login reseeds pristine data
    await expect
      .poll(async () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name)), {
        timeout: 5000,
      })
      .not.toContain('munni_demo');
    await shot(page, k('08-demo-signout'));
    await teardown(page, ctx, k('08-demo-signout'));
  });
}
