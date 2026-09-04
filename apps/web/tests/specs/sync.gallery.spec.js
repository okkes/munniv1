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
    // arc 4: spaces are born locked private — the OWNER lifts the lock.
    // #162: the toggle lives in the Settings tab's setup group now
    // (owner-only row), no space-settings detour anymore. Retried: the
    // active-space switch can re-render mid-tap and swallow the click.
    await page.click('[data-testid="tab-settings"]');
    const lock = page.locator('[data-testid="settings-space-private-toggle"]');
    await lock.waitFor({ timeout: 10000 });
    for (let attempt = 0; attempt < 4 && (await lock.isChecked()); attempt++) {
      await lock.click();
      await page.waitForTimeout(500);
    }
    await expect(lock).not.toBeChecked({ timeout: 5000 });
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
    // #314 r2: space cards mount collapsed — expand before asserting rows
    await a.page.locator('[data-testid^="accounts-space-head-"]').first().click();
    await expect(a.page.locator('[data-testid="screen-accounts"]')).toContainText('Sync Wallet');
    await shot(a.page, k('25-sync-devices') + '--s1');
    await a.page.waitForTimeout(3500); // nudge debounce (2s) + push

    // device B: brand-new context discovers the space and pulls everything
    const b = await createPage(browser, V);
    await base(b.page, V, { userSub: sub });
    await gotoGlobalSettings(b.page);
    await b.page.click('[data-testid="settings-accounts-row"]');
    // #314 r2: the pulled space arrives as a collapsed card — expand it
    await b.page.locator('[data-testid^="accounts-space-head-"]').first().click({ timeout: 15000 });
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
    // #314 r2: fresh mount = collapsed again
    await a.page.locator('[data-testid^="accounts-space-head-"]').first().click({ timeout: 15000 });
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
    await a.page.waitForSelector('[data-testid="part-cats-editor"]');
    await a.page.click('[data-testid="part-cat-0"]');
    await a.page.waitForSelector('[data-testid="catpicker-search"]');
    await a.page.click('[data-testid="catpicker-coffee"]');
    await a.page.click('[data-testid="part-cat-save"]');
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

    // friendship FIRST, on the friends screen — #169 turned the members-
    // screen request into a one-shot space add (sync-a6's story now); the
    // explicit invite sheet under test here needs a plain friendship
    await gotoGlobalSettings(alice.page);
    await alice.page.click('[data-testid="settings-friends-row"]');
    await alice.page.fill('[data-testid="friends-add-input"]', bobId);
    await alice.page.click('[data-testid="friends-add-send"]');
    await expect(alice.page.locator('[data-testid="friends-sent"]')).toBeVisible({ timeout: 10000 });

    // bob accepts on his friends screen (re-entered: the screen loads
    // requests on mount); alice heads for the members screen where the
    // fresh friendship is now invitable
    await bob.page.click('[data-testid="friends-back"]');
    await bob.page.click('[data-testid="settings-friends-row"]');
    await bob.page.locator('[data-testid^="friends-accept-"]').click({ timeout: 10000 });
    await bob.page.waitForTimeout(500);
    await alice.page.click('[data-testid="friends-back"]');
    await gotoMembersOf(alice.page, 'Shared Home', { unlock: true });
    await shot(alice.page, k('33-space-share') + '--s1');
    // #170/#171: the badge strip died — the invite sheet picks the friend
    // and the role up front (contributor preselected); send closes it
    await alice.page.click('[data-testid="space-members-add"]');
    await alice.page.locator('[data-testid^="space-invite-row-"]').first().click();
    await alice.page.click('[data-testid="space-invite-send"]');
    await alice.page.waitForTimeout(800);

    // bob: accept the invite banner; the shared space + its data arrive
    await gotoSpaces(bob.page);
    await expect(bob.page.locator('[data-testid="space-invites"]')).toContainText('Shared Home', { timeout: 10000 });
    await shot(bob.page, k('33-space-share') + '--s2');
    await bob.page.locator('[data-testid^="space-invite-accept-"]').click();
    await expect(bob.page.locator('[data-testid="screen-spaces"]')).toContainText('Shared Home', { timeout: 15000 });
    await shot(bob.page, k('33-space-share'));

    // roles (#172): a member ROW opens the member sheet; the role control
    // lives there, owner-looking-at-someone-else only. Both users wear
    // the same onboarding name, so probe rows until the picker shows
    // (the self sheet is read-only; Escape closes it).
    await alice.page.click('[data-testid="spacemembers-back"]');
    await alice.page.waitForTimeout(700);
    await gotoMembersOf(alice.page, 'Shared Home');
    await alice.page.waitForSelector('[data-testid^="member-row-"]', { timeout: 10000 });
    const memberRows = alice.page.locator('[data-testid^="member-row-"]');
    const rowCount = await memberRows.count();
    for (let i = 0; i < rowCount; i++) {
      await memberRows.nth(i).click();
      await alice.page.waitForTimeout(400);
      if (await alice.page.locator('[data-testid="member-sheet-role-reader"]').isVisible().catch(() => false)) break;
      await alice.page.keyboard.press('Escape');
      await alice.page.waitForTimeout(400);
    }
    await alice.page.click('[data-testid="member-sheet-role-reader"]');
    await alice.page.waitForTimeout(500);
    await expect(alice.page.locator('[data-testid="member-sheet-role-reader"]')).toHaveAttribute('aria-pressed', 'true');
    await shot(alice.page, k('57-space-roles'));
    await alice.page.click('[data-testid="member-sheet-role-contributor"]');
    await alice.page.waitForTimeout(500);
    await alice.page.keyboard.press('Escape');
    await alice.page.waitForTimeout(400);

    // bob leaves the space: it disappears from his list, alice keeps it
    await gotoMembersOf(bob.page, 'Shared Home');
    await bob.page.waitForSelector('[data-testid="space-leave"]');
    await bob.page.click('[data-testid="space-leave"]');
    // #304: the danger sheet counts down 5s before the confirm arms
    await expect(bob.page.locator('[data-testid="space-leave-confirm"]')).toBeEnabled({ timeout: 10000 });
    await bob.page.click('[data-testid="space-leave-confirm"]');
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

    // alice imports a statement — the feed registers on the server but
    // #204: nothing attaches by itself; the result offers the explicit
    // attach flow where alice picks the account, type and history
    await gotoGlobalSettings(alice.page);
    await alice.page.click('[data-testid="settings-accounts-row"]');
    await alice.page.setInputFiles('[data-testid="accounts-import-input"]', CAMT_FIXTURE);
    await alice.page.waitForSelector('[data-testid="import-preview"]');
    await alice.page.click('[data-testid="import-run"]');
    await alice.page.waitForSelector('[data-testid="import-result"]');
    await expect(alice.page.locator('[data-testid="import-unattached-note"]')).toBeVisible();
    await alice.page.click('[data-testid="import-goto-attach"]');
    await alice.page.waitForSelector('[data-testid="screen-space-accounts"]', { timeout: 10000 });
    // #310: the attach sheet auto-opens on arrival. This CAMT fixture
    // imports TWO accounts, so the door can't know which one — the
    // sheet lands on the pick list (a single import would land on the
    // final step, `space-attach-focus`, covered by unit specs)
    await alice.page.waitForSelector('[data-testid="space-attach-candidates"]', { timeout: 10000 });
    await alice.page.locator('[data-testid^="space-attach-pick-"]').first().click({ timeout: 10000 });
    await alice.page.click('[data-testid="space-attach-save"]');
    await alice.page.waitForTimeout(1500); // server attach + link mirror
    await gotoGlobalSettings(alice.page);
    await alice.page.click('[data-testid="settings-accounts-row"]');
    // #227: the "via <space>" subtitle is gone — the attachment now
    // echoes as an inert row under the space's own card, which mounts
    // COLLAPSED since #314 r2 — open it before looking for the echo
    await alice.page.locator('[data-testid^="accounts-space-head-"]', { hasText: 'Feed Home' }).click({ timeout: 15000 });
    await expect(alice.page.locator('[data-testid^="account-echo-"]').first()).toBeVisible({ timeout: 10000 });
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
    // #304: the request field lives inside the one invite sheet now
    await alice.page.click('[data-testid="space-members-add"]');
    await alice.page.fill('[data-testid="space-addfriend-input"]', bobId);
    await alice.page.click('[data-testid="space-addfriend-send"]');
    await expect(alice.page.locator('[data-testid="space-addfriend-sent"]')).toBeVisible({ timeout: 10000 });
    // #304: the request field lives inside the invite SHEET — close it
    // first, or its backdrop swallows the back tap below
    await alice.page.keyboard.press('Escape');
    await alice.page.waitForTimeout(500);
    // #169: the members-screen request CARRIES the space — bob's accept
    // makes him a member on the spot (no second invite, no banner) and
    // the accept handler pulls the fresh space immediately
    await bob.page.click('[data-testid="friends-back"]');
    await bob.page.click('[data-testid="settings-friends-row"]');
    await bob.page.locator('[data-testid^="friends-accept-"]').click({ timeout: 10000 });
    await alice.page.click('[data-testid="spacemembers-back"]');

    // bob makes the shared space active — and sees the FEED's
    // transactions through derived access (raw + alice's overlay joined)
    await gotoSpaces(bob.page);
    await expect(bob.page.locator('[data-testid="screen-spaces"]')).toContainText('Feed Home', { timeout: 20000 });
    await bob.page.locator('[data-testid="screen-spaces"] button:has-text("Feed Home")').first().click();
    await bob.page.waitForTimeout(600); // active-space switch settles
    await bob.page.click('[data-testid="tab-transactions"]');
    await bob.page.waitForSelector('[data-testid="screen-transactions"]', { timeout: 10000 });
    await expect(bob.page.locator('[data-testid="tx-list"]')).toContainText('Jumbo Amsterdam', { timeout: 25000 });
    await shot(bob.page, k('61-feed-share') + '--s2');

    // bob recategorizes a feed transaction; the shared overlay reaches alice
    await bob.page.locator('[data-testid="tx-list"] button:has-text("Jumbo Amsterdam")').first().click();
    await bob.page.click('[data-testid="tx-detail-category-row"]');
    await bob.page.waitForSelector('[data-testid="part-cats-editor"]');
    await bob.page.click('[data-testid="part-cat-0"]');
    await bob.page.waitForSelector('[data-testid="catpicker-videoGame"]');
    await bob.page.click('[data-testid="catpicker-videoGame"]');
    await bob.page.click('[data-testid="part-cat-save"]');
    await bob.page.waitForTimeout(3500); // push

    await alice.page.click('[data-testid="tab-transactions"]');
    await alice.page.locator('[data-testid="tx-list"] button:has-text("Jumbo Amsterdam")').first().click();
    await expect(alice.page.locator('[data-testid="tx-detail-category-row"]')).toContainText('Video Game', { timeout: 20000 });
    await shot(alice.page, k('61-feed-share'));

    // #305: bob meets the shared account inside ITS space section — the
    // global "Shared with me" section is retired. The echo wears the
    // shared badge and answers with the READ-ONLY info sheet (facts, no
    // owner levers: no rename, no detach, no delete)
    await bob.page.click('[data-testid="tx-detail-back"]');
    await gotoGlobalSettings(bob.page);
    await bob.page.click('[data-testid="settings-accounts-row"]');
    // #314 r2: the space card mounts collapsed — open Feed Home's first
    await bob.page.locator('[data-testid^="accounts-space-head-"]', { hasText: 'Feed Home' }).click({ timeout: 15000 });
    // the badge doubles as the ready signal: it appears once /me/feeds
    // answered and the entry classified as shared-with-me
    await expect(bob.page.locator('[data-testid^="echo-shared-"]').first()).toBeVisible({ timeout: 15000 });
    const sharedEcho = bob.page.locator('button[data-testid^="account-echo-"]').first();
    await expect(bob.page.locator('[data-testid="accounts-shared"]')).toHaveCount(0);
    await sharedEcho.click();
    await bob.page.waitForSelector('[data-testid="shared-account-info"]');
    await expect(bob.page.locator('[data-testid="space-account-sheet-detach"]')).toHaveCount(0);
    await expect(bob.page.locator('[data-testid="attach-delete"]')).toHaveCount(0);
    await shot(bob.page, k('61-feed-share') + '--s3');
    await bob.page.keyboard.press('Escape');
    await bob.page.waitForTimeout(600);

    // alice (feed owner + attacher) leaves the space: bob keeps the shared
    // history but the account freezes — the synced mirror row delivers the
    // archived state onto the space-level echo (#305: the pill moved here
    // from the retired shared section; bob's open screen updates live)
    await alice.page.click('[data-testid="tx-detail-back"]');
    await gotoMembersOf(alice.page, 'Feed Home');
    await alice.page.waitForSelector('[data-testid="space-leave"]');
    await alice.page.click('[data-testid="space-leave"]');
    await expect(alice.page.locator('[data-testid="space-leave-confirm"]')).toBeEnabled({ timeout: 10000 });
    await alice.page.click('[data-testid="space-leave-confirm"]');
    await expect(alice.page.locator('[data-testid="screen-spaces"]')).not.toContainText('Feed Home', { timeout: 10000 });

    await expect(bob.page.locator('[data-testid^="echo-archived-"]').first()).toBeVisible({ timeout: 25000 });
    await shot(bob.page, k('62-feed-archive'));

    await teardown(bob.page, bob.ctx, k('61-feed-share') + '--bob');
    await teardown(alice.page, alice.ctx, k('61-feed-share'));
  });
}
