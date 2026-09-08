#!/usr/bin/env node
/**
 * The ONE entry point for IaC stacks (docs/iac-plan.md).
 *
 *   node infra/bootstrap.mjs --stack munni-iac-prod            # ensure secrets + render + runbook (+ logto/glitchtip when creds exist)
 *   node infra/bootstrap.mjs --stack munni-iac-prod --verify   # probe reality, no writes
 *   node infra/bootstrap.mjs --stack munni-iac-prod --rotate NAS_GLITCHTIP_SECRET_KEY
 *   node infra/bootstrap.mjs --stack munni-iac-prod --render-only  # compose+env template only, no gh (the NAS bundle job)
 *   node infra/bootstrap.mjs --stack munni-local               # local twin: secrets live in a gitignored file, .env renders with real values
 *   node infra/bootstrap.mjs --list
 *
 * First run: mints generated secrets, renders compose/env + a runbook
 * with every manual step and the actual values inlined. Steady state:
 * re-renders and re-verifies with zero prompts.
 *
 * Exits via process.exitCode (never process.exit after async work):
 * exit() during undici/timer teardown hits a libuv assert on Windows
 * ("UV_HANDLE_CLOSING", found live 2026-08-27 in --verify).
 */
import { execFileSync } from 'node:child_process';
import { listStacks, loadStack, pairProd, sharedOf } from './modules/stack.mjs';
import { ensureSecrets, verifySecrets } from './modules/secrets.mjs';
import { ensureLocalSecrets, familyValues, loadLocalValues, saveLocalValues, stackManifestEntries } from './modules/localstore.mjs';
import { applyApps, applyBranding, applySocialConnectors, writeBack } from './modules/logto.mjs';
import { applyGlitchTip, writeBackDsns } from './modules/glitchtip.mjs';
import { renderStack } from './modules/render.mjs';
import { renderRunbook, renderLocalRunbook } from './modules/runbook.mjs';
import { applyReverseProxy } from './modules/dsm.mjs';
import { localAwareFetch } from './modules/insecure-fetch.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag('list')) {
  for (const s of listStacks()) console.log(s);
  process.exit(0);
}

const stackName = value('stack');
if (!stackName) {
  console.error('usage: bootstrap.mjs --stack <name> [--verify] [--rotate SECRET,...] [--render-only]');
  process.exit(2);
}
const stack = loadStack(stackName);
const pair = pairProd(stack);
const rotate = (value('rotate') ?? '').split(',').filter(Boolean);

function envSecret(env, name) {
  try {
    const out = execFileSync('gh', ['api', `repos/{owner}/{repo}/environments/${encodeURIComponent(env)}/secrets/${name}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out).name === name;
  } catch {
    return false;
  }
}

async function probe(label, url, ok = (r) => r.ok) {
  // manual controller + unref'd timer: AbortSignal.timeout keeps a live
  // handle armed for its full window, which delays (and on Windows can
  // crash) process teardown after the last probe
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  timer.unref?.();
  try {
    // localAwareFetch: hosted urls stay strictly verified; the family's
    // locally-signed https (localhost vault + sslip.io LAN hostnames)
    // would fail strict TLS and probe unverified instead
    const res = await localAwareFetch(url, { signal: controller.signal });
    const good = ok(res);
    console.log(`${good ? '  ✓' : '  ✗'} ${label}: ${url} (${res.status})`);
    return good;
  } catch (e) {
    console.log(`  ✗ ${label}: ${url} (${e.cause?.code ?? e.name})`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probeAll() {
  // probe what THIS stack addresses: its own services plus the shared
  // stack's (for iac pairs sharedOf = the pair's prod twin, unchanged)
  const shared = sharedOf(stack);
  let allUp = true;
  if (stack.urls.web) allUp &= await probe('web', stack.urls.web);
  if (stack.urls.api) allUp &= await probe('api', `${stack.urls.api}/health`);
  const logtoUrl = stack.urls.logto ?? pair.urls.logto;
  if (logtoUrl) allUp &= await probe('logto', `${logtoUrl}/oidc/.well-known/openid-configuration`);
  if (shared.urls.glitchtip) allUp &= await probe('glitchtip', `${shared.urls.glitchtip}/api/0/`, (r) => r.status < 500);
  if (shared.urls.vault) allUp &= await probe('vault', `${shared.urls.vault}/alive`, (r) => r.status < 500);
  if (stack.urls.control) allUp &= await probe('control', stack.urls.control, (r) => r.status < 500);
  if (stack.urls.pgadmin) allUp &= await probe('pgadmin', `${stack.urls.pgadmin}/misc/ping`);
  return allUp;
}

// ── target:"local" — the GitHub-free stacks ────────────────────────────
async function localVerify() {
  console.log(`verify ${stack.stack} (local)`);
  const values = familyValues(stack);
  const missing = stackManifestEntries(stack)
    .filter((s) => !s.optional && s.owner !== 'module' && !values[s.name])
    .map((s) => s.name);
  if (missing.length) console.log(`  ✗ values missing from the local store: ${missing.join(', ')}`);
  else console.log('  ✓ local secret store satisfies the manifest');
  const allUp = await probeAll();
  return missing.length || !allUp ? 1 : 0;
}

/** the SHARED local stack: mint its secrets, pull the control app id
 * from the designated env's store, render — no logto of its own */
async function localApplyShared() {
  console.log(`bootstrap ${stack.stack} (local shared services)`);
  const { values, minted, missingOperator } = ensureLocalSecrets(stack, { rotate });
  if (minted.length) console.log(`  minted: ${minted.join(', ')}`);
  if (missingOperator.length) console.log(`  ⚠ operator values still missing (export them and re-run): ${missingOperator.join(', ')}`);

  // munni-control has its OWN Logto app registered in the designated
  // env's Logto — its id lands in that env's store once logto-setup ran.
  // After Delete-everything that env does not EXIST yet (empty registry,
  // found live 2026-08-30) — the shared stack must still render.
  let controlAppId = null;
  try {
    controlAppId = loadLocalValues(loadStack(stack.controlApi)).VITE_LOGTO_APP_ID_CONTROL;
  } catch {
    console.log(`  control: ${stack.controlApi} does not exist yet — Set up & start creates it, then its sign-in setup feeds munni-control`);
  }
  if (controlAppId && values.CONTROL_LOGTO_APP_ID !== controlAppId) {
    values.CONTROL_LOGTO_APP_ID = controlAppId;
    saveLocalValues(stack, values);
    console.log(`  control: signs in via ${stack.controlApi}'s control app (${controlAppId})`);
  } else if (!controlAppId) {
    console.log(`  control: waiting for ${stack.controlApi}'s sign-in setup — its control app id feeds munni-control`);
  }

  const dir = renderStack(stack, values);
  console.log(`  rendered compose + .env (real values) → ${dir}`);
  const runbook = renderLocalRunbook(stack, { minted, missingOperator });
  console.log(`  runbook → ${runbook}`);
  console.log(`done. Next: cd ${dir} && docker compose --env-file .env.${stack.stack} -f docker-compose.${stack.stack}.yml up -d`);
  return 0;
}

/** Logto-as-code against THIS env's own logto — needs it RUNNING, so
 * first runs fall through gracefully to "start it, re-run" */
async function localApplyLogto(values) {
  if (!values.IAC_LOGTO_INFRA_M2M_ID || !values.IAC_LOGTO_INFRA_M2M_SECRET) {
    console.log('  logto: waiting for the infra M2M credential (the wizard seeds it automatically)');
    return;
  }
  try {
    const creds = { m2mId: values.IAC_LOGTO_INFRA_M2M_ID, m2mSecret: values.IAC_LOGTO_INFRA_M2M_SECRET };
    const apps = await applyApps(pair, stack, creds);
    values.NAS_LOGTO_M2M_APP_ID = apps.m2m.id;
    values.NAS_LOGTO_M2M_APP_SECRET = apps.m2m.secret;
    values.VITE_LOGTO_APP_ID = apps.web.id;
    values.VITE_LOGTO_APP_ID_ADMIN = apps.admin.id;
    values.NATIVE_LOGTO_APP_ID = apps.native.id; // the CI native build bakes this
    // this env hosts munni-control's sign-in? its dedicated control
    // app id feeds the shared stack's render
    if (apps.control) {
      values.VITE_LOGTO_APP_ID_CONTROL = apps.control.id;
      values.CONTROL_LOGTO_APP_ID = apps.control.id;
    }
    saveLocalValues(stack, values);
    console.log(`  logto: apps upserted (web ${apps.web.id}, admin ${apps.admin.id}, native ${apps.native.id})`);
    const social = await applySocialConnectors(pair, creds).catch((e) => ({ applied: [], error: e.message }));
    console.log(social.applied.length ? `  logto: social connectors applied [${social.applied}]` : '  logto: no social connector credentials — skipped');
    const brand = await applyBranding(pair, creds).catch((e) => ({ error: e.message }));
    console.log(brand.error ? `  logto: branding failed (${brand.error})` : '  logto: sign-in branded (munni logo + colors)');
  } catch (e) {
    console.log(`  logto: unreachable or failed (${e.message}) — is the stack up? docker compose up first, then re-run`);
  }
}

async function localApplyGlitchtip(values) {
  if (!values.IAC_GLITCHTIP_API_TOKEN) {
    console.log('  glitchtip: waiting for IAC_GLITCHTIP_API_TOKEN (the wizard mints it automatically)');
    return;
  }
  try {
    const shared = sharedOf(stack);
    const dsns = await applyGlitchTip(shared, stack, values.IAC_GLITCHTIP_API_TOKEN);
    // the api container reaches glitchtip over the shared network, not
    // the browser's published localhost port
    values.NAS_API_SENTRY_DSN = stack.sharedStack ? dsns.api.replace(shared.urls.glitchtip, 'http://glitchtip:8000') : dsns.api; // NOSONAR S5332 — container-to-container on the private docker network
    values.VITE_GLITCHTIP_DSN = dsns.web;
    values.VITE_GLITCHTIP_DSN_ADMIN = dsns.admin;
    saveLocalValues(stack, values);
    console.log('  glitchtip: org/projects ensured, DSNs stored');
  } catch (e) {
    console.log(`  glitchtip: apply failed (${e.message}) — is the shared stack up?`);
  }
}

async function localApply() {
  if (stack.role === 'shared') return localApplyShared();
  console.log(`bootstrap ${stack.stack} (local env — secrets in infra/rendered/${stack.stack}/.secrets.local.json)`);
  const { values, minted, missingOperator } = ensureLocalSecrets(stack, { rotate });
  if (minted.length) console.log(`  minted: ${minted.join(', ')}`);
  if (missingOperator.length) console.log(`  ⚠ operator values still missing (export them and re-run): ${missingOperator.join(', ')}`);

  await localApplyLogto(values);
  await localApplyGlitchtip(values);

  // render LAST so the .env carries every write-back from this run
  const dir = renderStack(stack, values);
  console.log(`  rendered compose + .env (real values) → ${dir}`);
  const runbook = renderLocalRunbook(stack, { minted, missingOperator });
  console.log(`  runbook → ${runbook}`);
  console.log(`done. Next: cd ${dir} && docker compose --env-file .env.${stack.stack} -f docker-compose.${stack.stack}.yml up -d`);
  return 0;
}

// ── GitHub-driven stacks (CI or a shell with gh + the secrets) ─────────
async function ciVerify() {
  console.log(`verify ${stack.stack}`);
  const { missing, unmanaged } = verifySecrets(stack);
  if (missing.length) console.log(`  ✗ secrets missing from ${stack.githubEnvironment}: ${missing.join(', ')}`);
  else console.log(`  ✓ secrets manifest satisfied (${stack.githubEnvironment})`);
  if (unmanaged.length) console.log(`  ! unmanaged secrets present (add to manifest or remove): ${unmanaged.join(', ')}`);
  const allUp = await probeAll();
  return missing.length || !allUp ? 1 : 0;
}

async function ciApply() {
  console.log(`bootstrap ${stack.stack} (pair ${stack.pair}, role ${stack.role})`);

  const { minted, missingOperator } = ensureSecrets(stack, { rotate });
  if (minted.length) console.log(`  minted: ${minted.join(', ')}`);
  if (missingOperator.length) console.log(`  ⚠ operator secrets still missing: ${missingOperator.join(', ')}`);

  const dir = renderStack(stack);
  console.log(`  rendered compose + env → ${dir}`);

  // Logto-as-code runs only once the pair's infra credential exists
  const infraEnv = pair.githubEnvironment;
  if (envSecret(infraEnv, 'IAC_LOGTO_INFRA_M2M_ID')) {
    const creds = {
      m2mId: process.env.IAC_LOGTO_INFRA_M2M_ID,
      m2mSecret: process.env.IAC_LOGTO_INFRA_M2M_SECRET,
    };
    if (creds.m2mId && creds.m2mSecret) {
      const apps = await applyApps(pair, stack, creds);
      writeBack(stack, apps);
      console.log(`  logto: apps upserted (web ${apps.web.id}, admin ${apps.admin.id}, native ${apps.native.id})`);
      if (stack.role === 'prod') {
        const social = await applySocialConnectors(pair, creds).catch((e) => ({ applied: [], error: e.message }));
        console.log(social.applied.length ? `  logto: social connectors applied [${social.applied}]` : `  logto: no social connector credentials in env — skipped${social.error ? ` (${social.error})` : ''}`);
        const brand = await applyBranding(pair, creds).catch((e) => ({ error: e.message }));
        console.log(brand.error ? `  logto: branding failed (${brand.error})` : `  logto: sign-in branded (munni logo + colors)`);
      }
    } else {
      console.log('  logto: infra credential exists in GitHub but not in this shell — export IAC_LOGTO_INFRA_M2M_ID/SECRET to apply apps locally (CI injects them)');
    }
  } else {
    console.log(`  logto: waiting for the one manual OOBE step (see the runbook) — infra M2M credential not stored yet`);
  }

  // GlitchTip-as-code (IAC8): once the pair's operator token exists, the
  // org/team/per-stack projects are ensured and the DSNs written back —
  // runbook §4 becomes a no-op. Soft-fails: GlitchTip may not be booted yet.
  if (envSecret(infraEnv, 'IAC_GLITCHTIP_API_TOKEN')) {
    if (process.env.IAC_GLITCHTIP_API_TOKEN) {
      try {
        const dsns = await applyGlitchTip(pair, stack, process.env.IAC_GLITCHTIP_API_TOKEN);
        writeBackDsns(stack, dsns);
        console.log(`  glitchtip: org/projects ensured, DSNs written back (${stack.stack}-pwa/-api/-admin)`);
      } catch (e) {
        console.log(`  glitchtip: apply failed (${e.message}) — retried on the next run`);
      }
    } else {
      console.log('  glitchtip: token exists in GitHub but not in this shell — export IAC_GLITCHTIP_API_TOKEN to apply locally (CI injects it)');
    }
  } else {
    console.log('  glitchtip: waiting for IAC_GLITCHTIP_API_TOKEN (see the runbook) — org/DSNs not ensured yet');
  }

  // DSM reverse proxy as code — runs whenever the deploy account creds
  // are in the shell (CI injects SYNOLOGY_*; locally: export them)
  const { SYNOLOGY_URL, SYNOLOGY_USER, SYNOLOGY_PASS } = process.env;
  if (SYNOLOGY_URL && SYNOLOGY_USER && SYNOLOGY_PASS) {
    try {
      const result = await applyReverseProxy(stack, { url: SYNOLOGY_URL, user: SYNOLOGY_USER, pass: SYNOLOGY_PASS });
      console.log(`  dsm: reverse proxy created=[${result.created}] updated=[${result.updated}] unchanged=${result.unchanged.length}`);
    } catch (e) {
      console.log(`  dsm: reverse-proxy apply failed (${e.message}) — check the deploy account's DSM admin rights`);
    }
  } else {
    console.log('  dsm: SYNOLOGY_URL/USER/PASS not in env — reverse-proxy rules not applied this run');
  }

  const runbook = renderRunbook(stack, { minted, missingOperator });
  console.log(`  runbook → ${runbook}`);
  console.log('done. Next: follow the runbook top-to-bottom (first run) or --verify (steady state).');
  return 0;
}

if (flag('render-only')) {
  // compose + env TEMPLATE, nothing else — no gh, no modules. The
  // deploy-nas bundle job uses this before render-env.sh substitutes.
  const dir = renderStack(stack);
  console.log(`rendered compose + env template → ${dir}`);
} else if (stack.target === 'local') {
  process.exitCode = flag('verify') ? await localVerify() : await localApply();
} else {
  process.exitCode = flag('verify') ? await ciVerify() : await ciApply();
}
