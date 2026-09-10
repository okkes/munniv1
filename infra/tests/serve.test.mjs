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
  validateImpl: async (provider, values, opts) => { validations.push({ provider, values, opts }); return { ok: true, detail: 'fake' }; },
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
    body: { provider: 'gocardless', values: { NAS_GOCARDLESS_SECRET_ID: 'id1', PATH: 'evil', RANDOM: 'x', SYNOLOGY_URL: 'https://nas:5001' }, redirectUris: ['https://munni-prod-logto.192-168-2-2.sslip.io/callback/google-universal', 'javascript:alert(1)', 'ftp://x/y', 42, 'http://localhost:3201/callback/google-universal'] },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(validations.length, 1);
  assert.equal(validations[0].provider, 'gocardless');
  // only http(s) callbacks reach the validator's redirect probes
  assert.deepEqual(validations[0].opts.redirectUris, ['https://munni-prod-logto.192-168-2-2.sslip.io/callback/google-universal', 'http://localhost:3201/callback/google-universal']);
  // …and the family's app bundle ids ride along (an App ID pasted as Apple client id is named)
  assert.deepEqual(validations[0].opts.iosAppIds, ['app.munni', 'app.munni.dev', 'app.munni.local.prod', 'app.munni.local.dev']);
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
  assert.ok(Array.isArray(shared.required), 'family roots are the shared stack\'s asks');
  assert.ok(!shared.required.includes('NAS_GHCR_PAT'), 'the registry token is optional (the munni images are public) — never a family ask (2026-09-10)');
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
  assert.equal(bare.iosAppId, 'app.munni.local.prod', 'the iOS bundle follows the Android id until named apart');

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
      if (url.includes('/androidApps?')) return { ok: true, status: 200, json: async () => ({ apps: [{ appId: 'A1', packageName: 'app.munni.local.prod' }] }) };
      if (url.includes('/iosApps?')) return { ok: true, status: 200, json: async () => ({ apps: [{ appId: 'I1', bundleId: 'app.munni.local.prod' }] }) };
      if (url.endsWith('/projects/p')) return { ok: true, status: 200, json: async () => ({ projectId: 'p' }) };
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const app2 = createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl });
    const res = fakeRes();
    await app2(fakeReq({ url: '/api/local/store-status?stack=munni-local-prod', token: 'tok' }), res);
    const body = JSON.parse(res.chunks.join(''));
    assert.equal(body.play.state, 'missing-app', 'Play 404 on the edit = app not created yet');
    assert.equal(body.ios.state, 'ready', 'ASC lists the bundle id');
    assert.equal(body.firebase.state, 'ready', 'project firebase-enabled + both apps registered = push wired');
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
    // App Store Connect in a box: the capability LIST is the truth —
    // ASSOCIATED_DOMAINS pre-exists, APPLE_ID_AUTH exists WITHOUT its
    // primary setting (the live 2026-09-09 state: keys found no App ID)
    const calls = [];
    const caps = [
      { id: 'BID1_ASSOCIATED_DOMAINS', attributes: { capabilityType: 'ASSOCIATED_DOMAINS', settings: null } },
      { id: 'BID1_APPLE_ID_AUTH', attributes: { capabilityType: 'APPLE_ID_AUTH', settings: null } },
    ];
    const netFetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes('/bundleIds?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      if (url.endsWith('/bundleIds')) return { ok: true, status: 201, json: async () => ({ data: { type: 'bundleIds', id: 'BID1' } }) };
      if (url.endsWith('/bundleIds/BID1/bundleIdCapabilities')) return { ok: true, status: 200, json: async () => ({ data: caps }) };
      if (url.endsWith('/bundleIdCapabilities') && init.method === 'POST') {
        const { capabilityType, settings } = JSON.parse(init.body).data.attributes;
        caps.push({ id: `BID1_${capabilityType}`, attributes: { capabilityType, settings: settings ?? null } });
        return { ok: true, status: 201, json: async () => ({}), text: async () => '' };
      }
      if (url.includes('/bundleIdCapabilities/') && init.method === 'PATCH') {
        const { settings } = JSON.parse(init.body).data.attributes;
        caps.find((c) => url.endsWith(c.id)).attributes.settings = settings;
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      }
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    };
    const app2 = createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl });
    const res = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/ios-appid', token: 'tok', body: { stack: 'munni-local-prod' } }), res);
    await settle(res);
    const stream = res.chunks.join('');
    assert.match(stream, /App ID app\.munni\.local\.prod registered ✓/);
    assert.match(stream, /PUSH_NOTIFICATIONS enabled ✓/);
    assert.match(stream, /APPLE_ID_AUTH completed ✓ — Sign in with Apple as the PRIMARY App ID/);
    assert.match(stream, /ASSOCIATED_DOMAINS ✓/, 'listed = done, no request needed');
    assert.match(stream, /New App/);
    assert.match(stream, /\[exit 0\]/);
    const create = calls.find((c) => c.url.endsWith('/bundleIds') && c.init.method === 'POST');
    assert.equal(JSON.parse(create.init.body).data.attributes.identifier, 'app.munni.local.prod');
    const posts = calls.filter((c) => c.url.endsWith('/bundleIdCapabilities') && c.init.method === 'POST');
    assert.deepEqual(posts.map((c) => JSON.parse(c.init.body).data.attributes.capabilityType), ['PUSH_NOTIFICATIONS'], 'only the missing one is created');
    const patch = calls.find((c) => c.url.endsWith('/bundleIdCapabilities/BID1_APPLE_ID_AUTH') && c.init.method === 'PATCH');
    assert.deepEqual(JSON.parse(patch.init.body).data.attributes.settings, [{ key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'PRIMARY_APP_CONSENT' }] }], 'the primary-app consent rides the update');

    // a second run finds everything complete: no mutation at all
    const again = fakeRes();
    const before = calls.length;
    await app2(fakeReq({ method: 'POST', url: '/api/local/ios-appid', token: 'tok', body: { stack: 'munni-local-prod' } }), again);
    await settle(again);
    assert.ok(!calls.slice(before).some((c) => c.init.method === 'POST' && c.url.includes('bundleIdCapabilities')));
    assert.ok(!calls.slice(before).some((c) => c.init.method === 'PATCH'));
    assert.match(again.chunks.join(''), /APPLE_ID_AUTH ✓/);

    // Apple refusing an entity (409 with nothing recorded) is NOT "already enabled"
    const refusing = async (url, init = {}) => {
      if (url.includes('/bundleIds?')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'BID2', attributes: { identifier: 'app.munni.local.prod' } }] }) };
      if (url.endsWith('/bundleIds/BID2/bundleIdCapabilities')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      if (init.method === 'POST') return { ok: false, status: 409, json: async () => ({}), text: async () => 'ENTITY_ERROR' };
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    };
    const refused = fakeRes();
    await createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: refusing })(
      fakeReq({ method: 'POST', url: '/api/local/ios-appid', token: 'tok', body: { stack: 'munni-local-prod' } }), refused);
    await settle(refused);
    const rs = refused.chunks.join('');
    assert.match(rs, /APPLE_ID_AUTH NOT enabled \(Apple answered 409: ENTITY_ERROR\)/);
    assert.match(rs, /Enable as a primary App ID/);
    assert.match(rs, /\[exit 1\]/);
  } finally {
    saveLocalValues(shared, prev);
  }

  // without the key: a clear refusal, not a crash
  const bare = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/ios-appid', token: 'tok', body: { stack: 'munni-local-prod' } }), bare);
  await settle(bare);
  assert.match(bare.chunks.join(''), /not stored yet \(Features & accounts\)/);
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
  assert.equal(loadStack('munni-local-roll').native.iosAppId, 'app.munni.local.phone2', 'iOS follows Android by default');
  assert.ok(spawned[0].args.join(' ').includes('--stack munni-local-roll'), 're-render ran');

  // the iOS bundle may DIVERGE (Play burns package names, ASC does not)
  const iosRes = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/new-store-package', token: 'tok', body: { stack: 'munni-local-roll', suffix: 'ipad', platform: 'ios' } }), iosRes);
  await settle(iosRes);
  assert.match(iosRes.chunks.join(''), /iOS bundle id set → app\.munni\.local\.ipad/);
  assert.equal(loadStack('munni-local-roll').native.appId, 'app.munni.local.phone2', 'the Android package is untouched');
  assert.equal(loadStack('munni-local-roll').native.iosAppId, 'app.munni.local.ipad');

  // …and native-config hands CI BOTH chosen ids
  const nc = fakeRes();
  await app(fakeReq({ url: '/api/local/native-config?stack=munni-local-roll', token: 'tok' }), nc);
  const body = JSON.parse(nc.chunks.join(''));
  assert.equal(body.appId, 'app.munni.local.phone2');
  assert.equal(body.iosAppId, 'app.munni.local.ipad');
  assert.equal(body.variables.NATIVE_LOCAL_APP_ID, 'app.munni.local.phone2');
  assert.equal(body.variables.NATIVE_LOCAL_APP_ID_IOS, 'app.munni.local.ipad');
  // cleanup: drop the throwaway env
  const del = fakeRes();
  await app2(fakeReq({ method: 'POST', url: '/api/local/envs/delete', token: 'tok', body: { name: 'roll' } }), del);
  await settle(del);
});

test('gh-pat: a working GitHub token persists into the shared store; an empty one refuses', async () => {
  const shared = loadStack('munni-local-shared');
  const prev = loadLocalValues(shared);
  try {
    const bad = fakeRes();
    await app(fakeReq({ method: 'POST', url: '/api/local/gh-pat', token: 'tok', body: { pat: '  ' } }), bad);
    assert.equal(bad.statusCode, 400);
    const res = fakeRes();
    await app(fakeReq({ method: 'POST', url: '/api/local/gh-pat', token: 'tok', body: { pat: 'github_pat_test123' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(loadLocalValues(shared).IAC_GH_PAT, 'github_pat_test123');
  } finally {
    saveLocalValues(shared, prev);
  }
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

test('store-retire: withdraws Play internal testing and expires TestFlight builds; skips without creds', async () => {
  // no creds: an honest skip on both sides, still exit 0
  const bare = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/store-retire', token: 'tok', body: { stack: 'munni-local-prod' } }), bare);
  await settle(bare);
  const bareOut = bare.chunks.join('');
  assert.match(bareOut, /Play: no service account stored .* skipped/);
  assert.match(bareOut, /TestFlight: no App Store Connect key stored .* skipped/);
  assert.match(bareOut, /\[exit 0\]/);

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
    // app exists on both sides: track cleared + committed, builds expired
    const calls = [];
    const netFetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'gtok' }) };
      if (url.endsWith('/edits') && init.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'e1' }) };
      if (url.includes('/tracks/internal')) return { ok: true, status: 200, json: async () => ({}) };
      if (url.includes(':commit')) return { ok: true, status: 200, json: async () => ({}) };
      if (url.includes('/apps?')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'app1' }] }) };
      if (url.includes('/builds?')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'b1', attributes: { version: '42' } }] }) };
      if (url.includes('/builds/b1')) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    };
    const app2 = createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl });
    const res = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/store-retire', token: 'tok', body: { stack: 'munni-local-prod' } }), res);
    await settle(res);
    const out = res.chunks.join('');
    assert.match(out, /internal testing withdrawn for app\.munni\.local\.prod/);
    assert.match(out, /1\/1 builds expired/);
    assert.match(out, /\[exit 0\]/);
    const put = calls.find((c) => c.url.includes('/tracks/internal'));
    assert.deepEqual(JSON.parse(put.init.body).releases, [], 'the internal track is cleared, not re-released');
    const expire = calls.find((c) => c.url.includes('/builds/b1'));
    assert.equal(JSON.parse(expire.init.body).data.attributes.expired, true);

    // no ASC app record: the portal App ID registration is deleted instead
    const calls2 = [];
    const netFetch2 = async (url, init = {}) => {
      calls2.push({ url, init });
      if (url.includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'gtok' }) };
      if (url.endsWith('/edits') && init.method === 'POST') return { ok: false, status: 404, json: async () => ({}) };
      if (url.includes('/apps?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      if (url.includes('/bundleIds?')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'BID1', attributes: { identifier: 'app.munni.local.prod' } }] }) };
      if (url.includes('/bundleIds/BID1')) return { ok: true, status: 204, json: async () => ({}) };
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    };
    const res2 = fakeRes();
    await createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: netFetch2 })(
      fakeReq({ method: 'POST', url: '/api/local/store-retire', token: 'tok', body: { stack: 'munni-local-prod' } }), res2);
    await settle(res2);
    const out2 = res2.chunks.join('');
    assert.match(out2, /Play: app\.munni\.local\.prod does not exist there/);
    assert.match(out2, /App ID registration app\.munni\.local\.prod was deleted/);
    assert.match(out2, /\[exit 0\]/);
    assert.ok(calls2.some((c) => c.url.includes('/bundleIds/BID1') && c.init.method === 'DELETE'));
  } finally {
    saveLocalValues(shared, prev);
  }
});

test('firebase as code: setup finds the project, registers both apps, copies the sender credential', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const rsaPem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const shared = loadStack('munni-local-shared');
  const prev = loadLocalValues(shared);
  saveLocalValues(shared, {
    ...prev,
    PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'ci@sa.test', token_uri: 'https://oauth2.googleapis.com/token', private_key: rsaPem, project_id: 'p' }),
  });
  try {
    const calls = [];
    let androidLists = 0;
    const netFetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'gtok' }) };
      if (url.includes('/projects/p:addFirebase')) return { ok: true, status: 200, json: async () => ({ name: 'operations/o1', done: true }) };
      if (url.endsWith('/projects/p')) return { ok: true, status: 200, json: async () => ({ projectId: 'p' }) };
      if (url.includes('/androidApps?')) {
        androidLists += 1;
        return { ok: true, status: 200, json: async () => ({ apps: androidLists > 1 ? [{ appId: 'A1', packageName: 'app.munni.local.prod' }] : [] }) };
      }
      if (url.endsWith('/androidApps') && init.method === 'POST') return { ok: true, status: 200, json: async () => ({ name: 'operations/o2', done: true }) };
      if (url.includes('/androidApps/A1/config')) return { ok: true, status: 200, json: async () => ({ configFileContents: 'R1M=' }) };
      // a stale display name from before the track rode in the label
      if (url.includes('/iosApps?')) return { ok: true, status: 200, json: async () => ({ apps: [{ appId: 'I1', bundleId: 'app.munni.local.prod', displayName: 'munni prod ios' }] }) };
      if (url.includes('/iosApps/I1?updateMask=displayName') && init.method === 'PATCH') return { ok: true, status: 200, json: async () => ({}) };
      if (url.includes('/iosApps/I1/config')) return { ok: true, status: 200, json: async () => ({ configFileContents: 'UEw=' }) };
      if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ capabilities: { fcm: true } }) };
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    };
    const spawned = [];
    const app2 = createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl, spawnImpl: scriptedSpawn(spawned, () => 'ok\n') });
    const envFile = join(SCRATCH, 'munni-local-prod', '.env.munni-local-prod');
    rmSync(envFile, { force: true });
    const res = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/firebase-setup', token: 'tok', body: { stack: 'munni-local-prod' } }), res);
    await settle(res);
    const out = res.chunks.join('');
    assert.match(out, /Firebase project p ✓/);
    assert.match(out, /registered as a Firebase android app ✓/);
    assert.match(out, /app\.munni\.local\.prod already registered ✓/, 'the iOS app was already there');
    assert.match(out, /renamed to "munni local prod ios" ✓/, 'the track rides into the console chip name');
    const created = calls.find((c) => c.url.endsWith('/androidApps') && c.init.method === 'POST');
    assert.equal(JSON.parse(created.init.body).displayName, 'munni local prod android');
    assert.match(out, /sender credential: the api sends push with the SAME service account — stored ✓/);
    // …and the api actually CARRIES it: re-render + up, then /health says fcm
    assert.match(out, /re-render prod with the sender credential/);
    assert.match(out, /restart prod so the api picks the sender up/);
    assert.match(out, /the api reports native push \(fcm\) ✓/);
    assert.match(out, /APNs key/);
    assert.match(out, /\[exit 0\]/);
    assert.ok(spawned.some((s) => s.args.includes('--stack') && s.args.includes('munni-local-prod')), 'bootstrap re-rendered the env');
    assert.ok(spawned.some((s) => s.cmd === 'docker' && s.args.includes('up') && s.args.includes('docker-compose.munni-local-prod.yml')), 'the env stack came up again');
    assert.equal(loadLocalValues(shared).NAS_FCM_SERVICE_ACCOUNT_JSON, loadLocalValues(shared).PLAY_SERVICE_ACCOUNT_JSON);

    // an env already carrying the credential is left alone (no restart on every Build)
    (await import('node:fs')).mkdirSync(join(SCRATCH, 'munni-local-prod'), { recursive: true });
    (await import('node:fs')).writeFileSync(envFile, "FCM_SERVICE_ACCOUNT_JSON='{\"client_email\":\"ci@sa.test\"}'\n");
    const before = spawned.length;
    const again = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/firebase-setup', token: 'tok', body: { stack: 'munni-local-prod' } }), again);
    await settle(again);
    assert.match(again.chunks.join(''), /sender: the prod api environment already carries it ✓/);
    assert.equal(spawned.length, before, 'nothing spawned when the env already carries the sender');
    rmSync(envFile, { force: true });

    // …and native-config now carries both configs for CI to bake
    const nc = fakeRes();
    await app2(fakeReq({ url: '/api/local/native-config?stack=munni-local-prod', token: 'tok' }), nc);
    const body = JSON.parse(nc.chunks.join(''));
    assert.equal(body.variables.NATIVE_GOOGLE_SERVICES_B64, 'R1M=');
    assert.equal(body.variables.NATIVE_IOS_FIREBASE_PLIST_B64, 'UEw=');
    // refusals: see the bare-Cloud-project test below
  } finally {
    saveLocalValues(shared, prev);
  }
});

test('firebase as code: a bare Cloud project gets Firebase added; the enable right is probed FIRST and its gap names the Service Usage Admin role', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const rsaPem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const shared = loadStack('munni-local-shared');
  const prev = loadLocalValues(shared);
  saveLocalValues(shared, {
    ...prev,
    PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'ci@sa.test', token_uri: 'https://oauth2.googleapis.com/token', private_key: rsaPem, project_id: 'p' }),
  });
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const fail = (status, error) => ({ ok: false, status, json: async () => ({ error }), text: async () => JSON.stringify({ error }) });
  const ENABLE = '/projects/p/services/firebase.googleapis.com:enable';
  const bare = fail(404, { code: 404, message: 'Requested entity was not found.' });
  // Google's real answer (captured live 2026-09-08) with Firebase Admin granted
  const denied = fail(403, {
    message: 'Permission denied to enable service [firebase.googleapis.com]',
    status: 'PERMISSION_DENIED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'AUTH_PERMISSION_DENIED', domain: 'serviceusage.googleapis.com', metadata: { service: 'serviceusage.googleapis.com', permission: 'serviceusage.services.enable' } }],
  });
  const apps = (url) => {
    if (url.includes('/androidApps?')) return ok({ apps: [{ appId: 'A1', packageName: 'app.munni.local.prod', displayName: 'munni local prod android' }] });
    if (url.includes('/androidApps/A1/config')) return ok({ configFileContents: 'R1M=' });
    if (url.includes('/iosApps?')) return ok({ apps: [{ appId: 'I1', bundleId: 'app.munni.local.prod', displayName: 'munni local prod ios' }] });
    if (url.includes('/iosApps/I1/config')) return ok({ configFileContents: 'UEw=' });
    if (url.endsWith('/health')) return ok({ capabilities: { fcm: true } });
    return null;
  };
  const setup = async (fetchImpl) => {
    const res = fakeRes();
    await createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: fetchImpl, spawnImpl: scriptedSpawn([], () => 'ok\n') })(
      fakeReq({ method: 'POST', url: '/api/local/firebase-setup', token: 'tok', body: { stack: 'munni-local-prod' } }), res);
    await settle(res);
    return res.chunks.join('');
  };
  try {
    // (1) bare project, the account may switch services on → no-op enable, addFirebase, apps
    const calls = [];
    const out1 = await setup(async (url) => {
      calls.push(url);
      if (url.includes('oauth2.googleapis.com')) return ok({ access_token: 'gtok' });
      if (url.endsWith('/projects/p')) return bare;
      if (url.endsWith(ENABLE)) return ok({ name: 'operations/su1', done: true });
      if (url.includes('/projects/p:addFirebase')) return ok({ name: 'operations/o1', done: true });
      return apps(url) ?? fail(500, {});
    });
    assert.match(out1, /p is not a Firebase project yet — adding Firebase to it/);
    assert.match(out1, /Firebase enabled on p ✓/);
    assert.match(out1, /\[exit 0\]/);
    assert.ok(calls.findIndex((u) => u.endsWith(ENABLE)) < calls.findIndex((u) => u.includes(':addFirebase')), 'the enable probe runs BEFORE addFirebase');

    // (2) the Management API is off and the account may switch it on → done in-line, no manual click
    const out2 = await setup(async (url) => {
      if (url.includes('oauth2.googleapis.com')) return ok({ access_token: 'gtok' });
      if (url.endsWith('/projects/p')) return fail(403, { message: 'Firebase Management API has not been used in project 1 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED', metadata: { activationUrl: 'https://console.developers.google.com/apis/api/firebase.googleapis.com/overview?project=1' } }] });
      if (url.endsWith(ENABLE)) return ok({ name: 'operations/su2', done: true });
      if (url.includes('/projects/p:addFirebase')) return ok({ name: 'operations/o2', done: true });
      return apps(url) ?? fail(500, {});
    });
    assert.match(out2, /the Firebase Management API is off in p — switching it on/);
    assert.match(out2, /Firebase Management API enabled ✓/);
    assert.match(out2, /Firebase enabled on p ✓/);
    assert.match(out2, /\[exit 0\]/);

    // (3) THE live refusal (2026-09-08): Firebase Admin granted, Google still says
    // no — the enable right is the gap; the text names it and both ways out
    const calls3 = [];
    const out3 = await setup(async (url) => {
      calls3.push(url);
      if (url.includes('oauth2.googleapis.com')) return ok({ access_token: 'gtok' });
      if (url.endsWith('/projects/p')) return bare;
      if (url.endsWith(ENABLE)) return denied;
      return fail(500, {});
    });
    assert.match(out3, /serviceusage\.services\.enable — the Firebase Admin role does NOT carry it/);
    assert.match(out3, /Service Usage Admin role beside Firebase Admin/);
    assert.match(out3, /iam-admin\/iam\?project=p/);
    assert.match(out3, /add Firebase to p by hand once/);
    assert.match(out3, /\[exit 1\]/);
    assert.ok(!calls3.some((u) => u.includes(':addFirebase')), 'no addFirebase attempt behind a known gap');
    assert.doesNotMatch(out3, /lacks Firebase rights/, 'the old wrong-role diagnosis is gone');

    // (4) no Firebase rights at all: the probe passes, addFirebase itself
    // refuses → Firebase Admin IS the fix, and Google's own words show
    const out4 = await setup(async (url) => {
      if (url.includes('oauth2.googleapis.com')) return ok({ access_token: 'gtok' });
      if (url.endsWith(ENABLE)) return ok({ name: 'operations/su4', done: true });
      return fail(403, { message: 'The caller does not have permission' });
    });
    assert.match(out4, /grant it the Firebase Admin role once/);
    assert.match(out4, /Google: The caller does not have permission/);
    assert.match(out4, /\[exit 1\]/);

    // …and the push pill (store-status) tells the same story BEFORE Build is pressed
    const status = async (fetchImpl) => {
      const res = fakeRes();
      await createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: fetchImpl })(
        fakeReq({ url: '/api/local/store-status?stack=munni-local-prod', token: 'tok' }), res);
      return JSON.parse(res.chunks.join('')).firebase;
    };
    const bareStatus = (enable) => async (url) => {
      if (url.includes('oauth2.googleapis.com')) return ok({ access_token: 'gtok' });
      if (url.endsWith('/projects/p')) return bare;
      if (url.endsWith(ENABLE)) return enable;
      if (url.includes('appstoreconnect')) return ok({ data: [] });
      return fail(404, {});
    };
    const willAdd = await status(bareStatus(ok({ name: 'operations/su5', done: true })));
    assert.equal(willAdd.state, 'missing-app');
    assert.match(willAdd.detail, /p is not a Firebase project yet; Build adds Firebase to it/);
    const blocked = await status(bareStatus(denied));
    assert.equal(blocked.state, 'error');
    assert.match(blocked.detail, /Service Usage Admin role/);
    assert.doesNotMatch(blocked.detail, /Requested entity was not found/, 'the raw 404 text never reaches the pill');
  } finally {
    saveLocalValues(shared, prev);
  }
});

test('apple cert: the machine mints the p12 password, pulls the minted certificate out of the run artifact, refuses without a token', async () => {
  const { zipBuild } = await import('../modules/zip.mjs');
  const shared = loadStack('munni-local-shared');
  const prev = loadLocalValues(shared);
  const { APPLE_DEV_CERT_P12: _p12, APPLE_DEV_CERT_PASSWORD: _pw, APPLE_DEV_CERT_SERIAL: _sn, IAC_GH_PAT: _pat, ...bare } = prev;
  // fake App Store Connect credentials: the status endpoint asks Apple
  // (mocked below) whether the stored certificate is still listed
  const { generateKeyPairSync } = await import('node:crypto');
  const ecPem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  saveLocalValues(shared, { ...bare, ASC_KEY_ID: 'K9', ASC_ISSUER_ID: 'ISS9', ASC_KEY_P8: Buffer.from(ecPem).toString('base64') });
  try {
    const status = async (app2) => {
      const res = fakeRes();
      await app2(fakeReq({ url: '/api/local/apple-cert', token: 'tok' }), res);
      return JSON.parse(res.chunks.join(''));
    };
    assert.deepEqual(await status(app), { present: false, password: false });

    const pw = fakeRes();
    await app(fakeReq({ method: 'POST', url: '/api/local/apple-cert/password', token: 'tok' }), pw);
    const minted = loadLocalValues(shared).APPLE_DEV_CERT_PASSWORD;
    assert.match(minted, /^[0-9a-f]{48}$/, 'a 24-byte hex password lands in the machine store');
    await app(fakeReq({ method: 'POST', url: '/api/local/apple-cert/password', token: 'tok' }), fakeRes());
    assert.equal(loadLocalValues(shared).APPLE_DEV_CERT_PASSWORD, minted, 'minting twice keeps the first password');
    assert.deepEqual(await status(app), { present: false, password: true });

    // no GitHub token in the store → the import names the fix
    const noPat = fakeRes();
    await app(fakeReq({ method: 'POST', url: '/api/local/apple-cert/import', token: 'tok', body: { slug: 'me/munni', runId: 42 } }), noPat);
    await settle(noPat);
    assert.match(noPat.chunks.join(''), /no GitHub token in the machine store/);
    assert.match(noPat.chunks.join(''), /\[exit 1\]/);

    saveLocalValues(shared, { ...loadLocalValues(shared), IAC_GH_PAT: 'ghp_test' });
    const b64 = 'MIIKAQIBAzCCCscGCSqGSIb3DQEHAaCCCrgEggq0'.repeat(4);
    const calls = [];
    const netFetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/actions/runs/42/artifacts')) return { ok: true, status: 200, json: async () => ({ artifacts: [{ id: 7, name: 'apple-dev-cert-p12' }] }) };
      if (url.endsWith('/actions/artifacts/7/zip')) return { ok: false, status: 302, headers: { get: (k) => (k === 'location' ? 'https://blob.example/7.zip' : null) } };
      if (url === 'https://blob.example/7.zip') return { ok: true, status: 200, arrayBuffer: async () => zipBuild({ 'APPLE_DEV_CERT_P12.b64': `${b64}\n`, 'APPLE_DEV_CERT_SERIAL.txt': '0abc123\n' }) };
      if (url.startsWith('https://api.appstoreconnect.apple.com/v1/certificates')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'CERT1', attributes: { serialNumber: 'ABC123', expirationDate: '2099-01-01T00:00:00.000+00:00' } }] }) };
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const app2 = createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl });
    const imp = fakeRes();
    await app2(fakeReq({ method: 'POST', url: '/api/local/apple-cert/import', token: 'tok', body: { slug: 'me/munni', runId: 42 } }), imp);
    await settle(imp);
    const out = imp.chunks.join('');
    assert.match(out, /Apple Development certificate stored in the machine store ✓/);
    assert.match(out, /\[exit 0\]/);
    assert.equal(loadLocalValues(shared).APPLE_DEV_CERT_P12, b64, 'the artifact content (trimmed) is the store value');
    assert.equal(calls[0].init.headers.authorization, 'Bearer ghp_test', 'the machine token lists the artifacts');
    assert.equal(calls[1].init.redirect, 'manual', 'the blob hop is taken WITHOUT the token');
    assert.equal(calls[2].init.headers, undefined);
    assert.equal(loadLocalValues(shared).APPLE_DEV_CERT_SERIAL, 'ABC123', 'the serial file rides along (leading zeros dropped, upper-cased)');
    assert.deepEqual(await status(app2), { present: true, password: true, serial: 'ABC123', apple: { state: 'valid', expires: '2099-01-01T00:00:00.000+00:00', id: 'CERT1' } });

    // Apple no longer lists the serial (revoked) → the wizard forgets the
    // certificate and mints again; the password stays
    const gone = createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'OTHER', attributes: { serialNumber: 'FFFF', expirationDate: '2099-01-01T00:00:00.000+00:00' } }] }) }) });
    assert.equal((await status(gone)).apple.state, 'missing');
    await app(fakeReq({ method: 'POST', url: '/api/local/apple-cert/forget', token: 'tok' }), fakeRes());
    assert.deepEqual(await status(app), { present: false, password: true }, 'forgetting drops the p12 and its serial, keeps the password');

    // a run without the artifact (mint job failed) → named, exit 1
    const none = fakeRes();
    await createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ artifacts: [] }) }) })(
      fakeReq({ method: 'POST', url: '/api/local/apple-cert/import', token: 'tok', body: { slug: 'me/munni', runId: 43 } }), none);
    await settle(none);
    assert.match(none.chunks.join(''), /carries no apple-dev-cert-p12 artifact/);
    assert.match(none.chunks.join(''), /\[exit 1\]/);
  } finally {
    saveLocalValues(shared, prev);
  }
});

test('autonomy: settings persist; a check fetches, pulls only on a clean tree, re-renders after a pull, pulls images and brings the family up; the logon task rides schtasks', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { loadAutonomy, saveAutonomy } = await import('../modules/stack.mjs');
  const envFiles = ['munni-local-shared', 'munni-local-prod'].map((n) => join(SCRATCH, n, `.env.${n}`));
  for (const f of envFiles) { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, 'X=1\n'); }
  const prevState = loadAutonomy();
  try {
    // off by default; turning it on persists (timers are main's business — none here)
    const st0 = fakeRes();
    await app(fakeReq({ url: '/api/local/autonomy', token: 'tok' }), st0);
    const s0 = JSON.parse(st0.chunks.join(''));
    assert.equal(s0.enabled, false);
    assert.equal(s0.intervalMinutes, 10);
    const on = fakeRes();
    await app(fakeReq({ method: 'POST', url: '/api/local/autonomy', token: 'tok', body: { enabled: true, intervalMinutes: 1 } }), on);
    assert.equal(loadAutonomy().enabled, true);
    assert.equal(loadAutonomy().intervalMinutes, 10, 'below the floor the interval stays');
    await app(fakeReq({ method: 'POST', url: '/api/local/autonomy', token: 'tok', body: { intervalMinutes: 30 } }), fakeRes());
    assert.equal(loadAutonomy().intervalMinutes, 30);

    const cycle = async ({ dirty, behind }) => {
      const spawned = [];
      let restarted = 0;
      const outputs = (n, args) => {
        if (args[0] === 'rev-parse') return 'dev\n';
        if (args[0] === 'status') return dirty ? ' M apps/web/tests/screenshots/x.png\n' : '';
        if (args[0] === 'rev-list') return `${behind}\n`;
        if (args.includes('up')) return ' Container munni-local-prod-api-prod-1  Recreated\n Container munni-local-prod-web-prod-1  Running\n';
        return '';
      };
      const app2 = createApp({ token: 'tok', probeImpl: async () => false, spawnImpl: scriptedSpawn(spawned, outputs), restartImpl: () => { restarted += 1; } });
      const res = fakeRes();
      await app2(fakeReq({ method: 'POST', url: '/api/local/autonomy/run', token: 'tok' }), res);
      await settle(res);
      return { out: res.chunks.join(''), spawned, restarted: () => restarted };
    };

    // clean tree, 2 commits behind → pull, re-render both set-up stacks, images, up
    const a = await cycle({ dirty: false, behind: 2 });
    const gitArgs = a.spawned.filter((s) => s.cmd === 'git').map((s) => s.args[0]);
    assert.deepEqual(gitArgs, ['rev-parse', 'status', 'fetch', 'rev-list', 'pull']);
    assert.ok(a.spawned.some((s) => s.cmd === 'git' && s.args.includes('--ff-only')), 'fast-forward only');
    const renders = a.spawned.filter((s) => s.args.includes('--stack')).map((s) => s.args.at(-1));
    assert.deepEqual(renders, ['munni-local-shared', 'munni-local-prod'], 'set-up stacks re-render after a pull; the dev env (never rendered) is skipped');
    assert.ok(a.spawned.some((s) => s.cmd === 'docker' && s.args.includes('pull') && s.args.includes('docker-compose.munni-local-prod.yml')), 'images pulled');
    assert.ok(a.spawned.some((s) => s.cmd === 'docker' && s.args.includes('up') && s.args.includes('docker-compose.munni-local-shared.yml')), 'family brought up');
    assert.match(a.out, /munni-local-dev: not set up yet — skipped/);
    assert.match(a.out, /code pulled; restarted: munni-local-prod-api-prod-1/);
    assert.match(a.out, /the helper restarts itself/);
    assert.match(a.out, /\[exit 0\]/);
    const saved = loadAutonomy().lastResult;
    assert.equal(saved.pulled, true);
    assert.deepEqual(saved.changed, ['munni-local-prod-api-prod-1']);

    // dirty tree, commits waiting → the pull pauses, images still update, no re-render, no restart
    const b = await cycle({ dirty: true, behind: 3 });
    assert.ok(!b.spawned.some((s) => s.cmd === 'git' && s.args[0] === 'pull'), 'no pull on a dirty tree');
    assert.ok(!b.spawned.some((s) => s.args.includes('--stack')), 'no re-render without new code');
    assert.ok(b.spawned.some((s) => s.cmd === 'docker' && s.args.includes('pull')), 'images still pulled');
    assert.match(b.out, /paused: 3 new commit\(s\) on origin\/dev, but this checkout has uncommitted changes \(1 file\(s\)\)/);
    assert.doesNotMatch(b.out, /restarts itself/);
    assert.equal(loadAutonomy().lastResult.paused.startsWith('3 new commit'), true);

    // up to date → nothing pulled, nothing re-rendered
    const c = await cycle({ dirty: false, behind: 0 });
    assert.match(c.out, /up to date with origin\/dev/);
    assert.match(c.out, /code unchanged/);

    // status carries the checkout facts the card shows
    const st = fakeRes();
    await createApp({ token: 'tok', probeImpl: async () => false, spawnImpl: scriptedSpawn([], (n, args) => (args[0] === 'rev-parse' ? 'dev\n' : '')) })(
      fakeReq({ url: '/api/local/autonomy', token: 'tok' }), st);
    const s1 = JSON.parse(st.chunks.join(''));
    assert.equal(s1.branch, 'dev');
    assert.equal(s1.enabled, true);
    assert.equal(s1.running, false);
    assert.equal(s1.armed, false, 'tests never arm the timer');
    assert.equal(s1.logonTask, process.platform === 'win32' ? true : null);

    // the logon task: Task Scheduler on Windows, a clear no on other platforms
    const spawned = [];
    const logon = fakeRes();
    await createApp({ token: 'tok', probeImpl: async () => false, spawnImpl: scriptedSpawn(spawned, () => 'SUCCESS\n') })(
      fakeReq({ method: 'POST', url: '/api/local/autonomy/logon', token: 'tok', body: { install: true } }), logon);
    await settle(logon);
    const lo = logon.chunks.join('');
    if (process.platform === 'win32') {
      // the ScheduledTasks module, not schtasks.exe: an ONLOGON trigger
      // through schtasks needs elevation (Access is denied, live 2026-09-08)
      const create = spawned.find((s) => s.cmd === 'powershell.exe');
      const script = create.args.at(-1);
      assert.ok(create.args.includes('-NonInteractive'));
      assert.match(script, /New-ScheduledTaskTrigger -AtLogOn -User \$env:USERNAME/);
      assert.match(script, /-LogonType Interactive -RunLevel Limited/);
      assert.match(script, /Register-ScheduledTask -TaskName 'munni local helper'/);
      assert.match(script, /autonomy\.cmd/);
      assert.match(lo, /starts at every logon/);
      assert.match(lo, /\[exit 0\]/);
      const off = fakeRes();
      await createApp({ token: 'tok', probeImpl: async () => false, spawnImpl: scriptedSpawn(spawned, () => '') })(
        fakeReq({ method: 'POST', url: '/api/local/autonomy/logon', token: 'tok', body: { install: false } }), off);
      await settle(off);
      assert.match(spawned.at(-1).args.at(-1), /Unregister-ScheduledTask -TaskName 'munni local helper'/);
    } else {
      assert.match(lo, /Windows-only/);
      assert.match(lo, /\[exit 1\]/);
    }
  } finally {
    saveAutonomy(prevState);
    for (const f of envFiles) rmSync(f, { force: true });
  }
});

test('cleanup-check: family docker resources count by compose PROJECT — the dev loop and munni-sonar do not', async () => {
  const spawned = [];
  const outputs = (n, args) => {
    if (args[0] === 'ps') return 'munni-local-shared-vaultwarden-1\tmunni-local-shared\nmunni-local-api-1\tmunni-local\nkavita-1\tprojects\n';
    if (args[0] === 'volume') return 'munni-local-shared_vaultdata\nmunni-local_pgdata\nmunni-sonar_sonar_data\n';
    return 'munni-local-shared-net\nmunni-local_default\nbridge\n';
  };
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, outputs), probeImpl: async () => false });
  const res = fakeRes();
  await app2(fakeReq({ url: '/api/local/cleanup-check', token: 'tok' }), res);
  await settle(res);
  const body = JSON.parse(res.chunks.join(''));
  assert.equal(body.clean, false);
  assert.ok(body.leftovers.includes('container munni-local-shared-vaultwarden-1'));
  assert.ok(!body.leftovers.includes('container munni-local-api-1'), 'the from-source dev loop (project munni-local) is a different lifecycle');
  assert.ok(body.leftovers.includes('volume munni-local-shared_vaultdata'));
  assert.ok(!body.leftovers.includes('volume munni-local_pgdata'));
  assert.ok(!body.leftovers.some((l) => l.includes('munni-sonar')), 'sonar tooling is not family residue');
  assert.ok(body.leftovers.includes('network munni-local-shared-net'));
  assert.ok(body.leftovers.includes('registry entry prod'), 'registry entries are leftovers too');
});

// LAST on purpose: it empties the registry the other tests rely on
test('delete-everything epilogue: forget-all wipes registry, env stores, LAN marker and the shared render — then cleanup-check reports CLEAN', async () => {
  const { existsSync: ex, writeFileSync: wf } = await import('node:fs');
  assert.ok(LOCAL_STACKS().length > 1, 'environments exist before');
  // residue that kept the wizard's Delete button armed (user report
  // 2026-09-04): the LAN marker and the shared stack's render artifacts
  wf(join(SCRATCH, 'lan-host'), '192.168.2.2\n');
  wf(join(SCRATCH, 'munni-local-shared', '.env.munni-local-shared'), 'X=1\n');
  wf(join(SCRATCH, 'munni-local-shared', 'Caddyfile'), '# tls\n');
  const res = fakeRes();
  await app(fakeReq({ method: 'POST', url: '/api/local/envs/forget-all', token: 'tok', body: {} }), res);
  const body = JSON.parse(res.chunks.join(''));
  assert.ok(body.forgotten.includes('prod'));
  assert.deepEqual(LOCAL_STACKS(), ['munni-local-shared'], 'only the shared stack remains');
  assert.ok(!ex(join(SCRATCH, 'munni-local-prod')), 'prod rendered dir (its store included) is gone');
  assert.ok(!ex(join(SCRATCH, 'lan-host')), 'the LAN marker dies with the family');
  assert.ok(!ex(join(SCRATCH, 'munni-local-shared', '.env.munni-local-shared')), 'the shared render is stripped');
  assert.ok(!ex(join(SCRATCH, 'munni-local-shared', 'Caddyfile')));
  assert.ok(ex(join(SCRATCH, 'munni-local-shared', '.secrets.local.json')), 'the credential store SURVIVES');
  assert.ok(ex(join(SCRATCH, 'munni-local-shared', 'upload-cert.pem')), 'the upload keystore certificate SURVIVES');
  // and the verification the wizard runs right after agrees: clean
  const spawned = [];
  const app2 = createApp({ token: 'tok', spawnImpl: scriptedSpawn(spawned, () => ''), probeImpl: async () => false });
  const chk = fakeRes();
  await app2(fakeReq({ url: '/api/local/cleanup-check', token: 'tok' }), chk);
  await settle(chk);
  const verdict = JSON.parse(chk.chunks.join(''));
  assert.equal(verdict.clean, true, `leftovers: ${verdict.leftovers?.join(', ')}`);
  assert.ok(verdict.kept.includes('the step-3 credential store'));
  assert.ok(verdict.kept.includes('the upload keystore certificate'));
  // native-config now refuses cleanly instead of crashing on a phantom env
  const nc = fakeRes();
  await app(fakeReq({ url: '/api/local/native-config', token: 'tok' }), nc);
  assert.equal(nc.statusCode, 400);
  // …and Check still works with ZERO environments (user report
  // 2026-09-08: the ascstore check answered 500 "unknown stack" mid
  // delete/recreate) — the endpoint falls back to the SHARED store.
  // The REAL validator runs here: neither path below touches the network
  const appReal = createApp({ token: 'tok', probeImpl: async () => false });
  const val = fakeRes();
  await appReal(fakeReq({ method: 'POST', url: '/api/validate', token: 'tok', body: { provider: 'ascstore', values: {} } }), val);
  assert.equal(val.statusCode, 200, val.chunks.join(''));
  const ascVerdict = JSON.parse(val.chunks.join(''));
  assert.equal(ascVerdict.ok, false);
  assert.match(ascVerdict.detail, /missing/, 'a real verdict, not an unknown-stack crash');
  // a validator that NEEDS an environment says so instead of throwing
  const m2m = fakeRes();
  await appReal(fakeReq({ method: 'POST', url: '/api/validate', token: 'tok', body: { provider: 'logto-m2m', values: { IAC_LOGTO_INFRA_M2M_ID: 'x', IAC_LOGTO_INFRA_M2M_SECRET: 'y' } } }), m2m);
  assert.equal(m2m.statusCode, 200);
  assert.match(JSON.parse(m2m.chunks.join('')).detail, /no local environment exists yet/);
  // SAVE routes to the shared stack too (second 2026-09-08 report: the
  // step-3 Save spawned bootstrap on the phantom prod env and died)
  runs.length = 0;
  await app(fakeReq({ method: 'POST', url: '/api/local/run', token: 'tok', body: { values: { NAS_GHCR_PAT: 'x' } } }), fakeRes());
  assert.ok(runs[0].args.join(' ').includes('--stack munni-local-shared'), 'zero environments → the shared stack takes the save');
});

test('ca trust + registry: fingerprints compare hex-only on the sha1 line; the registry probe reads anonymous pulls; unknown when unreachable', async () => {
  const { caListingHasFingerprint } = await import('../setup/serve.mjs');
  const fp = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01';
  assert.equal(caListingHasFingerprint('Cert Hash(sha1): ab cd ef 01 23 45 67 89 ab cd ef 01 23 45 67 89 ab cd ef 01\n', fp), true, 'spaced hex (older certutil)');
  assert.equal(caListingHasFingerprint('Cert Hash(sha1): abcdef0123456789abcdef0123456789abcdef01', fp), true, 'compact hex');
  assert.equal(caListingHasFingerprint('Cert Hash(sha1): 0000000000000000000000000000000000000000', fp), false);
  assert.equal(caListingHasFingerprint('Cert Hash(sha256): abcdef0123456789abcdef0123456789abcdef01', fp), false, 'only the sha1 line counts');
  assert.equal(caListingHasFingerprint('', fp), false);

  const body = async (app2, path) => { const res = fakeRes(); await app2(fakeReq({ url: path, token: 'tok' }), res); return JSON.parse(res.chunks.join('')); };
  const withToken = (manifest) => async (url) => (url.includes('/token?') ? { ok: true, status: 200, json: async () => ({ token: 'anon' }) } : manifest);
  const pub = await body(createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: withToken({ ok: true, status: 200 }) }), '/api/local/registry?force=1');
  assert.equal(pub.public, true);
  assert.match(pub.detail, /public/);
  assert.match(pub.image, /^ghcr\.io\/.+\/munni-web$/);
  const priv = await body(createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: withToken({ ok: false, status: 401 }) }), '/api/local/registry?force=1');
  assert.equal(priv.public, false);
  assert.match(priv.detail, /401.*read:packages/);
  const down = await body(createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: async () => { throw new Error('offline'); } }), '/api/local/registry?force=1');
  assert.equal(down.public, null);
  assert.match(down.detail, /could not reach/);

  // the trust probe: without LAN mode, off Windows, or with the CA site down the verdict is unknown — never a false "trusted"
  const trust = await body(createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl: async () => ({ ok: false, status: 503 }) }), '/api/local/ca-trust?force=1');
  assert.equal(trust.trusted, null);
  assert.match(trust.reason, /LAN mode is off|not Windows|not up/);
});

test('nas-probe: every host names the one-time step it is missing — dns, wildcard certificate, reverse-proxy rule, applied bundle', async () => {
  const tlsErr = (code) => { const e = new Error('fetch failed'); e.cause = { code }; return e; };
  const netFetchImpl = async (url) => {
    if (/^https:\/\/munni-iac\.nas\.example\//.test(url)) return { status: 200, text: async () => '<html><title>Hello! Welcome to Synology Web Station!</title></html>' };
    if (/^https:\/\/munni-iac-api\.nas\.example\//.test(url)) throw tlsErr('ERR_TLS_CERT_ALTNAME_INVALID');
    if (/^https:\/\/munni-iac-admin\.nas\.example\//.test(url)) return { status: 502, text: async () => '' };
    if (/^https:\/\/logto-iac\.nas\.example\//.test(url)) return { status: 302, text: async () => '' };
    if (/^https:\/\/vault-iac\.nas\.example\//.test(url)) throw tlsErr('ENOTFOUND');
    return { status: 200, text: async () => '<html><title>munni</title></html>' };
  };
  // the unverified second look after a name mismatch sees Web Station behind the api host
  const vaultFetchImpl = async () => ({ status: 200, text: async () => '<title>Hello! Welcome to Synology Web Station!</title>' });
  const app2 = createApp({ token: 'tok', probeImpl: async () => false, netFetchImpl, vaultFetchImpl });
  const bad = fakeRes();
  await app2(fakeReq({ url: '/api/local/nas-probe?domain=not%20a%20host', token: 'tok' }), bad);
  assert.equal(bad.statusCode, 400);
  const res = fakeRes();
  await app2(fakeReq({ url: '/api/local/nas-probe?domain=nas.example&force=1', token: 'tok' }), res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.chunks.join(''));
  assert.deepEqual(body.stacks.map((s) => s.stack), ['munni-iac-prod', 'munni-iac-staging']);
  const prod = Object.fromEntries(body.stacks[0].hosts.map((h) => [h.key, h]));
  assert.equal(prod.web.host, 'munni-iac.nas.example');
  assert.equal(prod.web.state, 'no-rule');
  assert.match(prod.web.detail, /Web Station/);
  assert.equal(prod.api.state, 'no-cert');
  assert.match(prod.api.detail, /wildcard/);
  assert.equal(prod.api.behind, 'no-rule', 'the certificate hides nothing: the rule state is read unverified');
  assert.ok(body.summary.rulesMissing >= 2, 'web (no-rule) and api (behind: no-rule) both count');
  assert.equal(prod.admin.state, 'no-container');
  assert.match(prod.admin.detail, /poller/);
  assert.equal(prod.logto.state, 'up');
  assert.equal(prod.vault.state, 'no-dns');
  assert.equal(body.summary.certificate, false);
  assert.equal(body.summary.dns, false);
  assert.ok(body.summary.rulesMissing >= 1);
  assert.ok(body.summary.containersMissing >= 1);
  assert.equal(process.env.IAC_DOMAIN, undefined, 'the probe restores the environment it borrowed');
});
