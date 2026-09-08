import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { VARIANTS, createPage, base, gotoGlobalSettings, gotoSpaces, shot, teardown, syncApiUp } from '../helpers/base.js';

const CAMT_FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/camt053-sample.xml');

// Two-device sync e2e against the real API + Postgres
// (deploy/docker-compose.test.yml). Skips when the stack isn't running.

// the space-settings doors are gone (user remark: Settings is the one
// place) — the Settings members row targets the ACTIVE space, so the
// target space is activated from the spaces list first
async function gotoMembersOf(page, spaceName, { unlock = false } = {}) {
  await gotoSpaces(page);
  await page.locator(`[data-testid="screen-spaces"] button:has-text("${spaceName}")`).first().click();
  // the check-circle badge appearing on the row = the switch settled
  await page.locator(`[data-testid^="space-row-"]:has-text("${spaceName}") .mdi-check-circle`).waitFor();
  if (unlock) {
    // arc 4: spaces are born locked private — the OWNER lifts the lock in
    // space settings on the FIRST visit (the toggle is owner-only, so the
    // detour must never run for members). Retried: the active-switch
    // re-render can swallow the first cog tap.
    const row = page.locator(`[data-testid^="space-row-"]:has-text("${spaceName}")`).first();
    const spaceId = (await row.getAttribute('data-testid')).replace('space-row-', '');
    const lock = page.locator('[data-testid="space-invite-lock"]');
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.click(`[data-testid="space-edit-${spaceId}"]`).catch(() => {});
      const landed = await page
        .waitForSelector('[data-testid="screen-space-settings"]', { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (landed && (await lock.waitFor({ timeout: 5000 }).then(() => true).catch(() => false))) break;
    }
    if (await lock.isChecked()) await lock.click();
    await page.click('[data-testid="spacesettings-back"]');
    await page.waitForSelector('[data-testid="screen-spaces"]');
  }
  await page.click('[data-testid="tab-settings"]');
  await page.click('[data-testid="settings-space-members-row"]');
  await page.waitForSelector('[data-testid="space-members"]');
}

async function addCashAccount(page, name, balance) {
  // manual creation lives on the SPACE's accounts screen (2026-07-28)
  await gotoGlobalSettings(page);
  await page.click('[data-testid="settings-accounts-row"]');
  await page.click('[data-testid="accounts-add"]');
  await page.click('[data-testid="chooser-manual-door"]');
  // "Add a manual account" opens the type grid directly (2026-08-01)
  await page.click('[data-testid="space-accounts-add"]');
  await page.click('[data-testid="chooser-accttype-cash"]');
  await page.fill('[data-testid="chooser-acctform-name"]', name);
  await page.fill('[data-testid="chooser-acctform-balance"]', balance);
  await page.click('[data-testid="chooser-acctform-save"]');
  await page.waitForTimeout(500);
}

for (const V of VARIANTS) {
  const k = (name) => `${name}--${V.id}`;

  test(`sync-a1 two devices converge through the real API [${V.id}]`, async ({ browser }) => {
    test.skip(!(await syncApiUp()), 'sync API not running (docker compose -f deploy/docker-compose.test.yml up -d)');
    test.setTimeout(120_000);
    const sub = `e2e-${Date.now()}`;

    // device A: first login creates + pushes the personal space
    const a = await createPage(browser, V);
    await base(a.page, V, { userSub: sub });
    await addCashAccount(a.page, 'Sync Wallet', '12,34');
    // creation lands on the SPACE's accounts screen; the global overview
    // lists it inside the space's own segment
    await expect(a.page.locator('[data-testid="screen-space-accounts"]')).toContainText('Sync Wallet');
    await a.page.click('[data-testid="spaceaccounts-back"]');
    await expect(a.page.locator('[data-testid="screen-accounts"]')).toContainText('Sync Wallet');
    await shot(a.page, k('25-sync-devices') + '--s1');
    await a.page.waitForTimeout(3500); // nudge debounce (2s) + push

    // device B: brand-new context discovers the space and pulls everything
    const b = await createPage(browser, V);
    await base(b.page, V, { userSub: sub });
    await gotoGlobalSettings(b.page);
    await b.page.click('[data-testid="settings-accounts-row"]');
    await expect(b.page.locator('[data-testid="screen-accounts"]')).toContainText('Sync Wallet', { timeout: 15000 });
    await expect(b.page.locator('[data-testid="screen-accounts"]')).toContainText('12.34');
    await shot(b.page, k('25-sync-devices') + '--s2');

    // device B renames it; device A sees the rename after its next pull (reload)
    await b.page.click('[data-testid="screen-accounts"] button:has-text("Sync Wallet")');
    await b.page.fill('[data-testid="acctedit-name"]', 'Renamed on B');
    await b.page.click('[data-testid="acctedit-save"]');
    await b.page.waitForTimeout(3500);

    await a.page.reload();
    await a.page.waitForSelector('[data-testid="tab-home"]');
    await gotoGlobalSettings(a.page);
    await a.page.click('[data-testid="settings-accounts-row"]');
    await expect(a.page.locator('[data-testid="screen-accounts"]')).toContainText('Renamed on B', { timeout: 15000 });
    await shot(a.page, k('25-sync-devices'));

    await teardown(b.page, b.ctx, k('25-sync-devices') + '--b');
    await teardown(a.page, a.ctx, k('25-sync-devices'));
  });

  test(`sync-a5 concurrent edits on the SAME transaction converge live (SSE) [${V.id}]`, async ({ browser }) => {
    test.skip(!(await syncApiUp()), 'sync API not running');
    test.setTimeout(120_000);
    const sub = `e2e-live-${Date.now()}`;

    // device A creates an account + a manual transaction
    const a = await createPage(browser, V);
    await base(a.page, V, { userSub: sub });
    await addCashAccount(a.page, 'Live Wallet', '100');
    await a.page.click('[data-testid="tab-transactions"]');
    await a.page.click('[data-testid="tx-add"]');
    await a.page.fill('[data-testid="txform-amount"]', '10');
    await a.page.fill('[data-testid="txform-merchant"]', 'Live Cafe');
    await a.page.click('[data-testid="txform-save"]');
    await a.page.waitForTimeout(3500); // outbox debounce + push

    // device B pulls the same transaction and both open its detail
    const b = await createPage(browser, V);
    await base(b.page, V, { userSub: sub });
    await b.page.click('[data-testid="tab-transactions"]');
    await expect(b.page.locator('[data-testid="tx-list"]')).toContainText('Live Cafe', { timeout: 15000 });
    await a.page.locator('[data-testid^="tx-row-"]', { hasText: 'Live Cafe' }).click();
    await b.page.locator('[data-testid^="tx-row-"]', { hasText: 'Live Cafe' }).click();
    await a.page.waitForSelector('[data-testid="tx-detail-notes"]');
    await b.page.waitForSelector('[data-testid="tx-detail-notes"]');

    // DIFFERENT fields in parallel: A picks a category, B writes a note
    await a.page.click('[data-testid="tx-detail-category-row"]');
    await a.page.waitForSelector('[data-testid="split-editor"]');
    await a.page.click('[data-testid="split-cat-0"]');
    await a.page.waitForSelector('[data-testid="catpicker-search"]');
    await a.page.click('[data-testid="catpicker-coffee"]');
    await a.page.click('[data-testid="split-save"]');
    await b.page.fill('[data-testid="tx-detail-notes"]', 'note from B');
    await b.page.locator('[data-testid="tx-detail-notes"]').blur();

    // both edits surface on BOTH devices without any reload (SSE + poll)
    await expect(a.page.locator('[data-testid="tx-detail-notes"]')).toHaveValue('note from B', { timeout: 20000 });
    await expect(b.page.locator('[data-testid="tx-detail-category-row"]')).toContainText('Coffee', { timeout: 20000 });
    await shot(a.page, k('58-sync-live'));

    // SAME field in parallel: the later write wins everywhere
    await a.page.fill('[data-testid="tx-detail-notes"]', 'A version');
    await a.page.locator('[data-testid="tx-detail-notes"]').blur();
    await a.page.waitForTimeout(300);
    await b.page.fill('[data-testid="tx-detail-notes"]', 'B wins');
    await b.page.locator('[data-testid="tx-detail-notes"]').blur();
    await expect(a.page.locator('[data-testid="tx-detail-notes"]')).toHaveValue('B wins', { timeout: 20000 });
    await shot(b.page, k('58-sync-live') + '--s1');

    await teardown(b.page, b.ctx, k('58-sync-live') + '--b');
    await teardown(a.page, a.ctx, k('58-sync-live'));
  });

  test(`sync-a3 shared space: invite via UI, member data converges [${V.id}]`, async ({ browser }) => {
    test.skip(!(await syncApiUp()), 'sync API not running');
    test.setTimeout(300_000);
    const run = Date.now();

    // alice: create a space to share
    const alice = await createPage(browser, V);
    await base(alice.page, V, { userSub: `e2e-owner-${run}` });
    await gotoSpaces(alice.page);
    await alice.page.click('[data-testid="spaces-add"]');
    await alice.page.fill('[data-testid="space-create-name"]', 'Shared Home');
    await alice.page.click('[data-testid="space-create-save"]');
    await alice.page.waitForTimeout(3000); // push

    // friendship: alice adds bob INLINE from the space members section
    // (never leaves the invite flow — the friends screen is only where
    // bob reads his id and accepts)
    const bob = await createPage(browser, V);
    await base(bob.page, V, { userSub: `e2e-member-${run}` });
    await gotoGlobalSettings(bob.page);
    await bob.page.click('[data-testid="settings-friends-row"]');
    await expect(bob.page.locator('[data-testid="friends-copy-id"] span')).toHaveText(/^[0-9a-f]{8}-/, { timeout: 10000 });
    const bobId = (await bob.page.locator('[data-testid="friends-copy-id"] span').textContent()).trim();

    await gotoMembersOf(alice.page, 'Shared Home', { unlock: true });
    await alice.page.fill('[data-testid="space-addfriend-input"]', bobId);
    await alice.page.click('[data-testid="space-addfriend-send"]');
    await expect(alice.page.locator('[data-testid="space-addfriend-sent"]')).toBeVisible({ timeout: 10000 });

    // bob accepts on his friends screen (re-entered: the screen loads
    // requests on mount); alice re-enters the members screen so the
    // fresh friendship shows up as an invitable chip
    await bob.page.click('[data-testid="friends-back"]');
    await bob.page.click('[data-testid="settings-friends-row"]');
    await bob.page.locator('[data-testid^="friends-accept-"]').click({ timeout: 10000 });
    await bob.page.waitForTimeout(500);
    await alice.page.click('[data-testid="spacemembers-back"]');
    await alice.page.waitForTimeout(700);
    await gotoMembersOf(alice.page, 'Shared Home');
    await shot(alice.page, k('33-space-share') + '--s1');
    await alice.page.locator('[data-testid^="space-invite-"]').first().click();
    await alice.page.waitForTimeout(800);

    // bob: accept the invite banner; the shared space + its data arrive
    await gotoSpaces(bob.page);
    await expect(bob.page.locator('[data-testid="space-invites"]')).toContainText('Shared Home', { timeout: 10000 });
    await shot(bob.page, k('33-space-share') + '--s2');
    await bob.page.locator('[data-testid^="space-invite-accept-"]').click();
    await expect(bob.page.locator('[data-testid="screen-spaces"]')).toContainText('Shared Home', { timeout: 15000 });
    await shot(bob.page, k('33-space-share'));

    // roles: alice (owner) demotes bob to reader, then back to contributor
    // (re-enter the members screen so the list includes bob)
    await alice.page.click('[data-testid="spacemembers-back"]');
    await alice.page.waitForTimeout(700);
    await gotoMembersOf(alice.page, 'Shared Home');
    await alice.page.waitForSelector('[data-testid^="space-role-"]', { timeout: 10000 });
    await alice.page.locator('[data-testid^="space-role-"]').selectOption('reader');
    await alice.page.waitForTimeout(500);
    await expect(alice.page.locator('[data-testid^="space-role-"]')).toHaveValue('reader');
    await shot(alice.page, k('57-space-roles'));
    await alice.page.locator('[data-testid^="space-role-"]').selectOption('contributor');
    await alice.page.waitForTimeout(500);

    // bob leaves the space: it disappears from his list, alice keeps it
    await gotoMembersOf(bob.page, 'Shared Home');
    await bob.page.waitForSelector('[data-testid="space-leave"]');
    await bob.page.click('[data-testid="space-leave"]'); // arm
    await bob.page.click('[data-testid="space-leave"]'); // confirm
    await expect(bob.page.locator('[data-testid="screen-spaces"]')).not.toContainText('Shared Home', { timeout: 10000 });
    await shot(bob.page, k('57-space-roles') + '--s1');

    await teardown(bob.page, bob.ctx, k('33-space-share') + '--bob');
    await teardown(alice.page, alice.ctx, k('33-space-share'));
  });

  test(`sync-a4 onboarding shows once for brand-new users, sets currency [${V.id}]`, async ({ browser }) => {
    test.skip(!(await syncApiUp()), 'sync API not running');
    const sub = `e2e-onboard-${Date.now()}`;

    const a = await createPage(browser, V);
    await base(a.page, V, { userSub: sub, keepOnboarding: true });
    // brand-new user -> redirected to onboarding
    await a.page.waitForSelector('[data-testid="screen-onboarding"]');
    await a.page.fill('[data-testid="onboarding-name"]', 'Okkes Test');
    await a.page.click('[data-testid="onboarding-country"]');
    await a.page.waitForSelector('[data-testid="onboarding-country-search"]');
    await a.page.fill('[data-testid="onboarding-country-search"]', 'Turk');
    await a.page.click('[data-testid="onboarding-country-TR"]');
    await shot(a.page, k('37-onboarding'));
    await a.page.click('[data-testid="onboarding-save"]');
    // step 2 (app lock) — decide later in the e2e stack; the bank step is
    // gone (the guided tutorial owns account setup now)
    await a.page.waitForSelector('[data-testid="onboarding-lock-step"]');
    await shot(a.page, k('37-onboarding') + '--s1');
    await a.page.click('[data-testid="onboarding-lock-later"]');
    await a.page.waitForSelector('[data-testid="screen-home"]');
    // reload: onboarding never comes back
    await a.page.reload();
    await a.page.waitForSelector('[data-testid="screen-home"]');
    await expect(a.page.locator('[data-testid="screen-onboarding"]')).toHaveCount(0);
    await teardown(a.page, a.ctx, k('37-onboarding'));
  });

  test(`sync-a2 personal space exists exactly once for a returning user [${V.id}]`, async ({ browser }) => {
    test.skip(!(await syncApiUp()), 'sync API not running');
    const sub = `e2e-solo-${Date.now()}`;

    const a = await createPage(browser, V);
    await base(a.page, V, { userSub: sub });
    await a.page.waitForTimeout(3000); // personal space pushed

    // same user, fresh device: must NOT create a second personal space
    const b = await createPage(browser, V);
    await base(b.page, V, { userSub: sub });
    await gotoSpaces(b.page);
    await b.page.waitForTimeout(2000);
    await expect(b.page.locator('[data-testid="screen-spaces"] [data-testid^="space-row-"]')).toHaveCount(1, {
      timeout: 15000,
    });
    await shot(b.page, k('26-sync-single-space'));
    await teardown(b.page, b.ctx, k('26-sync-single-space'));
    await teardown(a.page, a.ctx, k('26-sync-single-space') + '--a');
  });

  test(`sync-a6 shared bank feed: import, invite, diverge, archive on leave [${V.id}]`, async ({ browser }) => {
    test.skip(!(await syncApiUp()), 'sync API not running');
    test.setTimeout(300_000);
    const run = Date.now();

    // alice: fresh user, creates the shared space (becomes active)
    const alice = await createPage(browser, V);
    await base(alice.page, V, { userSub: `e2e-feedowner-${run}` });
    await gotoSpaces(alice.page);
    await alice.page.click('[data-testid="spaces-add"]');
    await alice.page.fill('[data-testid="space-create-name"]', 'Feed Home');
    await alice.page.click('[data-testid="space-create-save"]');
    await alice.page.waitForTimeout(3000); // push

    // alice imports a statement — the feed registers on the server and
    // auto-attaches to the active space
    await gotoGlobalSettings(alice.page);
    await alice.page.click('[data-testid="settings-accounts-row"]');
    await alice.page.setInputFiles('[data-testid="accounts-import-input"]', CAMT_FIXTURE);
    await alice.page.waitForSelector('[data-testid="import-preview"]');
    await alice.page.click('[data-testid="import-run"]');
    await alice.page.waitForSelector('[data-testid="import-result"]');
    await alice.page.click('[data-testid="import-close"]');
    await expect(alice.page.locator('[data-testid^="account-via-"]').first()).toContainText('Feed Home', { timeout: 10000 });
    await shot(alice.page, k('61-feed-share') + '--s1');
    await alice.page.waitForTimeout(4000); // push feed rows + overlay

    // bob: fresh user; alice friends him inline from the members section
    const bob = await createPage(browser, V);
    await base(bob.page, V, { userSub: `e2e-feedmember-${run}` });
    await gotoGlobalSettings(bob.page);
    await bob.page.click('[data-testid="settings-friends-row"]');
    await expect(bob.page.locator('[data-testid="friends-copy-id"] span')).toHaveText(/^[0-9a-f]{8}-/, { timeout: 10000 });
    const bobId = (await bob.page.locator('[data-testid="friends-copy-id"] span').textContent()).trim();

    await gotoMembersOf(alice.page, 'Feed Home', { unlock: true });
    await alice.page.fill('[data-testid="space-addfriend-input"]', bobId);
    await alice.page.click('[data-testid="space-addfriend-send"]');
    await expect(alice.page.locator('[data-testid="space-addfriend-sent"]')).toBeVisible({ timeout: 10000 });
    await bob.page.click('[data-testid="friends-back"]');
    await bob.page.click('[data-testid="settings-friends-row"]');
    await bob.page.locator('[data-testid^="friends-accept-"]').click({ timeout: 10000 });
    await alice.page.click('[data-testid="spacemembers-back"]');
    await alice.page.waitForTimeout(700);
    await gotoMembersOf(alice.page, 'Feed Home');
    await alice.page.locator('[data-testid^="space-invite-"]').first().click();
    await alice.page.waitForTimeout(800);
    await alice.page.click('[data-testid="spacemembers-back"]');

    // bob accepts, makes the shared space active — and sees the FEED's
    // transactions through derived access (raw + alice's overlay joined)
    await gotoSpaces(bob.page);
    await expect(bob.page.locator('[data-testid="space-invites"]')).toContainText('Feed Home', { timeout: 10000 });
    await bob.page.locator('[data-testid^="space-invite-accept-"]').click();
    await expect(bob.page.locator('[data-testid="screen-spaces"]')).toContainText('Feed Home', { timeout: 15000 });
    await bob.page.locator('[data-testid="screen-spaces"] button:has-text("Feed Home")').first().click();
    await bob.page.waitForTimeout(600); // active-space switch settles
    await bob.page.click('[data-testid="tab-transactions"]');
    await bob.page.waitForSelector('[data-testid="screen-transactions"]', { timeout: 10000 });
    await expect(bob.page.locator('[data-testid="tx-list"]')).toContainText('Jumbo Amsterdam', { timeout: 25000 });
    await shot(bob.page, k('61-feed-share') + '--s2');

    // bob recategorizes a feed transaction; the shared overlay reaches alice
    await bob.page.locator('[data-testid="tx-list"] button:has-text("Jumbo Amsterdam")').first().click();
    await bob.page.click('[data-testid="tx-detail-category-row"]');
    await bob.page.waitForSelector('[data-testid="split-editor"]');
    await bob.page.click('[data-testid="split-cat-0"]');
    await bob.page.waitForSelector('[data-testid="catpicker-videoGame"]');
    await bob.page.click('[data-testid="catpicker-videoGame"]');
    await bob.page.click('[data-testid="split-save"]');
    await bob.page.waitForTimeout(3500); // push

    await alice.page.click('[data-testid="tab-transactions"]');
    await alice.page.locator('[data-testid="tx-list"] button:has-text("Jumbo Amsterdam")').first().click();
    await expect(alice.page.locator('[data-testid="tx-detail-category-row"]')).toContainText('Video Game', { timeout: 20000 });
    await shot(alice.page, k('61-feed-share'));

    // alice (feed owner + attacher) leaves the space: bob keeps the shared
    // history but the account freezes — the synced mirror row delivers the
    // archived badge to his accounts screen
    await alice.page.click('[data-testid="tx-detail-back"]');
    await gotoMembersOf(alice.page, 'Feed Home');
    await alice.page.waitForSelector('[data-testid="space-leave"]');
    await alice.page.click('[data-testid="space-leave"]');
    await alice.page.click('[data-testid="space-leave"]');
    await expect(alice.page.locator('[data-testid="screen-spaces"]')).not.toContainText('Feed Home', { timeout: 10000 });

    await bob.page.click('[data-testid="tx-detail-back"]');
    await gotoGlobalSettings(bob.page);
    await bob.page.click('[data-testid="settings-accounts-row"]');
    await expect(bob.page.locator('[data-testid="accounts-shared"]')).toContainText('Archived', { timeout: 25000 });
    await shot(bob.page, k('62-feed-archive'));

    await teardown(bob.page, bob.ctx, k('61-feed-share') + '--bob');
    await teardown(alice.page, alice.ctx, k('61-feed-share'));
  });
}
