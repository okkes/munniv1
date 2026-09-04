import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, shot, teardown } from '../helpers/base.js';

// --- Tests ------------------------------------------------------------------

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`review-a1 banner opens queue [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    // the demo seeds a review backlog (count varies with the rich seed)
    await expect(page.locator('[data-testid="home-review-banner"]')).toContainText(/[0-9]+ transactions/);
    await shot(page, k('13-review-banner') + '--s1');
    await page.click('[data-testid="home-review-banner"]');
    await expect(page.locator('[data-testid="review-card"]')).toBeVisible();
    // oldest first (user rule): Bol.com leads the backlog
    await expect(page.locator('[data-testid="review-card"]')).toContainText('Bol.com');
    await shot(page, k('13-review-banner'));
    await teardown(page, ctx, k('13-review-banner'));
  });

  test(`review-a2 confirm and recategorize drain the queue [${V.id}]`, async ({ browser }) => {
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await page.click('[data-testid="home-review-banner"]');
    // oldest first (user rule): Bol.com → H&M → Amazon.nl
    await expect(page.locator('[data-testid="review-card"]')).toContainText('Bol.com');
    await page.click('[data-testid="review-confirm-btn"]'); // 1/3 confirmed
    await expect(page.locator('[data-testid="review-card"]')).toContainText('H&M Nederland');
    await shot(page, k('14-review-flow') + '--s1');
    // recategorize H&M — the chip opens the split-categories editor
    // (#211); the pick is STAGED, confirm writes it
    await page.click('[data-testid="review-category-chip"]');
    await page.click('[data-testid="part-cat-0"]');
    await page.waitForSelector('[data-testid="catpicker-search"]');
    await page.fill('[data-testid="catpicker-search"]', 'gift');
    await page.click('[data-testid="catpicker-gift"]');
    await page.click('[data-testid="part-cat-save"]');
    await expect(page.locator('[data-testid="review-category-chip"]')).toContainText('Gift');
    await shot(page, k('14-review-flow') + '--s2');
    await page.click('[data-testid="review-confirm-btn"]'); // Gift confirmed
    // the richer demo seed varies the rest of the queue — drain it with
    // the same paced idempotent-confirm loop as review-a3
    await expect(async () => {
      if (await page.locator('[data-testid="review-empty"]').count()) return;
      await page.click('[data-testid="review-confirm-btn"]', { timeout: 2000 }).catch(() => undefined);
      throw new Error('queue not empty yet');
    }).toPass({ timeout: 90_000, intervals: [800, 1500, 3000] });
    await expect(page.locator('[data-testid="review-empty"]')).toBeVisible();
    await shot(page, k('14-review-flow'));
    await teardown(page, ctx, k('14-review-flow'));
  });

  test(`review-a3 empty queue hides home banner [${V.id}]`, async ({ browser }) => {
    test.slow(); // 3 confirm round-trips through the live query — CI needs headroom
    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { demo: true });
    await page.click('[data-testid="home-review-banner"]');
    // drain the whole queue: keep confirming until the empty state shows.
    // Re-confirming a card that hasn't swapped yet is an idempotent write,
    // so no advance-tracking is needed — the paced intervals stop this
    // from hammering, and a genuinely unconfirmable card still fails.
    // (the old fixed 3-iteration loop flaked whenever the LAST live-query
    // round trip outlived its separate budget on coverage runners)
    await expect(async () => {
      if (await page.locator('[data-testid="review-empty"]').count()) return;
      await page.click('[data-testid="review-confirm-btn"]', { timeout: 2000 }).catch(() => undefined);
      throw new Error('queue not empty yet');
    }).toPass({ timeout: 90_000, intervals: [800, 1500, 3000] });
    await expect(page.locator('[data-testid="review-empty"]')).toBeVisible();
    await page.click('[data-testid="review-back"]');
    await expect(page.locator('[data-testid="screen-home"]')).toBeVisible();
    await expect(page.locator('[data-testid="home-review-banner"]')).toHaveCount(0);
    await shot(page, k('15-review-done'));
    await teardown(page, ctx, k('15-review-done'));
  });
}
