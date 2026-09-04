import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, gotoGlobalSettings, shot, teardown } from '../helpers/base.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/camt053-sample.xml');

// --- Tests ------------------------------------------------------------------

async function goToAccounts(page) {
  await gotoGlobalSettings(page);
  await page.click('[data-testid="settings-accounts-row"]');
  await page.waitForSelector('[data-testid="screen-accounts"]');
  // #314 r2: space cards mount COLLAPSED — open the demo cluster so the
  // balance asserts on demo rows keep seeing them
  await page.click('[data-testid="accounts-space-head-demo_space"]');
  await page.waitForSelector('[data-testid="account-row-demo_main"]');
}

async function pickFixture(page) {
  await page.setInputFiles('[data-testid="accounts-import-input"]', FIXTURE);
  await page.waitForSelector('[data-testid="import-preview"]');
}

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`import-a1 preview matches existing account by IBAN [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await goToAccounts(page);
    await pickFixture(page);
    await page.waitForTimeout(500); // sheet slide-in
    // statement 1 matches demo checking by IBAN, statement 2 is new
    await expect(page.locator('[data-testid="import-preview"]')).toContainText('Demo Checking');
    await expect(page.locator('[data-testid="import-preview"]')).toContainText('New account');
    await shot(page, k('19-import-preview'));
    await teardown(page, ctx, k('19-import-preview'));
  });

  test(`import-a2 import categorizes, updates balance, dedupes on re-import [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await goToAccounts(page);
    await pickFixture(page);
    await page.click('[data-testid="import-run"]');
    await expect(page.locator('[data-testid="import-result"]')).toContainText('Imported 3 transactions, skipped 0');
    await shot(page, k('20-import-run') + '--s1');
    await page.click('[data-testid="import-close"]');
    await page.waitForTimeout(500);
    // matched account balance updated to CLBD 3390.55; new account created with 500.00
    await expect(page.locator('[data-testid="account-row-demo_main"]')).toContainText('3,390.55');
    await expect(page.locator('[data-testid="screen-accounts"]')).toContainText('Bank · 4300'); // new NL91ABNA…4300 account
    // Jumbo predicted as groceries (no review); unknown merchant needs review
    await page.click('[data-testid="tab-transactions"]');
    await expect(page.locator('[data-testid="tx-list"]')).toContainText('Jumbo Amsterdam');
    await expect(page.locator('[data-testid="tx-list"]')).toContainText('Grocery');
    await expect(page.locator('[data-testid="tx-list"]')).toContainText('Onbekende Winkel XQZ');
    await shot(page, k('20-import-run') + '--s2');
    // re-import the same file: everything is a duplicate
    await goToAccounts(page);
    await pickFixture(page);
    await page.click('[data-testid="import-run"]');
    await expect(page.locator('[data-testid="import-result"]')).toContainText('Imported 0 transactions, skipped 3');
    await shot(page, k('20-import-run'));
    await teardown(page, ctx, k('20-import-run'));
  });

  test(`import-a3 invalid file shows error [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await goToAccounts(page);
    await page.setInputFiles('[data-testid="accounts-import-input"]', {
      name: 'not-camt.xml',
      mimeType: 'text/xml',
      buffer: Buffer.from('<foo>bar</foo>'),
    });
    await expect(page.locator('[data-testid="import-error"]')).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, k('21-import-invalid'));
    await teardown(page, ctx, k('21-import-invalid'));
  });
}
