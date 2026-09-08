import { test, expect } from '@playwright/test';
import { VARIANTS, base } from '../helpers/base.js';

/**
 * WebKit engine guard — geometry assertions only, no gallery shots.
 * Every iOS surface (Safari, PWA, both native webviews) renders with
 * WebKit, and WebKit applies flex sizing stricter than Blink: basis 0%
 * overrides `height` on the main axis and min-height:0 drops the
 * content minimum, which collapsed every sheet to its header on iOS
 * while Android/desktop looked perfect (user ss 2026-07-26 — a `tall`
 * 600px sheet measured 261px). jsdom cannot catch this (no layout) and
 * Chromium grows the item to content anyway; only WebKit tells the
 * truth. Runs in CI and via deploy/webkit-e2e.ps1 (dockerized, no
 * browsers on the host) — the config defines the webkit project only
 * in those two environments.
 */
const V = VARIANTS[0];

async function openSplitEditor(page) {
  await page.click('[data-testid="tab-transactions"]');
  await page.locator('[data-testid^="tx-row-"]').first().click();
  // the split-categories editor is a `tall` (600px) sheet (#211)
  await page.click('[data-testid="tx-detail-cats-edit"]');
  await expect(page.locator('[data-testid="part-cat-0"]')).toBeVisible();
}

test(`sheet-w1 a tall sheet opens to its full height [${V.id}]`, async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: V.vp, deviceScaleFactor: V.dpr, locale: 'en-US' });
  const page = await ctx.newPage();
  await base(page, V, { demo: true });
  await openSplitEditor(page);

  const sheet = page.locator('.react-modal-sheet-container');
  // the collapse measured 261px of sheet and 199px of scrollport — the
  // thresholds sit far from both the broken and the correct value, so
  // animation timing can't flake them and a regression can't sneak under
  await expect.poll(async () => (await sheet.boundingBox())?.height ?? 0).toBeGreaterThan(450);
  const scroller = await page.locator('.react-modal-sheet-content-scroller').boundingBox();
  expect(scroller?.height ?? 0).toBeGreaterThan(300);
  expect((await sheet.boundingBox())?.height ?? 0).toBeLessThan(V.vp.height);
  await ctx.close();
});

test(`sheet-w2 a stacked child keeps the depth step-down [${V.id}]`, async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: V.vp, deviceScaleFactor: V.dpr, locale: 'en-US' });
  const page = await ctx.newPage();
  await base(page, V, { demo: true });
  await openSplitEditor(page);

  await page.click('[data-testid="part-cat-0"]'); // stacks the category picker
  const sheets = page.locator('.react-modal-sheet-container');
  await expect(sheets).toHaveCount(2);
  // stacked sheets step down 28px per level (Sheet.tsx depth cue) — the
  // child must be full-height too, just one step shorter than its parent
  await expect.poll(async () => (await sheets.nth(1).boundingBox())?.height ?? 0).toBeGreaterThan(450);
  const parent = (await sheets.nth(0).boundingBox())?.height ?? 0;
  const child = (await sheets.nth(1).boundingBox())?.height ?? 0;
  expect(Math.abs(parent - 28 - child)).toBeLessThanOrEqual(2);
  await ctx.close();
});
