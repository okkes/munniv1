// The local three-stack family (plans LS1-LS3): shared/prod/dev stack
// contracts — url shapes, ownership-routed stores, legacy migration,
// rendering. MUNNI_RENDER_DIR sends every write into a throwaway dir —
// set BEFORE the modules load (they read it at import time).
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const SCRATCH = mkdtempSync(join(tmpdir(), 'munni-infra-test-'));
process.env.MUNNI_RENDER_DIR = SCRATCH;
process.env.IAC_DOMAIN = 'example.test';
// no registry file = no environments now — seed the classic prod+dev pair
writeFileSync(join(SCRATCH, 'local-envs.json'), JSON.stringify({ envs: [
  { name: 'prod', channel: 'dev', slot: 0 },
  { name: 'dev', channel: 'dev', slot: 1 },
] }));

const { lanHost, loadStack, sharedOf } = await import('../modules/stack.mjs');
const { ensureLocalSecrets, familyValues, loadLocalValues, saveLocalValues } = await import('../modules/localstore.mjs');
const { renderStack, templatePlaceholders } = await import('../modules/render.mjs');
const { appDefinitions } = await import('../modules/logto.mjs');

test.after(() => rmSync(SCRATCH, { recursive: true, force: true }));

test('the family derives plain-http localhost urls per stack', () => {
  const prod = loadStack('munni-local-prod');
  assert.equal(prod.urls.web, 'http://localhost:8380');
  assert.equal(prod.urls.logtoAdmin, 'http://localhost:3202');
  assert.equal(prod.urls.glitchtip, undefined, 'env stacks have no glitchtip of their own');
  const dev = loadStack('munni-local-dev');
  assert.equal(dev.urls.web, 'http://localhost:8480');
  assert.equal(dev.urls.logto, 'http://localhost:3301');
  const shared = loadStack('munni-local-shared');
  assert.equal(shared.urls.glitchtip, 'http://localhost:8383');
  // the vault is https even locally (Caddy sidecar, Bitwarden client rule)
  assert.equal(shared.urls.vault, 'https://localhost:8384');
  assert.equal(shared.urls.control, 'http://localhost:8385');
  assert.equal(shared.urls.pgadmin, 'http://localhost:8386');
  assert.equal(sharedOf(prod).stack, 'munni-local-shared');
});

test('the legacy single-twin store migrates by ownership', () => {
  // simulate the retired munni-local store with mixed values
  mkdirSync(join(SCRATCH, 'munni-local'), { recursive: true });
  writeFileSync(join(SCRATCH, 'munni-local', '.secrets.local.json'), JSON.stringify({
    NAS_GHCR_PAT: 'ghp_legacy',
    NAS_POSTGRES_PASSWORD: 'pg_legacy',
    VITE_LOGTO_APP_ID: 'web-legacy',
    NAS_ADMIN_SUBS: 'usr_legacy',
  }));
  const prod = loadStack('munni-local-prod');
  const own = loadLocalValues(prod);
  assert.equal(own.VITE_LOGTO_APP_ID, 'web-legacy');
  assert.equal(own.NAS_ADMIN_SUBS, 'usr_legacy');
  // postgres passwords are PER-STACK now — the legacy value seeds prod
  assert.equal(own.NAS_POSTGRES_PASSWORD, 'pg_legacy');
  assert.equal(own.NAS_GHCR_PAT, undefined, 'shared names must not land in the env store');
  const merged = familyValues(prod);
  assert.equal(merged.NAS_GHCR_PAT, 'ghp_legacy');
  // dev starts CLEAN — no leaked env values from prod's past
  const dev = loadLocalValues(loadStack('munni-local-dev'));
  assert.equal(dev.VITE_LOGTO_APP_ID, undefined);
  assert.equal(dev.NAS_POSTGRES_PASSWORD, undefined, 'each stack mints its OWN postgres password');
});

test('minting follows ownership: every stack its own postgres password, shared owns glitchtip + pgadmin, envs own VAPID', () => {
  const shared = loadStack('munni-local-shared');
  const sharedRun = ensureLocalSecrets(shared, {});
  assert.ok(sharedRun.values.NAS_GLITCHTIP_SECRET_KEY);
  assert.ok(sharedRun.values.NAS_PGADMIN_PASSWORD, 'shared mints the pgAdmin login');
  assert.ok(sharedRun.minted.includes('NAS_POSTGRES_PASSWORD'), 'shared mints glitchtip-db its own password');
  assert.ok(!sharedRun.minted.includes('NAS_PUSH_VAPID_PUBLIC_KEY'), 'shared must not mint VAPID');

  const prod = loadStack('munni-local-prod');
  const prodRun = ensureLocalSecrets(prod, {});
  assert.ok(prodRun.values.NAS_PUSH_VAPID_PUBLIC_KEY);
  assert.ok(!prodRun.minted.includes('NAS_POSTGRES_PASSWORD'), 'prod keeps its legacy-seeded password');
  assert.equal(loadLocalValues(prod).NAS_POSTGRES_PASSWORD, 'pg_legacy');
  assert.ok(!prodRun.minted.includes('NAS_PGADMIN_PASSWORD'), 'envs must not mint the shared pgAdmin login');

  const dev = loadStack('munni-local-dev');
  const devRun = ensureLocalSecrets(dev, {});
  assert.ok(devRun.minted.includes('NAS_POSTGRES_PASSWORD'), 'dev mints its OWN password');
  const pw = {
    shared: loadLocalValues(shared).NAS_POSTGRES_PASSWORD,
    prod: loadLocalValues(prod).NAS_POSTGRES_PASSWORD,
    dev: loadLocalValues(dev).NAS_POSTGRES_PASSWORD,
  };
  assert.ok(pw.shared);
  assert.ok(pw.prod);
  assert.ok(pw.dev);
  assert.notEqual(pw.dev, pw.prod, 'isolation: no two servers share a password');
  assert.notEqual(pw.dev, pw.shared);
  assert.notEqual(pw.prod, pw.shared);

  const again = ensureLocalSecrets(prod, {});
  assert.deepEqual(again.minted, [], 'stable across re-runs');
  assert.equal(again.values.NAS_PUSH_VAPID_PUBLIC_KEY, prodRun.values.NAS_PUSH_VAPID_PUBLIC_KEY);
});

test('saving a shared-owned name from an env stack routes to the shared store', () => {
  const prod = loadStack('munni-local-prod');
  saveLocalValues(prod, { ...familyValues(prod), NAS_GOCARDLESS_SECRET_ID: 'gc-route-1' });
  assert.equal(loadLocalValues(prod).NAS_GOCARDLESS_SECRET_ID, undefined);
  assert.equal(loadLocalValues(loadStack('munni-local-shared')).NAS_GOCARDLESS_SECRET_ID, 'gc-route-1');
  assert.equal(familyValues(loadStack('munni-local-dev')).NAS_GOCARDLESS_SECRET_ID, 'gc-route-1', 'the whole family sees it');
});

test('shared render: glitchtip with own db + vault + ocr + control + pgadmin over the family', () => {
  const shared = loadStack('munni-local-shared');
  const dir = renderStack(shared, familyValues(shared));
  const compose = readFileSync(join(dir, 'docker-compose.munni-local-shared.yml'), 'utf8');
  for (const marker of ['vaultwarden/server', 'glitchtip/glitchtip', 'hertzg/tesseract-server', 'munni-local-shared-net', 'munni-control:', '"8385:80"', 'dpage/pgadmin4', '"8386:80"', 'glitchtip-db:5432/glitchtip']) {
    assert.ok(compose.includes(marker), `shared compose lacks ${marker}`);
  }
  assert.ok(!compose.includes('CREATE DATABASE'), 'no consumer databases here — envs run their own postgres');
  const servers = JSON.parse(readFileSync(join(dir, 'pgadmin-servers.json'), 'utf8'));
  const hosts = Object.values(servers.Servers).map((s) => s.Host);
  assert.deepEqual(hosts.sort((a, b) => a.localeCompare(b)), ['glitchtip-db', 'postgres-dev', 'postgres-prod']);
});

test('env render: own logto, OWN postgres with a pgadmin alias, no glitchtip service', () => {
  const dev = loadStack('munni-local-dev');
  const dir = renderStack(dev, familyValues(dev));
  const compose = readFileSync(join(dir, 'docker-compose.munni-local-dev.yml'), 'utf8');
  assert.ok(compose.includes('postgres-dev:'), 'UNIQUE service name — plain "postgres" collides across envs on the shared net');
  assert.ok(!/\n {2}postgres:\n/.test(compose), 'no ambiguous plain postgres service');
  assert.ok(compose.includes('aliases: [postgres]'), 'in-stack consumers keep the plain name via a default-net alias');
  assert.ok(compose.includes('Database=munni;'));
  assert.ok(compose.includes('postgres:5432/logto'));
  assert.ok(compose.includes('external: true'));
  assert.ok(compose.includes('munni-local-shared-net'));
  assert.ok(compose.includes('MUNNI_CHANNEL: staging'));
  assert.ok(compose.includes('Auth__RequireHttps: "false"'));
  assert.ok(!compose.includes('glitchtip/glitchtip'), 'env stacks must not run their own glitchtip');
  const initdb = readFileSync(join(dir, 'initdb', '01-create-databases.sql'), 'utf8');
  assert.ok(initdb.includes('CREATE DATABASE logto;'));
  const env = readFileSync(join(dir, '.env.munni-local-dev'), 'utf8');
  assert.ok(!env.includes('${'), 'placeholders survived the env render');
});

test('LAN mode: the marker file moves every local url onto https sslip.io hostnames, localhost stays a twin', () => {
  writeFileSync(join(SCRATCH, 'lan-host'), '192.168.1.50\n');
  try {
    assert.equal(lanHost(), '192.168.1.50');
    const prod = loadStack('munni-local-prod');
    assert.equal(prod.urls.web, 'https://munni-prod.192-168-1-50.sslip.io');
    assert.equal(prod.urls.admin, 'https://munni-prod-admin.192-168-1-50.sslip.io');
    assert.equal(prod.urls.api, 'https://munni-prod-api.192-168-1-50.sslip.io');
    assert.equal(prod.urls.logto, 'https://munni-prod-logto.192-168-1-50.sslip.io');
    const shared = loadStack('munni-local-shared');
    assert.equal(shared.urls.glitchtip, 'https://glitchtip.192-168-1-50.sslip.io');
    assert.equal(shared.urls.vault, 'https://vault.192-168-1-50.sslip.io');
    // sign-in accepts BOTH forms so host-browser use keeps working
    const apps = appDefinitions(prod);
    assert.deepEqual(apps.web.oidcClientMetadata.redirectUris, [
      'https://munni-prod.192-168-1-50.sslip.io/auth-callback',
      'http://localhost:8380/auth-callback',
    ]);
    assert.ok(apps.web.customClientMetadata.corsAllowedOrigins.includes('http://localhost:8380'));
    // the api's CORS carries the https origin AND the localhost twins
    const dir = renderStack(prod, familyValues(prod));
    const compose = readFileSync(join(dir, 'docker-compose.munni-local-prod.yml'), 'utf8');
    assert.ok(compose.includes('postgres-prod:'), 'unique pg service name under LAN mode too');
    // PINNED tag: a floating postgres:18-alpine pull jumped image data
    // layouts and re-initialized a live cluster (found live 2026-08-28)
    assert.ok(compose.includes('image: postgres:18.6-alpine'), 'postgres image stays pinned');
    // the same unique-name rule covers every service on the shared net
    for (const svc of ['web-prod:', 'admin-prod:', 'api-prod:', 'logto-prod:']) {
      assert.ok(compose.includes(svc), `${svc} carries the env suffix (shared-net DNS collisions)`);
    }
    assert.ok(compose.includes('aliases: [logto]'), 'in-stack alias keeps plain names working');
    assert.ok(compose.includes('Cors__Origins__0: https://munni-prod.192-168-1-50.sslip.io'));
    assert.ok(compose.includes('http://localhost:8380'));
    assert.ok(compose.includes('http://localhost:8381'));
    // munni-control lives on its OWN origin and calls this api — CORS
    // must let it in (found live: blocked ping read as "not an admin")
    assert.ok(compose.includes('https://control.192-168-1-50.sslip.io'), 'control origin in the api CORS');
    assert.ok(compose.includes('http://localhost:8385'), 'control localhost twin in the api CORS');
    // logto sits behind the family Caddy now — it must trust the proxy
    assert.ok(compose.includes('TRUST_PROXY_HEADER: "1"'));
    // the family Caddy terminates tls for every env + shared service and
    // serves its root CA for phone installs
    const sharedDir = renderStack(shared, familyValues(shared));
    const caddy = readFileSync(join(sharedDir, 'Caddyfile'), 'utf8');
    assert.ok(caddy.includes('local_certs'));
    assert.ok(caddy.includes('https://munni-prod.192-168-1-50.sslip.io'));
    assert.ok(caddy.includes('https://munni-prod-logto.192-168-1-50.sslip.io'));
    assert.ok(caddy.includes('https://glitchtip.192-168-1-50.sslip.io'));
    assert.ok(caddy.includes('https://localhost:8384'), 'vault keeps its localhost https site as a twin');
    assert.ok(caddy.includes('http://ca.192-168-1-50.sslip.io'), 'root CA download site');
    assert.ok(caddy.includes('application/x-x509-ca-cert'), 'root.crt downloads as a certificate, not inline text');
  } finally {
    rmSync(join(SCRATCH, 'lan-host'), { force: true });
  }
  assert.equal(lanHost(), null);
  assert.equal(loadStack('munni-local-prod').urls.web, 'http://localhost:8380', 'deleting the marker flips back');
  assert.equal(loadStack('munni-local-shared').urls.vault, 'https://localhost:8384', 'vault stays https even without LAN');
  renderStack(loadStack('munni-local-prod'), familyValues(loadStack('munni-local-prod'))); // leave a localhost render behind
});

test('iac render keeps the CI placeholder contract and the runtime-config overlay', () => {
  const stack = loadStack('munni-iac-prod');
  const dir = renderStack(stack);
  const compose = readFileSync(join(dir, 'docker-compose.munni-iac-prod.yml'), 'utf8');
  assert.ok(compose.includes('MUNNI_LOGTO_APP_ID: ${WEB_LOGTO_APP_ID}'));
  assert.ok(compose.includes('MUNNI_GLITCHTIP_DSN: ${ADMIN_GLITCHTIP_DSN}'));
  assert.ok(compose.includes('MUNNI_PUBLIC_ORIGIN: https://munni-iac.example.test'));
  assert.ok(compose.includes('extra_hosts'));
  assert.ok(compose.includes('vaultwarden/server'), 'the iac prod twin keeps the pair vault');
  assert.ok(!compose.includes('Auth__RequireHttps'), 'hosted stacks stay https-strict');
  const placeholders = templatePlaceholders(stack);
  for (const name of ['NAS_GHCR_PAT', 'VITE_LOGTO_APP_ID', 'VITE_LOGTO_APP_ID_ADMIN', 'VITE_GLITCHTIP_DSN', 'VITE_GLITCHTIP_DSN_ADMIN', 'VAULT_SIGNUPS_ALLOWED']) {
    assert.ok(placeholders.includes(name), `${name} missing from the iac env template`);
  }
});
