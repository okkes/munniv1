import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, shot, teardown } from '../helpers/base.js';

// --- Tests ------------------------------------------------------------------

async function openFirstReviewTx(page) {
  await page.click('[data-testid="tab-transactions"]');
  await page.waitForSelector('[data-testid="tx-list"]');
  // dm100 = Amazon.nl -28.99, needsReview in the seeded dataset
  await page.click('[data-testid="tx-row-dm100"]');
  await page.waitForSelector('[data-testid="screen-tx-detail"]');
}

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`tx-a1 detail opens from list, back returns [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await openFirstReviewTx(page);
    await expect(page.locator('[data-testid="tx-detail-amount"]')).toContainText('28.99');
    await shot(page, k('09-tx-detail') + '--s1');
    await page.goBack();
    await expect(page.locator('[data-testid="tx-list"]')).toBeVisible();
    await shot(page, k('09-tx-detail'));
    await teardown(page, ctx, k('09-tx-detail'));
  });

  test(`tx-a2 recategorize via picker clears review flag [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await openFirstReviewTx(page);
    await page.click('[data-testid="tx-detail-category-row"]');
    await page.waitForSelector('[data-testid="part-cats-editor"]'); // the split-categories editor (#211)
    await page.click('[data-testid="part-cat-0"]');
    await page.waitForSelector('[data-testid="catpicker-videoGame"]');
    await page.waitForTimeout(500); // sheet slide-in
    await shot(page, k('10-tx-recat') + '--s1');
    await page.click('[data-testid="catpicker-videoGame"]');
    await page.waitForTimeout(400);
    await page.click('[data-testid="part-cat-save"]');
    await page.waitForTimeout(500); // sheet slide-out
    await expect(page.locator('[data-testid="tx-detail-category-row"]')).toContainText('Video Game');
    // review badge cleared by explicit categorization
    await expect(page.locator('[data-testid="tx-detail-category-row"]')).not.toContainText('Confirm');
    await shot(page, k('10-tx-recat'));
    await teardown(page, ctx, k('10-tx-recat'));
  });

  test(`tx-a3 category search filters picker [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await openFirstReviewTx(page);
    await page.click('[data-testid="tx-detail-category-row"]');
    await page.waitForSelector('[data-testid="part-cats-editor"]');
    await page.click('[data-testid="part-cat-0"]');
    await page.waitForSelector('[data-testid="catpicker-search"]');
    await page.fill('[data-testid="catpicker-search"]', 'groc');
    await expect(page.locator('[data-testid="catpicker-groceries"]')).toBeVisible();
    await expect(page.locator('[data-testid="catpicker-videoGame"]')).toHaveCount(0);
    await page.waitForTimeout(400);
    await shot(page, k('11-tx-cat-search'));
    await teardown(page, ctx, k('11-tx-cat-search'));
  });

  test(`tx-a5 create manual transaction [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await page.click('[data-testid="tab-transactions"]');
    await page.click('[data-testid="tx-add"]');
    await page.waitForSelector('[data-testid="txform-amount"]');
    await page.fill('[data-testid="txform-amount"]', '12,50');
    await page.fill('[data-testid="txform-merchant"]', 'Test Lunch');
    // two demo manual accounts → nothing pre-selects (2026-07-31): pick
    // the main one through the account field + sheet
    await page.click('[data-testid="txform-account"]');
    await page.click('[data-testid="txform-account-demo_main"]');
    await page.click('[data-testid="txform-category"]');
    // the split-categories editor (#211): per-entry picker, Done stages it
    await page.click('[data-testid="part-cat-0"]');
    await page.waitForSelector('[data-testid="catpicker-search"]');
    await page.fill('[data-testid="catpicker-search"]', 'dining');
    await page.click('[data-testid="catpicker-restaurants"]');
    await page.click('[data-testid="part-cat-save"]');
    await page.waitForTimeout(500);
    await shot(page, k('27-tx-create') + '--s1');
    await page.click('[data-testid="txform-save"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="tx-list"]')).toContainText('Test Lunch');
    await expect(page.locator('[data-testid="tx-list"]')).toContainText('12.50');
    await shot(page, k('27-tx-create'));
    await teardown(page, ctx, k('27-tx-create'));
  });

  test(`tx-a6 edit manual transaction amount and name [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await openFirstReviewTx(page); // dm100 — demo txs have no importRef, so editable
    await page.click('[data-testid="tx-detail-edit"]');
    await page.waitForSelector('[data-testid="txform-amount"]');
    await page.fill('[data-testid="txform-amount"]', '99,99');
    await page.fill('[data-testid="txform-merchant"]', 'Amazon Corrected');
    await page.click('[data-testid="txform-save"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="tx-detail-amount"]')).toContainText('99.99');
    await expect(page.locator('[data-testid="screen-tx-detail"]')).toContainText('Amazon Corrected');
    await shot(page, k('28-tx-edit'));
    await teardown(page, ctx, k('28-tx-edit'));
  });

  test(`tx-a7 link and unlink a reimbursement [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await openFirstReviewTx(page); // dm100: Amazon.nl -28.99
    // finding the counterpart lives on its own full screen now (redesign
    // 2026-07-28): search + suggestions above the full candidate list
    await page.click('[data-testid="reimb-add"]');
    await page.waitForSelector('[data-testid="reimb-link-list"]');
    // pick a DETERMINISTIC big credit — the list is date-sorted and the
    // demo's relative-dated rows drift past absolute-dated ones over
    // time, so "the first row" rots with the calendar
    await page.locator('[data-testid="reimb-link-list"] [data-testid^="tx-row-"]').filter({ hasText: 'Demo Corp' }).first().click();
    await expect(page.locator('[data-testid="reimb-amount"]')).toHaveValue('28,99'); // clamped prefill
    await page.fill('[data-testid="reimb-amount"]', '10,00');
    await page.click('[data-testid="reimb-save"]');
    await page.waitForTimeout(500);
    // net −18.99, gross struck through, summary line
    await expect(page.locator('[data-testid="tx-detail-amount"]')).toContainText('18.99');
    await expect(page.locator('[data-testid="tx-detail-original-amount"]')).toContainText('28.99'); // details block owns the original
    // #231 r2: the section is links-only — the linked row carries the amount
    await expect(page.locator('[data-testid="reimb-list"] [data-testid^="reimb-row-"]').first()).toContainText('10.00');
    await shot(page, k('34-tx-reimburse'));
    // unlink restores the gross amount
    await page.locator('[data-testid^="reimb-unlink-"]').click();
    await expect(page.locator('[data-testid="tx-detail-amount"]')).toContainText('28.99');
    await expect(page.locator('[data-testid="tx-detail-original-amount"]')).toHaveCount(0);
    await teardown(page, ctx, k('34-tx-reimburse'));
  });

  test(`tx-a8 categories lead (#133): a diamond pick asks its counterparty, the pot answers [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await openFirstReviewTx(page); // dm100: hobby expense on demo_main
    // #133 r4: no kind row — the Set aside (diamond) pick opens the
    // counterparty ask ON THE PICK, Default pinned on top; the savings
    // pot answers, the entry's subrow names it, Done lands both
    // (#211: the pencil opens the split-CATEGORIES editor now)
    await page.click('[data-testid="tx-detail-cats-edit"]');
    await page.click('[data-testid="part-cat-0"]');
    await page.waitForSelector('[data-testid="catpicker-search"]');
    await page.fill('[data-testid="catpicker-search"]', 'set aside');
    await page.click('[data-testid="catpicker-savingDeposit"]');
    await page.waitForSelector('[data-testid="counter-default"]');
    await page.click('[data-testid="counter-pick-demo_save"]');
    // #237: manual counters fork now — creating the leg is the explicit door
    await page.click('[data-testid="counter-fork-create"]');
    // #228 feedback: no counter line under the entry — the ask closes
    await expect(page.locator('[data-testid="counter-accounts"]')).toHaveCount(0);
    await page.click('[data-testid="part-cat-save"]');
    await page.waitForTimeout(500);
    // #133 r4: the user's category STAYS the story — the link makes it
    // a movement, and the pot's own ledger carries the saving leg
    await expect(page.locator('[data-testid="tx-detail-category-row"]')).toContainText('Set aside');
    await expect(page.locator('[data-testid="tx-detail-linked-account"]')).toBeVisible();
    await shot(page, k('35-tx-type-link'));
    await teardown(page, ctx, k('35-tx-type-link'));
  });

  test(`tx-a9 split categories across two categories [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await openFirstReviewTx(page); // dm100: -28.99
    // #211: the category row opens the split-CATEGORIES editor — the
    // row stays ONE transaction, never a split container
    await page.click('[data-testid="tx-detail-category-row"]');
    await page.waitForSelector('[data-testid="part-cats-editor"]');
    await page.click('[data-testid="part-cat-add"]');
    // assign 20.00 to the first entry; second is open -> remainder shown
    await page.fill('[data-testid="part-cat-amount-0"]', '20,00');
    await expect(page.locator('[data-testid="part-cat-remainder"]')).toContainText('8.99');
    // #195: Done stays tappable — an unbalanced tap refuses and the
    // remainder pill is the visible explanation
    await page.click('[data-testid="part-cat-save"]');
    await expect(page.locator('[data-testid="part-cats-editor"]')).toBeVisible();
    await expect(page.locator('[data-testid="part-cat-save"]')).toHaveAttribute('aria-invalid', 'true');
    // pick a category for entry 2 and auto-balance via the remainder chip
    await page.click('[data-testid="part-cat-1"]');
    await page.waitForSelector('[data-testid="catpicker-search"]');
    await page.fill('[data-testid="catpicker-search"]', 'gift');
    await page.click('[data-testid="catpicker-gift"]');
    await page.waitForTimeout(700);
    await page.click('[data-testid="part-cat-remainder"]');
    await expect(page.locator('[data-testid="part-cat-amount-1"]')).toHaveValue('8,99');
    await shot(page, k('36-tx-split') + '--s1');
    await page.click('[data-testid="part-cat-save"]');
    await page.waitForTimeout(500);
    // breakdown visible; primary category = largest entry (Hobby, 20.00);
    // the row keeps its pencil — it is NOT a container (#211)
    await expect(page.locator('[data-testid="tx-detail-categories"]')).toContainText('20.00');
    await expect(page.locator('[data-testid="tx-detail-categories"]')).toContainText('8.99');
    await expect(page.locator('[data-testid="tx-detail-category-row"]')).toContainText('Hobby');
    await expect(page.locator('[data-testid="tx-detail-cats-edit"]')).toBeVisible();
    await shot(page, k('36-tx-split'));
    // collapsing back to one entry restores a single category
    await page.click('[data-testid="tx-detail-cats-edit"]');
    await page.click('[data-testid="part-cat-remove-1"]');
    await page.click('[data-testid="part-cat-save"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid^="tx-detail-cat-"]')).toHaveCount(0);
    await teardown(page, ctx, k('36-tx-split'));
  });

  test(`tx-a4 notes persist [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await openFirstReviewTx(page);
    await page.fill('[data-testid="tx-detail-notes"]', 'Split with Sam later');
    await page.click('[data-testid="tx-detail-amount"]'); // blur -> save
    await page.goBack();
    await page.click('[data-testid="tx-row-dm100"]');
    await expect(page.locator('[data-testid="tx-detail-notes"]')).toHaveValue('Split with Sam later');
    await shot(page, k('12-tx-notes'));
    await teardown(page, ctx, k('12-tx-notes'));
  });
}
