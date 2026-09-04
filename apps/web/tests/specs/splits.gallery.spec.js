import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, shot, teardown, syncApiUp } from '../helpers/base.js';

// Splits SP1 against the real API: create a split, add manual expenses,
// read the ledger. Online-only feature — skips when the stack is down.

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`sp-a1 create a split, add expenses, ledger says who owes whom [${V.id}]`, async ({ browser }) => {
    test.skip(!(await syncApiUp()), 'sync API not running (docker compose -f deploy/docker-compose.test.yml up -d)');
    test.setTimeout(240_000);
    const sub = `e2e-split-${Date.now()}`;

    const { page, ctx } = await createPage(browser, V);
    await base(page, V, { userSub: sub });

    await page.click('[data-testid="tab-settings"]'); // splits live on space Settings now
    await page.click('[data-testid="settings-splits-row"]');
    await page.waitForSelector('[data-testid="screen-splits"]');
    await page.waitForSelector('[data-testid="splits-empty"]');

    // create
    await page.click('[data-testid="splits-add"]');
    await page.fill('[data-testid="split-name"]', 'Barcelona trip');
    await page.click('[data-testid="split-create"]');
    await page.waitForSelector('[data-testid="screen-split-detail"]');

    // two manual expenses, both paid by me (solo split: net stays 0)
    for (const [desc, amount] of [['Tapas night', '30,00'], ['Metro cards', '9,50']]) {
      await page.click('[data-testid="split-add-entry"]');
      await page.fill('[data-testid="split-entry-desc"]', desc);
      await page.fill('[data-testid="split-entry-amount"]', amount);
      await page.click('[data-testid="split-entry-save"]');
      await expect(page.locator('[data-testid="split-entries"]')).toContainText(desc);
    }
    await expect(page.locator('[data-testid="split-entries"]')).toContainText('€30.00');
    await expect(page.locator('[data-testid="split-ledger"]')).toBeVisible();
    await shot(page, k('67-split-detail'));

    // back to the list: counts reflect the entries
    await page.click('[data-testid="split-back"]');
    await page.waitForSelector('[data-testid="screen-splits"]');
    await expect(page.locator('[data-testid^="split-row-"]')).toContainText('Barcelona trip');
    await shot(page, k('68-splits-list'));

    await teardown(page, ctx, k('68-splits-list'));
  });

  test(`sp-a2 invite link: a stranger joins with their own space attachment [${V.id}]`, async ({ browser }) => {
    test.skip(!(await syncApiUp()), 'sync API not running (docker compose -f deploy/docker-compose.test.yml up -d)');
    test.setTimeout(240_000);
    const stamp = Date.now();

    // host creates a split and mints the share link
    const host = await createPage(browser, V);
    await base(host.page, V, { userSub: `e2e-split-host-${stamp}` });
    await host.page.click('[data-testid="tab-settings"]'); // splits live on space Settings now
    await host.page.click('[data-testid="settings-splits-row"]');
    await host.page.click('[data-testid="splits-add"]');
    await host.page.fill('[data-testid="split-name"]', 'Ski trip');
    await host.page.click('[data-testid="split-create"]');
    await host.page.waitForSelector('[data-testid="screen-split-detail"]');
    await host.page.click('[data-testid="split-invite"]');
    const linkBox = host.page.locator('[data-testid="split-invite-link"]');
    // real path (no #): OS app links can only match real paths; the web
    // shell bounces /splits/join/* into the hash router
    await expect(linkBox).toContainText('/splits/join/');
    const joinPath = new URL((await linkBox.textContent()).trim()).pathname;

    // a complete stranger (not a friend, no shared space) follows the link
    const guest = await createPage(browser, V);
    await base(guest.page, V, { userSub: `e2e-split-guest-${stamp}` });
    await guest.page.goto(joinPath);
    await guest.page.waitForSelector('[data-testid="split-join-card"]');
    await expect(guest.page.locator('[data-testid="split-join-card"]')).toContainText('Ski trip');
    await shot(guest.page, k('69-split-join'));
    await guest.page.click('[data-testid="split-join-confirm"]');
    await guest.page.waitForSelector('[data-testid="screen-split-detail"]');
    await expect(guest.page.locator('[data-testid="split-members"]')).toContainText('Owner');

    // the host sees the new member after reopening
    await host.page.reload();
    await host.page.waitForSelector('[data-testid="split-members"]');
    const memberRows = host.page.locator('[data-testid="split-members"] .mdi-account-outline');
    await expect(memberRows).toHaveCount(2);

    await teardown(guest.page, guest.ctx, k('69-split-join') + '--guest');
    await teardown(host.page, host.ctx, k('69-split-join'));
  });
}
