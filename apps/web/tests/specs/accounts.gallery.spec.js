import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, gotoGlobalSettings, shot, teardown } from '../helpers/base.js';

// --- Tests ------------------------------------------------------------------

async function goToAccounts(page) {
  await gotoGlobalSettings(page);
  await page.click('[data-testid="settings-accounts-row"]');
  await page.waitForSelector('[data-testid="screen-accounts"]');
}

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`acct-a1 list shows seeded demo accounts [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await goToAccounts(page);
    await expect(page.locator('[data-testid="account-row-demo_main"]')).toContainText('Demo Checking');
    await expect(page.locator('[data-testid="account-row-demo_save"]')).toContainText('8,150.00');
    await shot(page, k('16-accounts-list'));
    await teardown(page, ctx, k('16-accounts-list'));
  });

  test(`acct-a2 add manual cash account updates list and home total [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await goToAccounts(page);
    await page.click('[data-testid="accounts-add"]');
    // manual is a DOOR on the global screen now (2026-07-28): it leads
    // into the space's own accounts screen, where creation lives
    await page.click('[data-testid="chooser-manual-door"]');
    // "Add a manual account" opens the type grid directly (2026-08-01)
    await page.click('[data-testid="space-accounts-add"]');
    await page.waitForSelector('[data-testid="chooser-accttype-cash"]');
    await page.waitForTimeout(500); // sheet slide-in
    await shot(page, k('17-accounts-add') + '--s1');
    await page.click('[data-testid="chooser-accttype-cash"]');
    await page.fill('[data-testid="chooser-acctform-name"]', 'Wallet');
    await page.fill('[data-testid="chooser-acctform-balance"]', '52,50');
    await shot(page, k('17-accounts-add') + '--s2');
    await page.click('[data-testid="chooser-acctform-save"]');
    await page.waitForTimeout(500); // sheet slide-out
    // the fresh manual account lists on the SPACE's accounts screen…
    await expect(page.locator('[data-testid="screen-space-accounts"]')).toContainText('Wallet');
    // …and the global overview shows it inside its space segment
    await page.click('[data-testid="spaceaccounts-back"]');
    await expect(page.locator('[data-testid^="accounts-space-"]')).toContainText('Wallet');
    await expect(page.locator('[data-testid^="accounts-space-"]')).toContainText('52.50');
    // home total includes the new account: 8,080.55 + 52.50 (the demo's
    // v2 loan accounts weigh on the band now)
    await page.click('[data-testid="tab-home"]');
    await expect(page.locator('[data-testid="home-total-balance"]')).toContainText('8,133.05');
    await shot(page, k('17-accounts-add'));
    await teardown(page, ctx, k('17-accounts-add'));
  });

  test(`acct-a3 rename and delete via edit sheet [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await goToAccounts(page);
    await page.click('[data-testid="account-row-demo_save"]');
    await page.waitForSelector('[data-testid="acctedit-name"]');
    await page.fill('[data-testid="acctedit-name"]', 'Rainy Day Fund');
    await page.click('[data-testid="acctedit-save"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="account-row-demo_save"]')).toContainText('Rainy Day Fund');
    await shot(page, k('18-accounts-edit') + '--s1');
    // delete it: tombstone removes it from the list and the home total
    await page.click('[data-testid="account-row-demo_save"]');
    await page.click('[data-testid="acctedit-delete"]');
    // aligned destructive deletes: the danger sheet asks first, and its
    // confirm arms only after the cooldown (5s in real builds)
    const removeConfirm = page.locator('[data-testid="acctedit-remove-confirm"]');
    await expect(removeConfirm).toBeEnabled({ timeout: 10_000 });
    await removeConfirm.click();
    await expect(page.locator('[data-testid="account-row-demo_save"]')).toHaveCount(0);
    await page.click('[data-testid="tab-home"]');
    // 8,080.55 − 8,150.00 savings: the v2 demo loans keep weighing in,
    // so deleting the big savings account honestly dips below zero
    await expect(page.locator('[data-testid="home-total-balance"]')).toContainText('69.45');
    await shot(page, k('18-accounts-edit'));
    await teardown(page, ctx, k('18-accounts-edit'));
  });
}
