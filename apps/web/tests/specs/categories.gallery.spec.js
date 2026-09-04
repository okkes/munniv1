import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, shot, teardown } from '../helpers/base.js';

// --- Tests ------------------------------------------------------------------

async function goToManageCats(page) {
  await page.click('[data-testid="tab-settings"]');
  await page.click('[data-testid="settings-categories-row"]');
  await page.waitForSelector('[data-testid="screen-manage-cats"]');
}

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`cats-a1 manage screen lists catalog by parent [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await goToManageCats(page);
    // groups start collapsed (user redesign) — unfold what we inspect
    await page.click('[data-testid="cats-group-consumption"]');
    await expect(page.locator('[data-testid="managecat-groceries"]')).toBeVisible();
    // demo seed ships a custom main with its locked Other sub
    await page.click('[data-testid="cats-group-demo_cat_padel"]');
    await expect(page.locator('[data-testid="managecat-demo_cat_padel_other"]')).toBeVisible();
    await shot(page, k('29-cats-manage'));
    await teardown(page, ctx, k('29-cats-manage'));
  });

  test(`cats-a2 create custom sub (direction follows the parent, #244), use it on a transaction [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await goToManageCats(page);
    await page.click('[data-testid="cats-group-consumption"]');
    await page.click('[data-testid="cats-addsub-consumption"]');
    await page.waitForSelector('[data-testid="catform-name"]');
    await page.fill('[data-testid="catform-name"]', 'Bubble Tea');
    // #244: no direction question — the sub follows its parent's nature
    await expect(page.locator('[data-testid="catform-direction-debit"]')).toHaveCount(0);
    await page.click('[data-testid="catform-icon-coffee-outline"]');
    await page.waitForTimeout(400);
    await shot(page, k('30-cats-create') + '--s1');
    await page.click('[data-testid="catform-save"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="screen-manage-cats"]')).toContainText('Bubble Tea');
    await shot(page, k('30-cats-create') + '--s2');

    // recategorize a transaction to the new custom category
    await page.click('[data-testid="tab-transactions"]');
    await page.click('[data-testid="tx-row-dm100"]');
    await page.click('[data-testid="tx-detail-category-row"]');
    await page.waitForSelector('[data-testid="part-cats-editor"]');
    await page.click('[data-testid="part-cat-0"]');
    await page.waitForSelector('[data-testid="catpicker-search"]');
    await page.fill('[data-testid="catpicker-search"]', 'bubble');
    // #234/#246: the search wears a clear × and a ◆ chip that share the
    // catpicker- prefix — pick inside the LIST, where rows live
    const customOption = page.locator('[data-testid="catpicker-list"] [data-testid^="catpicker-"]:not([data-testid="catpicker-list"]):not([data-testid="catpicker-create-custom"])').first();
    await customOption.click();
    await page.waitForTimeout(400);
    await page.click('[data-testid="part-cat-save"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="tx-detail-category-row"]')).toContainText('Bubble Tea');
    await shot(page, k('30-cats-create'));
    await teardown(page, ctx, k('30-cats-create'));
  });

  test(`cats-a3 edit and delete custom sub [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await goToManageCats(page);
    // create one under Sport
    await page.click('[data-testid="cats-group-sport"]');
    await page.click('[data-testid="cats-addsub-sport"]');
    await page.fill('[data-testid="catform-name"]', 'Temp Cat');
    await page.click('[data-testid="catform-save"]');
    await page.waitForTimeout(500);
    // rename via edit
    await page.click('[data-testid="screen-manage-cats"] button:has-text("Temp Cat")');
    await page.waitForSelector('[data-testid="catform-name"]');
    await page.fill('[data-testid="catform-name"]', 'Renamed Cat');
    await page.click('[data-testid="catform-save"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="screen-manage-cats"]')).toContainText('Renamed Cat');
    await shot(page, k('31-cats-edit') + '--s1');
    // delete
    await page.click('[data-testid="screen-manage-cats"] button:has-text("Renamed Cat")');
    await page.click('[data-testid="catform-delete"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="screen-manage-cats"]')).not.toContainText('Renamed Cat');
    await shot(page, k('31-cats-edit'));
    await teardown(page, ctx, k('31-cats-edit'));
  });

  test(`cats-a4 create custom MAIN (always expense, #244) with color; delete cascades [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await goToManageCats(page);
    await page.click('[data-testid="cats-add"]');
    await page.waitForSelector('[data-testid="catform-name"]');
    await page.fill('[data-testid="catform-name"]', 'Music');
    // #244: no type question — the form SAYS a new parent tracks spending
    await expect(page.locator('[data-testid="catform-expense-note"]')).toBeVisible();
    await page.click('[data-testid="catform-color-9B59B6"]');
    await page.click('[data-testid="catform-icon-music"]');
    await shot(page, k('56-cats-main') + '--s1');
    await page.click('[data-testid="catform-save"]');
    await page.waitForTimeout(500);
    // group header with type badge + locked Other sub
    await expect(page.locator('[data-cat-group]', { hasText: 'Music' })).toContainText('Expense');
    await shot(page, k('56-cats-main'));

    // delete the main again — Edit lives in the header's hold menu now
    const musicHeader = page.locator('[data-cat-group]', { hasText: 'Music' }).locator('[data-testid^="cats-group-"]');
    await musicHeader.dispatchEvent('pointerdown');
    await page.waitForTimeout(600); // the 450ms hold threshold
    await musicHeader.dispatchEvent('pointerup');
    await page.locator('[data-testid^="cats-editmain-"]').click();
    await page.click('[data-testid="catform-delete"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="screen-manage-cats"]')).not.toContainText('Music');
    await teardown(page, ctx, k('56-cats-main'));
  });
}
