import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, gotoGlobalSettings, gotoSpaces, shot, teardown } from '../helpers/base.js';

// --- Tests ------------------------------------------------------------------

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`shell-a1 home tab default [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await expect(page.locator('[data-testid="screen-home"]')).toBeVisible();
    await expect(page).toHaveURL(/#\/home$/);
    await shot(page, k('01-shell-home'));
    await teardown(page, ctx, k('01-shell-home'));
  });

  test(`shell-a2 tab navigation [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await page.click('[data-testid="tab-transactions"]');
    await expect(page.locator('[data-testid="screen-transactions"]')).toBeVisible();
    await shot(page, k('02-shell-tabs') + '--s1');
    await page.click('[data-testid="tab-recurring"]');
    await expect(page.locator('[data-testid="screen-recurring"]')).toBeVisible();
    await shot(page, k('02-shell-tabs') + '--s2');
    await page.click('[data-testid="tab-settings"]');
    await expect(page.locator('[data-testid="screen-settings"]')).toBeVisible();
    await shot(page, k('02-shell-tabs'));
    await teardown(page, ctx, k('02-shell-tabs'));
  });

  test(`shell-a3 browser back returns to previous tab [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await page.click('[data-testid="tab-transactions"]');
    await expect(page.locator('[data-testid="screen-transactions"]')).toBeVisible();
    await shot(page, k('03-shell-back') + '--s1');
    await page.goBack();
    await expect(page.locator('[data-testid="screen-home"]')).toBeVisible();
    await expect(page).toHaveURL(/#\/home$/);
    await shot(page, k('03-shell-back'));
    await teardown(page, ctx, k('03-shell-back'));
  });

  test(`shell-a4 language switch to Dutch [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await gotoGlobalSettings(page);
    await expect(page.locator('[data-testid="settings-language-row"]')).toBeVisible();
    await shot(page, k('04-shell-language') + '--s1');
    await page.click('[data-testid="settings-language-row"]');
    await expect(page.locator('[data-testid="lang-option-nl"]')).toBeVisible();
    await page.waitForTimeout(500); // sheet slide-in
    await shot(page, k('04-shell-language') + '--s2');
    await page.click('[data-testid="lang-option-nl"]');
    await page.waitForTimeout(500); // sheet slide-out
    await expect(page.locator('[data-testid="screen-settings-global"]')).toContainText('Algemene instellingen');
    await shot(page, k('04-shell-language'));
    await teardown(page, ctx, k('04-shell-language'));
  });

  test(`shell-a6 offline profile: create, add data, sign out keeps it [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V); // login screen, no session
    await page.click('[data-testid="login-offline-btn"]');
    // offline mode is a full screen: trade-off cards above the profiles
    await page.waitForSelector('[data-testid="screen-offline-intro"]');
    await shot(page, k('38-offline') + '--s0');
    await page.click('[data-testid="offline-continue"]');
    await page.waitForSelector('[data-testid="screen-offline-profiles"]');
    await page.fill('[data-testid="offline-name"]', 'Okkes Offline');
    await shot(page, k('38-offline') + '--s1');
    await page.click('[data-testid="offline-create"]');
    // offline first-run setup (name prefilled from the profile)
    await page.waitForSelector('[data-testid="screen-onboarding"]');
    await page.click('[data-testid="onboarding-save"]');
    await page.click('[data-testid="onboarding-lock-later"]');
    // Mina owns the first-run now — skipping creates the default space
    await page.click('[data-testid="mina-skip"]');
    await page.click('[data-testid="mina-skip-confirm"]');
    await page.waitForSelector('[data-testid="mina-tutorial"]', { state: 'detached' });
    await page.waitForSelector('[data-testid="tab-home"]');
    await gotoSpaces(page);
    await expect(page.locator('[data-testid="screen-spaces"]')).toContainText('Private');
    // add a cash account, then a manual transaction (zero network) —
    // manual creation lives on the SPACE's accounts screen (2026-07-28)
    await gotoGlobalSettings(page);
    await page.click('[data-testid="settings-accounts-row"]');
    await page.click('[data-testid="accounts-add"]');
    await page.click('[data-testid="chooser-manual-door"]');
    // "Add a manual account" opens the type grid directly (2026-08-01)
    await page.click('[data-testid="space-accounts-add"]');
    await page.click('[data-testid="chooser-accttype-cash"]');
    await page.fill('[data-testid="chooser-acctform-name"]', 'Wallet');
    await page.fill('[data-testid="chooser-acctform-balance"]', '100');
    await page.click('[data-testid="chooser-acctform-save"]');
    await page.waitForTimeout(500);
    await page.click('[data-testid="tab-transactions"]');
    await page.click('[data-testid="tx-add"]');
    await page.fill('[data-testid="txform-amount"]', '5,00');
    await page.fill('[data-testid="txform-merchant"]', 'Offline Coffee');
    await page.click('[data-testid="txform-save"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="tx-list"]')).toContainText('Offline Coffee');
    await shot(page, k('38-offline') + '--s2');
    // sign out does NOT destroy offline data; profile is selectable again
    await page.click('[data-testid="tab-settings"]');
    await page.click('[data-testid="settings-signout"]');
    await page.waitForSelector('[data-testid="screen-login"]');
    await page.click('[data-testid="login-offline-btn"]');
    await page.click('[data-testid="offline-continue"]');
    await page.locator('[data-testid^="offline-profile-"]').click();
    await page.waitForSelector('[data-testid="tab-home"]');
    await page.click('[data-testid="tab-transactions"]');
    await expect(page.locator('[data-testid="tx-list"]')).toContainText('Offline Coffee');
    await shot(page, k('38-offline'));
    await teardown(page, ctx, k('38-offline'));
  });

  test(`shell-a5 dark mode toggle [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await gotoGlobalSettings(page);
    await expect(page.locator('[data-testid="settings-theme-toggle"]')).toBeVisible();
    await page.click('[data-testid="settings-theme-dark"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await shot(page, k('05-shell-dark'));
    await teardown(page, ctx, k('05-shell-dark'));
  });
}

