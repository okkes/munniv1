// The setup wizard's local helper over the three-stack family: token
// gate, host gate, the fixed per-stack tool allowlist, stack routing,
// and the operator-name filter on env passed to bootstrap.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';

const SCRATCH = mkdtempSync(join(tmpdir(), 'munni-serve-test-'));
process.env.MUNNI_RENDER_DIR = SCRATCH;
// no registry file = no environments now — seed the classic prod+dev pair
(await import('node:fs')).writeFileSync(join(SCRATCH, 'local-envs.json'), JSON.stringify({ envs: [
  { name: 'prod', channel: 'dev', slot: 0 },
  { name: 'dev', channel: 'dev', slot: 1 },
] }));
const { createApp, lanCandidates, OPERATOR_NAMES, toolFor, LOCAL_STACKS } = await import('../setup/serve.mjs');
const { loadLocalValues, saveLocalValues } = await import('../modules/localstore.mjs');
const { loadStack } = await import('../modules/stack.mjs');

test.after(() => rmSync(SCRATCH, { recursive: true, force: true }));

function fakeRes() {
  const res = { statusCode: 0, headers: null, chunks: [], ended: false };
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; };
  res.write = (c) => res.chunks.push(String(c));
  res.end = (c) => { if (c) res.chunks.push(String(c)); res.ended = true; };
  return res;
}
const fakeReq = ({ method = 'GET', url = '/', host = '127.0.0.1:8377', token, body } = {}) => {
  const listeners = {};
  return {
    method,
    url,
    headers: { host, ...(token ? { 'x-setup-token': token } : {}) },
    on(event, cb) {
      listeners[event] = cb;
      if (event === 'end') {
        if (body !== undefined) listeners.data?.(JSON.stringify(body));
        cb();
      }
      return this;
    },
  };
};

const runs = [];
const validations = [];
const app = createApp({
  token: 'tok',
  probeImpl: async () => false,
  runImpl: (res, cmd, args, opts) => { runs.push({ cmd, args, opts }); res.writeHead(200, {}); res.end('[exit 0]\n'); },
  validateImpl: async (provider, values) => { validations.push({ provider, values }); return { ok: true, detail: 'fake' }; },
});

/** fake child-process factory for the multi-step endpoints */
const scriptedSpawn = (spawned, outputFor) => (cmd, args, opts) => {
  spawned.push({ cmd, args, opts });
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    child.stdout.emit('data', outputFor(spawned.length, args));
    child.emit('close', 0);
  });
  return child;
};
const settle = async (res) => { for (let i = 0; i < 50 && !res.ended; i++) await new Promise((r) => setTimeout(r, 10)); };

test('api calls without the token are rejected; bad hosts are rejected outright', async () => {
  const noToken = fakeRes();
  await app(fakeReq({ url: '/api/local/status' }), noToken);
  assert.equal(noToken.statusCode, 401);
  const badHost = fakeRes();
  await app(fakeReq({ url: '/api/local/status', host: 'evil.example', token: 'tok' }), badHost);
  assert.equal(badHost.statusCode, 403);
});

test('the served page carries the helper token; file paths outside / are 404', async () => {
  const page = fakeRes();
  await app(fakeReq({ url: '/' }), page);
  assert.equal(page.statusCode, 200);
  assert.match(page.chunks.join(''), /__SETUP_HELPER__=\{token:"tok"\}/);
  const other = fakeRes();
  await app(fakeReq({ url: '/etc/passwd' }), other);
  assert.equal(other.statusCode, 404);
});

test('run routes to the requested stack and passes ONLY manifest operator names as env', async () => {
  runs.length = 0;
  const res = fakeRes();
  await app(fakeReq({
    method: 'POST', url: '/api/local/run', token: 'tok',
    body: { values: { NAS_GHCR_PAT: 'ghp_x', PATH: 'evil', LD_PRELOAD: 'evil', NOT_A_SECRET: 'x', IAC_DOMAIN: 'nas-only' } },
  }), res);
  assert.equal(runs.length, 1);
  const { cmd, args, opts } = runs[0];
  assert.equal(cmd, process.execPath);
  assert.ok(args.join(' ').includes('bootstrap.mjs --stack munni-local-prod'), 'prod is the default stack');
  assert.equal(opts.env.NAS_GHCR_PAT, 'ghp_x');
  assert.notEqual(opts.env.PATH, 'evil');
  assert.equal(opts.env.NOT_A_SECRET, undefined);
  // platform-nas operator roots are not local operator names
  assert.ok(!OPERATOR_NAMES.has('IAC_DOMAIN'));
  assert.equal(opts.env.IAC_DOMAIN, process.env.IAC_DOMAIN);

  runs.length = 0;
  await app(fakeReq({ method: 'POST', url: '/api/local/run', token: 'tok', body: { stack: 'munni-local-shared' } }), fakeRes());
  assert.ok(runs[0].args.join(' ').includes('--stack munni-local-shared'));
  runs.length = 0;
  await app(fakeReq({ method: 'POST', url: '/api/local/run', token: 'tok', body: { stack: '../evil' } }), fakeRes());
  assert.ok(runs[0].args.join(' ').includes('--stack munni-local-prod'), 'unknown stacks fall back to prod');
});

test('verify flag appends --verify', async () => {
  runs.length = 0;
  const res = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/run', token: 'tok', body: { verify: true } }), res);
  assert.ok(runs[0].args.includes('--verify'));
});

test('tools run only from the fixed per-stack allowlist', async () => {
  runs.length = 0;
  const bad = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/tool', token: 'tok', body: { tool: 'rm -rf /' } }), bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(runs.length, 0);
  const good = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/tool', token: 'tok', body: { tool: 'munni-local-shared:up' } }), good);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].args.slice(-3), ['up', '-d', '--remove-orphans']);
  assert.ok(runs[0].args.join(' ').includes('docker-compose.munni-local-shared.yml'));
  // every family stack resolves up/down/destroy; devsource covers the
  // from-source dev flow; anything else refuses
  for (const name of LOCAL_STACKS()) {
    for (const verb of ['up', 'down', 'destroy']) {
      const tool = toolFor(`${name}:${verb}`);
      assert.ok(tool, `${name}:${verb} missing`);
      assert.equal(tool.cmd, 'docker');
    }
  }
  assert.ok(toolFor('devsource:up'));
  assert.equal(toolFor('munni-local-ghost:up'), null, 'unknown stacks refuse');
  assert.equal(toolFor('munni-local-prod:exec'), null, 'unknown verbs refuse');
});

test('validate passes only manifest operator names through, merged over the store', async () => {
  validations.length = 0;
  const res = fakeRes();
  await app(fakeReq({
    method: 'POST', url: '/api/validate', token: 'tok',
    body: { provider: 'gocardless', values: { NAS_GOCARDLESS_SECRET_ID: 'id1', PATH: 'evil', RANDOM: 'x', SYNOLOGY_URL: 'https://nas:5001' } },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(validations.length, 1);
  assert.equal(validations[0].provider, 'gocardless');
  assert.equal(validations[0].values.NAS_GOCARDLESS_SECRET_ID, 'id1');
  // SYNOLOGY_* are operator names (NAS platform) — allowed for validation
  assert.equal(validations[0].values.SYNOLOGY_URL, 'https://nas:5001');
  assert.equal(validations[0].values.PATH, undefined);
  assert.equal(validations[0].values.RANDOM, undefined);
});

test('logto-setup targets the chosen environment and reuses the stored credential', async () => {
  const spawned = [];
  const outputs = (n) => (n === 1 ? 'INSERT 0 1\nINSERT 0 1\n' : n === 2 ? '  logto: apps upserted (web w1, admin a1, native n1)\n' : 'ok\n');
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, outputs), probeImpl: async () => false });
  const res = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/logto-setup', token: 'tok', body: { stack: 'munni-local-dev' } }), res);
  await settle(res);

  // dev is NOT the control api → insert → bootstrap → m-admin read (claim
  // SKIPS: the fake output is no credential, no network touched) → up
  assert.equal(spawned.length, 4, 'expected psql insert → bootstrap → m-admin read → compose up');
  const psql = spawned[0];
  assert.equal(psql.cmd, 'docker');
  assert.ok(psql.args.includes('psql'));
  assert.ok(psql.args.join(' ').includes('docker-compose.munni-local-dev.yml'), 'the env runs its OWN postgres');
  assert.ok(psql.args.includes('postgres-dev'), 'exec targets the UNIQUE pg service name');
  assert.deepEqual(psql.args.slice(psql.args.indexOf('-d'), psql.args.indexOf('-d') + 2), ['-d', 'logto']);
  const insertSql = psql.args.join(' ');
  assert.match(insertSql, /insert into applications /);
  assert.match(insertSql, /on conflict \(id\) do nothing/i);
  assert.match(insertSql, /Logto Management API access/);
  const boot = spawned[1];
  assert.equal(boot.cmd, process.execPath);
  assert.ok(boot.args.join(' ').includes('--stack munni-local-dev'));
  const id = boot.opts.env.IAC_LOGTO_INFRA_M2M_ID;
  const secret = boot.opts.env.IAC_LOGTO_INFRA_M2M_SECRET;
  assert.match(id, /^infra[a-f0-9]{16}$/);
  assert.equal(secret.length, 48);
  assert.ok(insertSql.includes(id), 'psql insert must carry the same app id');
  assert.match(spawned[2].args.join(' '), /m-admin/);
  const stream = res.chunks.join('');
  assert.ok(!stream.includes(secret), 'the M2M secret leaked into the page stream');
  assert.match(stream, /auto-claim skipped/);
  assert.match(stream, /\[exit 0\]/);
  assert.deepEqual(spawned[3].args.slice(-3), ['up', '-d', '--remove-orphans']);
  assert.ok(spawned[3].args.join(' ').includes('docker-compose.munni-local-dev.yml'));

  // fresh-database contract: with a credential in the store (the REAL
  // bootstrap persists it; the scripted one can't), the insert re-uses
  // it verbatim instead of minting anew — so a reseeded logto database
  // gets the SAME app back
  const dev = loadStack('munni-local-dev');
  saveLocalValues(dev, { ...loadLocalValues(dev), IAC_LOGTO_INFRA_M2M_ID: 'infra0123456789abcdef', IAC_LOGTO_INFRA_M2M_SECRET: 'f'.repeat(48) });
  const spawned2 = [];
  const app3 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned2, outputs), probeImpl: async () => false });
  const res2 = fakeRes();
  await app3(fakeReq({ method: 'POST', url: '/api/local/logto-setup', token: 'tok', body: { stack: 'munni-local-dev' } }), res2);
  await settle(res2);
  assert.ok(spawned2[0].args.join(' ').includes('infra0123456789abcdef'), 'the stored app id must be re-inserted verbatim');
  assert.equal(spawned2[1].opts.env.IAC_LOGTO_INFRA_M2M_SECRET, 'f'.repeat(48), 'the stored secret rides along');
});

test('logto-setup on the control-owning environment refreshes the shared stack too', async () => {
  const spawned = [];
  const outputs = (n) => (n === 1 ? 'INSERT 0 1\n' : n === 2 ? 'logto: apps upserted (web w, admin a, native n)\n' : 'ok\n');
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, outputs), probeImpl: async () => false });
  const res = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/logto-setup', token: 'tok', body: { stack: 'munni-local-prod' } }), res);
  await settle(res);
  // insert → bootstrap → m-admin read → shared bootstrap → shared up → prod up
  assert.equal(spawned.length, 6, 'munni-control rides prod sign-in: the shared stack must re-render + restart');
  assert.ok(spawned[3].args.join(' ').includes('--stack munni-local-shared'));
  assert.ok(spawned[4].args.join(' ').includes('docker-compose.munni-local-shared.yml'));
  assert.deepEqual(spawned[4].args.slice(-3), ['up', '-d', '--remove-orphans']);
  assert.ok(spawned[5].args.join(' ').includes('docker-compose.munni-local-prod.yml'));
});

test('logto-setup fails loudly when bootstrap never reports the upsert', async () => {
  const spawned = [];
  const app2 = createApp({
    token: 'tok',
    spawnImpl: scriptedSpawn(spawned, (n, args) => (args.includes('psql') ? 'INSERT 0 1\n' : 'logto: unreachable or failed (fetch failed)\n')),
    probeImpl: async () => false,
  });
  const res = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/logto-setup', token: 'tok', body: { stack: 'munni-local-dev' } }), res);
  await settle(res);
  const stream = res.chunks.join('');
  assert.match(stream, /\[exit 1\]/);
  assert.match(stream, /did not accept the credential/);
});

test('cleanup destroys the chosen stack (GC purge skips without stored creds)', async () => {
  for (const [target, composeFile] of [
    ['devsource', 'docker-compose.local.yml'],
    ['munni-local-dev', 'docker-compose.munni-local-dev.yml'],
  ]) {
    const runs2 = [];
    const app2 = createApp({
      token: 'tok',
      probeImpl: async () => false,
      runImpl: (res, cmd, cmdArgs, opts) => { runs2.push({ cmd, cmdArgs, opts }); res.writeHead(200, {}); res.end('[exit 0]\n'); },
    });
    const res = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/cleanup', token: 'tok', body: { target } }), res);
    await settle(res);
    assert.equal(runs2.length, 1, `${target}: exactly one docker teardown`);
    assert.ok(runs2[0].cmdArgs.join(' ').includes(composeFile), `${target} → ${composeFile}`);
    assert.ok(runs2[0].cmdArgs.includes('-v'), 'volumes must be removed');
    assert.ok(runs2[0].cmdArgs.includes('--remove-orphans'));
    assert.match(res.chunks.join(''), /no GoCardless credentials in the store|creates no bank consents/);
  }
});

test('status reports per-stack store NAMES, requirements and probes — never values', async () => {
  const res = fakeRes();
  await app(fakeReq({ url: '/api/local/status', token: 'tok' }), res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.chunks.join(''));
  assert.deepEqual(Object.keys(body.stacks), LOCAL_STACKS());
  assert.equal(body.stacks['munni-local-prod'].envName, 'prod');
  assert.equal(body.stacks['munni-local-prod'].channel, 'dev');
  const shared = body.stacks['munni-local-shared'];
  assert.deepEqual(shared.services, { glitchtip: false, vault: false, control: false, pgadmin: false });
  assert.ok(shared.required.includes('NAS_GHCR_PAT'), 'family roots are the shared stack\'s asks');
  const prod = body.stacks['munni-local-prod'];
  assert.deepEqual(prod.services, { web: false, api: false, logto: false });
  assert.ok(!prod.required.includes('NAS_GHCR_PAT'), 'env stacks must not re-ask for shared names');
  assert.ok(prod.urls.web.startsWith('http://localhost:'));
  assert.ok(Array.isArray(prod.stored));
  assert.ok(!JSON.stringify(body).includes('ghp_'), 'status leaked a value');
});

test('secret retrieval: reveal returns the family stores; the vault export skips VAPID and shapes real logins', async () => {
  const prodStack = loadStack('munni-local-prod');
  // writes route by ownership: GLITCHTIP_* + GC id land in the SHARED
  // store even when saved "from" prod; VAPID stays in prod's own store
  saveLocalValues(prodStack, {
    ...loadLocalValues(prodStack),
    NAS_PUSH_VAPID_PRIVATE_KEY: 'vapid-secret-x',
    NAS_GOCARDLESS_SECRET_ID: 'gc-id-1',
    NAS_PGADMIN_PASSWORD: 'pgadmin-pw-long',
    GLITCHTIP_ADMIN_EMAIL: 'admin@munni.dev',
    // ≥12 chars: the glitchtip-setup endpoint REUSES a stored password,
    // and its own spec asserts real-password length
    GLITCHTIP_ADMIN_PASSWORD: 'pw-x-seeded-long',
  });

  const reveal = fakeRes();
  await app(fakeReq({ url: '/api/local/secrets', token: 'tok' }), reveal);
  const revealed = JSON.parse(reveal.chunks.join('')).values;
  assert.equal(revealed['munni-local-shared'].NAS_GOCARDLESS_SECRET_ID, 'gc-id-1');
  assert.equal(revealed['munni-local-shared'].GLITCHTIP_ADMIN_EMAIL, 'admin@munni.dev');
  assert.equal(revealed['munni-local-prod'].NAS_PUSH_VAPID_PRIVATE_KEY, 'vapid-secret-x');
  assert.equal(revealed['munni-local-prod'].NAS_GOCARDLESS_SECRET_ID, undefined, 'shared names show under shared');

  const noToken = fakeRes();
  await app(fakeReq({ url: '/api/local/secrets' }), noToken);
  assert.equal(noToken.statusCode, 401);

  const exportRes = fakeRes();
  await app(fakeReq({ url: '/api/local/vault-export', token: 'tok' }), exportRes);
  const exported = JSON.parse(exportRes.chunks.join(''));
  assert.equal(exported.encrypted, false);
  const names = exported.items.map((i) => i.name);
  assert.ok(names.includes('GlitchTip console'));
  assert.ok(names.includes('pgAdmin'), 'pgAdmin login rides the export');
  assert.ok(names.includes('NAS_GOCARDLESS_SECRET_ID'), 'plain names — folders carry the grouping now');
  assert.ok(!JSON.stringify(exported).includes('vapid-secret-x'), 'VAPID key leaked into the vault export');
  const gt = exported.items.find((i) => i.name === 'GlitchTip console');
  assert.equal(gt.login.username, 'admin@munni.dev');
  assert.ok(gt.login.uris[0].uri.includes('localhost:8383'));
  // folder grouping (user request): shared items point at the shared folder
  const sharedFolder = exported.folders.find((f) => f.name === 'shared');
  assert.ok(sharedFolder, 'a "shared" folder exists in the export');
  assert.equal(gt.folderId, sharedFolder.id);
  const gcItem = exported.items.find((i) => i.name === 'NAS_GOCARDLESS_SECRET_ID');
  assert.equal(gcItem.folderId, sharedFolder.id, 'GC secret lives in the shared folder (shared ownership)');
});

test('lanCandidates ranks private IPv4 first and skips internal/v6', () => {
  const fake = () => ({
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    eth: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '203.0.113.9', internal: false }],
    wifi: [{ family: 'IPv4', address: '192.168.1.50', internal: false }],
    vpn: [{ family: 'IPv4', address: '10.8.0.2', internal: false }],
  });
  assert.deepEqual(lanCandidates(fake), ['192.168.1.50', '10.8.0.2', '203.0.113.9']);
});

test('lan set: refuses an address this machine does not have; turning OFF re-renders + restarts the family', async () => {
  const bad = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/lan', token: 'tok', body: { host: '203.0.113.7' } }), bad);
  assert.equal(bad.statusCode, 400);

  const spawned = [];
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, () => 'ok\n'), probeImpl: async () => false });
  const res = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/lan', token: 'tok', body: { host: '' } }), res);
  await settle(res);
  // bootstrap + up for shared, prod, dev = 6 fixed spawns (shared FIRST —
  // glitchtip must carry the new domain before envs ask it for DSNs)
  assert.equal(spawned.length, 6);
  assert.ok(spawned[0].args.join(' ').includes('--stack munni-local-shared'));
  assert.ok(spawned[2].args.join(' ').includes('--stack munni-local-prod'));
  assert.ok(spawned[5].args.join(' ').includes('docker-compose.munni-local-dev.yml'));
  assert.match(res.chunks.join(''), /LAN mode OFF/);
  assert.match(res.chunks.join(''), /\[exit 0\]/);
});

test('native-config: LAN off means not ready, values stay out of reach until sign-in stored', async () => {
  const res = fakeRes();
  await app(fakeReq({ url: '/api/local/native-config', token: 'tok' }), res);
  const body = JSON.parse(res.chunks.join(''));
  assert.equal(body.environment, 'local');
  assert.equal(body.ready, false);
  assert.ok(body.missing.some((m) => /LAN mode is off/.test(m)));
  assert.equal(body.variables.NATIVE_API_URL, 'http://localhost:8382');
  assert.equal(body.variables.NATIVE_PUBLIC_ORIGIN, 'http://localhost:8380');
  assert.equal(body.variables.NATIVE_FAMILY_CA_PEM, undefined, 'no CA rider without LAN');
});

test('native-config under LAN: the family root rides along for the in-app trust anchor', async () => {
  const { writeFileSync: wf } = await import('node:fs');
  wf(join(SCRATCH, 'lan-host'), '192.168.1.50\n');
  try {
    const fetched = [];
    const netFetchImpl = async (url) => { fetched.push(url); return { ok: true, status: 200, text: async () => 'PEM-ROOT' }; };
    const app2 = createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl });
    const res = fakeRes();
    await app2(fakeReq({ url: '/api/local/native-config?stack=munni-local-prod', token: 'tok' }), res);
    const body = JSON.parse(res.chunks.join(''));
    assert.equal(fetched[0], 'http://ca.192-168-1-50.sslip.io/root.crt');
    assert.equal(body.variables.NATIVE_FAMILY_CA_PEM, 'PEM-ROOT');
    assert.equal(body.variables.NATIVE_API_URL, 'https://munni-prod-api.192-168-1-50.sslip.io');
  } finally {
    rmSync(join(SCRATCH, 'lan-host'), { force: true });
  }
});

test('vault-setup: creates the account, imports the items, closes signups — idempotent on re-run', async () => {
  const vaultCalls = [];
  const vaultFetch = async (url, init = {}) => {
    vaultCalls.push({ url, init });
    if (url.includes('/identity/connect/token')) {
      // first attempt: no account yet → login fails until registered
      const registered = vaultCalls.some((c) => c.url.includes('/accounts/register'));
      return registered
        ? { ok: true, json: async () => ({ access_token: 'vault-token' }) }
        : { ok: false, text: async () => 'invalid' };
    }
    return { ok: true, json: async () => ({}), text: async () => '' };
  };
  const spawned = [];
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, () => 'ok\n'), probeImpl: async () => false, vaultFetchImpl: vaultFetch });
  const res = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/vault-setup', token: 'tok', body: {} }), res);
  await settle(res);
  const stream = res.chunks.join('');
  assert.match(stream, /account created ✓/);
  assert.match(stream, /items in \d+ folders ✓/);
  assert.match(stream, /\[exit 0\]/);
  assert.ok(vaultCalls.some((c) => c.url.includes('/api/ciphers/purge')));
  const imp = vaultCalls.find((c) => c.url.includes('/api/ciphers/import'));
  assert.ok(imp, 'import was called');
  const impBody = JSON.parse(imp.init.body);
  assert.ok(impBody.ciphers.length >= 1, 'items were imported');
  assert.ok(impBody.folders.length >= 1, 'per-environment folders ride along');
  assert.equal(impBody.folderRelationships.length, impBody.ciphers.length, 'every item lands in a folder');
  assert.match(impBody.folders[0].name, /^2\./, 'folder names are encrypted EncStrings');
  assert.equal(spawned.length, 2, 'signups close = bootstrap + up on the shared stack');
  assert.ok(spawned[0].args.join(' ').includes('--stack munni-local-shared'));
  const store = loadLocalValues(loadStack('munni-local-shared'));
  assert.equal(store.VAULT_ADMIN_EMAIL, 'admin@munni.dev');
  assert.ok(store.VAULT_MASTER_PASSWORD?.length >= 16);
  assert.equal(store.VAULT_SIGNUPS_ALLOWED, 'false');
  assert.ok(!stream.includes(store.VAULT_MASTER_PASSWORD), 'the master password leaked into the stream');

  // second run: login succeeds straight away, signups already closed
  const vaultCalls2 = [];
  const vaultFetch2 = async (url, init = {}) => {
    vaultCalls2.push({ url, init });
    if (url.includes('/identity/connect/token')) return { ok: true, json: async () => ({ access_token: 'vault-token' }) };
    return { ok: true, json: async () => ({}), text: async () => '' };
  };
  const spawned2 = [];
  const app3 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned2, () => 'ok\n'), probeImpl: async () => false, vaultFetchImpl: vaultFetch2 });
  const res2 = fakeRes();
  await app3(fakeReq({ method: 'POST', url: '/api/local/vault-setup', token: 'tok', body: {} }), res2);
  await settle(res2);
  assert.match(res2.chunks.join(''), /account already exists/);
  assert.equal(spawned2.length, 0, 'no re-render needed when signups are already closed');
  assert.ok(!vaultCalls2.some((c) => c.url.includes('/accounts/register')), 'no second registration');
});

test('vault-setup heals a WIPED vault whose store still says signups-closed', async () => {
  // the store remembers "closed" from a previous life; the vault itself
  // is empty — registration must reopen, register, then close again
  const sharedStack = loadStack('munni-local-shared');
  saveLocalValues(sharedStack, { ...loadLocalValues(sharedStack), VAULT_SIGNUPS_ALLOWED: 'false' });
  let alive = false;
  let registered = false;
  const vaultFetch = async (url) => {
    if (url.endsWith('/alive')) { alive = true; return { ok: true }; }
    if (url.includes('/accounts/register')) {
      if (!alive) return { ok: false, status: 400, text: async () => 'Registration not allowed or user already exists' };
      registered = true;
      return { ok: true, text: async () => '' };
    }
    if (url.includes('/identity/connect/token')) {
      return registered ? { ok: true, json: async () => ({ access_token: 'tok' }) } : { ok: false };
    }
    return { ok: true, json: async () => ({}), text: async () => '' };
  };
  const spawned = [];
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, () => 'ok\n'), probeImpl: async () => false, vaultFetchImpl: vaultFetch });
  const res = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/vault-setup', token: 'tok', body: {} }), res);
  await settle(res);
  const stream = res.chunks.join('');
  assert.match(stream, /reopening signups once/);
  assert.match(stream, /account created ✓/);
  assert.match(stream, /\[exit 0\]/);
  // reopen (bootstrap + up) then close again (bootstrap + up)
  assert.equal(spawned.length, 4);
  assert.equal(loadLocalValues(sharedStack).VAULT_SIGNUPS_ALLOWED, 'false', 'signups end closed');
});

test('dynamic environments: create validates + registers + renders; delete guards the control env and forgets the rest', async () => {
  runs.length = 0;
  for (const badName of ['P!', 'x', 'toolong', 'shared', 'prod']) {
    const res = fakeRes();
    await app(fakeReq({ method: 'POST', url: '/api/local/envs', token: 'tok', body: { name: badName } }), res);
    assert.equal(res.statusCode, 400, `"${badName}" must be refused`);
  }
  assert.equal(runs.length, 0);
  const ok = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/envs', token: 'tok', body: { name: 'tst', channel: 'latest' } }), ok);
  assert.equal(runs.length, 1);
  assert.ok(runs[0].args.join(' ').includes('--stack munni-local-tst'));
  assert.ok(LOCAL_STACKS().includes('munni-local-tst'));
  const t = loadStack('munni-local-tst');
  assert.equal(t.urls.web, 'http://localhost:8580', 'slot 2 → the next 100-port block');
  assert.equal(t.urls.logto, 'http://localhost:3401');
  assert.equal(t.channel, 'latest');
  assert.equal(t.appChannel, 'staging');

  const guard = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/envs/delete', token: 'tok', body: { name: 'prod' } }), guard);
  assert.equal(guard.statusCode, 400, 'the control environment must refuse deletion');

  const spawned = [];
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, () => 'ok\n'), probeImpl: async () => false });
  const del = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/envs/delete', token: 'tok', body: { name: 'tst' } }), del);
  await settle(del);
  assert.equal(spawned.length, 1, 'one docker teardown');
  assert.ok(spawned[0].args.includes('-v'));
  assert.match(del.chunks.join(''), /deleted and forgotten/);
  assert.ok(!LOCAL_STACKS().includes('munni-local-tst'), 'registry entry removed');
});

test('LAN mode: env create/delete refreshes the family Caddyfile + restarts the https proxy', async () => {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(SCRATCH, 'lan-host'), '192.168.1.50\n');
  try {
    const spawned = [];
    const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, () => 'ok\n'), probeImpl: async () => false });
    const mk = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/envs', token: 'tok', body: { name: 'lnt' } }), mk);
    await settle(mk);
    // env bootstrap, shared bootstrap (Caddyfile), proxy restart
    assert.equal(spawned.length, 3);
    assert.ok(spawned[0].args.join(' ').includes('--stack munni-local-lnt'));
    assert.ok(spawned[1].args.join(' ').includes('--stack munni-local-shared'));
    assert.deepEqual(spawned[2].args.slice(-2), ['restart', 'family-tls']);
    assert.match(mk.chunks.join(''), /\[exit 0\]/);

    spawned.length = 0;
    const del = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/envs/delete', token: 'tok', body: { name: 'lnt' } }), del);
    await settle(del);
    // teardown, shared bootstrap (dead hostnames drop), proxy restart
    assert.equal(spawned.length, 3);
    assert.ok(spawned[0].args.includes('-v'));
    assert.ok(spawned[1].args.join(' ').includes('--stack munni-local-shared'));
    assert.deepEqual(spawned[2].args.slice(-2), ['restart', 'family-tls']);
    assert.ok(!LOCAL_STACKS().includes('munni-local-lnt'));
  } finally {
    rmSync(join(SCRATCH, 'lan-host'), { force: true });
  }
});

test('glitchtip-setup mints in the SHARED stack and wires the chosen environment', async () => {
  const spawned = [];
  const app2 = createApp({
    token: 'tok',
    spawnImpl: scriptedSpawn(spawned, (n) => (n === 1 ? 'USER:created\nTOKEN_STATE:created\nTOKEN:gt_secret_token_123\n' : 'ok\n')),
    probeImpl: async () => false,
  });
  const res = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/glitchtip-setup', token: 'tok', body: { stack: 'munni-local-dev' } }), res);
  await settle(res);

  assert.equal(spawned.length, 3, 'expected exec → bootstrap → compose up');
  // step 1: manage.py shell inside the SHARED stack's glitchtip, creds via env not argv
  const exec = spawned[0];
  assert.equal(exec.cmd, 'docker');
  assert.ok(exec.args.includes('exec'));
  assert.ok(exec.args.includes('glitchtip'));
  assert.ok(exec.args.includes('shell'));
  assert.ok(exec.args.join(' ').includes('docker-compose.munni-local-shared.yml'));
  assert.ok(!exec.args.join(' ').includes(exec.opts.env.GT_ADMIN_PASSWORD), 'password leaked into argv');
  assert.equal(exec.opts.env.GT_ADMIN_PASSWORD, 'pw-x-seeded-long', 'the stored shared password is reused');
  // step 2: bootstrap for the chosen ENV with the captured token in env
  const boot = spawned[1];
  assert.equal(boot.cmd, process.execPath);
  assert.ok(boot.args.join(' ').includes('--stack munni-local-dev'));
  assert.equal(boot.opts.env.IAC_GLITCHTIP_API_TOKEN, 'gt_secret_token_123');
  // step 3: the env restarts with its DSNs
  assert.deepEqual(spawned[2].args.slice(-3), ['up', '-d', '--remove-orphans']);
  assert.ok(spawned[2].args.join(' ').includes('docker-compose.munni-local-dev.yml'));

  const stream = res.chunks.join('');
  assert.ok(!stream.includes('gt_secret_token_123'), 'the API token leaked into the page stream');
  assert.match(stream, /TOKEN:\(captured\)/);
  assert.match(stream, /console login → email admin@munni\.dev · password \S+/);
  assert.match(stream, /\[exit 0\]/);
  // admin credentials live in the SHARED store (one console for the family)
  // — a resolvable-TLD address: GlitchTip 6.x 500s on .local emails
  const store = loadLocalValues(loadStack('munni-local-shared'));
  assert.equal(store.GLITCHTIP_ADMIN_EMAIL, 'admin@munni.dev');
  assert.ok(store.GLITCHTIP_ADMIN_PASSWORD?.length >= 12);
});

test('trust-ca: refuses without LAN; with LAN downloads root.crt and hands it to certutil', async () => {
  const { writeFileSync: wf, readFileSync: rf } = await import('node:fs');
  const spawned = [];
  const fetched = [];
  const netFetchImpl = async (url) => { fetched.push(url); return { ok: true, text: async () => 'PEM-CERT' }; };
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, () => 'ok\n'), probeImpl: async () => false, netFetchImpl });
  const off = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/trust-ca', token: 'tok', body: {} }), off);
  await settle(off);
  assert.match(off.chunks.join(''), /LAN mode is off/);
  assert.equal(spawned.length, 0);

  wf(join(SCRATCH, 'lan-host'), '192.168.1.50\n');
  try {
    const on = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/trust-ca', token: 'tok', body: {} }), on);
    await settle(on);
    assert.equal(fetched[0], 'http://ca.192-168-1-50.sslip.io/root.crt');
    assert.equal(rf(join(SCRATCH, 'munni-local-shared', 'family-root.crt'), 'utf8'), 'PEM-CERT');
    if (process.platform === 'win32') {
      assert.equal(spawned.length, 1);
      assert.equal(spawned[0].cmd, 'certutil');
      assert.deepEqual(spawned[0].args.slice(0, 3), ['-user', '-addstore', 'Root']);
      assert.match(on.chunks.join(''), /\[exit 0\]/);
    }
  } finally {
    rmSync(join(SCRATCH, 'lan-host'), { force: true });
  }
});

test('env delete purges the GlitchTip org when a token exists', async () => {
  const mk = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/envs', token: 'tok', body: { name: 'gtd' } }), mk);
  const shared = loadStack('munni-local-shared');
  const prev = loadLocalValues(shared);
  saveLocalValues(shared, { ...prev, IAC_GLITCHTIP_API_TOKEN: 'gt_tok_1' });
  const calls = [];
  const netFetchImpl = async (url, init = {}) => { calls.push({ url, init }); return { ok: true, status: 204, text: async () => '' }; };
  const spawned = [];
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, () => 'ok\n'), probeImpl: async () => false, netFetchImpl });
  const del = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/envs/delete', token: 'tok', body: { name: 'gtd' } }), del);
  await settle(del);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/api/0/organizations/munni-local-gtd/'));
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.headers.authorization, 'Bearer gt_tok_1');
  assert.match(del.chunks.join(''), /GlitchTip org munni-local-gtd deleted/);
  assert.ok(!LOCAL_STACKS().includes('munni-local-gtd'));
  saveLocalValues(shared, prev); // the fake token must not leak into later tests
});

test('store-status: no creds reports so; with creds it mirrors the real Play/ASC calls', async () => {
  const none = fakeRes();
  await app(fakeReq({ url: '/api/local/store-status?stack=munni-local-prod', token: 'tok' }), none);
  const bare = JSON.parse(none.chunks.join(''));
  assert.equal(bare.play.state, 'no-creds');
  assert.equal(bare.ios.state, 'no-creds');
  assert.equal(bare.appId, 'app.munni.local.prod');

  const { generateKeyPairSync } = await import('node:crypto');
  const rsaPem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const ecPem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const shared = loadStack('munni-local-shared');
  const prev = loadLocalValues(shared);
  saveLocalValues(shared, {
    ...prev,
    PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'ci@sa.test', token_uri: 'https://oauth2.googleapis.com/token', private_key: rsaPem, project_id: 'p' }),
    ASC_KEY_ID: 'KEY1',
    ASC_ISSUER_ID: 'ISS1',
    ASC_KEY_P8: Buffer.from(ecPem).toString('base64'),
  });
  try {
    const calls = [];
    const netFetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'gtok' }) };
      if (url.includes('androidpublisher')) return { ok: false, status: 404, json: async () => ({}) };
      if (url.includes('appstoreconnect')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'app1' }] }) };
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const app2 = createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl });
    const res = fakeRes();
    await app2(fakeReq({ url: '/api/local/store-status?stack=munni-local-prod', token: 'tok' }), res);
    const body = JSON.parse(res.chunks.join(''));
    assert.equal(body.play.state, 'missing-app', 'Play 404 on the edit = app not created yet');
    assert.equal(body.ios.state, 'ready', 'ASC lists the bundle id');
    assert.ok(calls.some((c) => c.url.includes('/applications/app.munni.local.prod/edits')));
    assert.ok(calls.some((c) => c.url.includes('filter%5BbundleId%5D=app.munni.local.prod')));

    // 403 splits two ways (user request 2026-08-29): a sibling munni app
    // answering non-403 proves the account link works → app just missing
    const splitFetch = (siblingStatus) => async (url) => {
      if (url.includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'gtok' }) };
      if (url.includes('/applications/app.munni.local.prod/')) return { ok: false, status: 403, json: async () => ({}) };
      if (url.includes('androidpublisher')) return { ok: false, status: siblingStatus, json: async () => ({}) };
      if (url.includes('appstoreconnect')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const visible = fakeRes();
    await createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: splitFetch(404) })(
      fakeReq({ url: '/api/local/store-status?stack=munni-local-prod', token: 'tok' }), visible);
    const vb = JSON.parse(visible.chunks.join(''));
    assert.equal(vb.play.state, 'missing-app');
    assert.match(vb.play.detail, /has Play access/);

    const denied = fakeRes();
    await createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: splitFetch(403) })(
      fakeReq({ url: '/api/local/store-status?stack=munni-local-prod', token: 'tok' }), denied);
    const db2 = JSON.parse(denied.chunks.join(''));
    assert.equal(db2.play.state, 'error');
    assert.match(db2.play.detail, /NOT invited/);

    // a 403 whose body says SERVICE_DISABLED = the API is off in the
    // service account's own Cloud project — verdict carries the switch
    const disabledFetch = async (url) => {
      if (url.includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'gtok' }) };
      if (url.includes('androidpublisher')) {
        return { ok: false, status: 403, json: async () => ({ error: { code: 403, message: 'Google Play Android Developer API has not been used in project 1 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED', metadata: { activationUrl: 'https://console.developers.google.com/apis/x' } }] } }) };
      }
      if (url.includes('appstoreconnect')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const off = fakeRes();
    await createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: disabledFetch })(
      fakeReq({ url: '/api/local/store-status?stack=munni-local-prod', token: 'tok' }), off);
    const ob = JSON.parse(off.chunks.join(''));
    assert.equal(ob.play.state, 'error');
    assert.match(ob.play.detail, /API is disabled .* Cloud project/);
    assert.match(ob.play.detail, /console\.developers\.google\.com/);
  } finally {
    saveLocalValues(shared, prev);
  }
});

test('ios-appid: registers the bundle id and its long-run capabilities via the ASC API', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const ecPem2 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const shared = loadStack('munni-local-shared');
  const prev = loadLocalValues(shared);
  saveLocalValues(shared, { ...prev, ASC_KEY_ID: 'K1', ASC_ISSUER_ID: 'ISS1', ASC_KEY_P8: Buffer.from(ecPem2).toString('base64') });
  try {
    const calls = [];
    const netFetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes('/bundleIds?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      if (url.endsWith('/bundleIds')) return { ok: true, status: 201, json: async () => ({ data: { type: 'bundleIds', id: 'BID1' } }) };
      if (url.endsWith('/bundleIdCapabilities')) {
        const cap = JSON.parse(init.body).data.attributes.capabilityType;
        return cap === 'ASSOCIATED_DOMAINS'
          ? { ok: false, status: 409, json: async () => ({}), text: async () => 'exists' }
          : { ok: true, status: 201, json: async () => ({}), text: async () => '' };
      }
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    };
    const app2 = createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl });
    const res = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/ios-appid', token: 'tok', body: { stack: 'munni-local-prod' } }), res);
    await settle(res);
    const stream = res.chunks.join('');
    assert.match(stream, /App ID app\.munni\.local\.prod registered ✓/);
    assert.match(stream, /PUSH_NOTIFICATIONS ✓/);
    assert.match(stream, /APPLE_ID_AUTH ✓/);
    assert.match(stream, /ASSOCIATED_DOMAINS ✓/, 'a 409 (already enabled) counts as done');
    assert.match(stream, /New App/);
    assert.match(stream, /\[exit 0\]/);
    const create = calls.find((c) => c.url.endsWith('/bundleIds') && c.init.method === 'POST');
    assert.equal(JSON.parse(create.init.body).data.attributes.identifier, 'app.munni.local.prod');
    assert.equal(calls.filter((c) => c.url.endsWith('/bundleIdCapabilities')).length, 3);
  } finally {
    saveLocalValues(shared, prev);
  }

  // without the key: a clear refusal, not a crash
  const bare = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/ios-appid', token: 'tok', body: { stack: 'munni-local-prod' } }), bare);
  await settle(bare);
  assert.match(bare.chunks.join(''), /not stored yet \(step 3\)/);
});

test('new-store-package: the operator names the suffix, re-render follows, consumers see it', async () => {
  const mk = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/envs', token: 'tok', body: { name: 'roll' } }), mk);
  assert.equal(loadStack('munni-local-roll').native.appId, 'app.munni.local.roll');
  const spawned = [];
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, () => 'ok\n'), probeImpl: async () => false });

  const bad = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/new-store-package', token: 'tok', body: { stack: 'munni-local-roll', suffix: '2bad!' } }), bad);
  assert.equal(bad.statusCode, 400, 'suffix rules enforced');

  const res = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/new-store-package', token: 'tok', body: { stack: 'munni-local-roll', suffix: 'phone2' } }), res);
  await settle(res);
  const stream = res.chunks.join('');
  assert.match(stream, /store package set → app\.munni\.local\.phone2/);
  assert.match(stream, /\[exit 0\]/);
  assert.equal(loadStack('munni-local-roll').native.appId, 'app.munni.local.phone2');
  assert.ok(spawned[0].args.join(' ').includes('--stack munni-local-roll'), 're-render ran');
  // …and native-config hands CI the chosen id
  const nc = fakeRes();
  await app(fakeReq({ url: '/api/local/native-config?stack=munni-local-roll', token: 'tok' }), nc);
  const body = JSON.parse(nc.chunks.join(''));
  assert.equal(body.appId, 'app.munni.local.phone2');
  assert.equal(body.variables.NATIVE_LOCAL_APP_ID, 'app.munni.local.phone2');
  // cleanup: drop the throwaway env
  const del = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/envs/delete', token: 'tok', body: { name: 'roll' } }), del);
  await settle(del);
});

test('mint-keystore: mints once into the machine store (docker keytool), then reuses forever', async () => {
  const { existsSync: ex2, readFileSync: rf2 } = await import('node:fs');
  const shared = loadStack('munni-local-shared');
  const prev = loadLocalValues(shared);
  try {
    const spawned = [];
    const out = 'KEYSTORE_B64:QUJDS0VZ\n-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----\n';
    const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, () => out), probeImpl: async () => false });
    const res = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/mint-keystore', token: 'tok', body: {} }), res);
    await settle(res);
    const stream = res.chunks.join('');
    assert.match(stream, /minted into the machine store ✓/);
    assert.match(stream, /\[exit 0\]/);
    assert.ok(!stream.includes('QUJDS0VZ'), 'the keystore bytes leaked into the page stream');
    assert.equal(spawned[0].cmd, 'docker');
    assert.ok(spawned[0].args.includes('eclipse-temurin:21-jdk'));
    const store = loadLocalValues(shared);
    assert.equal(store.ANDROID_KEYSTORE_BASE64, 'QUJDS0VZ');
    assert.equal(store.ANDROID_KEY_ALIAS, 'munni-upload');
    assert.ok(store.ANDROID_KEYSTORE_PASSWORD?.length >= 32);
    assert.equal(store.ANDROID_KEY_PASSWORD, store.ANDROID_KEYSTORE_PASSWORD);
    assert.ok(ex2(join(SCRATCH, 'munni-local-shared', 'upload-cert.pem')), 'reset certificate written');
    assert.match(rf2(join(SCRATCH, 'munni-local-shared', 'upload-cert.pem'), 'utf8'), /BEGIN CERTIFICATE/);

    // second call: same key, no new mint
    const again = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/mint-keystore', token: 'tok', body: {} }), again);
    await settle(again);
    assert.match(again.chunks.join(''), /already holds the upload keystore/);
    assert.equal(spawned.length, 1, 'no second docker run');
  } finally {
    saveLocalValues(shared, prev);
  }
});

// LAST on purpose: it empties the registry the other tests rely on
test('delete-everything epilogue: forget-all empties the registry and removes the env stores', async () => {
  const { existsSync: ex } = await import('node:fs');
  assert.ok(LOCAL_STACKS().length > 1, 'environments exist before');
  const res = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/envs/forget-all', token: 'tok', body: {} }), res);
  const body = JSON.parse(res.chunks.join(''));
  assert.ok(body.forgotten.includes('prod'));
  assert.deepEqual(LOCAL_STACKS(), ['munni-local-shared'], 'only the shared stack remains');
  assert.ok(!ex(join(SCRATCH, 'munni-local-prod')), 'prod rendered dir (its store included) is gone');
  // native-config now refuses cleanly instead of crashing on a phantom env
  const nc = fakeRes();
  await app(fakeReq({ url: '/api/local/native-config', token: 'tok' }), nc);
  assert.equal(nc.statusCode, 400);
});
