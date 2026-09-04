#!/usr/bin/env node
/**
 * The setup wizard's LOCAL HELPER — `node infra/setup/serve.mjs` (or
 * double-click infra/setup/start.cmd). Zero dependencies.
 *
 * It serves infra/setup/index.html on 127.0.0.1 and gives the page hands
 * on THIS machine, now over the local THREE-STACK family (plan LS1-LS3):
 * munni-local-shared (postgres, glitchtip, vault, ocr, munni-control)
 * plus the munni-local-prod / munni-local-dev environments, each with its
 * own Logto. Endpoints take a `stack` and stream every command's output
 * into the page. Without the helper the page stays a guided manual.
 *
 * Security model (a localhost dev tool, but still):
 * - binds 127.0.0.1 only; Host header must be localhost/127.0.0.1;
 * - every /api call needs the per-run token the server injects into the
 *   page it serves (other local pages can't drive it);
 * - commands are a fixed allowlist over a fixed stack list — the ONLY
 *   caller-controlled data is operator secret VALUES, passed as env to
 *   bootstrap (never argv, never logged) and restricted to the
 *   manifest's operator names.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MANIFEST } from '../modules/secrets.mjs';
import { familyValues, loadLocalValues, saveLocalValues, stackManifestEntries } from '../modules/localstore.mjs';
import { insecureFetch, localAwareFetch } from '../modules/insecure-fetch.mjs';
import { lanHost, loadStack, localEnvRegistry, saveLocalEnvRegistry } from '../modules/stack.mjs';
import { jwtES256, jwtRS256, validate } from '../modules/validate.mjs';
import { buildAccount, buildCipher, encString, vaultImport, vaultLogin, vaultPurge, vaultRegister } from '../modules/vault.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..', '..');
const HTML = join(DIR, 'index.html');

export const SHARED_STACK = 'munni-local-shared';
/** the environment stacks are DYNAMIC (local-envs.json registry) */
export const LOCAL_ENVS = () => localEnvRegistry().map((e) => `munni-local-${e.name}`);
export const LOCAL_STACKS = () => [SHARED_STACK, ...LOCAL_ENVS()];

// MUNNI_RENDER_DIR: same test override the render/localstore modules honor
const renderedDir = (name) =>
  process.env.MUNNI_RENDER_DIR ? join(process.env.MUNNI_RENDER_DIR, name) : join(ROOT, 'infra', 'rendered', name);
const composeArgs = (name) => ['compose', '--env-file', `.env.${name}`, '-f', `docker-compose.${name}.yml`];
const pickStack = (candidate, fallback = 'munni-local-prod') => (LOCAL_STACKS().includes(candidate) ? candidate : fallback);
const pickEnv = (candidate) => (LOCAL_ENVS().includes(candidate) ? candidate : 'munni-local-prod');

/** operator names the browser may hand to bootstrap via env */
export const OPERATOR_NAMES = new Set(
  MANIFEST.secrets.filter((s) => s.owner === 'operator' && !['nas', 'ci'].includes(s.platform)).map((s) => s.name),
);

const DEVSOURCE_COMPOSE = ['compose', '--env-file', 'deploy/env/.env.local', '-f', 'deploy/docker-compose.local.yml'];
/** fixed verb set over the KNOWN stacks — nothing here is caller-
 * controlled beyond picking one. The heavyweight VERIFICATION tools
 * (sonar, e2e, webkit) left this on user ruling: they are development
 * instruments, not setup steps. */
export function toolFor(id) {
  const m = /^(.+):(up|down|destroy)$/.exec(String(id ?? ''));
  if (!m) return null;
  const [, name, verb] = m;
  if (name === 'devsource') {
    const args = { up: ['up', '-d', '--build'], down: ['down'], destroy: ['down', '-v', '--remove-orphans'] }[verb];
    return { cwd: ROOT, cmd: 'docker', args: [...DEVSOURCE_COMPOSE, ...args] };
  }
  if (!LOCAL_STACKS().includes(name)) return null;
  // -v --remove-orphans: destroy nukes volumes, network, strays — the
  // wizard asks for explicit confirmation before calling these
  const args = { up: ['up', '-d', '--remove-orphans'], down: ['down'], destroy: ['down', '-v', '--remove-orphans'] }[verb];
  return { cwd: renderedDir(name), cmd: 'docker', args: [...composeArgs(name), ...args] };
}

/** the web origin each stack hands to GoCardless as its consent redirect
 * — the discriminator for which requisitions BELONG to it */
function gcRedirectPrefix(target) {
  if (target === 'devsource') return 'http://localhost:5173/';
  if (!LOCAL_ENVS().includes(target)) return null; // shared: no consents
  return `${loadStack(target).urls.web}/`;
}

const hostOk = (req) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '');

async function probe(url) {
  try {
    const res = await localAwareFetch(url, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false; // unreachable → down
  }
}

function runToStream(res, cmd, args, opts = {}) {
  if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  const child = spawn(cmd, args, { cwd: opts.cwd ?? ROOT, env: opts.env ?? process.env, shell: false });
  child.stdout.on('data', (d) => res.write(d));
  child.stderr.on('data', (d) => res.write(d));
  child.on('error', (e) => { res.write(`\n[helper] failed to start ${cmd}: ${e.message}\n`); res.end('[exit -1]\n'); });
  child.on('close', (code) => res.end(`\n[exit ${code}]\n`));
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1_000_000) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

const stepRunner = (spawnImpl) => (res, label, cmd, args, opts = {}) =>
  new Promise((resolve) => {
    res.write(`\n▶ ${label}\n`);
    const child = spawnImpl(cmd, args, { cwd: opts.cwd ?? ROOT, env: opts.env ?? process.env, shell: false });
    let out = '';
    const forward = (d) => {
      const s = String(d);
      out += s;
      res.write(opts.mask ? opts.mask(s) : s);
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', (e) => { res.write(`[helper] ${cmd} failed to start: ${e.message}\n`); resolve({ code: -1, out }); });
    child.on('close', (code) => resolve({ code, out }));
  });

/* ── status ────────────────────────────────────────────────────────── */
/** which health url each service key answers on */
const SERVICE_PROBE_PATH = {
  web: '',
  api: '/health',
  logto: '/oidc/.well-known/openid-configuration',
  glitchtip: '/api/0/',
  vault: '/alive',
  control: '',
  pgadmin: '/misc/ping',
};

async function stackStatus(name, probeImpl) {
  const stack = loadStack(name);
  const services = {};
  for (const [key, path] of Object.entries(SERVICE_PROBE_PATH)) {
    if (stack.urls[key]) services[key] = await probeImpl(`${stack.urls[key]}${path}`);
  }
  const own = loadLocalValues(stack);
  return {
    rendered: existsSync(join(renderedDir(name), `.env.${name}`)),
    stored: Object.keys(own).filter((k) => own[k]), // NAMES only, never values
    required: stackManifestEntries(stack).filter((s) => !s.optional && s.owner === 'operator').map((s) => s.name),
    services,
    urls: stack.urls,
    envName: stack.envName ?? null,
    channel: stack.channel,
  };
}

async function statusEndpoint(res, probeImpl) {
  const docker = await new Promise((resolve) => {
    const c = spawn('docker', ['version', '--format', '{{.Server.Version}}'], { shell: false });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', () => resolve({ ok: false }));
    c.on('close', (code) => resolve({ ok: code === 0, version: out.trim() }));
  });
  const stacks = {};
  for (const name of LOCAL_STACKS()) {
    stacks[name] = await stackStatus(name, probeImpl);
  }
  return json(res, 200, { docker, stacks, lan: lanHost() });
}

/* ── run bootstrap ─────────────────────────────────────────────────── */
async function runEndpoint(req, res, runImpl) {
  const body = await readBody(req);
  const stackName = pickStack(body.stack);
  const env = { ...process.env };
  for (const [name, value] of Object.entries(body.values ?? {})) {
    if (OPERATOR_NAMES.has(name) && typeof value === 'string' && value) env[name] = value;
  }
  const args = [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', stackName];
  if (body.verify) args.push('--verify');
  return runImpl(res, process.execPath, args, { cwd: ROOT, env });
}

async function toolEndpoint(req, res, runImpl) {
  const body = await readBody(req);
  const tool = toolFor(body.tool);
  if (!tool) return json(res, 400, { error: 'unknown tool' });
  return runImpl(res, tool.cmd, tool.args, { cwd: tool.cwd });
}

/* ── zero-input Logto per environment (plans LS3 + earlier rounds):
   insert the infra M2M app straight into THAT env's logto database on
   the shared postgres, wire apps as code, claim the console + the app's
   first admin user. Idempotent — the insert is ON CONFLICT DO NOTHING
   with the STORED credential, so a fresh database gets re-seeded. ── */
const LOGTO_MGMT_ROLE = 'Logto Management API access';

const logtoToken = async (base, id, secret, resource) => {
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await localAwareFetch(`${base}/oidc/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', resource, scope: 'all' }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()).access_token;
};
const logtoApi = async (base, token, path, init = {}) => {
  const res = await localAwareFetch(`${base}/api${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} ${res.status}`);
  return res.status === 204 ? null : res.json();
};

/** psql inside the ENVIRONMENT's own postgres (each env runs its own;
 * the service carries a UNIQUE name — see the render's DNS-collision note) */
const envPgService = (stackName) => `postgres-${stackName.replace('munni-local-', '')}`;
const envPsql = (stackName, db, sql) => [
  ...composeArgs(stackName), 'exec', '-T', envPgService(stackName), 'psql', '-U', 'munni', '-d', db, '-v', 'ON_ERROR_STOP=1',
  ...sql.flatMap((s) => ['-c', s]),
];
/** single-VALUE query: -At strips headers/footers so out.trim() IS the value */
const envPsqlValue = (stackName, db, sql) => [
  ...composeArgs(stackName), 'exec', '-T', envPgService(stackName), 'psql', '-U', 'munni', '-d', db, '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-c', sql,
];

async function claimLogtoHumans(res, run, stack, infra) {
  const secretStep = await run(res, 'read the console machine credential (inside postgres)', 'docker',
    envPsqlValue(stack.stack, 'logto', "select secret from applications where tenant_id='admin' and id='m-admin';"),
    { cwd: renderedDir(stack.stack), mask: () => '(captured)\n' });
  const mSecret = secretStep.code === 0 ? secretStep.out.trim() : '';
  if (!/^[0-9a-zA-Z_-]{16,}$/.test(mSecret)) {
    res.write('could not read the console machine credential — account auto-claim skipped\n');
    return false;
  }
  let changed = false;
  const adminBase = stack.urls.logtoAdmin;
  try {
    const token = await logtoToken(adminBase, 'm-admin', mSecret, 'https://admin.logto.app/api');
    const users = await logtoApi(adminBase, token, '/users?page_size=1');
    if (users.length) {
      res.write('Logto console already has its account — left untouched\n');
    } else {
      const password = randomBytes(12).toString('base64url');
      const created = await logtoApi(adminBase, token, '/users', { method: 'POST', body: JSON.stringify({ username: 'admin', password }) });
      const roles = await logtoApi(adminBase, token, '/roles?page_size=50');
      const roleIds = roles.filter((r) => ['user', 'default:admin'].includes(r.name)).map((r) => r.id);
      if (roleIds.length) await logtoApi(adminBase, token, `/users/${created.id}/roles`, { method: 'POST', body: JSON.stringify({ roleIds }) });
      saveLocalValues(stack, { ...loadLocalValues(stack), LOGTO_CONSOLE_USERNAME: 'admin', LOGTO_CONSOLE_PASSWORD: password });
      res.write(`Logto console claimed → ${adminBase} · username admin · password ${password}\n(kept in the local secret store)\n`);
      changed = true;
    }
    // an API-created account never flips the console out of its OOBE
    // Register mode (found live: the page kept offering Create-account
    // and refused the taken username) — force SignIn once a user exists
    const exp = await logtoApi(adminBase, token, '/sign-in-exp');
    if (exp.signInMode !== 'SignIn') {
      await logtoApi(adminBase, token, '/sign-in-exp', { method: 'PATCH', body: JSON.stringify({ signInMode: 'SignIn' }) });
      res.write('console switched to the LOGIN screen (register mode off)\n');
    }
  } catch (e) {
    res.write(`console auto-claim failed (${e.message}) — claim it by hand at ${adminBase} when you like\n`);
  }
  try {
    // reality first, store second: after Delete + Set up the store still
    // carries a NAS_ADMIN_SUBS from the WIPED database — the fresh env
    // must get its admin user regardless (found live 2026-08-28)
    const token = await logtoToken(stack.urls.logto, infra.id, infra.secret, 'https://default.logto.app/api');
    const users = await logtoApi(stack.urls.logto, token, '/users?page_size=1');
    if (users.length) {
      const store = loadLocalValues(stack);
      res.write(store.NAS_ADMIN_SUBS
        ? 'the app has users and admin access is configured — left untouched\n'
        : 'the app already has users — paste YOUR user id under Store admin access instead\n');
      return changed;
    }
    // NOTE: Logto usernames must match /^[A-Z_a-z]\w*$/ — no hyphens
    const password = randomBytes(12).toString('base64url');
    const created = await logtoApi(stack.urls.logto, token, '/users', { method: 'POST', body: JSON.stringify({ username: 'munni_admin', password }) });
    saveLocalValues(stack, { ...loadLocalValues(stack), LOGTO_APP_ADMIN_USERNAME: 'munni_admin', LOGTO_APP_ADMIN_PASSWORD: password, NAS_ADMIN_SUBS: created.id });
    res.write(`munni admin user created → sign into the app as munni_admin · ${password}\nadmin access wired automatically (NAS_ADMIN_SUBS=${created.id})\n`);
    return true;
  } catch (e) {
    res.write(`app-admin auto-create failed (${e.message}) — use Store admin access after your first sign-up\n`);
    return changed;
  }
}

async function logtoSetupEndpoint(req, res, spawnImpl) {
  const body = await readBody(req);
  const stack = loadStack(pickEnv(body.stack));
  const values = familyValues(stack);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  const run = stepRunner(spawnImpl);

  // stored credential re-used verbatim; the INSERT is idempotent, so a
  // freshly reseeded logto database gets the same credential back
  const id = values.IAC_LOGTO_INFRA_M2M_ID ?? `infra${randomBytes(8).toString('hex')}`;
  const secret = values.IAC_LOGTO_INFRA_M2M_SECRET ?? randomBytes(24).toString('hex');
  const linkId = `link0${randomBytes(8).toString('hex')}`;
  const sqlApp = `insert into applications (tenant_id, id, name, secret, description, type, oidc_client_metadata, custom_client_metadata) values ('default', '${id}', 'infra (munni setup)', '${secret}', 'created by the munni setup wizard', 'MachineToMachine', '{"redirectUris":[],"postLogoutRedirectUris":[]}', '{}') on conflict (id) do nothing;`;
  const sqlRole = `insert into applications_roles (tenant_id, id, application_id, role_id) select 'default', '${linkId}', '${id}', r.id from roles r where r.tenant_id = 'default' and r.name = '${LOGTO_MGMT_ROLE}' on conflict do nothing;`;
  const ins = await run(res, `seed the infra M2M app inside ${stack.stack}'s Logto`, 'docker',
    envPsql(stack.stack, 'logto', [sqlApp, sqlRole]),
    { cwd: renderedDir(stack.stack), mask: (s) => s.replaceAll(secret, '(secret)') });
  if (ins.code !== 0) {
    res.write('\nIs this environment running (step 4)? Its logto dot must be green — then retry.\n');
    return res.end('[exit 1]\n');
  }
  res.write(`\nInfra app id: ${id} — the secret goes straight into the local secret store, never shown.\n`);

  const boot = await run(res, 'turn sign-in into code (apps, redirect URIs, API resource) + store the credential', process.execPath,
    [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', stack.stack],
    { cwd: ROOT, env: { ...process.env, IAC_LOGTO_INFRA_M2M_ID: id, IAC_LOGTO_INFRA_M2M_SECRET: secret } });
  if (boot.code !== 0 || !/logto: apps upserted/.test(boot.out)) {
    res.write('\nLogto did not accept the credential yet — wait for the logto dot to turn green, then press the button again (nothing is lost).\n');
    return res.end('[exit 1]\n');
  }

  const changed = await claimLogtoHumans(res, run, stack, { id, secret });
  if (changed) {
    await run(res, 'refresh the rendered env (admin access wired in)', process.execPath,
      [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', stack.stack], { cwd: ROOT });
  }
  // this env powers munni-control? refresh the shared render too
  if (loadStack(SHARED_STACK).controlApi === stack.stack) {
    await run(res, 'wire munni-control to this sign-in', process.execPath,
      [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', SHARED_STACK], { cwd: ROOT });
    await run(res, 'restart the shared stack (control picks its app id up)', 'docker',
      [...composeArgs(SHARED_STACK), 'up', '-d', '--remove-orphans'], { cwd: renderedDir(SHARED_STACK) });
  }

  const up = await run(res, 'restart web/admin with their sign-in config', 'docker',
    [...composeArgs(stack.stack), 'up', '-d', '--remove-orphans'], { cwd: renderedDir(stack.stack) });
  res.write('\nDone. Sign-in is code — console and admin logins live under Reveal secrets.\n');
  return res.end(`\n[exit ${up.code === 0 ? 0 : 1}]\n`);
}

/* ── zero-input GlitchTip: the shared stack owns ONE admin + token; each
   environment gets its own org projects + DSNs. ── */
const GT_BOOTSTRAP_PY = `
import os
from django.contrib.auth import get_user_model
from apps.api_tokens.models import APIToken
email = os.environ['GT_ADMIN_EMAIL']
password = os.environ['GT_ADMIN_PASSWORD']
U = get_user_model()
u = U.objects.filter(email=email).first()
if u is None:
    u = U.objects.create_superuser(email, password)
    print('USER:created')
else:
    print('USER:existing')
t = APIToken.objects.filter(user=u).first()
if t is None:
    flags = getattr(APIToken._meta.get_field('scopes'), 'flags', []) or []
    t = APIToken.objects.create(user=u, scopes=(1 << len(flags)) - 1)
    print('TOKEN_STATE:created')
else:
    print('TOKEN_STATE:existing')
print('TOKEN:' + str(t.token))
`;

async function glitchtipSetupEndpoint(req, res, spawnImpl) {
  const body = await readBody(req);
  const stack = loadStack(pickEnv(body.stack));
  const shared = loadStack(SHARED_STACK);
  const sharedValues = loadLocalValues(shared);
  // resolvable-TLD address like pgadmin/vault: GlitchTip 6.x (pydantic
  // email validation) 500s on EVERY /users/me/ for a .local address —
  // "the part after the @-sign is a special-use or reserved name"
  const email = sharedValues.GLITCHTIP_ADMIN_EMAIL ?? 'admin@munni.dev';
  const password = sharedValues.GLITCHTIP_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
  saveLocalValues(shared, { ...sharedValues, GLITCHTIP_ADMIN_EMAIL: email, GLITCHTIP_ADMIN_PASSWORD: password });

  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  const run = stepRunner(spawnImpl);

  const mint = await run(res, 'create the GlitchTip admin + API token (inside the shared stack)', 'docker',
    [...composeArgs(SHARED_STACK), 'exec', '-T', '-e', 'GT_ADMIN_EMAIL', '-e', 'GT_ADMIN_PASSWORD', 'glitchtip', './manage.py', 'shell', '-c', GT_BOOTSTRAP_PY],
    {
      cwd: renderedDir(SHARED_STACK),
      env: { ...process.env, GT_ADMIN_EMAIL: email, GT_ADMIN_PASSWORD: password },
      mask: (s) => s.replace(/TOKEN:\S+/g, 'TOKEN:(captured)'),
    });
  if (mint.code !== 0) {
    res.write('\nIs the shared stack running? Use step 4 → Set up first, wait for GlitchTip, then retry.\n');
    return res.end('[exit 1]\n');
  }
  const token = /TOKEN:(\S+)/.exec(mint.out)?.[1];
  if (!token) {
    res.write('\ncould not read the API token back from the container — use the manual fallback\n');
    return res.end('[exit 1]\n');
  }
  res.write(`\nGlitchTip console login → email ${email} · password ${password}\n(kept in the local secret store — change it inside GlitchTip whenever you like)\n`);

  const wire = await run(res, `wire ${stack.stack}'s org, projects and DSNs (bootstrap)`, process.execPath,
    [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', stack.stack],
    { cwd: ROOT, env: { ...process.env, IAC_GLITCHTIP_API_TOKEN: token } });
  if (wire.code !== 0) return res.end('[exit 1]\n');

  const restart = await run(res, 'restart with the DSNs wired in (docker compose up -d)', 'docker',
    [...composeArgs(stack.stack), 'up', '-d', '--remove-orphans'], { cwd: renderedDir(stack.stack) });
  return res.end(`\n[exit ${restart.code === 0 ? 0 : 1}]\n`);
}

/* ── cleanup: revoke the stack's own GoCardless consents, then remove
   containers + volumes + network ── */
async function purgeGcRequisitions(target, res) {
  // GC credentials are SHARED-owned — never depend on an env existing
  const values = familyValues(loadStack(SHARED_STACK));
  if (!values.NAS_GOCARDLESS_SECRET_ID || !values.NAS_GOCARDLESS_SECRET_KEY) {
    res.write('no GoCardless credentials in the store — nothing to purge there\n');
    return true;
  }
  const prefix = gcRedirectPrefix(target);
  if (!prefix) { res.write('this stack creates no bank consents — skipping the provider purge\n'); return true; }
  const tokenRes = await fetch('https://bankaccountdata.gocardless.com/api/v2/token/new/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ secret_id: values.NAS_GOCARDLESS_SECRET_ID, secret_key: values.NAS_GOCARDLESS_SECRET_KEY }),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenRes.ok) { res.write(`GoCardless token mint failed (${tokenRes.status}) — skipping the provider purge\n`); return false; }
  const { access } = await tokenRes.json();
  const gc = (path, init = {}) => fetch(`https://bankaccountdata.gocardless.com/api/v2${path}`, {
    ...init,
    headers: { authorization: `Bearer ${access}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const list = await (await gc('/requisitions/?limit=100')).json();
  const mine = (list.results ?? []).filter((r) => String(r.redirect ?? '').startsWith(prefix));
  if (!mine.length) { res.write('no requisitions at GoCardless belong to this stack — nothing to purge\n'); return true; }
  let removed = 0;
  for (const r of mine) {
    const del = await gc(`/requisitions/${r.id}/`, { method: 'DELETE' });
    if (del.ok || del.status === 404) { removed += 1; res.write(`  revoked ${r.institution_id} consent (${String(r.id).slice(0, 8)}…, was ${r.status})\n`); }
    else res.write(`  could not delete ${String(r.id).slice(0, 8)}… (${del.status})\n`);
  }
  res.write(`GoCardless purge: ${removed}/${mine.length} of this stack's consents removed\n`);
  return removed === mine.length;
}

async function cleanupEndpoint(req, res, runImpl) {
  const body = await readBody(req);
  const target = body.target === 'devsource' ? 'devsource' : pickStack(body.target);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.write(`▶ clean up ${target} — GoCardless consents first, then containers + volumes + network\n\n`);
  try {
    await purgeGcRequisitions(target, res);
  } catch (e) {
    res.write(`GoCardless purge failed (${e.message}) — continuing with the docker teardown\n`);
  }
  const tool = toolFor(`${target}:destroy`);
  return runImpl(res, tool.cmd, tool.args, { cwd: tool.cwd });
}

/* ── LAN mode + CI-built native apps (user ruling 2026-08-28: FULL LAN
   mode so phones reach the local stacks, but binaries come from the
   existing GitHub workflows — nothing builds on this machine) ── */
const LAN_FILE = () => join(process.env.MUNNI_RENDER_DIR ?? join(ROOT, 'infra', 'rendered'), 'lan-host');

/** the machine's plausible LAN addresses, private ranges first */
export function lanCandidates(interfacesImpl = networkInterfaces) {
  const rank = (ip) => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  };
  const all = Object.values(interfacesImpl())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  return [...new Set(all)].sort((a, b) => rank(a) - rank(b));
}

function lanGetEndpoint(res) {
  return json(res, 200, { current: lanHost(), candidates: lanCandidates() });
}

/** flip the whole local family between localhost and a LAN address:
 * write the marker, re-render every stack (urls, CORS, Logto redirect
 * URIs, DSNs all follow), restart the containers */
async function lanSetEndpoint(req, res, spawnImpl, probeImpl, netFetchImpl) {
  const body = await readBody(req);
  const host = String(body.host ?? '').trim();
  if (host && !lanCandidates().includes(host)) return json(res, 400, { error: 'not one of this machine\'s addresses' });
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  const run = stepRunner(spawnImpl);
  if (host) {
    mkdirSync(dirname(LAN_FILE()), { recursive: true });
    writeFileSync(LAN_FILE(), `${host}\n`);
    res.write(`▶ LAN mode ON — the family moves to https://munni-<env>.${host.replaceAll('.', '-')}.sslip.io hostnames (localhost keeps working alongside)\n`);
  } else {
    rmSync(LAN_FILE(), { force: true });
    res.write('▶ LAN mode OFF — back to localhost-only\n');
  }
  // SHARED first: glitchtip must run under the NEW domain before the env
  // bootstraps ask it for DSNs (found live 2026-08-28: env-first kept
  // the localhost DSN form in the LAN render)
  for (const name of [SHARED_STACK, ...LOCAL_ENVS()]) {
    const boot = await run(res, `re-render ${name}`, process.execPath,
      [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', name], { cwd: ROOT });
    if (boot.code !== 0) return res.end('[exit 1]\n');
    const up = await run(res, `restart ${name}`, 'docker', [...composeArgs(name), 'up', '-d', '--remove-orphans'], { cwd: renderedDir(name) });
    if (up.code !== 0) return res.end('[exit 1]\n');
    if (name === SHARED_STACK && host) {
      res.write('… waiting for glitchtip to answer on the new address\n');
      const glitchtipUrl = `${loadStack(SHARED_STACK).urls.glitchtip}/api/0/`;
      const deadline = Date.now() + 120000;
      while (!(await probeImpl(glitchtipUrl))) {
        if (Date.now() > deadline) { res.write('glitchtip never answered on the new address — check docker ps, then retry\n'); return res.end('[exit 1]\n'); }
        await new Promise((r) => setTimeout(r, 4000));
      }
      res.write('✓ glitchtip is up on the new address\n');
    }
  }
  if (host) {
    // this PC's browsers need the CA too (fetch to the logto hostname
    // fails without it) — one Windows dialog, silent when already there
    await installFamilyCa(res, run, netFetchImpl);
    const base = `${host.replaceAll('.', '-')}.sslip.io`;
    const envLine = localEnvRegistry().map((e) => `${e.name} → https://munni-${e.name}.${base}`).join(' · ');
    res.write(`\nDone. From your phone (same wifi): ${envLine}\nTrust the family's certificate once per device: download http://ca.${base} (root.crt), install it as a CA certificate (iPhone: also enable it under Certificate Trust Settings).\nIf the phone cannot reach it, allow Docker/vpnkit through the Windows firewall for private networks (incl. port 443), and give this machine a DHCP reservation — a changed address needs a rebuilt app.\n`);
  } else {
    res.write('\nDone. Everything answers on localhost again.\n');
  }
  return res.end('\n[exit 0]\n');
}

/** trust the family CA in the DESKTOP browser too: an https page can be
 * clicked through per-origin, but fetch() to the logto hostname just
 * fails — sign-in breaks until the root is trusted (found live
 * 2026-08-28). Downloads root.crt from the CA site and hands it to
 * certutil (CurrentUser Root — Windows shows ONE consent dialog; a
 * re-run with the cert already present is silent). */
async function installFamilyCa(res, run, netFetchImpl) {
  const lan = lanHost();
  if (!lan) { res.write('LAN mode is off — no local CA to trust\n'); return false; }
  const base = `${lan.replaceAll('.', '-')}.sslip.io`;
  let crt;
  try {
    const crtRes = await netFetchImpl(`http://ca.${base}/root.crt`, { signal: AbortSignal.timeout(8000) });
    if (!crtRes.ok) throw new Error(`status ${crtRes.status}`);
    crt = await crtRes.text(); // Caddy's root.crt is PEM
  } catch (e) {
    res.write(`could not download http://ca.${base}/root.crt (${e.message}) — is the family running?\n`);
    return false;
  }
  const file = join(renderedDir(SHARED_STACK), 'family-root.crt');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, crt);
  if (process.platform !== 'win32') {
    res.write(`root certificate saved to ${file} — add it to this OS's trust store by hand (certutil is Windows-only)\n`);
    return false;
  }
  res.write('if Windows asks to install a root certificate: that is the family CA — confirm it\n');
  const add = await run(res, 'trust the family CA on this PC (certutil, CurrentUser Root)', 'certutil', ['-user', '-addstore', 'Root', file], { cwd: renderedDir(SHARED_STACK) });
  return add.code === 0;
}

async function trustCaEndpoint(res, spawnImpl, netFetchImpl) {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  const ok = await installFamilyCa(res, stepRunner(spawnImpl), netFetchImpl);
  return res.end(`\n[exit ${ok ? 0 : 1}]\n`);
}

/* ── store readiness (user ruling 2026-08-28: no manual Enable-publish
   button — the wizard POLLS whether the operator did the one-time store
   upload and flips auto-publish itself). The credentials live in the
   local store; checks mirror what CI's publish steps really do. ── */
async function playAppExists(values, appId, fetchImpl) {
  if (!values.PLAY_SERVICE_ACCOUNT_JSON) return { state: 'no-creds' };
  let sa;
  try {
    sa = JSON.parse(values.PLAY_SERVICE_ACCOUNT_JSON);
  } catch {
    return { state: 'error', detail: 'PLAY_SERVICE_ACCOUNT_JSON is not valid JSON' };
  }
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwtRS256({
    header: { alg: 'RS256', typ: 'JWT' },
    payload: { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: sa.token_uri, iat: now, exp: now + 300 },
    pem: sa.private_key,
  });
  const tok = await fetchImpl(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!tok.ok) return { state: 'error', detail: `Google rejected the service account (${tok.status})` };
  const { access_token: access } = await tok.json();
  // a throwaway edit: succeeds only when the package exists AND the
  // service account may publish it — exactly what the CI upload needs.
  // ALWAYS deleted right after: opening an edit EXPIRES any concurrent
  // one, and a poll racing a CI publish killed a real upload (found
  // live 2026-08-30: "This edit has expired")
  const probe = (pkg) => fetchImpl(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/edits`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10000),
  });
  const dropEdit = async (pkg, res2) => {
    try {
      const { id } = await res2.json();
      if (id) {
        await fetchImpl(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/edits/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${access}` },
          signal: AbortSignal.timeout(10000),
        });
      }
    } catch { /* the edit dies on its own within minutes */ }
  };
  const edit = await probe(appId);
  if (edit.ok) {
    await dropEdit(appId, edit);
    return { state: 'ready' };
  }
  // Google's own hiccups must not masquerade as a config problem (a
  // transient 503 wore the "release access?" hint, user report)
  if (edit.status >= 500) return { state: 'transient', detail: `Play answered ${edit.status} — a hiccup on Google's side, retried on the next poll` };
  if (edit.status === 404) return { state: 'missing-app' };
  if (edit.status === 403) {
    // Google reuses 403 for a DISABLED API in the service account's own
    // Cloud project (found live 2026-08-29: SERVICE_DISABLED while the
    // Play-side permissions were fine) — the body names it exactly
    const body = await edit.json().catch(() => ({}));
    const disabled = body?.error?.details?.find((d) => d.reason === 'SERVICE_DISABLED');
    if (disabled || /has not been used in project|it is disabled/.test(body?.error?.message ?? '')) {
      const url = disabled?.metadata?.activationUrl ?? 'https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com';
      return { state: 'error', detail: `the Google Play Android Developer API is disabled in the service account's Cloud project — enable it once (${url}), wait a few minutes, this page retries by itself` };
    }
    // Play answers 403 both for "not invited at all" and "this app is
    // not visible to you" — probing the OTHER munni packages splits the
    // two: any non-403 proves the account link works (user request
    // 2026-08-29: say WHICH problem it is)
    for (const other of ['app.munni', 'app.munni.dev']) {
      const r2 = await probe(other).catch(() => null);
      if (r2?.ok) await dropEdit(other, r2);
      if (r2 && (r2.ok || r2.status === 404)) {
        return { state: 'missing-app', detail: `the service account has Play access, but ${appId} is not visible to it — do the one-time upload to create the app (or, with per-app scoping, grant it under App permissions)` };
      }
    }
    return { state: 'error', detail: 'the service account is NOT invited to the Play developer account yet — Play Console → Users and permissions → invite it with Release to testing tracks (guide step 2)' };
  }
  return { state: 'error', detail: `Play answered ${edit.status} — does the service account have release access?` };
}

/** ES256 App Store Connect token from the stored key (base64 or raw PEM) */
function ascJwt(values) {
  const now = Math.floor(Date.now() / 1000);
  return jwtES256({
    header: { alg: 'ES256', kid: values.ASC_KEY_ID, typ: 'JWT' },
    payload: { iss: values.ASC_ISSUER_ID, aud: 'appstoreconnect-v1', iat: now, exp: now + 600 },
    pem: values.ASC_KEY_P8.includes('BEGIN') ? values.ASC_KEY_P8 : Buffer.from(values.ASC_KEY_P8, 'base64').toString('utf8'),
  });
}

async function ascAppExists(values, bundleId, fetchImpl) {
  if (!values.ASC_KEY_ID || !values.ASC_ISSUER_ID || !values.ASC_KEY_P8) return { state: 'no-creds' };
  let jwt;
  try {
    jwt = ascJwt(values);
  } catch (e) {
    return { state: 'error', detail: `the ASC .p8 does not parse (${e.message})` };
  }
  const res = await fetchImpl(`https://api.appstoreconnect.apple.com/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(bundleId)}`, {
    headers: { authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status >= 500) return { state: 'transient', detail: `App Store Connect answered ${res.status} — a hiccup on Apple's side, retried on the next poll` };
  if (!res.ok) return { state: 'error', detail: `App Store Connect answered ${res.status}` };
  const body = await res.json();
  return { state: (body.data ?? []).length ? 'ready' : 'missing-app' };
}

async function storeStatusEndpoint(res, url, fetchImpl) {
  if (!LOCAL_ENVS().length) return json(res, 400, { error: 'no environments exist yet' });
  const stack = loadStack(pickEnv(url?.searchParams.get('stack')));
  const values = familyValues(stack);
  const [play, ios] = await Promise.all([
    playAppExists(values, stack.native.appId, fetchImpl).catch((e) => ({ state: 'error', detail: e.message })),
    ascAppExists(values, stack.native.appId, fetchImpl).catch((e) => ({ state: 'error', detail: e.message })),
  ]);
  return json(res, 200, { localEnv: stack.envName, appId: stack.native.appId, play, ios });
}

/* ── the MACHINE owns the upload keystore (user incident 2026-08-31:
   deleting the repo destroyed the CI-minted keystore, the fresh repo
   minted another, and Play pins the first upload key forever). Minted
   ONCE here (JDK in a container, docker-tooling rule) into the shared
   store; the wizard ships it into every repo's environment. ── */
async function mintKeystoreEndpoint(req, res, spawnImpl) {
  const shared = loadStack(SHARED_STACK);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  if (loadLocalValues(shared).ANDROID_KEYSTORE_BASE64) {
    res.write('the machine already holds the upload keystore — every repo signs with the same key ✓\n');
    return res.end('[exit 0]\n');
  }
  const pass = randomBytes(24).toString('hex');
  const run = stepRunner(spawnImpl);
  const mint = await run(res, 'mint the upload keystore (JDK in a container — the first run pulls the image)', 'docker',
    ['run', '--rm', '-e', `KS_PASS=${pass}`, 'eclipse-temurin:21-jdk', 'sh', '-c',
      'keytool -genkeypair -keystore /tmp/u.ks -alias munni-upload -keyalg RSA -keysize 2048 -validity 10000 -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=munni upload key" >/dev/null 2>&1 && echo "KEYSTORE_B64:$(base64 -w0 /tmp/u.ks)" && keytool -exportcert -rfc -keystore /tmp/u.ks -alias munni-upload -storepass "$KS_PASS"'],
    { cwd: ROOT, mask: (s) => s.replaceAll(pass, '(pass)').replace(/KEYSTORE_B64:\S+/g, 'KEYSTORE_B64:(captured)') });
  if (mint.code !== 0) {
    res.write('minting failed — is Docker running?\n');
    return res.end('[exit 1]\n');
  }
  const b64 = /KEYSTORE_B64:(\S+)/.exec(mint.out)?.[1];
  const cert = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/.exec(mint.out)?.[0];
  if (!b64) {
    res.write('could not read the keystore back from the container\n');
    return res.end('[exit 1]\n');
  }
  saveLocalValues(shared, {
    ...loadLocalValues(shared),
    ANDROID_KEYSTORE_BASE64: b64,
    ANDROID_KEYSTORE_PASSWORD: pass,
    ANDROID_KEY_ALIAS: 'munni-upload',
    ANDROID_KEY_PASSWORD: pass,
  });
  if (cert) {
    const certFile = join(renderedDir(SHARED_STACK), 'upload-cert.pem');
    mkdirSync(dirname(certFile), { recursive: true });
    writeFileSync(certFile, `${cert}\n`);
    res.write(`upload certificate → ${certFile} (only needed for a Play UPLOAD-KEY RESET)\n`);
  }
  res.write('upload keystore minted into the machine store ✓ — every repo, present and future, signs with the SAME key\n');
  return res.end('[exit 0]\n');
}

/* ── roll a BURNED store package (user request 2026-08-31: a new Play
   app NOW instead of the two-day upload-key reset). Play pins the first
   upload key per PACKAGE — bumping the generation gives the same
   environment a fresh package (app.munni.local.prod → …prod2) while
   its data, sign-in and urls stay untouched. ── */
async function newStorePackageEndpoint(req, res, spawnImpl) {
  const body = await readBody(req);
  if (!LOCAL_ENVS().length) return json(res, 400, { error: 'no environments exist yet' });
  const name = pickEnv(body.stack).replace('munni-local-', '');
  const envs = localEnvRegistry();
  const entry = envs.find((e) => e.name === name);
  if (!entry) return json(res, 400, { error: `no environment named "${name}"` });
  // the OPERATOR names the package segment (no black-box numbering)
  const suffix = String(body.suffix ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9]{1,29}$/.test(suffix)) {
    return json(res, 400, { error: 'the package suffix must be 2-30 characters, letters/digits, starting with a letter (like prod2, phone, beta)' });
  }
  entry.appSuffix = suffix;
  delete entry.appGen; // superseded by the explicit suffix
  saveLocalEnvRegistry(envs);
  const newId = loadStack(`munni-local-${name}`).native.appId;
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.write(`▶ store package set → ${newId}\n(a previously used package keeps its store records — retire them in the consoles whenever)\n\n`);
  const run = stepRunner(spawnImpl);
  await run(res, `re-render ${name} with the new identity`, process.execPath,
    [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', `munni-local-${name}`], { cwd: ROOT });
  res.write(`\nNext: create the Play record for ${newId} (Play Console → Create app). This page detects it, and the FIRST build uploads itself — signed with the machine keystore, the key that never changes again.\n`);
  return res.end('[exit 0]\n');
}

/* ── Apple App ID as code (user request 2026-08-31: automate the
   identifier + capabilities; only the ASC "New App" record has no
   create-API). Registers bundle app.munni.local.<env> with the
   LONG-RUN capabilities so nothing needs re-provisioning later. ── */
const IOS_CAPABILITIES = [
  ['PUSH_NOTIFICATIONS', 'push notifications (FCM later — tick now, never reprovision)'],
  ['APPLE_ID_AUTH', 'Sign in with Apple (Apple requires it beside Google login)'],
  ['ASSOCIATED_DOMAINS', 'associated domains (universal links on the hosted track)'],
];

async function iosAppIdEndpoint(req, res, fetchImpl) {
  const body = await readBody(req);
  if (!LOCAL_ENVS().length) return json(res, 400, { error: 'no environments exist yet' });
  const stack = loadStack(pickEnv(body.stack));
  const values = familyValues(stack);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  if (!values.ASC_KEY_ID || !values.ASC_ISSUER_ID || !values.ASC_KEY_P8) {
    res.write('the App Store Connect key is not stored yet (step 3) — cannot register the App ID\n');
    return res.end('[exit 1]\n');
  }
  let jwt;
  try {
    jwt = ascJwt(values);
  } catch (e) {
    res.write(`the ASC .p8 does not parse (${e.message})\n`);
    return res.end('[exit 1]\n');
  }
  const asc = (path, init = {}) => fetchImpl(`https://api.appstoreconnect.apple.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(15000),
  });
  const bundleId = stack.native.appId;
  const list = await asc(`/bundleIds?filter%5Bidentifier%5D=${encodeURIComponent(bundleId)}`);
  if (!list.ok) {
    res.write(`App Store Connect answered ${list.status} listing bundle ids — is the key an App Manager key?\n`);
    return res.end('[exit 1]\n');
  }
  let record = ((await list.json()).data ?? []).find((d) => d.attributes?.identifier === bundleId);
  if (record) {
    res.write(`App ID ${bundleId} already registered ✓\n`);
  } else {
    const created = await asc('/bundleIds', {
      method: 'POST',
      body: JSON.stringify({ data: { type: 'bundleIds', attributes: { identifier: bundleId, name: `munni ${stack.envName}`, platform: 'IOS' } } }),
    });
    if (!created.ok) {
      res.write(`could not register ${bundleId} (${created.status}): ${(await created.text()).slice(0, 300)}\n`);
      return res.end('[exit 1]\n');
    }
    record = (await created.json()).data;
    res.write(`App ID ${bundleId} registered ✓\n`);
  }
  for (const [cap, why] of IOS_CAPABILITIES) {
    const r = await asc('/bundleIdCapabilities', {
      method: 'POST',
      body: JSON.stringify({ data: {
        type: 'bundleIdCapabilities',
        attributes: { capabilityType: cap },
        relationships: { bundleId: { data: { type: 'bundleIds', id: record.id } } },
      } }),
    });
    // 409 = already enabled — exactly what we want on a re-run
    if (r.ok || r.status === 409) res.write(`  capability ${cap} ✓ — ${why}\n`);
    else res.write(`  capability ${cap} answered ${r.status} — enable it by hand if it is missing\n`);
  }
  res.write(`\nRemaining one-time (no API exists): App Store Connect → New App → pick ${bundleId} from the bundle-id dropdown. The APNs SSL certificate dialog is the LEGACY push path — never create those; push will use the team APNs key via Firebase.\n`);
  return res.end('[exit 0]\n');
}

/** what the wizard writes into the GitHub environment `local` so the
 * EXISTING native workflows bake a build that talks to this machine —
 * per LOCAL environment (?stack=munni-local-<name>, default prod) */
async function nativeConfigEndpoint(res, url, fetchImpl) {
  if (!LOCAL_ENVS().length) return json(res, 400, { error: 'no environments exist yet — Set up & start munni first' });
  const stack = loadStack(pickEnv(url?.searchParams.get('stack')));
  const values = familyValues(stack);
  const lan = lanHost();
  const dsn = values.VITE_GLITCHTIP_DSN ?? '';
  const variables = {
    NATIVE_API_URL: stack.urls.api,
    NATIVE_PUBLIC_ORIGIN: stack.urls.web,
    NATIVE_LOGTO_ENDPOINT: stack.urls.logto,
    NATIVE_LOGTO_RESOURCE: stack.urls.api,
    NATIVE_LOGTO_APP_ID: values.NATIVE_LOGTO_APP_ID ?? '',
    NATIVE_GLITCHTIP_DSN_ANDROID: dsn,
    NATIVE_GLITCHTIP_DSN_IOS: dsn,
    // the AUTHORITATIVE package id (carries the store-package generation
    // — the workflows must not re-derive it from the env name alone)
    NATIVE_LOCAL_APP_ID: stack.native.appId,
  };
  const missing = [];
  if (!lan) missing.push('LAN mode is off — a phone cannot reach localhost');
  if (lan) {
    // CI bakes the family root INTO the app (user request 2026-08-31:
    // no manual certificate install on the phone for the app itself)
    try {
      const crt = await fetchImpl(`http://ca.${lan.replaceAll('.', '-')}.sslip.io/root.crt`, { signal: AbortSignal.timeout(8000) });
      if (crt.ok) variables.NATIVE_FAMILY_CA_PEM = await crt.text();
      else missing.push(`the family CA is not downloadable (status ${crt.status}) — is the family running? Without it the app build cannot bundle the certificate`);
    } catch (e) {
      missing.push(`the family CA is not downloadable (${e.message}) — is the family running? Without it the app build cannot bundle the certificate`);
    }
  }
  if (!variables.NATIVE_LOGTO_APP_ID) missing.push(`sign-in setup has not stored the native app id yet — press Re-run sign-in setup on ${stack.envName} once`);
  return json(res, 200, {
    environment: 'local',
    localEnv: stack.envName,
    appId: stack.native.appId,
    scheme: stack.native.scheme,
    lanHost: lan,
    ready: missing.length === 0,
    missing,
    variables,
  });
}

/* ── dynamic environments: "+" creates one, delete tears one down and
   forgets it (user ruling 2026-08-28: any number of environments) ── */
const RESERVED_ENV_NAMES = new Set(['shared', 'local']);

/** LAN mode: the family Caddyfile enumerates the registry — a changed
 * env list must re-render the shared stack and restart the tls proxy,
 * or the new hostnames never resolve / dead ones 502 forever */
async function refreshFamilyTls(res, spawnImpl) {
  if (!lanHost()) return;
  const run = stepRunner(spawnImpl);
  await run(res, 'refresh the family Caddyfile (hostnames follow the registry)', process.execPath,
    [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', SHARED_STACK], { cwd: ROOT });
  await run(res, 'restart the https proxy', 'docker',
    [...composeArgs(SHARED_STACK), 'restart', 'family-tls'], { cwd: renderedDir(SHARED_STACK) });
}

async function envCreateEndpoint(req, res, runImpl, spawnImpl) {
  const body = await readBody(req);
  const name = String(body.name ?? '').trim().toLowerCase();
  const channel = body.channel === 'latest' ? 'latest' : 'dev';
  if (!/^[a-z]{2,5}$/.test(name)) return json(res, 400, { error: 'name must be 2-5 lowercase letters (like dev, test, acc, stg)' });
  if (RESERVED_ENV_NAMES.has(name)) return json(res, 400, { error: `"${name}" is reserved` });
  const envs = localEnvRegistry();
  if (envs.some((e) => e.name === name)) return json(res, 400, { error: `environment "${name}" already exists` });
  const used = new Set(envs.map((e) => e.slot));
  let slot = 0;
  while (used.has(slot)) slot += 1;
  saveLocalEnvRegistry([...envs, { name, channel, slot }]);
  // render right away (mints its secrets, writes compose + env); the
  // wizard chains start + sign-in + crash wiring from here
  if (!lanHost()) {
    return runImpl(res, process.execPath, [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', `munni-local-${name}`], { cwd: ROOT });
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  const boot = await stepRunner(spawnImpl)(res, `render environment ${name}`, process.execPath,
    [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', `munni-local-${name}`], { cwd: ROOT });
  if (boot.code !== 0) return res.end('[exit 1]\n');
  await refreshFamilyTls(res, spawnImpl);
  return res.end('\n[exit 0]\n');
}

/** part of the delete cascade (user ruling 2026-08-28): the env's
 * GlitchTip org (+ its projects/DSNs) dies with it — best-effort, the
 * token only exists once crash tracking was wired */
async function purgeGlitchtipOrg(stackName, res, fetchImpl = localAwareFetch) {
  const token = familyValues(loadStack(SHARED_STACK)).IAC_GLITCHTIP_API_TOKEN;
  if (!token) { res.write('no GlitchTip token in the store — skipping the org purge\n'); return; }
  const base = loadStack(SHARED_STACK).urls.glitchtip;
  try {
    const del = await fetchImpl(`${base}/api/0/organizations/${stackName}/`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (del.ok || del.status === 204) res.write(`GlitchTip org ${stackName} deleted\n`);
    else if (del.status === 404) res.write(`GlitchTip has no org ${stackName} — nothing to purge\n`);
    else res.write(`GlitchTip org delete answered ${del.status} — remove it in the console if it lingers\n`);
  } catch (e) {
    res.write(`GlitchTip org purge failed (${e.message}) — remove it in the console if it lingers\n`);
  }
}

/** Delete-everything epilogue (user ruling 2026-08-28: prod is not
 * special — after the wipe NO environment exists; Set up & start
 * recreates production). The wizard calls this after destroying every
 * stack's containers; here the environments are FORGOTTEN: registry
 * emptied, rendered dirs (each env's secret store included) removed.
 * The shared store survives, so re-setup keeps the entered credentials. */
function envsForgetAllEndpoint(res) {
  const names = localEnvRegistry().map((e) => e.name);
  for (const name of names) {
    rmSync(renderedDir(`munni-local-${name}`), { recursive: true, force: true });
  }
  saveLocalEnvRegistry([]);
  return json(res, 200, { forgotten: names });
}

async function envDeleteEndpoint(req, res, spawnImpl, netFetchImpl) {
  const body = await readBody(req);
  const name = String(body.name ?? '').trim().toLowerCase();
  const stackName = `munni-local-${name}`;
  const envs = localEnvRegistry();
  if (!envs.some((e) => e.name === name)) return json(res, 400, { error: `no environment named "${name}"` });
  if (loadStack(SHARED_STACK).controlApi === stackName) {
    return json(res, 400, { error: 'munni-control and the native apps ride this environment — it cannot be deleted' });
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.write(`▶ delete environment ${name} — GoCardless consents, GlitchTip org, containers + volumes, then forget it\n\n`);
  try {
    await purgeGcRequisitions(stackName, res);
  } catch (e) {
    res.write(`GoCardless purge failed (${e.message}) — continuing with the docker teardown\n`);
  }
  await purgeGlitchtipOrg(stackName, res, netFetchImpl);
  const tool = toolFor(`${stackName}:destroy`);
  await stepRunner(spawnImpl)(res, 'containers + volumes + network', tool.cmd, tool.args, { cwd: tool.cwd });
  saveLocalEnvRegistry(localEnvRegistry().filter((e) => e.name !== name));
  rmSync(renderedDir(stackName), { recursive: true, force: true });
  await refreshFamilyTls(res, spawnImpl);
  res.write(`\nenvironment ${name} deleted and forgotten (its secret store went with the rendered folder)\n`);
  res.write(`what CANNOT be deleted by API, in case you created them: the Play/App Store apps for app.munni.local.${name} (retire them in the consoles by hand) and any GitHub environment "local" variables still pointing at it (overwritten by the next native build)\n`);
  return res.end('\n[exit 0]\n');
}

/* ── secret retrieval (family-wide): the stores ARE readable — surfaced
   on EXPLICIT request only; values go to the page, never to any log ── */
function secretsEndpoint(res) {
  const values = {};
  for (const name of LOCAL_STACKS()) {
    values[name] = loadLocalValues(loadStack(name));
  }
  return json(res, 200, { values });
}

/** the family's sign-ins and raw values as PLAIN rows — the Bitwarden
 * JSON export and the automatic in-vault import both build from this.
 * Every row carries a FOLDER (one per environment + "shared") so the
 * vault groups by environment instead of name prefixes (user ruling
 * 2026-08-28). VAPID keys stay out per the plan; the vault's own master
 * credential stays out of its own contents. */
const vaultFolderOf = (stackName) => (stackName === SHARED_STACK ? 'shared' : stackName.replace('munni-local-', ''));

/* what each raw secret IS (user request 2026-08-28: "what it is used
 * for, how it's generated") — provenance + rotation come from the
 * manifest, purpose from this map */
const VAULT_PURPOSE = {
  NAS_GOCARDLESS_SECRET_ID: 'GoCardless Bank Account Data credential (half 1) — the api mints access tokens with the pair for bank syncs and consents.',
  NAS_GOCARDLESS_SECRET_KEY: 'GoCardless Bank Account Data credential (half 2) — paired with the secret id.',
  NAS_ENABLEBANKING_APPLICATION_ID: 'Enable Banking application id (UUID) — names the app in the RS256 JWTs the api signs.',
  NAS_ENABLEBANKING_PRIVATE_KEY_PEM: 'Enable Banking application private key (downloadable ONCE at registration) — signs the api’s JWTs.',
  NAS_GLITCHTIP_SECRET_KEY: 'GlitchTip’s Django SECRET_KEY — signs its sessions and cookies.',
  IAC_GLITCHTIP_API_TOKEN: 'GlitchTip API token the setup uses to create orgs/projects and read DSNs back.',
  VITE_GLITCHTIP_DSN: 'Crash-report DSN for the munni web app — points its browser errors at the right GlitchTip project. Public by design.',
  VITE_GLITCHTIP_DSN_ADMIN: 'Crash-report DSN for the admin portal. Public by design.',
  NAS_API_SENTRY_DSN: 'Crash-report DSN for the api (container-network form — the api cannot resolve browser addresses).',
  VITE_LOGTO_APP_ID: 'Logto application id (public client id) the munni web app signs in with.',
  VITE_LOGTO_APP_ID_ADMIN: 'Logto application id the admin portal signs in with.',
  VITE_LOGTO_APP_ID_CONTROL: 'Logto application id the munni-control cockpit signs in with.',
  NATIVE_LOGTO_APP_ID: 'Logto application id the native (Android/iOS) shells sign in with.',
  NAS_LOGTO_M2M_APP_ID: 'Machine-to-machine app id the api itself uses against Logto (e.g. deleting a sign-in identity with the account).',
  NAS_LOGTO_M2M_APP_SECRET: 'Secret of the api’s machine-to-machine Logto app.',
  NAS_ADMIN_SUBS: 'Comma-separated OIDC user ids (subs) with admin access — gates both the admin portal and munni-control.',
  NAS_GHCR_PAT: 'GitHub token docker uses to pull the munni images from GHCR.',
  NAS_FCM_SERVICE_ACCOUNT_JSON: 'Firebase service account (whole JSON file) — lets the api send Android push messages.',
  NAS_LOGODEV_SECRET_KEY: 'logo.dev secret key (server-side merchant-logo search).',
  NAS_LOGODEV_PUBLIC_TOKEN: 'logo.dev publishable token (client-side logo images).',
  LOGTO_GOOGLE_CLIENT_ID: 'Google OAuth client id for “Sign in with Google”.',
  LOGTO_GOOGLE_CLIENT_SECRET: 'Google OAuth client secret — pairs with the client id.',
  LOGTO_APPLE_CLIENT_ID: 'Apple Services ID for “Sign in with Apple”.',
  VAULT_SIGNUPS_ALLOWED: 'Wizard bookkeeping: whether this vault still accepts registrations (closed after setup).',
  PLAY_SERVICE_ACCOUNT_JSON: 'Google Play service account (whole JSON file) — CI publishes builds with it; the wizard also uses it to detect when a store app exists.',
  ANDROID_KEYSTORE_BASE64: 'The upload keystore (base64) every Android build signs with — minted ONCE by the wizard and kept here because Play pins the first upload key forever; it must outlive any repo.',
  ANDROID_KEYSTORE_PASSWORD: 'Password of the upload keystore (wizard-generated).',
  ANDROID_KEY_ALIAS: 'Key alias inside the upload keystore (munni-upload).',
  ANDROID_KEY_PASSWORD: 'Key password inside the upload keystore (same as the store password).',
  ASC_KEY_ID: 'App Store Connect API key id — with the issuer id + .p8, CI uploads to TestFlight and the wizard checks app records.',
  ASC_ISSUER_ID: 'App Store Connect API issuer id — pairs with the key.',
  ASC_KEY_P8: 'App Store Connect API private key (.p8, base64) — shown once at creation.',
  APPLE_TEAM_ID: 'The 10-character Apple developer team id — signing and uploads name it.',
};

function vaultNote(name) {
  const parts = [];
  if (VAULT_PURPOSE[name]) parts.push(VAULT_PURPOSE[name]);
  const entry = MANIFEST.secrets.find((s) => s.name === name);
  if (entry?.owner === 'generated') parts.push('Generated by the setup (random) — nothing to look up anywhere.');
  else if (entry?.owner === 'operator') parts.push('Entered by you in the setup wizard.');
  else if (!VAULT_PURPOSE[name]) parts.push('Derived and stored by the setup wizard.');
  if (entry?.rotation) parts.push(`Rotation: ${entry.rotation}.`);
  return parts.join(' ');
}

function buildVaultItems() {
  const items = [];
  const sharedStack = loadStack(SHARED_STACK);
  const shared = loadLocalValues(sharedStack);
  if (shared.GLITCHTIP_ADMIN_EMAIL) {
    items.push({
      folder: 'shared',
      name: 'GlitchTip console',
      username: shared.GLITCHTIP_ADMIN_EMAIL,
      password: shared.GLITCHTIP_ADMIN_PASSWORD ?? '',
      uri: sharedStack.urls.glitchtip,
      notes: 'Sign-in for the crash-report console (one GlitchTip for every environment). Account + password created by the setup wizard — change it inside GlitchTip whenever you like.',
    });
  }
  if (shared.NAS_PGADMIN_PASSWORD) {
    items.push({ folder: 'shared', name: 'pgAdmin', username: 'admin@munni.dev', password: shared.NAS_PGADMIN_PASSWORD, uri: sharedStack.urls.pgadmin, notes: 'One console over every database server in the family — the servers are preregistered; on first connect paste the matching Postgres password (each environment’s is in its folder) and tick “save password”. Wizard-generated.' });
  }
  for (const stackName of LOCAL_STACKS()) {
    items.push(...stackVaultItems(stackName));
  }
  return items;
}

const VAULT_SKIP_NAMES = new Set(['NAS_PUSH_VAPID_PRIVATE_KEY', 'NAS_PUSH_VAPID_PUBLIC_KEY', 'VAULT_ADMIN_EMAIL', 'VAULT_MASTER_PASSWORD']);
const VAULT_COVERED_NAMES = new Set([
  'GLITCHTIP_ADMIN_EMAIL', 'GLITCHTIP_ADMIN_PASSWORD', 'NAS_PGADMIN_PASSWORD',
  'NAS_POSTGRES_PASSWORD', 'LOGTO_CONSOLE_USERNAME', 'LOGTO_CONSOLE_PASSWORD',
  'LOGTO_APP_ADMIN_USERNAME', 'LOGTO_APP_ADMIN_PASSWORD', 'IAC_LOGTO_INFRA_M2M_ID', 'IAC_LOGTO_INFRA_M2M_SECRET',
]);

function stackVaultItems(stackName) {
  const items = [];
  const stack = loadStack(stackName);
  const values = loadLocalValues(stack);
  const folder = vaultFolderOf(stackName);
  const pgNote = stackName === SHARED_STACK
    ? 'The shared stack’s database server (GlitchTip’s data lives here). Wizard-generated password; every environment has its OWN server with its own password.'
    : `Database server owned by the ${folder} environment alone (munni + logto databases) — deleting the environment deletes it. Wizard-generated password; use it in pgAdmin for the “${folder}” entry.`;
  if (values.NAS_POSTGRES_PASSWORD) {
    items.push({ folder, name: 'Postgres', username: 'munni', password: values.NAS_POSTGRES_PASSWORD, notes: pgNote });
  }
  if (values.LOGTO_CONSOLE_USERNAME) {
    items.push({ folder, name: 'Logto console', username: values.LOGTO_CONSOLE_USERNAME, password: values.LOGTO_CONSOLE_PASSWORD ?? '', uri: stack.urls.logtoAdmin ?? '', notes: `The ${folder} environment’s Logto ADMIN console (manage sign-in experience, users, connectors). Account auto-claimed by the setup wizard with a generated password.` });
  }
  if (values.LOGTO_APP_ADMIN_USERNAME) {
    items.push({ folder, name: 'munni app (admin user)', username: values.LOGTO_APP_ADMIN_USERNAME, password: values.LOGTO_APP_ADMIN_PASSWORD ?? '', uri: stack.urls.web ?? '', notes: `The ${folder} environment’s first munni user, auto-created and wired as admin (its id sits in NAS_ADMIN_SUBS) — sign into the app, the admin portal and munni-control with it.` });
  }
  if (values.IAC_LOGTO_INFRA_M2M_ID) {
    items.push({ folder, name: 'Logto infra M2M', username: values.IAC_LOGTO_INFRA_M2M_ID, password: values.IAC_LOGTO_INFRA_M2M_SECRET ?? '', uri: stack.urls.logto ?? '', notes: 'Machine credential the SETUP uses to manage this environment’s Logto as code (apps, redirect URIs, branding). Seeded straight into Logto’s database by the wizard.' });
  }
  for (const [name, value] of Object.entries(values)) {
    if (VAULT_COVERED_NAMES.has(name) || VAULT_SKIP_NAMES.has(name) || !value) continue;
    items.push({ folder, name, password: String(value), notes: vaultNote(name) });
  }
  return items;
}

/** Bitwarden-importable JSON (web vault → Tools → Import → Bitwarden json) */
function vaultExportEndpoint(res) {
  const rows = buildVaultItems();
  const folderNames = [...new Set(rows.map((r) => r.folder))];
  const folders = folderNames.map((name, i) => ({ id: `f${i}`, name }));
  const items = rows.map((r) => ({
    type: 1,
    folderId: `f${folderNames.indexOf(r.folder)}`,
    name: r.name,
    notes: r.notes ?? '',
    favorite: false,
    login: { username: r.username ?? '', password: r.password ?? '', uris: r.uri ? [{ match: null, uri: r.uri }] : [], totp: null },
    collectionIds: null,
  }));
  return json(res, 200, { encrypted: false, folders, items });
}

/** zero-input vault (user ruling): create the account with a GENERATED
 * master password kept in the local store, refresh every secret item
 * inside it (purge + import), then close signups. Re-runnable — a re-run
 * re-syncs the items. */
/** reopen signups (they close after every successful setup — but a
 * WIPED vault with a store that still says "closed" must be able to
 * register its account again; found live 2026-08-28) */
async function reopenVaultSignups(res, run, base, fetchImpl) {
  const shared = loadStack(SHARED_STACK);
  const v = loadLocalValues(shared);
  saveLocalValues(shared, { ...v, VAULT_SIGNUPS_ALLOWED: '' });
  await run(res, 'reopen vault signups for the fresh vault (closed again right after)', process.execPath,
    [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', SHARED_STACK], { cwd: ROOT });
  await run(res, 'restart the shared stack', 'docker', [...composeArgs(SHARED_STACK), 'up', '-d', '--remove-orphans'], { cwd: renderedDir(SHARED_STACK) });
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      const r = await fetchImpl(`${base}/alive`);
      if (r.ok) return true;
    } catch { /* still starting */ }
    if (Date.now() > deadline) return false;
    await new Promise((s) => setTimeout(s, 3000));
  }
}

/** sign in, or create the account — reopening signups once when a WIPED
 * vault sits behind a store that still says signups-closed. Returns the
 * access token, or null after writing the failure to the stream. */
async function vaultEnsureAccount(res, run, base, account, fetchImpl) {
  let token = await vaultLogin(base, account.register.email, account.hash, fetchImpl);
  if (token) {
    res.write('account already exists — signed in with the stored master password ✓\n');
    return token;
  }
  let reg = await vaultRegister(base, account.register, fetchImpl);
  if (!reg.ok) {
    // vaultwarden's refusal is ambiguous ("Registration not allowed or
    // user already exists") — closed signups from a previous run are
    // the common cause; reopen once and retry before giving up
    res.write(`registration refused (${reg.status}) — reopening signups once and retrying\n`);
    if (!(await reopenVaultSignups(res, run, base, fetchImpl))) {
      res.write('the vault never came back after the restart — check step 4 status, then retry\n');
      return null;
    }
    reg = await vaultRegister(base, account.register, fetchImpl);
  }
  if (!reg.ok) {
    res.write(`could not create the account (${reg.status})\nan account for this email exists with a DIFFERENT master password — Delete shared services (wipes the vault volume) and re-run, or change VAULT_ADMIN_EMAIL in the store\n`);
    return null;
  }
  res.write('account created ✓\n');
  token = await vaultLogin(base, account.register.email, account.hash, fetchImpl);
  if (!token) res.write('login failed right after registration — is the vault healthy (step 4 status)?\n');
  return token;
}

async function vaultSetupEndpoint(req, res, spawnImpl, fetchImpl) {
  const shared = loadStack(SHARED_STACK);
  const values = loadLocalValues(shared);
  // pgadmin-style resolvable-TLD address; any inbox-less email works
  const email = values.VAULT_ADMIN_EMAIL ?? 'admin@munni.dev';
  const password = values.VAULT_MASTER_PASSWORD ?? randomBytes(16).toString('base64url');
  saveLocalValues(shared, { ...values, VAULT_ADMIN_EMAIL: email, VAULT_MASTER_PASSWORD: password });
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  const run = stepRunner(spawnImpl);
  const base = shared.urls.vault;
  res.write(`▶ vault account ${email} — sign in, create when missing\n`);
  const account = buildAccount(email, password);
  const token = await vaultEnsureAccount(res, run, base, account, fetchImpl);
  if (!token) return res.end('[exit 1]\n');
  res.write('▶ refresh the secret items (purge + import, grouped in per-environment folders)\n');
  await vaultPurge(base, token, account.hash, fetchImpl);
  const rows = buildVaultItems();
  const folderNames = [...new Set(rows.map((r) => r.folder))];
  const folders = folderNames.map((name) => ({ name: encString(account.userKeys, name) }));
  const ciphers = rows.map((r) => buildCipher(account.userKeys, r));
  const folderRelationships = rows.map((r, i) => ({ key: i, value: folderNames.indexOf(r.folder) }));
  const imp = await vaultImport(base, token, { ciphers, folders, folderRelationships }, fetchImpl);
  if (!imp.ok) {
    res.write(`import failed (${imp.status} ${(await imp.text().catch(() => '')).slice(0, 200)})\n`);
    return res.end('[exit 1]\n');
  }
  res.write(`${ciphers.length} items in ${folders.length} folders ✓ (re-running this refreshes them)\n`);
  const v2 = loadLocalValues(shared);
  if (v2.VAULT_SIGNUPS_ALLOWED !== 'false') {
    saveLocalValues(shared, { ...v2, VAULT_SIGNUPS_ALLOWED: 'false' });
    await run(res, 'close vault signups (nobody else on the network can register)', process.execPath,
      [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', SHARED_STACK], { cwd: ROOT });
    await run(res, 'restart the shared stack', 'docker', [...composeArgs(SHARED_STACK), 'up', '-d', '--remove-orphans'], { cwd: renderedDir(SHARED_STACK) });
  }
  res.write(`\nDone. Vault → ${base} · ${email} · master password under Reveal secrets.\n(Use it with the real Bitwarden apps/extension pointed at that server url.)\n`);
  return res.end('\n[exit 0]\n');
}

/** every manifest operator name may carry a value INTO a validation —
 * transient use only, never stored, never logged */
const VALIDATABLE_NAMES = new Set(MANIFEST.secrets.filter((s) => s.owner === 'operator').map((s) => s.name));

async function validateEndpoint(req, res, validateImpl) {
  const body = await readBody(req);
  // pasted field values win; the family store fills the gaps so "Check"
  // also re-verifies values stored earlier
  const values = { ...familyValues(loadStack(pickEnv(body.stack))) };
  for (const [name, value] of Object.entries(body.values ?? {})) {
    if (VALIDATABLE_NAMES.has(name) && typeof value === 'string' && value) values[name] = value;
  }
  return json(res, 200, await validateImpl(String(body.provider ?? ''), values));
}

function serveHtml(res, token) {
  const html = readFileSync(HTML, 'utf8').replace(
    '</head>',
    `<script>window.__SETUP_HELPER__={token:${JSON.stringify(token)}};</script></head>`,
  );
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(html);
}

/** build the handler; spawn/probe/validate deps injectable for tests */
export function createApp({ token, probeImpl = probe, runImpl = runToStream, validateImpl = validate, spawnImpl = spawn, vaultFetchImpl = insecureFetch, netFetchImpl = localAwareFetch } = {}) {
  const routes = {
    'GET /api/local/status': (req, res) => statusEndpoint(res, probeImpl),
    'POST /api/local/run': (req, res) => runEndpoint(req, res, runImpl),
    'POST /api/local/tool': (req, res) => toolEndpoint(req, res, runImpl),
    'POST /api/local/glitchtip-setup': (req, res) => glitchtipSetupEndpoint(req, res, spawnImpl),
    'POST /api/local/logto-setup': (req, res) => logtoSetupEndpoint(req, res, spawnImpl),
    'POST /api/local/cleanup': (req, res) => cleanupEndpoint(req, res, runImpl),
    'POST /api/local/envs': (req, res) => envCreateEndpoint(req, res, runImpl, spawnImpl),
    'POST /api/local/envs/delete': (req, res) => envDeleteEndpoint(req, res, spawnImpl, netFetchImpl),
    'POST /api/local/envs/forget-all': (req, res) => envsForgetAllEndpoint(res),
    'GET /api/local/store-status': (req, res) => storeStatusEndpoint(res, new URL(req.url, 'http://localhost'), netFetchImpl),
    'POST /api/local/ios-appid': (req, res) => iosAppIdEndpoint(req, res, netFetchImpl),
    'POST /api/local/mint-keystore': (req, res) => mintKeystoreEndpoint(req, res, spawnImpl),
    'POST /api/local/new-store-package': (req, res) => newStorePackageEndpoint(req, res, spawnImpl),
    'POST /api/local/trust-ca': (req, res) => trustCaEndpoint(res, spawnImpl, netFetchImpl),
    'GET /api/local/secrets': (req, res) => secretsEndpoint(res),
    'GET /api/local/vault-export': (req, res) => vaultExportEndpoint(res),
    'POST /api/local/vault-setup': (req, res) => vaultSetupEndpoint(req, res, spawnImpl, vaultFetchImpl),
    'GET /api/local/lan': (req, res) => lanGetEndpoint(res),
    'POST /api/local/lan': (req, res) => lanSetEndpoint(req, res, spawnImpl, probeImpl, netFetchImpl),
    'GET /api/local/native-config': (req, res) => nativeConfigEndpoint(res, new URL(req.url, 'http://localhost'), netFetchImpl),
    'POST /api/validate': (req, res) => validateEndpoint(req, res, validateImpl),
  };
  return async function handle(req, res) {
    if (!hostOk(req)) return json(res, 403, { error: 'bad host' });
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveHtml(res, token);
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (req.headers['x-setup-token'] !== token) return json(res, 401, { error: 'bad token' });
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return json(res, 404, { error: 'not found' });
    try {
      return await route(req, res);
    } catch (e) {
      return json(res, 500, { error: String(e.message ?? e) });
    }
  };
}

// ── main ───────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const openBrowser = (url) => {
  if (process.env.SETUP_NO_OPEN) return;
  const openers = { win32: ['cmd', ['/c', 'start', '', url]], darwin: ['open', [url]] };
  const [cmd, args] = openers[process.platform] ?? ['xdg-open', [url]];
  spawn(cmd, args, { shell: false, stdio: 'ignore' }).on('error', () => {});
};

/** is the thing on this port ALREADY a munni helper? (double-started) */
async function isRunningHelper(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return res.ok && /__SETUP_HELPER__/.test(await res.text());
  } catch {
    return false;
  }
}

function startHelper(port, attemptsLeft) {
  const token = randomBytes(16).toString('hex');
  const server = createServer(createApp({ token }));
  server.requestTimeout = 0; // compose builds stream for many minutes
  server.on('error', async (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    if (await isRunningHelper(port)) {
      const url = `http://127.0.0.1:${port}/`;
      console.log(`the munni setup helper is ALREADY running → ${url}`);
      console.log('(opened it in your browser — nothing else to do. Close the other window first if you really want a fresh one.)');
      openBrowser(url);
      return; // exit 0 — this is the happy path, not an error
    }
    if (attemptsLeft > 0) {
      console.log(`port ${port} is taken by something else — trying ${port + 1}`);
      startHelper(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(`ports ${port - 3}-${port} are all taken. Free one (or set SETUP_PORT) and start me again.`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`munni setup helper ready → ${url}`);
    console.log('(the page it serves can now run the local setup for you; Ctrl+C stops the helper)');
    openBrowser(url);
  });
}

if (isMain) {
  startHelper(Number(process.env.SETUP_PORT ?? 8377), 3);
}
