#!/usr/bin/env node
/**
 * The ONE entry point for IaC stacks (docs/iac-plan.md).
 *
 *   node infra/bootstrap.mjs --stack munni-iac-prod            # ensure secrets + render + runbook (+ logto when creds exist)
 *   node infra/bootstrap.mjs --stack munni-iac-prod --verify   # probe reality, no writes
 *   node infra/bootstrap.mjs --stack munni-iac-prod --rotate NAS_GLITCHTIP_SECRET_KEY
 *   node infra/bootstrap.mjs --list
 *
 * First run: mints generated secrets, renders compose/env + a runbook
 * with every manual step and the actual values inlined. Steady state:
 * re-renders and re-verifies with zero prompts.
 */
import { execFileSync } from 'node:child_process';
import { listStacks, loadStack, pairProd } from './modules/stack.mjs';
import { ensureSecrets, verifySecrets } from './modules/secrets.mjs';
import { applyApps, applyBranding, applySocialConnectors, writeBack } from './modules/logto.mjs';
import { renderStack } from './modules/render.mjs';
import { renderRunbook } from './modules/runbook.mjs';
import { applyReverseProxy } from './modules/dsm.mjs';

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
  console.error('usage: bootstrap.mjs --stack <name> [--verify] [--rotate SECRET,...]');
  process.exit(2);
}
const stack = loadStack(stackName);
const pair = pairProd(stack);

function envSecret(env, name) {
  try {
    const out = execFileSync('gh', ['api', `repos/{owner}/{repo}/environments/${encodeURIComponent(env)}/secrets/${name}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out).name === name;
  } catch {
    return false;
  }
}

async function probe(label, url, ok = (r) => r.ok) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const good = ok(res);
    console.log(`${good ? '  ✓' : '  ✗'} ${label}: ${url} (${res.status})`);
    return good;
  } catch (e) {
    console.log(`  ✗ ${label}: ${url} (${e.cause?.code ?? e.name})`);
    return false;
  }
}

if (flag('verify')) {
  console.log(`verify ${stack.stack}`);
  const { missing, unmanaged } = verifySecrets(stack);
  if (missing.length) console.log(`  ✗ secrets missing from ${stack.githubEnvironment}: ${missing.join(', ')}`);
  else console.log(`  ✓ secrets manifest satisfied (${stack.githubEnvironment})`);
  if (unmanaged.length) console.log(`  ! unmanaged secrets present (add to manifest or remove): ${unmanaged.join(', ')}`);
  let allUp = true;
  allUp &= await probe('web', stack.urls.web);
  allUp &= await probe('api', `${stack.urls.api}/health`);
  allUp &= await probe('logto', `${pair.urls.logto}/oidc/.well-known/openid-configuration`);
  allUp &= await probe('glitchtip', `${pair.urls.glitchtip}/api/0/`, (r) => r.status < 500);
  process.exit(missing.length || !allUp ? 1 : 0);
}

// --- apply path -------------------------------------------------------------
const rotate = (value('rotate') ?? '').split(',').filter(Boolean);
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
