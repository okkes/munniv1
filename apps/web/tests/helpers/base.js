import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SHOTS_DIR = path.join(ROOT, 'screenshots');
export const VIDEOS_DIR = path.join(ROOT, 'videos');

for (const d of [SHOTS_DIR, VIDEOS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// All test variants: language × theme × viewport.
// id format: '{lang}-{theme}-{viewport}'
// Single default variant: EN, light, mobile.
// Dark / TR / desktop are evaluated manually when explicitly requested.
export const VARIANTS = [
  { id: 'en-light-mobile', lang: 'en', dark: false, vp: { width: 393, height: 852 }, dpr: 2 },
];

// Create a browser context + page configured for the given variant.
// Includes video recording — call teardown() after the test to finalize.
export async function createPage(browser, variant) {
  const ctx = await browser.newContext({
    viewport:          variant.vp,
    deviceScaleFactor: variant.dpr,
    locale:            variant.lang === 'tr' ? 'tr-TR' : 'en-US',
    recordVideo:       { dir: VIDEOS_DIR, size: variant.vp },
  });
  const page = await ctx.newPage();
  return { page, ctx };
}

// Inject language + theme into localStorage before page load, then navigate.
// opts.demo: pre-authenticated demo session (skips the login screen).
// opts.userSub: pre-authenticated syncing user via test auth (needs the
//               docker-compose.test.yml API on localhost:8180).
export async function base(page, variant, opts = {}) {
  await page.addInitScript((v) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('munni_lang', v.lang);
    localStorage.setItem('munni_theme', v.dark ? 'dark' : 'light');
    if (v.demo) localStorage.setItem('munni_session', JSON.stringify({ kind: 'demo' }));
    if (v.demo) indexedDB.deleteDatabase('munni_demo'); // pristine seed every run
    if (v.userSub) {
      localStorage.setItem('munni_session', JSON.stringify({ kind: 'user', sub: v.userSub, testAuth: true }));
    }
  }, { lang: variant.lang, dark: variant.dark, demo: !!opts.demo, userSub: opts.userSub ?? null });
  if (opts.extraSetup) await page.addInitScript(opts.extraSetup);
  if (process.env.E2E_LOG) page.on('console', (m) => console.log('[page]', m.text()));
  await page.goto('/');
  const authed = opts.demo || opts.userSub;
  // brand-new accounts land on the NON-skippable onboarding (tab bar
  // hidden there) — complete it so specs start on a normal home. Specs
  // that test onboarding itself pass keepOnboarding: true.
  if (opts.userSub && !opts.keepOnboarding) await completeOnboardingIfShown(page, opts.userSub);
  await page.waitForSelector(authed ? '[data-testid="tab-home"]' : '[data-testid="screen-login"]');
}

async function completeOnboardingIfShown(page, userSub) {
  // a brand-new user's FIRST paint can exceed a short fixed wait on a
  // cold CI stack — the old 3s timeout then declared "no onboarding"
  // and the spec waited forever for a tab bar onboarding keeps hidden.
  // Race the two possible outcomes instead of guessing.
  const onboarding = page.locator('[data-testid="screen-onboarding"]');
  // NOT tab-home: the tab bar sits OUTSIDE DataProvider and is visible
  // during the whole bootstrap — screen-home only renders once state is
  // ready, which is exactly when the needsOnboarding meta is final
  const home = page.locator('[data-testid="screen-home"]');
  // as patient as the spec budget itself: under FULL-suite load a brand
  // new user's first paint has been observed beyond 30s — a shorter cap
  // here just converts slowness into a guaranteed timeout later
  let winner = await Promise.race([
    onboarding.waitFor({ timeout: 120000 }).then(() => 'onboarding').catch(() => null),
    home.waitFor({ state: 'visible', timeout: 120000 }).then(() => 'home').catch(() => null),
  ]);
  if (winner === 'home') {
    // the tab bar can paint a beat BEFORE Home's needsOnboarding query
    // navigates away — the meta itself is already final (the fail-closed
    // bootstrap wrote it before rendering), so read it directly instead
    // of guessing: races here ambushed specs with a late onboarding
    const needs = await page.evaluate(
      (dbName) =>
        new Promise((resolve) => {
          const req = indexedDB.open(dbName);
          req.onerror = () => resolve(false);
          req.onsuccess = () => {
            const db = req.result;
            try {
              const get = db.transaction('meta').objectStore('meta').get('needsOnboarding');
              get.onsuccess = () => {
                resolve(get.result?.value === true);
                db.close();
              };
              get.onerror = () => {
                resolve(false);
                db.close();
              };
            } catch {
              resolve(false);
              db.close();
            }
          };
        }),
      `munni_user_${userSub}`,
    );
    if (!needs) return; // truly a returning user
    await onboarding.waitFor({ timeout: 30000 }); // the redirect is coming
    winner = 'onboarding';
  }
  if (winner !== 'onboarding') return;
  // something can remount the tree once during a cold boot and wipe the
  // typed name (CI snapshots showed the field empty + Continue disabled
  // AFTER a successful fill) — so fill-until-armed, then walk the steps,
  // retrying the whole passage if the screen snaps back
  const name = page.locator('[data-testid="onboarding-name"]');
  const save = page.locator('[data-testid="onboarding-save"]');
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      for (let i = 0; i < 30 && !(await save.isEnabled().catch(() => false)); i++) {
        await name.fill('E2E User').catch(() => undefined);
        await page.waitForTimeout(500);
      }
      await save.click({ timeout: 10000 });
      await page.click('[data-testid="onboarding-lock-later"]', { timeout: 15000 });
      await page.waitForSelector('[data-testid="screen-home"]', { timeout: 20000 });
      await skipMinaTutorial(page);
      return;
    } catch {
      // snapped back to an earlier step (or home already arrived) — loop
      if (await page.locator('[data-testid="screen-home"]').isVisible().catch(() => false)) {
        await skipMinaTutorial(page);
        return;
      }
    }
  }
  throw new Error('onboarding never completed — see the page snapshot');
}

// Brand-new identities auto-start the Mina tutorial right after the
// onboarding form (no space exists yet!). Specs that don't test Mina
// skip it — the skip path creates the default "Private" space, which is
// what every downstream assertion needs to exist.
async function skipMinaTutorial(page) {
  const skip = page.locator('[data-testid="mina-skip"]');
  if (!(await skip.isVisible().catch(() => false))) {
    // give the auto-start a beat — dispatched right after navigation
    await skip.waitFor({ timeout: 5000 }).catch(() => undefined);
  }
  if (!(await skip.isVisible().catch(() => false))) return;
  await skip.click();
  await page.click('[data-testid="mina-skip-confirm"]', { timeout: 10000 });
  // the default space lands before the tutorial unmounts
  await page.waitForSelector('[data-testid="mina-tutorial"]', { state: 'detached', timeout: 15000 });
}

// App-wide rows live behind the single "Global settings" door on the
// Settings tab (scope split): canonical route to that screen for tests.
export async function gotoGlobalSettings(page) {
  await page.click('[data-testid="tab-settings"]');
  await page.click('[data-testid="settings-global-row"]');
  await page.waitForSelector('[data-testid="screen-settings-global"]');
}

// Spaces left the tab bar (the Home avatar switches, Settings manages):
// canonical route to the Spaces screen for tests.
export async function gotoSpaces(page) {
  await gotoGlobalSettings(page);
  await page.click('[data-testid="settings-spaces-row"]');
  await page.waitForSelector('[data-testid="screen-spaces"]');
}

// True when the docker-compose.test.yml API (header test-auth) is reachable.
export async function syncApiUp() {
  try {
    const res = await fetch('http://localhost:8181/health', { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = await res.json();
    return body.capabilities?.testAuth === true;
  } catch {
    return false;
  }
}

// Wait for the m-fade animation (280ms) to finish before screenshotting.
export async function shot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: false });
}

// Close context and rename the recorded video to match the screenshot name.
export async function teardown(page, ctx, finalShotName) {
  const video = page.video();
  let videoPath;
  try { videoPath = await video?.path(); } catch {}
  try { await ctx.close(); } catch {}
  if (videoPath) {
    try {
      const dest = path.join(VIDEOS_DIR, `${finalShotName}.webm`);
      if (fs.existsSync(videoPath) && videoPath !== dest) {
        fs.renameSync(videoPath, dest);
      }
    } catch {
      // Cross-device rename can fail; fall back to saveAs copy
      try { await video?.saveAs(path.join(VIDEOS_DIR, `${finalShotName}.webm`)); } catch {}
    }
  }
}
