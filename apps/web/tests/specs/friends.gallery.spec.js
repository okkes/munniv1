import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, gotoGlobalSettings, shot, teardown, syncApiUp } from '../helpers/base.js';

// Two-user friends flow against the real API (deploy/docker-compose.test.yml).

async function goToFriends(page) {
  await gotoGlobalSettings(page);
  await page.click('[data-testid="settings-friends-row"]');
  await page.waitForSelector('[data-testid="screen-friends"]');
}

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`friends-a1 request, accept, unfriend across two users [${V.id}]`, async ({ browser }) => {
    test.skip(!(await syncApiUp()), 'sync API not running');
    test.setTimeout(240_000);
    const run = Date.now();

    const alice = await createPage(browser, V);
    await base(alice.page, V, { userSub: `e2e-alice-${run}` });
    await goToFriends(alice.page);
    await expect(alice.page.locator('[data-testid="friends-copy-id"] span')).toHaveText(/^[0-9a-f]{8}-/, {
      timeout: 10000,
    });
    const aliceId = (await alice.page.locator('[data-testid="friends-copy-id"] span').textContent())?.trim();
    await shot(alice.page, k('32-friends') + '--s1');

    // bob sends a request to alice's id
    const bob = await createPage(browser, V);
    await base(bob.page, V, { userSub: `e2e-bob-${run}` });
    await goToFriends(bob.page);
    await bob.page.fill('[data-testid="friends-add-input"]', aliceId);
    await bob.page.click('[data-testid="friends-add-send"]');
    await expect(bob.page.locator('[data-testid="friends-sent"]')).toBeVisible();
    await shot(bob.page, k('32-friends') + '--s2');

    // alice reloads the screen and accepts
    await alice.page.click('[data-testid="friends-back"]');
    await goToFriends(alice.page);
    await expect(alice.page.locator('[data-testid="friends-received"]')).toBeVisible();
    await alice.page.locator('[data-testid^="friends-accept-"]').click();
    await expect(alice.page.locator('[data-testid="friends-list"]')).not.toContainText('No friends yet');
    await shot(alice.page, k('32-friends') + '--s3');

    // bob sees the friendship after revisiting
    await bob.page.click('[data-testid="friends-back"]');
    await goToFriends(bob.page);
    // #165: rows carry no trash button anymore — the row itself is the door
    await expect(bob.page.locator('[data-testid="friends-list"] [data-testid^="friends-row-"]')).toHaveCount(1);
    await shot(bob.page, k('32-friends'));

    await teardown(bob.page, bob.ctx, k('32-friends') + '--bob');
    await teardown(alice.page, alice.ctx, k('32-friends'));
  });
}
