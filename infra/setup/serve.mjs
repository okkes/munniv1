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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes, X509Certificate } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MANIFEST } from '../modules/secrets.mjs';
import { familyValues, loadLocalValues, saveLocalValues, stackManifestEntries } from '../modules/localstore.mjs';
import { insecureFetch, localAwareFetch } from '../modules/insecure-fetch.mjs';
import { lanHost, loadAutonomy, loadStack, localEnvRegistry, saveAutonomy, saveLocalEnvRegistry } from '../modules/stack.mjs';
import { jwtES256, jwtRS256, validate } from '../modules/validate.mjs';
import { buildAccount, buildCipher, encString, vaultImport, vaultLogin, vaultPurge, vaultRegister } from '../modules/vault.mjs';
import { zipEntry, zipNames } from '../modules/zip.mjs';
import { proxyRules } from '../modules/dsm.mjs';

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
/** stack routing with honest fallbacks: the named stack when it exists,
 * else the FIRST registry environment, else the shared stack. The old
 * hardcoded munni-local-prod fallback crashed every consumer while the
 * registry was empty (mid delete/recreate — user reports 2026-09-08:
 * first Check, then Save died on bootstrap's unknown-stack throw) and
 * would equally crash a registry without a literal "prod". */
const pickStack = (candidate) => (LOCAL_STACKS().includes(candidate) ? candidate : (LOCAL_ENVS()[0] ?? SHARED_STACK));
/** env-only variant: callers guard LOCAL_ENVS().length before calling */
const pickEnv = (candidate) => (LOCAL_ENVS().includes(candidate) ? candidate : LOCAL_ENVS()[0]);

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
  const { enabled, lastCheckAt, lastResult } = loadAutonomy();
  // the Google console links point at the Play service account's own
  // project — the OAuth client belongs next to the Firebase apps
  let googleProject = null;
  try {
    googleProject = JSON.parse(loadLocalValues(loadStack(SHARED_STACK)).PLAY_SERVICE_ACCOUNT_JSON ?? 'null')?.project_id ?? null;
  } catch { /* no or malformed service account — generic links */ }
  return json(res, 200, { docker, stacks, lan: lanHost(), googleProject, autonomy: { enabled, lastCheckAt, lastResult, running: autonomyRunning } });
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
    res.write(`\nDone. From your phone (same wifi): ${envLine}\nTrust the family's certificate once per device: download http://ca.${base} (root.crt). Android: install it as a CA certificate (Settings → Security). iPhone: Settings → Profile Downloaded → Install, THEN Settings → General → About → Certificate Trust Settings → switch the root fully on (both steps, or sign-in fails).\nIf the phone cannot reach it, allow Docker/vpnkit through the Windows firewall for private networks (incl. port 443), and give this machine a DHCP reservation — a changed address needs a rebuilt app.\n`);
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
  caTrustMemo = { at: 0, value: null }; // the next probe reads the store afresh
  return res.end(`\n[exit ${ok ? 0 : 1}]\n`);
}

/* ── is the family CA trusted on THIS PC? (user request 2026-09-10: no
   manual tick — with the CA site up, compare the root's fingerprint with
   the CurrentUser Root store). Memoized a minute; trust-ca busts it. ── */
let caTrustMemo = { at: 0, value: null };
/** certutil prints one "Cert Hash(sha1): …" line per certificate — with or
 *  without spaces depending on the Windows build; compare hex only */
export function caListingHasFingerprint(listing, fingerprint) {
  const want = String(fingerprint ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  return want.length === 40 && String(listing ?? '').split(/\r?\n/).some((line) => /sha1/i.test(line) && line.replace(/[^0-9a-f]/gi, '').toLowerCase().includes(want));
}
async function caTrustState(netFetchImpl, spawnImpl, { force = false } = {}) {
  const lan = lanHost();
  if (!lan) return { trusted: null, reason: 'LAN mode is off — no family certificate to trust' };
  if (process.platform !== 'win32') return { trusted: null, reason: 'not Windows — trust the root by hand' };
  if (!force && caTrustMemo.value && Date.now() - caTrustMemo.at < 60000) return caTrustMemo.value;
  const remember = (value) => { caTrustMemo = { at: Date.now(), value }; return value; };
  const base = `${lan.replaceAll('.', '-')}.sslip.io`;
  let pem;
  try {
    const r = await netFetchImpl(`http://ca.${base}/root.crt`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
    pem = await r.text();
  } catch (e) {
    return remember({ trusted: null, reason: `the family CA site is not up (${e.message}) — known once the family runs` });
  }
  let fingerprint;
  try {
    fingerprint = new X509Certificate(pem).fingerprint;
  } catch (e) {
    return remember({ trusted: null, reason: `root.crt is unreadable (${e.message})` });
  }
  const listing = await capture(spawnImpl, 'certutil', ['-user', '-store', 'Root']);
  const trusted = caListingHasFingerprint(listing.out, fingerprint);
  return remember({ trusted, fingerprint: fingerprint.replaceAll(':', '').slice(0, 12).toLowerCase(), reason: trusted ? 'the family root is in this user’s Root store' : 'the family root is not in this user’s Root store yet — Trust the certificate again installs it' });
}
async function caTrustEndpoint(res, url, netFetchImpl, spawnImpl) {
  return json(res, 200, await caTrustState(netFetchImpl, spawnImpl, { force: url.searchParams.get('force') === '1' }));
}

/* ── are the munni images public? Then no registry token is needed to
   pull them (user request 2026-09-10: stop asking for a second token).
   An anonymous pull token + a manifest HEAD, memoized ten minutes. ── */
let registryMemo = { at: 0, value: null };
async function registryState(netFetchImpl, { force = false } = {}) {
  if (!force && registryMemo.value && Date.now() - registryMemo.at < 600000) return registryMemo.value;
  const registry = loadStack(SHARED_STACK).registry ?? 'ghcr.io/okkes';
  const repo = `${registry.replace(/^ghcr\.io\//, '')}/munni-web`;
  const remember = (value) => { registryMemo = { at: Date.now(), value }; return value; };
  try {
    const t = await netFetchImpl(`https://ghcr.io/token?scope=repository:${repo}:pull`, { signal: AbortSignal.timeout(8000) });
    const token = t.ok ? (await t.json())?.token : null;
    const m = token
      ? await netFetchImpl(`https://ghcr.io/v2/${repo}/manifests/latest`, { method: 'HEAD', headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' }, signal: AbortSignal.timeout(8000) })
      : null;
    const isPublic = Boolean(m?.ok);
    return remember({ public: isPublic, image: `ghcr.io/${repo}`, detail: isPublic ? `the munni images (ghcr.io/${repo.split('/')[0]}/…) are public — no registry token is needed to pull them` : `ghcr.io answered ${m?.status ?? t.status} for an anonymous pull of ${repo} — private images need a classic PAT with read:packages` });
  } catch (e) {
    return remember({ public: null, image: `ghcr.io/${repo}`, detail: `could not reach ghcr.io (${e.message})` });
  }
}
async function registryEndpoint(res, url, netFetchImpl) {
  return json(res, 200, await registryState(netFetchImpl, { force: url.searchParams.get('force') === '1' }));
}

/* ── NAS readiness without any DSM credential (2026-09-10): seen from
   outside, every reverse-proxy host tells which one-time step is still
   missing — DNS, the wildcard certificate (TLS fails by name), the rule
   (DSM answers with Web Station's welcome page when nothing matches),
   the containers (a rule answering 502 has nothing behind it yet: no
   bundle applied → the poller task is missing or Deploy never ran). ── */
const NAS_STACKS = ['munni-iac-prod', 'munni-iac-staging'];
const NAS_HOST_KEYS = ['web', 'api', 'admin', 'logto', 'logtoAdmin', 'glitchtip', 'vault'];
export function nasHosts(domain) {
  const prev = process.env.IAC_DOMAIN;
  process.env.IAC_DOMAIN = domain;
  try {
    return NAS_STACKS.map((name) => {
      const st = loadStack(name);
      return { stack: name, hosts: proxyRules(st).map((r, i) => ({ key: NAS_HOST_KEYS[i] ?? String(i), host: r.host })) };
    });
  } finally {
    if (prev === undefined) delete process.env.IAC_DOMAIN; else process.env.IAC_DOMAIN = prev;
  }
}
const NAS_CERT_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']);
/** what answers on the host: a rule (munni or a 502 behind it) or DSM itself */
/** DSM's own front door: its ports, or its web app's path */
const DSM_PORTAL = /^https?:\/\/[^/]+:(5000|5001)(\/|$)|\/webman\//i;
async function classifyNasAnswer(host, fetchImpl) {
  const res = await fetchImpl(`https://${host}/`, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  const text = res.status < 400 && typeof res.text === 'function' ? String(await res.text()).slice(0, 6000) : '';
  const noRule = (how) => ({ state: 'no-rule', detail: `${how} — no reverse-proxy rule for this host yet; Bootstrap writes it once the deploy account may use DSM` });
  if (/Synology Web Station/i.test(text)) return noRule('DSM answers with Web Station’s welcome page');
  // without Web Station, DSM's default server sends an unmatched host to its own portal (:5001, /webman/)
  const location = res.status >= 300 && res.status < 400 ? String(res.headers?.get?.('location') ?? '') : '';
  if (location && DSM_PORTAL.test(location)) return noRule(`DSM redirects to its own portal (${location})`);
  if (/DiskStation|SYNO\.SDS|\/webman\//i.test(text)) return noRule('DSM’s own portal answers');
  if ([502, 503, 504].includes(res.status)) return { state: 'no-container', detail: `the rule exists but nothing answers behind it (${res.status}) — no bundle applied yet: Bootstrap (prod twin) creates the poller task when SYNOLOGY_PATH is stored, Deploy uploads the bundle, the poller applies it within five minutes` };
  return { state: 'up', detail: `answers (${res.status})` };
}
export async function probeNasHost(host, netFetchImpl, insecureImpl = null) {
  try {
    return { host, ...(await classifyNasAnswer(host, netFetchImpl)) };
  } catch (e) {
    const code = e.cause?.code ?? e.code ?? e.name;
    if (code === 'ERR_TLS_CERT_ALTNAME_INVALID' || NAS_CERT_CODES.has(code)) {
      const detail = code === 'ERR_TLS_CERT_ALTNAME_INVALID'
        ? 'the certificate does not cover this host — Bootstrap (prod twin) requests the wildcard (*.<domain>) through DSM and binds the rules to it once the deploy account may use DSM (own domain: acme.sh with the synology_dsm hook)'
        : `the certificate is not trusted (${code}) — Bootstrap (prod twin) requests a Let’s Encrypt certificate through DSM once the deploy account may use DSM${code === 'CERT_HAS_EXPIRED' ? ' (an expired wildcard is replaced)' : ''}`;
      // a second, deliberately unverified look: the certificate hides
      // nothing about the rule behind it — say both at once
      let behind = null;
      if (insecureImpl) behind = await classifyNasAnswer(host, insecureImpl).catch(() => null);
      return { host, state: 'no-cert', detail, ...(behind ? { behind: behind.state, behindDetail: behind.detail } : {}) };
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { host, state: 'no-dns', detail: 'the name does not resolve — Synology DDNS resolves *.<domain> by itself; an own domain needs a wildcard record' };
    return { host, state: 'unreachable', detail: `no answer (${code})` };
  }
}
let nasProbeMemo = { at: 0, domain: null, value: null };
async function nasProbeEndpoint(res, url, netFetchImpl, insecureImpl) {
  const domain = String(url.searchParams.get('domain') ?? '').trim().toLowerCase();
  if (!/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return json(res, 400, { error: 'domain must be a hostname (e.g. yourname.synology.me)' });
  const force = url.searchParams.get('force') === '1';
  if (!force && nasProbeMemo.value && nasProbeMemo.domain === domain && Date.now() - nasProbeMemo.at < 30000) return json(res, 200, nasProbeMemo.value);
  const stacks = await Promise.all(nasHosts(domain).map(async (s) => ({ ...s, hosts: await Promise.all(s.hosts.map(async (h) => ({ ...h, ...(await probeNasHost(h.host, netFetchImpl, insecureImpl)) }))) })));
  const all = stacks.flatMap((s) => s.hosts);
  const count = (state) => all.filter((h) => h.state === state || h.behind === state).length;
  const summary = {
    hosts: all.length,
    up: count('up'),
    dns: all.filter((h) => h.state === 'no-dns').length === 0,
    certificate: all.filter((h) => h.state === 'no-cert').length === 0 && all.filter((h) => h.state === 'no-dns').length < all.length,
    rulesMissing: count('no-rule'),
    containersMissing: count('no-container'),
    unreachable: all.filter((h) => h.state === 'unreachable').length,
  };
  const value = { domain, stacks, summary };
  nasProbeMemo = { at: Date.now(), domain, value };
  return json(res, 200, value);
}

/* ── store readiness (user ruling 2026-08-28: no manual Enable-publish
   button — the wizard POLLS whether the operator did the one-time store
   upload and flips auto-publish itself). The credentials live in the
   local store; checks mirror what CI's publish steps really do. ── */
/** Google access token from the stored Play service account, for any
 * scope — the SAME credential drives the Play checks AND (once granted
 * the Firebase Admin + Service Usage Admin roles) the Firebase
 * Management API. Throws with the
 * exact operator-facing diagnosis on failure. */
async function googleAccessToken(values, scope, fetchImpl) {
  let sa;
  try {
    sa = JSON.parse(values.PLAY_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error('PLAY_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwtRS256({
    header: { alg: 'RS256', typ: 'JWT' },
    payload: { iss: sa.client_email, scope, aud: sa.token_uri, iat: now, exp: now + 300 },
    pem: sa.private_key,
  });
  const tok = await fetchImpl(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!tok.ok) throw new Error(`Google rejected the service account (${tok.status})`);
  return { access: (await tok.json()).access_token, projectId: sa.project_id, clientEmail: sa.client_email };
}

async function playAccessToken(values, fetchImpl) {
  return (await googleAccessToken(values, 'https://www.googleapis.com/auth/androidpublisher', fetchImpl)).access;
}

async function playAppExists(values, appId, fetchImpl) {
  if (!values.PLAY_SERVICE_ACCOUNT_JSON) return { state: 'no-creds' };
  let access;
  try {
    access = await playAccessToken(values, fetchImpl);
  } catch (e) {
    return { state: 'error', detail: e.message };
  }
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

/** is push WIRED for this env? project firebase-enabled + both apps
 * registered → the builds bake real configs and the sender works */
async function firebaseState(values, stack, fetchImpl) {
  if (!values.PLAY_SERVICE_ACCOUNT_JSON) return { state: 'no-creds' };
  let access;
  let projectId;
  let clientEmail;
  try {
    ({ access, projectId, clientEmail } = await googleAccessToken(values, 'https://www.googleapis.com/auth/cloud-platform', fetchImpl));
  } catch (e) {
    return { state: 'error', detail: e.message };
  }
  const fb = fbFetcher(access, fetchImpl);
  const proj = await fb(`/projects/${projectId}`);
  if (proj.status >= 500) return { state: 'transient', detail: `Firebase answered ${proj.status} — retried on the next poll` };
  if (proj.status === 404) {
    // a bare Cloud project (the Management API IS on — off answers 403):
    // Build adds Firebase, IF the account may switch services on. The
    // no-op enable is the honest probe and changes nothing here
    const en = await enableService(access, projectId, FB_API, fetchImpl);
    return en.ok
      ? { state: 'missing-app', detail: `push stubbed — ${projectId} is not a Firebase project yet; Build adds Firebase to it` }
      : { state: 'error', detail: await suExplain(en, projectId, clientEmail, FB_API) };
  }
  if (!proj.ok) return { state: 'error', detail: fbExplain(proj.status, await googleError(proj), projectId, clientEmail) };
  const [aList, iList] = await Promise.all([
    fb(`/projects/${projectId}/androidApps?pageSize=100`).then((r) => r.json()).then((b) => b.apps ?? []),
    fb(`/projects/${projectId}/iosApps?pageSize=100`).then((r) => r.json()).then((b) => b.apps ?? []),
  ]);
  const missing = [];
  if (!aList.some((a) => a.packageName === stack.native.appId)) missing.push(stack.native.appId);
  if (!iList.some((a) => a.bundleId === stack.native.iosAppId)) missing.push(`${stack.native.iosAppId} (iOS)`);
  return missing.length
    ? { state: 'missing-app', detail: `not registered at Firebase yet: ${missing.join(', ')} — pressing Build registers them` }
    : { state: 'ready' };
}

async function storeStatusEndpoint(res, url, fetchImpl) {
  if (!LOCAL_ENVS().length) return json(res, 400, { error: 'no environments exist yet' });
  const stack = loadStack(pickEnv(url?.searchParams.get('stack')));
  const values = familyValues(stack);
  const [play, ios, firebase] = await Promise.all([
    playAppExists(values, stack.native.appId, fetchImpl).catch((e) => ({ state: 'error', detail: e.message })),
    ascAppExists(values, stack.native.iosAppId, fetchImpl).catch((e) => ({ state: 'error', detail: e.message })),
    firebaseState(values, stack, fetchImpl).catch((e) => ({ state: 'error', detail: e.message })),
  ]);
  return json(res, 200, { localEnv: stack.envName, appId: stack.native.appId, iosAppId: stack.native.iosAppId, play, ios, firebase });
}

/* ── OPT-IN store retirement on delete (user request 2026-09-04):
   neither store offers a delete API for apps, but the DISTRIBUTION can
   be pulled — Play internal-testing releases withdrawn, TestFlight
   builds expired (testers lose the app immediately). Records and the
   package name stay; only ever touches app.munni.local.* packages. ── */
async function storeRetireEndpoint(req, res, netFetchImpl) {
  const body = await readBody(req);
  if (!LOCAL_ENVS().length) return json(res, 400, { error: 'no environments exist' });
  const stack = loadStack(pickEnv(body.stack));
  const appId = stack.native.appId;
  const iosAppId = stack.native.iosAppId;
  if (!appId.startsWith('app.munni.local.') || !iosAppId.startsWith('app.munni.local.')) {
    return json(res, 400, { error: `refusing to touch ${appId} / ${iosAppId} — only app.munni.local.* packages can be retired here` });
  }
  const values = familyValues(stack);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.write(`▶ retire ${appId === iosAppId ? appId : `${appId} (Play) + ${iosAppId} (TestFlight)`} at the stores — distribution is withdrawn; the records themselves have no delete API\n\n`);
  let ok = true;
  if (!values.PLAY_SERVICE_ACCOUNT_JSON) {
    res.write('Play: no service account stored (Features & accounts) — skipped\n');
  } else {
    try {
      const access = await playAccessToken(values, netFetchImpl);
      const api = (path, init = {}) => netFetchImpl(
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(appId)}${path}`,
        { ...init, headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(15000) },
      );
      const edit = await api('/edits', { method: 'POST', body: '{}' });
      if (edit.status === 404 || edit.status === 403) {
        res.write(`Play: ${appId} does not exist there (or is not visible to the service account) — nothing to retire\n`);
      } else if (!edit.ok) {
        ok = false;
        res.write(`Play: opening an edit failed (${edit.status})\n`);
      } else {
        const { id } = await edit.json();
        const trk = await api(`/edits/${id}/tracks/internal`, { method: 'PUT', body: JSON.stringify({ track: 'internal', releases: [] }) });
        if (!trk.ok) {
          ok = false;
          res.write(`Play: clearing the internal track failed (${trk.status})\n`);
          await api(`/edits/${id}`, { method: 'DELETE' }).catch(() => {});
        } else {
          // some accounts refuse the plain commit for review-exempt
          // changes — the retry mirrors what the Console itself does
          let commit = await api(`/edits/${id}:commit`, { method: 'POST' });
          if (!commit.ok) commit = await api(`/edits/${id}:commit?changesNotSentForReview=true`, { method: 'POST' });
          if (commit.ok) {
            res.write(`Play: internal testing withdrawn for ${appId} ✓ — testers lose it now. The app record and the package name STAY (Google has no delete API; a never-published app can be removed by hand in Play Console, but the package name is burned either way).\n`);
          } else {
            ok = false;
            res.write(`Play: committing the withdrawal failed (${commit.status})\n`);
          }
        }
      }
    } catch (e) {
      ok = false;
      res.write(`Play: ${e.message}\n`);
    }
  }
  if (!values.ASC_KEY_ID || !values.ASC_ISSUER_ID || !values.ASC_KEY_P8) {
    res.write('TestFlight: no App Store Connect key stored (Features & accounts) — skipped\n');
  } else {
    try {
      const jwt = ascJwt(values);
      const asc = (path, init = {}) => netFetchImpl(`https://api.appstoreconnect.apple.com/v1${path}`, {
        ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(15000),
      });
      const appsRes = await asc(`/apps?filter%5BbundleId%5D=${encodeURIComponent(iosAppId)}&limit=2`);
      if (!appsRes.ok) throw new Error(`App Store Connect answered ${appsRes.status}`);
      const app = ((await appsRes.json()).data ?? [])[0];
      if (app) {
        const builds = ((await (await asc(`/builds?filter%5Bapp%5D=${encodeURIComponent(app.id)}&filter%5Bexpired%5D=false&limit=200`)).json()).data) ?? [];
        let expired = 0;
        for (const b of builds) {
          const p = await asc(`/builds/${b.id}`, { method: 'PATCH', body: JSON.stringify({ data: { type: 'builds', id: b.id, attributes: { expired: true } } }) });
          if (p.ok) expired += 1;
          else { ok = false; res.write(`TestFlight: expiring build ${b.attributes?.version ?? b.id} failed (${p.status})\n`); }
        }
        res.write(`TestFlight: ${expired}/${builds.length} builds expired for ${iosAppId} ✓ — testers lose it now. The App Store Connect app record STAYS (Apple has no delete API; a never-published app can be removed by hand under App Information → Remove App).\n`);
      } else {
        // no app record — but the developer-portal App ID registration
        // (the wizard creates it as code) CAN be deleted while unused
        const bids = ((await (await asc(`/bundleIds?filter%5Bidentifier%5D=${encodeURIComponent(iosAppId)}&limit=200`)).json()).data) ?? [];
        const bid = bids.find((d) => d.attributes?.identifier === iosAppId);
        if (!bid) {
          res.write(`TestFlight: nothing at Apple for ${iosAppId} — no app record, no App ID registration\n`);
        } else {
          const del = await asc(`/bundleIds/${bid.id}`, { method: 'DELETE' });
          if (del.ok || del.status === 204) res.write(`TestFlight: no app record existed — the App ID registration ${iosAppId} was deleted from the developer portal ✓ (fully freed on Apple's side)\n`);
          else { ok = false; res.write(`TestFlight: deleting the App ID registration failed (${del.status}) — remove it by hand at developer.apple.com → Identifiers\n`); }
        }
      }
    } catch (e) {
      ok = false;
      res.write(`TestFlight: ${e.message}\n`);
    }
  }
  return res.end(`\n[exit ${ok ? 0 : 1}]\n`);
}

/* ── Firebase push as code (user ruling 2026-09-08: automate — no
   separate project, no separate credential). The Play service account's
   OWN Cloud project becomes the Firebase project via the Management
   API; each environment's Android/iOS apps are registered there and
   their config files ride to CI as variables. The one-time Google
   floor: grant that service account the Firebase Admin role AND the
   Service Usage Admin role — adding Firebase to a Cloud project switches
   APIs on, which Google gates behind serviceusage.services.enable, and
   Firebase Admin does NOT carry that permission (found live 2026-09-08:
   role granted, addFirebase still 403 — the old text blamed the wrong
   role). By hand instead: add Firebase to the project once in the
   Firebase console, after which Firebase Admin alone is enough. ── */
const FB_BASE = 'https://firebase.googleapis.com/v1beta1';
const SU_BASE = 'https://serviceusage.googleapis.com/v1';
const FB_API = 'firebase.googleapis.com';
const iamUrl = (projectId) => `https://console.cloud.google.com/iam-admin/iam?project=${projectId}`;
const fbFetcher = (access, fetchImpl) => (path, init = {}) => fetchImpl(`${FB_BASE}${path}`, {
  ...init,
  headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', ...init.headers },
  signal: AbortSignal.timeout(20000),
});

/** Google's error envelope, or {} when the body is not JSON */
const googleError = async (r) => (await r.json().catch(() => ({})))?.error ?? {};
/** the SERVICE_DISABLED detail (or {} when only the message says so) */
const serviceDisabled = (err) => err.details?.find((d) => d.reason === 'SERVICE_DISABLED')
  ?? (/has not been used in project|it is disabled/.test(err.message ?? '') ? {} : null);
/** the permission Google itself names in a refusal (ErrorInfo metadata) */
const deniedPermission = (err) => err.details?.find((d) => d.reason === 'AUTH_PERMISSION_DENIED')?.metadata?.permission;
const ROLE_FOR = { 'serviceusage.services.enable': 'Service Usage Admin role' };

/** switch an API on in the service account's own Cloud project — a
 * no-op when it already is, which makes it the one honest probe for
 * serviceusage.services.enable BEFORE addFirebase burns a 403 */
const enableService = (access, projectId, service, fetchImpl) => fetchImpl(`${SU_BASE}/projects/${projectId}/services/${service}:enable`, {
  method: 'POST',
  headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
  body: '{}',
  signal: AbortSignal.timeout(20000),
});

/** name enableService's refusal precisely — the role gap, both ways out */
async function suExplain(r, projectId, clientEmail, service) {
  const err = await googleError(r);
  if (r.status === 403) {
    const perm = deniedPermission(err) ?? 'serviceusage.services.enable';
    return `${clientEmail} may not switch APIs on in ${projectId} (${perm} — the Firebase Admin role does NOT carry it). One-time, pick one: grant it the Service Usage Admin role beside Firebase Admin (${iamUrl(projectId)}), wait a minute, Build again — or add Firebase to ${projectId} by hand once (https://console.firebase.google.com → Add project → choose the existing Cloud project ${projectId}), after which Firebase Admin alone is enough`;
  }
  return `Google refused switching on ${service} in ${projectId} (${r.status}): ${err.message ?? 'no detail'}`;
}

/** name the classic Firebase Management API refusals precisely */
function fbExplain(status, err, projectId, clientEmail) {
  const disabled = serviceDisabled(err);
  if (disabled) {
    const url = disabled.metadata?.activationUrl ?? `https://console.cloud.google.com/apis/library/${FB_API}?project=${projectId}`;
    return `the Firebase Management API is disabled in ${projectId} — Build switches it on by itself once ${clientEmail} holds the Service Usage Admin role; or enable it by hand (${url}), wait a few minutes, retry`;
  }
  const perm = deniedPermission(err);
  if (perm) {
    return `${clientEmail} lacks ${perm} on ${projectId} — grant it the ${ROLE_FOR[perm] ?? `role that carries ${perm}`} (${iamUrl(projectId)}), wait a minute, retry`;
  }
  if (status === 403) {
    return `${clientEmail} lacks Firebase rights on ${projectId}${err.message ? ` (Google: ${err.message})` : ''} — grant it the Firebase Admin role once (${iamUrl(projectId)}), wait a minute, retry`;
  }
  return err.message ?? `status ${status}`;
}

/** poll a long-running Google operation (Firebase, Service Usage) to completion */
async function opWait(getOp, opRes, what) {
  let op = await opRes.json();
  const deadline = Date.now() + 90000;
  while (op.name && !op.done) {
    if (Date.now() > deadline) throw new Error(`${what} never finished — retry in a minute`);
    await new Promise((r) => setTimeout(r, 2000));
    op = await (await getOp(op.name)).json();
  }
  if (op.error) throw new Error(op.error.message ?? `${what} failed`);
  return op;
}
const fbOpWait = (fb, opRes) => opWait((name) => fb(`/${name}`), opRes, 'the Firebase operation');
const suOpWait = (access, opRes, fetchImpl) => opWait(
  (name) => fetchImpl(`${SU_BASE}/${name}`, { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(20000) }),
  opRes, 'switching the API on',
);

/** turn the bare Cloud project into a Firebase project: API on (a no-op
 * probe of the enable right when it already is), then addFirebase — a
 * freshly switched-on API takes Google a moment to notice */
async function fbAddFirebase(res, fb, access, projectId, clientEmail, apiOff, fetchImpl) {
  const en = await enableService(access, projectId, FB_API, fetchImpl);
  if (!en.ok) {
    res.write(`could not add Firebase: ${await suExplain(en, projectId, clientEmail, FB_API)}\n`);
    return false;
  }
  await suOpWait(access, en, fetchImpl);
  if (apiOff) res.write('Firebase Management API enabled ✓\n');
  const attempt = () => fb(`/projects/${projectId}:addFirebase`, { method: 'POST', body: '{}' });
  let add = await attempt();
  let err = add.ok ? null : await googleError(add);
  for (let left = apiOff ? 12 : 0; left > 0 && err && serviceDisabled(err); left -= 1) {
    if (left === 12) res.write('Google needs a moment to notice the switch — waiting…\n');
    await new Promise((r) => setTimeout(r, 5000));
    add = await attempt();
    err = add.ok ? null : await googleError(add);
  }
  if (err) {
    res.write(`could not add Firebase: ${fbExplain(add.status, err, projectId, clientEmail)}\n`);
    return false;
  }
  await fbOpWait(fb, add);
  res.write(`Firebase enabled on ${projectId} ✓\n`);
  return true;
}

/** get-or-create one Firebase app (android|ios) and return its config */
async function fbEnsureApp(fb, res, projectId, kind, id, label) {
  const coll = kind === 'android' ? 'androidApps' : 'iosApps';
  const field = kind === 'android' ? 'packageName' : 'bundleId';
  const list = async () => (((await (await fb(`/projects/${projectId}/${coll}?pageSize=100`)).json()).apps) ?? []);
  let app = (await list()).find((a) => a[field] === id);
  if (!app) {
    const created = await fb(`/projects/${projectId}/${coll}`, { method: 'POST', body: JSON.stringify({ [field]: id, displayName: label }) });
    if (!created.ok) throw new Error(`registering ${id} failed: ${(await created.text()).slice(0, 300)}`);
    await fbOpWait(fb, created);
    app = (await list()).find((a) => a[field] === id);
    if (!app) throw new Error(`${id} did not appear after registration — retry in a minute`);
    res.write(`  ${id} registered as a Firebase ${kind} app ✓\n`);
  } else {
    res.write(`  ${id} already registered ✓\n`);
    if (app.displayName !== label) {
      // the console chips show the DISPLAY name — the track belongs in it
      // (user 2026-09-08: 'munni prod' is ambiguous beside the nas twins)
      const renamed = await fb(`/projects/${projectId}/${coll}/${app.appId}?updateMask=displayName`, { method: 'PATCH', body: JSON.stringify({ displayName: label }) });
      res.write(renamed.ok ? `  renamed to "${label}" ✓\n` : `  (could not rename it to "${label}" — Firebase answered ${renamed.status}; cosmetic, carrying on)\n`);
    }
  }
  const cfg = await fb(`/projects/${projectId}/${coll}/${app.appId}/config`);
  if (!cfg.ok) throw new Error(`could not fetch ${id}'s config (${cfg.status})`);
  return (await cfg.json()).configFileContents; // base64 of the file
}

/** the env's api must CARRY the sender: re-render + up when its rendered
 * env lacks the credential, then take the api's own word from /health.
 * Found live 2026-09-08: 'stored ✓' printed while the api still ran
 * with an empty Fcm__ServiceAccountJson — friend requests reached the
 * in-app bell, the phone stayed silent (the routing sender reports
 * success for a transport that is not configured). */
async function applySenderToApi(res, stack, clientEmail, spawnImpl, fetchImpl) {
  const envFile = join(renderedDir(stack.stack), `.env.${stack.stack}`);
  if (existsSync(envFile) && readFileSync(envFile, 'utf8').includes(clientEmail)) {
    res.write(`sender: the ${stack.envName} api environment already carries it ✓\n`);
    return true;
  }
  const run = stepRunner(spawnImpl);
  const render = await run(res, `re-render ${stack.envName} with the sender credential`, process.execPath,
    [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', stack.stack], { cwd: ROOT });
  if (render.code !== 0) {
    res.write('the re-render failed — the api keeps running WITHOUT a sender until Set up & start succeeds\n');
    return false;
  }
  const up = await run(res, `restart ${stack.envName} so the api picks the sender up`, 'docker',
    [...composeArgs(stack.stack), 'up', '-d', '--remove-orphans'], { cwd: renderedDir(stack.stack) });
  if (up.code !== 0) {
    res.write('the restart failed — is Docker running? (Set up & start retries it)\n');
    return false;
  }
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const health = await fetchImpl(`${stack.urls.api}/health`, { signal: AbortSignal.timeout(5000) });
      if (health.ok && (await health.json())?.capabilities?.fcm === true) {
        res.write('the api reports native push (fcm) ✓\n');
        return true;
      }
    } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  res.write(`the api did not report fcm within 90 s — check ${stack.urls.api}/health and the api logs\n`);
  return false;
}

/** Firebase console chips show these — the TRACK belongs in the name */
const fbLabel = (stack, kind) => `munni local ${stack.envName} ${kind}`;

async function firebaseSetupEndpoint(req, res, netFetchImpl, spawnImpl) {
  const body = await readBody(req);
  if (!LOCAL_ENVS().length) return json(res, 400, { error: 'no environments exist yet' });
  const stack = loadStack(pickEnv(body.stack));
  const values = familyValues(stack);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.write(`▶ Firebase push for ${stack.envName} — project, app registrations and configs, all as code\n\n`);
  if (!values.PLAY_SERVICE_ACCOUNT_JSON) {
    res.write('the Play service account is not stored yet (Features & accounts) — the SAME credential drives Firebase\n');
    return res.end('[exit 1]\n');
  }
  try {
    const { access, projectId, clientEmail } = await googleAccessToken(values, 'https://www.googleapis.com/auth/cloud-platform', netFetchImpl);
    const fb = fbFetcher(access, netFetchImpl);
    const proj = await fb(`/projects/${projectId}`);
    if (proj.ok) {
      res.write(`Firebase project ${projectId} ✓\n`);
    } else {
      // a bare Cloud project answers 404 here (403 SERVICE_DISABLED while
      // the Management API is off) — adding Firebase to it is exactly the
      // console's "create project" without the console
      const apiOff = Boolean(serviceDisabled(await googleError(proj)));
      res.write(apiOff
        ? `the Firebase Management API is off in ${projectId} — switching it on…\n`
        : `${projectId} is not a Firebase project yet — adding Firebase to it…\n`);
      if (!(await fbAddFirebase(res, fb, access, projectId, clientEmail, apiOff, netFetchImpl))) return res.end('[exit 1]\n');
    }
    await fbEnsureApp(fb, res, projectId, 'android', stack.native.appId, fbLabel(stack, 'android'));
    res.write('  google-services.json ready — the next Android build bakes it in (push active)\n');
    await fbEnsureApp(fb, res, projectId, 'ios', stack.native.iosAppId, fbLabel(stack, 'ios'));
    res.write('  GoogleService-Info.plist ready — the next iOS build bakes it in\n');
    // the API's SENDER credential: same service account, zero extra input
    const shared = loadStack(SHARED_STACK);
    const sharedValues = loadLocalValues(shared);
    if (!sharedValues.NAS_FCM_SERVICE_ACCOUNT_JSON) {
      saveLocalValues(shared, { ...sharedValues, NAS_FCM_SERVICE_ACCOUNT_JSON: values.PLAY_SERVICE_ACCOUNT_JSON });
      res.write('sender credential: the api sends push with the SAME service account — stored ✓\n');
    } else {
      res.write('sender credential: already stored ✓\n');
    }
    if (!(await applySenderToApi(res, stack, clientEmail, spawnImpl, netFetchImpl))) return res.end('[exit 1]\n');
    res.write('\nRemaining manual floor for iOS push only: upload the APNs key once — Firebase console → Project settings → Cloud Messaging → Apple app configuration.\n');
    return res.end('\n[exit 0]\n');
  } catch (e) {
    res.write(`${e.message}\n`);
    return res.end('[exit 1]\n');
  }
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
  // the OPERATOR names the package segment (no black-box numbering);
  // Android and iOS may diverge (user request 2026-09-06: a Play-burned
  // package rolls while the existing ASC record keeps its bundle)
  const platform = body.platform === 'ios' ? 'ios' : 'android';
  const suffix = String(body.suffix ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9]{1,29}$/.test(suffix)) {
    return json(res, 400, { error: 'the package suffix must be 2-30 characters, letters/digits, starting with a letter (like prod2, phone, beta)' });
  }
  if (platform === 'ios') {
    entry.iosSuffix = suffix;
  } else {
    entry.appSuffix = suffix;
    delete entry.appGen; // superseded by the explicit suffix
  }
  saveLocalEnvRegistry(envs);
  const native = loadStack(`munni-local-${name}`).native;
  const newId = platform === 'ios' ? native.iosAppId : native.appId;
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.write(`▶ ${platform === 'ios' ? 'iOS bundle id' : 'store package'} set → ${newId}\n(a previously used package keeps its store records — retire them in the consoles whenever)\n\n`);
  const run = stepRunner(spawnImpl);
  await run(res, `re-render ${name} with the new identity`, process.execPath,
    [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', `munni-local-${name}`], { cwd: ROOT });
  if (platform === 'ios') {
    res.write(`\nNext: the App ID registers itself on the next iOS build; create the App Store Connect record for ${newId} (New App) if it does not exist yet — this page detects it.\n`);
  } else {
    res.write(`\nNext: create the Play record for ${newId} (Play Console → Create app). This page detects it, and the FIRST build uploads itself — signed with the machine keystore, the key that never changes again.\n`);
  }
  return res.end('[exit 0]\n');
}

/* ── Apple App ID as code (user request 2026-08-31: automate the
   identifier + capabilities; only the ASC "New App" record has no
   create-API). Registers bundle app.munni.local.<env> with the
   LONG-RUN capabilities so nothing needs re-provisioning later. ── */
const IOS_CAPABILITIES = [
  ['PUSH_NOTIFICATIONS', 'push notifications (FCM later — tick now, never reprovision)', null],
  // Sign in with Apple only EXISTS with the primary-app consent setting:
  // without it Apple records nothing, keys and Services IDs find "no
  // identifiers available", and the API answers 409 — which the loop
  // used to read as "already enabled" (found live 2026-09-09)
  ['APPLE_ID_AUTH', 'Sign in with Apple as the PRIMARY App ID (keys and Services IDs attach to it)', [{ key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'PRIMARY_APP_CONSENT' }] }]],
  ['ASSOCIATED_DOMAINS', 'associated domains (universal links on the hosted track)', null],
];
const isPrimaryAppleId = (cap) => (cap.attributes?.settings ?? [])
  .some((s) => s.key === 'APPLE_ID_AUTH_APP_CONSENT' && (s.options ?? []).some((o) => o.key === 'PRIMARY_APP_CONSENT'));

async function iosAppIdEndpoint(req, res, fetchImpl) {
  const body = await readBody(req);
  if (!LOCAL_ENVS().length) return json(res, 400, { error: 'no environments exist yet' });
  const stack = loadStack(pickEnv(body.stack));
  const values = familyValues(stack);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  if (!values.ASC_KEY_ID || !values.ASC_ISSUER_ID || !values.ASC_KEY_P8) {
    res.write('the App Store Connect key is not stored yet (Features & accounts) — cannot register the App ID\n');
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
  const bundleId = stack.native.iosAppId;
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
      body: JSON.stringify({ data: { type: 'bundleIds', attributes: { identifier: bundleId, name: `munni local ${stack.envName}`, platform: 'IOS' } } }),
    });
    if (!created.ok) {
      res.write(`could not register ${bundleId} (${created.status}): ${(await created.text()).slice(0, 300)}\n`);
      return res.end('[exit 1]\n');
    }
    record = (await created.json()).data;
    res.write(`App ID ${bundleId} registered ✓\n`);
  }
  // the LIST is the truth about what Apple recorded — a 409 means
  // "already there" OR "entity refused", and only the list tells them apart
  const listCaps = async () => (((await (await asc(`/bundleIds/${record.id}/bundleIdCapabilities`)).json()).data) ?? []);
  let have = await listCaps();
  let ok = true;
  for (const [cap, why, settings] of IOS_CAPABILITIES) {
    const existing = have.find((c) => c.attributes?.capabilityType === cap);
    const complete = (c) => c && (!settings || isPrimaryAppleId(c));
    if (complete(existing)) {
      res.write(`  capability ${cap} ✓ — ${why}\n`);
      continue;
    }
    const attributes = settings ? { capabilityType: cap, settings } : { capabilityType: cap };
    const r = existing
      ? await asc(`/bundleIdCapabilities/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ data: { type: 'bundleIdCapabilities', id: existing.id, attributes } }) })
      : await asc('/bundleIdCapabilities', { method: 'POST', body: JSON.stringify({ data: { type: 'bundleIdCapabilities', attributes, relationships: { bundleId: { data: { type: 'bundleIds', id: record.id } } } } }) });
    if (r.ok) {
      res.write(`  capability ${cap} ${existing ? 'completed' : 'enabled'} ✓ — ${why}\n`);
      continue;
    }
    const detail = (await r.text().catch(() => '')).slice(0, 200);
    have = await listCaps();
    if (complete(have.find((c) => c.attributes?.capabilityType === cap))) {
      res.write(`  capability ${cap} ✓ — ${why}\n`);
    } else {
      ok = false;
      res.write(`  capability ${cap} NOT enabled (Apple answered ${r.status}${detail ? `: ${detail}` : ''}) — by hand: developer.apple.com → Identifiers → ${bundleId}${settings ? ' → Sign in with Apple → Configure → Enable as a primary App ID' : ''}\n`);
    }
  }
  res.write(`\nRemaining one-time (no API exists): App Store Connect → New App → pick ${bundleId} from the bundle-id dropdown. The APNs SSL certificate dialog is the LEGACY push path — never create those; push will use the team APNs key via Firebase.\n`);
  return res.end(`[exit ${ok ? 0 : 1}]\n`);
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
    // the AUTHORITATIVE package ids (carry the store-package choices —
    // the workflows must not re-derive them from the env name alone);
    // Android and iOS may diverge (Play burns package names, ASC not)
    NATIVE_LOCAL_APP_ID: stack.native.appId,
    NATIVE_LOCAL_APP_ID_IOS: stack.native.iosAppId,
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
  // Firebase configs ride along when the apps are REGISTERED (the build
  // flows run firebase-setup first; this only reads — never creates).
  // Absent configs are not blocking: the stub keeps builds green with
  // push inactive, and the wizard's push pill names the reason.
  if (values.PLAY_SERVICE_ACCOUNT_JSON) {
    try {
      const { access, projectId } = await googleAccessToken(values, 'https://www.googleapis.com/auth/cloud-platform', fetchImpl);
      const fb = fbFetcher(access, fetchImpl);
      const aList = ((await (await fb(`/projects/${projectId}/androidApps?pageSize=100`)).json()).apps) ?? [];
      const aApp = aList.find((a) => a.packageName === stack.native.appId);
      if (aApp) {
        const cfg = await fb(`/projects/${projectId}/androidApps/${aApp.appId}/config`);
        if (cfg.ok) variables.NATIVE_GOOGLE_SERVICES_B64 = (await cfg.json()).configFileContents;
      }
      const iList = ((await (await fb(`/projects/${projectId}/iosApps?pageSize=100`)).json()).apps) ?? [];
      const iApp = iList.find((a) => a.bundleId === stack.native.iosAppId);
      if (iApp) {
        const cfg = await fb(`/projects/${projectId}/iosApps/${iApp.appId}/config`);
        if (cfg.ok) variables.NATIVE_IOS_FIREBASE_PLIST_B64 = (await cfg.json()).configFileContents;
      }
    } catch { /* push stays stubbed — firebase-setup names the reason */ }
  }
  return json(res, 200, {
    environment: 'local',
    localEnv: stack.envName,
    appId: stack.native.appId,
    iosAppId: stack.native.iosAppId,
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
 * The LAN marker and the shared RENDER die too (user report 2026-09-04:
 * their leftovers kept the https pill and the Delete button armed after
 * a wipe) — only the machine-owned survivors stay: the step-3
 * credential store and the upload keystore's reset certificate. */
const NUKE_SURVIVORS = ['.secrets.local.json', 'upload-cert.pem'];
function envsForgetAllEndpoint(res) {
  const names = localEnvRegistry().map((e) => e.name);
  for (const name of names) {
    rmSync(renderedDir(`munni-local-${name}`), { recursive: true, force: true });
  }
  saveLocalEnvRegistry([]);
  rmSync(LAN_FILE(), { force: true });
  const sharedDir = renderedDir(SHARED_STACK);
  if (existsSync(sharedDir)) {
    for (const f of readdirSync(sharedDir)) {
      if (!NUKE_SURVIVORS.includes(f)) rmSync(join(sharedDir, f), { recursive: true, force: true });
    }
  }
  return json(res, 200, { forgotten: names, kept: NUKE_SURVIVORS.filter((f) => existsSync(join(sharedDir, f))) });
}

/** post-wipe verification (user request 2026-09-04): name what is STILL
 * there, so the wizard can honestly retire the Delete button — or keep
 * it armed with the leftovers listed. Docker resources are matched by
 * their compose PROJECT (family projects are munni-local-<something>;
 * the from-source dev loop's project is exactly `munni-local` and
 * munni-sonar is different tooling — neither counts). */
async function cleanupCheckEndpoint(res, spawnImpl) {
  const dockerLines = (args) => new Promise((resolve) => {
    const c = spawnImpl('docker', args, { shell: false });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr?.on?.('data', () => {});
    c.on('error', () => resolve(null));
    c.on('close', (code) => resolve(code === 0 ? out.split('\n').map((s) => s.trim()).filter(Boolean) : null));
  });
  const [containers, volumes, networks] = await Promise.all([
    dockerLines(['ps', '-a', '--format', '{{.Names}}\t{{.Label "com.docker.compose.project"}}']),
    dockerLines(['volume', 'ls', '--format', '{{.Name}}']),
    dockerLines(['network', 'ls', '--format', '{{.Name}}']),
  ]);
  const leftovers = [];
  if (!containers || !volumes || !networks) leftovers.push('docker did not answer — containers/volumes could not be verified');
  for (const line of containers ?? []) {
    const [name, project] = line.split('\t');
    if (project?.startsWith('munni-local-')) leftovers.push(`container ${name}`);
  }
  for (const n of volumes ?? []) if (n.startsWith('munni-local-')) leftovers.push(`volume ${n}`);
  for (const n of networks ?? []) if (n.startsWith('munni-local-')) leftovers.push(`network ${n}`);
  for (const e of localEnvRegistry()) leftovers.push(`registry entry ${e.name}`);
  const base = dirname(LAN_FILE());
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      if (!d.startsWith('munni-local-')) continue;
      if (d === SHARED_STACK) {
        for (const f of readdirSync(renderedDir(SHARED_STACK))) {
          if (!NUKE_SURVIVORS.includes(f)) leftovers.push(`shared render file ${f}`);
        }
      } else {
        leftovers.push(`rendered folder ${d}`);
      }
    }
  }
  if (existsSync(LAN_FILE())) leftovers.push('LAN marker (https mode)');
  const kept = [];
  if (existsSync(join(renderedDir(SHARED_STACK), '.secrets.local.json'))) kept.push('the step-3 credential store');
  if (existsSync(join(renderedDir(SHARED_STACK), 'upload-cert.pem'))) kept.push('the upload keystore certificate');
  return json(res, 200, { clean: leftovers.length === 0, leftovers, kept });
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
  res.write(`what CANNOT be deleted by API: the STORE RECORDS for its app.munni.local.* package (the wizard's retire option withdraws the distribution — the records themselves go by hand in the consoles) and any GitHub environment "local" variables still pointing at it (overwritten by the next native build)\n`);
  return res.end('\n[exit 0]\n');
}

/** persist the GitHub PAT like every other step-3 credential (user
 * request 2026-09-06: no re-pasting on every visit). Saved into the
 * shared machine store; the wizard reads it back and reconnects itself
 * on the next load. */
async function ghPatEndpoint(req, res) {
  const body = await readBody(req);
  const pat = String(body.pat ?? '').trim();
  if (!pat) return json(res, 400, { error: 'no token given' });
  const shared = loadStack(SHARED_STACK);
  saveLocalValues(shared, { ...loadLocalValues(shared), IAC_GH_PAT: pat });
  return json(res, 200, { ok: true });
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
  APPLE_DEV_CERT_P12: 'The machine’s persistent Apple Development certificate (.p12, base64) — CI imports it instead of minting a throwaway one per build (no more “certificate revoked” mails).',
  APPLE_DEV_CERT_PASSWORD: 'Password of that .p12 — minted here before the certificate; the mint workflow encrypts with it.',
  APPLE_DEV_CERT_SERIAL: 'Serial of that certificate — the wizard asks Apple by serial whether it is still valid before each iOS build.',
  LOGTO_APPLE_CLIENT_ID: 'Apple Services ID for “Sign in with Apple”.',
  VAULT_SIGNUPS_ALLOWED: 'Wizard bookkeeping: whether this vault still accepts registrations (closed after setup).',
  PLAY_SERVICE_ACCOUNT_JSON: 'Google Play service account (whole JSON file) — CI publishes builds with it; the wizard also uses it to detect when a store app exists.',
  ANDROID_KEYSTORE_BASE64: 'The upload keystore (base64) every Android build signs with — minted ONCE by the wizard and kept here because Play pins the first upload key forever; it must outlive any repo.',
  ANDROID_KEYSTORE_PASSWORD: 'Password of the upload keystore (wizard-generated).',
  ANDROID_KEY_ALIAS: 'Key alias inside the upload keystore (munni-upload).',
  ANDROID_KEY_PASSWORD: 'Key password inside the upload keystore (same as the store password).',
  IAC_GH_PAT: 'Fine-grained GitHub token the wizard connects and dispatches CI builds with — saved so the GitHub card reconnects by itself.',
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
  // also re-verifies values stored earlier — via pickStack, so a
  // registry with no environments (mid delete/recreate) still reads
  // the surviving SHARED store instead of throwing on a phantom env
  const values = { ...familyValues(loadStack(pickStack(body.stack))) };
  for (const [name, value] of Object.entries(body.values ?? {})) {
    if (VALIDATABLE_NAMES.has(name) && typeof value === 'string' && value) values[name] = value;
  }
  // the sign-in callbacks the page wants judged alongside the credentials
  // (Google/Apple answer a redirect check without a user)
  const redirectUris = (Array.isArray(body.redirectUris) ? body.redirectUris : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(u))
    .slice(0, 12);
  // the family's app bundle ids — an App ID pasted as Apple client id is
  // the classic mix-up, and only the helper knows the ids to compare
  const iosAppIds = [...new Set(['app.munni', 'app.munni.dev', ...LOCAL_ENVS().map((name) => loadStack(name).native?.iosAppId).filter(Boolean)])];
  return json(res, 200, await validateImpl(String(body.provider ?? ''), values, { redirectUris, iosAppIds }));
}

function serveHtml(res, token) {
  const html = readFileSync(HTML, 'utf8').replace(
    '</head>',
    `<script>window.__SETUP_HELPER__={token:${JSON.stringify(token)}};</script></head>`,
  );
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(html);
}

/* ── the MACHINE owns the Apple Development certificate (same ruling as
   the upload keystore; user report 2026-09-08: every local iOS build
   minted a throwaway cert and pruned the older ones — each prune an
   Apple "certificate revoked" email). Minted ONCE by the repo's
   mint-apple-cert workflow (a macOS runner: its p12s import cleanly),
   pulled back here from the run artifact, shipped into every repo's
   environment local by the wizard before an iOS build. ── */
const APPLE_CERT_ARTIFACT = 'apple-dev-cert-p12';
const APPLE_CERT_FILE = 'APPLE_DEV_CERT_P12.b64';
const APPLE_CERT_SERIAL_FILE = 'APPLE_DEV_CERT_SERIAL.txt';
const normSerial = (s) => String(s ?? '').trim().toUpperCase().replace(/^0+/, '');

/** does Apple still list the machine's certificate? A revoked or expired
 *  p12 imports without a word and CI would mint throwaways until Apple's
 *  cap (2026-09-09: the wizard's first mint had wiped the hosted track's
 *  certificate; ten piled up in a day) — matched by serial */
async function appleCertAtApple(values, fetchImpl) {
  if (!values.APPLE_DEV_CERT_SERIAL) return { state: 'unknown' }; // imported before the mint recorded serials
  if (!values.ASC_KEY_ID || !values.ASC_ISSUER_ID || !values.ASC_KEY_P8) return { state: 'no-creds' };
  try {
    const res = await fetchImpl('https://api.appstoreconnect.apple.com/v1/certificates?filter%5BcertificateType%5D=DEVELOPMENT,IOS_DEVELOPMENT&limit=200', {
      headers: { authorization: `Bearer ${ascJwt(values)}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { state: 'error', detail: `App Store Connect answered ${res.status}` };
    const want = normSerial(values.APPLE_DEV_CERT_SERIAL);
    const hit = ((await res.json()).data ?? []).find((c) => normSerial(c.attributes?.serialNumber) === want);
    if (!hit) return { state: 'missing' };
    const expires = hit.attributes.expirationDate;
    if (new Date(expires).getTime() < Date.now()) return { state: 'expired', expires };
    return { state: 'valid', expires, id: hit.id };
  } catch (e) {
    return { state: 'error', detail: e.message };
  }
}

async function appleCertStatusEndpoint(res, fetchImpl) {
  const v = loadLocalValues(loadStack(SHARED_STACK));
  const out = { present: Boolean(v.APPLE_DEV_CERT_P12 && v.APPLE_DEV_CERT_PASSWORD), password: Boolean(v.APPLE_DEV_CERT_PASSWORD) };
  if (v.APPLE_DEV_CERT_SERIAL) out.serial = v.APPLE_DEV_CERT_SERIAL;
  if (out.present) out.apple = await appleCertAtApple(v, fetchImpl);
  return json(res, 200, out);
}

/** Apple revoked or expired the machine's certificate: drop it so the
 *  next iOS build mints again (the wizard calls this by itself) */
function appleCertForgetEndpoint(res) {
  const shared = loadStack(SHARED_STACK);
  const next = { ...loadLocalValues(shared) };
  delete next.APPLE_DEV_CERT_P12;
  delete next.APPLE_DEV_CERT_SERIAL;
  saveLocalValues(shared, next);
  return json(res, 200, { ok: true });
}

/** the p12 password is minted HERE first — the mint workflow encrypts with it */
function appleCertPasswordEndpoint(res) {
  const shared = loadStack(SHARED_STACK);
  const v = loadLocalValues(shared);
  if (!v.APPLE_DEV_CERT_PASSWORD) saveLocalValues(shared, { ...v, APPLE_DEV_CERT_PASSWORD: randomBytes(24).toString('hex') });
  return json(res, 200, { ok: true });
}

/** pull the minted p12 out of the workflow run's artifact into the store */
async function appleCertImportEndpoint(req, res, netFetchImpl) {
  const body = await readBody(req);
  const slug = String(body.slug ?? '');
  const runId = Number(body.runId);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug) || !Number.isInteger(runId) || runId <= 0) {
    res.write('need the repo slug and the mint run id\n');
    return res.end('[exit 1]\n');
  }
  const shared = loadStack(SHARED_STACK);
  const values = loadLocalValues(shared);
  if (!values.IAC_GH_PAT) {
    res.write('no GitHub token in the machine store — press Store as IAC_GH_PAT on the GitHub tile first\n');
    return res.end('[exit 1]\n');
  }
  const api = (path, init = {}) => netFetchImpl(`https://api.github.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${values.IAC_GH_PAT}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...init.headers },
    signal: AbortSignal.timeout(30000),
  });
  try {
    const list = await api(`/repos/${slug}/actions/runs/${runId}/artifacts`);
    if (!list.ok) throw new Error(`GitHub answered ${list.status} listing the run's artifacts`);
    const art = ((await list.json()).artifacts ?? []).find((a) => a.name === APPLE_CERT_ARTIFACT);
    if (!art) throw new Error(`run ${runId} carries no ${APPLE_CERT_ARTIFACT} artifact — did the mint job fail? (its Preflight names the missing secret)`);
    // the archive url 302s to blob storage, which refuses a forwarded
    // Authorization header — hop by hand
    const hop = await api(`/repos/${slug}/actions/artifacts/${art.id}/zip`, { redirect: 'manual' });
    const location = hop.headers?.get?.('location');
    const zipRes = location ? await netFetchImpl(location, { signal: AbortSignal.timeout(60000) }) : hop;
    if (!zipRes.ok) throw new Error(`artifact download failed (${zipRes.status})`);
    const zip = Buffer.from(await zipRes.arrayBuffer());
    const b64 = zipEntry(zip, APPLE_CERT_FILE).toString('utf8').trim();
    if (!/^[A-Za-z0-9+/=]{100,}$/.test(b64)) throw new Error('the artifact does not look like a base64 p12');
    // the serial rides along since 2026-09-09 (older mints: none → the
    // validity check reports unknown; CI's own check still guards)
    const serial = zipNames(zip).includes(APPLE_CERT_SERIAL_FILE) ? normSerial(zipEntry(zip, APPLE_CERT_SERIAL_FILE).toString('utf8')) : '';
    const next = { ...loadLocalValues(shared), APPLE_DEV_CERT_P12: b64 };
    delete next.APPLE_DEV_CERT_SERIAL;
    if (serial) next.APPLE_DEV_CERT_SERIAL = serial;
    saveLocalValues(shared, next);
    res.write(`Apple Development certificate stored in the machine store ✓${serial ? ` (serial ${serial})` : ''} — every repo's iOS builds sign with it from now on (the whole Apple team shares this one certificate); nothing gets minted or revoked anymore. Apple expires it after a year — the wizard notices and mints again by itself\n`);
    return res.end('[exit 0]\n');
  } catch (e) {
    res.write(`${e.message}\n`);
    return res.end('[exit 1]\n');
  }
}

/* ── keeps itself up to date (user ruling 2026-09-08: the wizard is a
   ONE-TIME bootstrap — afterwards CI/CD must update everything). The NAS
   pulls a bundle through the DSM poller; a PC cannot be pushed to
   either, so the helper IS the poller: fetch this checkout's branch,
   fast-forward when the tree is clean, re-render every stack after a
   pull, pull the (mutable channel) images, bring the family up, and
   restart itself once its own code moved. Nothing is pushed here. ── */
const AUTONOMY_TASK = 'munni local helper';
const AUTONOMY_MIN_MINUTES = 2;
let autonomyRunning = false;
let autonomyLastLog = '';
let autonomyTimer = null;
let autonomyDeps = null; // set by main only — tests never arm timers
let autonomyNextAt = null;

/** run a command quietly and hand back its output */
const capture = (spawnImpl, cmd, args, opts = {}) => stepRunner(spawnImpl)({ write() {} }, '', cmd, args, opts);

async function autonomyCycle(res, spawnImpl, restartImpl) {
  const log = { text: '' };
  const out = { write(s) { log.text = (log.text + String(s)).slice(-20000); res?.write(s); } };
  if (autonomyRunning) {
    out.write('an update check is already running\n');
    return { code: 1 };
  }
  autonomyRunning = true;
  const run = stepRunner(spawnImpl);
  const git = (label, args) => run(out, label, 'git', args, { cwd: ROOT });
  const result = { at: new Date().toISOString(), branch: null, pulled: false, paused: null, changed: [], failed: [] };
  try {
    result.branch = (await git('which branch does this checkout follow?', ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim() || 'HEAD';
    const dirty = (await git('uncommitted changes?', ['status', '--porcelain', '--untracked-files=no'])).out.trim();
    const fetched = await git(`fetch origin/${result.branch}`, ['fetch', '--quiet', 'origin', result.branch]);
    if (fetched.code !== 0) {
      result.paused = 'origin unreachable (offline?) — images still update';
    } else {
      const behind = Number((await git('commits behind origin', ['rev-list', '--count', `HEAD..origin/${result.branch}`])).out.trim()) || 0;
      if (behind && dirty) {
        result.paused = `${behind} new commit(s) on origin/${result.branch}, but this checkout has uncommitted changes (${dirty.split('\n').length} file(s)) — the pull waits for a clean tree; images still update`;
      } else if (behind) {
        const pull = await git(`pull ${behind} commit(s) (fast-forward only)`, ['pull', '--ff-only', '--quiet', 'origin', result.branch]);
        if (pull.code === 0) result.pulled = true;
        else result.paused = 'the pull failed (diverged history?) — fix it by hand, images still update';
      } else {
        out.write(`up to date with origin/${result.branch}\n`);
      }
    }
    for (const name of LOCAL_STACKS()) {
      if (!existsSync(join(renderedDir(name), `.env.${name}`))) {
        out.write(`${name}: not set up yet — skipped\n`);
        continue;
      }
      if (result.pulled) {
        // templates only change through a pull — re-render from the store then
        const render = await run(out, `re-render ${name}`, process.execPath, [join(ROOT, 'infra', 'bootstrap.mjs'), '--stack', name], { cwd: ROOT });
        if (render.code !== 0) {
          result.failed.push(`${name} (render)`);
          continue;
        }
      }
      const pull = await run(out, `pull ${name}'s images (channel tags move)`, 'docker', [...composeArgs(name), 'pull', '--quiet'], { cwd: renderedDir(name) });
      if (pull.code !== 0) result.failed.push(`${name} (image pull)`);
      const up = await run(out, `bring ${name} up`, 'docker', [...composeArgs(name), 'up', '-d', '--remove-orphans'], { cwd: renderedDir(name) });
      if (up.code !== 0) result.failed.push(`${name} (up)`);
      for (const m of up.out.matchAll(/Container (\S+)\s+(?:Recreated|Started)/g)) {
        if (!result.changed.includes(m[1])) result.changed.push(m[1]);
      }
    }
    saveAutonomy({ ...loadAutonomy(), lastCheckAt: result.at, lastResult: result });
    const verdict = [
      result.paused ? `paused: ${result.paused}` : (result.pulled ? 'code pulled' : 'code unchanged'),
      result.changed.length ? `restarted: ${result.changed.join(', ')}` : 'containers unchanged',
      ...(result.failed.length ? [`FAILED: ${result.failed.join(', ')}`] : []),
    ].join('; ');
    out.write(`\n${verdict}\n`);
    if (result.pulled && restartImpl) {
      out.write('the helper restarts itself to run the new code — reload this page in a few seconds\n');
      setTimeout(restartImpl, 1500);
    }
    return { code: result.failed.length ? 1 : 0, result };
  } finally {
    autonomyLastLog = log.text;
    autonomyRunning = false;
  }
}

function rearmAutonomy() {
  if (!autonomyDeps) return;
  clearInterval(autonomyTimer);
  autonomyTimer = null;
  autonomyNextAt = null;
  const state = loadAutonomy();
  if (!state.enabled) return;
  const every = Math.max(AUTONOMY_MIN_MINUTES, Number(state.intervalMinutes) || 10) * 60000;
  const tick = () => {
    autonomyNextAt = new Date(Date.now() + every).toISOString();
    return autonomyCycle(null, autonomyDeps.spawnImpl, autonomyDeps.restartImpl).catch(() => {});
  };
  autonomyTimer = setInterval(tick, every);
  autonomyTimer.unref?.();
  // a logon start (or turning it on) applies what landed meanwhile soon,
  // not a full interval later
  setTimeout(tick, 45000).unref?.();
  autonomyNextAt = new Date(Date.now() + 45000).toISOString();
}

/** main hands the real spawn + the self-restart in; tests never call this */
export function armAutonomy(deps) {
  autonomyDeps = deps;
  rearmAutonomy();
}

// Task Scheduler through the built-in PowerShell module: schtasks.exe
// refuses an ONLOGON trigger without elevation ("Access is denied",
// found live 2026-09-08), Register-ScheduledTask registers a task for
// the current user's own logon as a plain user
const PS = 'powershell.exe';
const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script];
const taskExists = async (spawnImpl) => process.platform === 'win32'
  ? (await capture(spawnImpl, PS, psArgs(`Get-ScheduledTask -TaskName '${AUTONOMY_TASK}' -ErrorAction Stop | Out-Null`), { cwd: ROOT })).code === 0
  : null;

async function autonomyStatusEndpoint(res, spawnImpl) {
  const state = loadAutonomy();
  const branch = (await capture(spawnImpl, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT })).out.trim() || null;
  return json(res, 200, {
    ...state,
    running: autonomyRunning,
    armed: Boolean(autonomyTimer),
    nextCheckAt: autonomyNextAt,
    logonTask: await taskExists(spawnImpl),
    branch,
    checkout: ROOT,
    lastLog: autonomyLastLog.slice(-4000),
  });
}

async function autonomySetEndpoint(req, res) {
  const body = await readBody(req);
  const state = loadAutonomy();
  if (typeof body.enabled === 'boolean') state.enabled = body.enabled;
  if (Number.isFinite(Number(body.intervalMinutes)) && Number(body.intervalMinutes) >= AUTONOMY_MIN_MINUTES) state.intervalMinutes = Math.round(Number(body.intervalMinutes));
  saveAutonomy(state);
  rearmAutonomy();
  return json(res, 200, { ...state, armed: Boolean(autonomyTimer), nextCheckAt: autonomyNextAt });
}

async function autonomyRunEndpoint(res, spawnImpl, restartImpl) {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  const { code } = await autonomyCycle(res, spawnImpl, restartImpl);
  return res.end(`\n[exit ${code}]\n`);
}

/** Task Scheduler (built-in, current user, no admin): the helper starts
 * at every logon from autonomy.cmd — minimized, no browser tab */
async function autonomyLogonEndpoint(req, res, spawnImpl) {
  const body = await readBody(req);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  if (process.platform !== 'win32') {
    res.write('the logon task is Windows-only (Task Scheduler) — on macOS/Linux start the helper from a login item or a user service\n');
    return res.end('[exit 1]\n');
  }
  const run = stepRunner(spawnImpl);
  if (body.install === false) {
    const del = await run(res, 'remove the logon task', PS, psArgs(`Unregister-ScheduledTask -TaskName '${AUTONOMY_TASK}' -Confirm:$false -ErrorAction Stop`), { cwd: ROOT });
    if (del.code === 0) res.write('the helper no longer starts at logon (a running one keeps running until you close it)\n');
    return res.end(`\n[exit ${del.code === 0 ? 0 : 1}]\n`);
  }
  const cmdFile = join(DIR, 'autonomy.cmd').replaceAll("'", "''");
  const script = [
    '$t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME',
    `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c start /min ' + [char]34 + 'munni helper' + [char]34 + ' ' + [char]34 + '${cmdFile}' + [char]34)`,
    '$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited',
    `Register-ScheduledTask -TaskName '${AUTONOMY_TASK}' -Trigger $t -Action $a -Principal $p -Force -ErrorAction Stop | Out-Null`,
    "'registered'",
  ].join('; ');
  const create = await run(res, 'register the logon task (Task Scheduler, current user, no admin needed)', PS, psArgs(script), { cwd: ROOT });
  if (create.code !== 0) {
    res.write('registering failed — open Task Scheduler once to see whether tasks may be created for this user\n');
    return res.end('[exit 1]\n');
  }
  res.write(`the helper now starts at every logon from ${cmdFile} (minimized window, no browser tab) — with automatic updates on it keeps the family current by itself\n`);
  return res.end('[exit 0]\n');
}

/** build the handler; spawn/probe/validate deps injectable for tests */
export function createApp({ token, probeImpl = probe, runImpl = runToStream, validateImpl = validate, spawnImpl = spawn, vaultFetchImpl = insecureFetch, netFetchImpl = localAwareFetch, restartImpl = null } = {}) {
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
    'GET /api/local/cleanup-check': (req, res) => cleanupCheckEndpoint(res, spawnImpl),
    'POST /api/local/store-retire': (req, res) => storeRetireEndpoint(req, res, netFetchImpl),
    'GET /api/local/store-status': (req, res) => storeStatusEndpoint(res, new URL(req.url, 'http://localhost'), netFetchImpl),
    'POST /api/local/firebase-setup': (req, res) => firebaseSetupEndpoint(req, res, netFetchImpl, spawnImpl),
    'POST /api/local/ios-appid': (req, res) => iosAppIdEndpoint(req, res, netFetchImpl),
    'POST /api/local/mint-keystore': (req, res) => mintKeystoreEndpoint(req, res, spawnImpl),
    'GET /api/local/apple-cert': (req, res) => appleCertStatusEndpoint(res, netFetchImpl),
    'POST /api/local/apple-cert/password': (req, res) => appleCertPasswordEndpoint(res),
    'POST /api/local/apple-cert/forget': (req, res) => appleCertForgetEndpoint(res),
    'POST /api/local/apple-cert/import': (req, res) => appleCertImportEndpoint(req, res, netFetchImpl),
    'GET /api/local/autonomy': (req, res) => autonomyStatusEndpoint(res, spawnImpl),
    'POST /api/local/autonomy': (req, res) => autonomySetEndpoint(req, res),
    'POST /api/local/autonomy/run': (req, res) => autonomyRunEndpoint(res, spawnImpl, restartImpl),
    'POST /api/local/autonomy/logon': (req, res) => autonomyLogonEndpoint(req, res, spawnImpl),
    'POST /api/local/new-store-package': (req, res) => newStorePackageEndpoint(req, res, spawnImpl),
    'POST /api/local/trust-ca': (req, res) => trustCaEndpoint(res, spawnImpl, netFetchImpl),
    'GET /api/local/ca-trust': (req, res) => caTrustEndpoint(res, new URL(req.url, 'http://localhost'), netFetchImpl, spawnImpl),
    'GET /api/local/registry': (req, res) => registryEndpoint(res, new URL(req.url, 'http://localhost'), netFetchImpl),
    'GET /api/local/nas-probe': (req, res) => nasProbeEndpoint(res, new URL(req.url, 'http://localhost'), netFetchImpl, vaultFetchImpl),
    'POST /api/local/gh-pat': (req, res) => ghPatEndpoint(req, res),
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

/** hand over to a fresh process running the just-pulled code: stop
 * listening first (the double-start guard would otherwise see THIS
 * helper and exit the new one), let the event loop drain, and fall back
 * to a hard exit only if something keeps it alive */
function restartHelper(server) {
  clearInterval(autonomyTimer);
  autonomyTimer = null;
  server.close();
  server.closeAllConnections?.();
  spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    env: { ...process.env, SETUP_NO_OPEN: '1', SETUP_RESTART_WAIT: '1500' },
  }).unref();
  setTimeout(() => process.exit(0), 3000).unref();
}

function startHelper(port, attemptsLeft) {
  const token = randomBytes(16).toString('hex');
  let server = null;
  server = createServer(createApp({ token, restartImpl: () => restartHelper(server) }));
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
    armAutonomy({ spawnImpl: spawn, restartImpl: () => restartHelper(server) });
    if (loadAutonomy().enabled) console.log('automatic updates are ON — this helper keeps the local family current by itself');
  });
}

if (isMain) {
  // a self-restart waits for its predecessor to let go of the port
  setTimeout(() => startHelper(Number(process.env.SETUP_PORT ?? 8377), 3), Number(process.env.SETUP_RESTART_WAIT ?? 0));
}
