import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanHost, loadStack, localEnvRegistry, pairProd } from './stack.mjs';

/** the docker network local env stacks share with munni-local-shared */
export const LOCAL_SHARED_NET = 'munni-local-shared-net';

// MUNNI_RENDER_DIR: test override so specs never touch a real rendered/
const OUT_DIR = process.env.MUNNI_RENDER_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'rendered');

/**
 * Render docker-compose.<stack>.yml + .env.<stack> (NAS_* placeholder
 * template, same contract as deploy/env/.env.nas: CI substitutes the
 * placeholders from the stack's GitHub Environment secrets + variables at
 * bundle time — deploy/nas/render-env.sh). Output goes to
 * infra/rendered/<stack>/ and ships through the SAME NAS bundle pipeline
 * as the live stacks — just its own channel (deploy-nas.yml).
 *
 * `values` (local target only): a name→value map that substitutes the
 * placeholders right here, producing a runnable .env with the minted
 * secrets inline — nothing GitHub-side is involved for the local twin.
 */
export function renderStack(stack, values) {
  const dir = join(OUT_DIR, stack.stack);
  mkdirSync(join(dir, 'initdb'), { recursive: true });

  if (stack.target === 'local' && stack.role === 'shared') {
    // the local SHARED stack (plan LS1): glitchtip (own db), vault, ocr,
    // munni-control, pgAdmin — plus the family Caddy (https everywhere)
    writeFileSync(join(dir, `docker-compose.${stack.stack}.yml`), sharedLocalCompose(stack));
    writeFileSync(join(dir, `.env.${stack.stack}`), substitute(sharedLocalTemplate(stack), values));
    writeFileSync(join(dir, 'pgadmin-servers.json'), `${pgadminServers()}\n`);
    writeFileSync(join(dir, 'Caddyfile'), familyCaddyfile(stack));
    return dir;
  }

  if (stack.target === 'local' && stack.sharedStack) {
    // a local ENV stack (plan LS2/LS3): web/admin/api + its OWN logto
    // and OWN postgres, riding the shared stack only for glitchtip/ocr
    writeFileSync(join(dir, `docker-compose.${stack.stack}.yml`), envLocalCompose(stack));
    writeFileSync(join(dir, `.env.${stack.stack}`), substitute(envLocalTemplate(stack), values));
    writeFileSync(join(dir, 'initdb', '01-create-databases.sql'), 'CREATE DATABASE logto;\n');
    return dir;
  }

  const pair = pairProd(stack);
  writeFileSync(join(dir, `docker-compose.${stack.stack}.yml`), compose(stack, pair));
  writeFileSync(join(dir, `.env.${stack.stack}`), envFile(stack, values));
  // first postgres boot: side databases for the pair's shared services
  writeFileSync(
    join(dir, 'initdb', '01-create-databases.sql'),
    stack.sharedServices ? 'CREATE DATABASE logto;\nCREATE DATABASE glitchtip;\n' : '-- no side databases: shared services live on the prod twin\n',
  );
  return dir;
}

const substitute = (text, values) =>
  values ? text.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, name) => String(values[name] ?? '').replaceAll("'", '')) : text;

function composeHeader(s) {
  const p = s.ports;
  if (s.target === 'local') return '# Local twin: everything on localhost, plain http, no reverse proxy.';
  const sharedHosts = s.sharedServices
    ? `,\n# ${s.host('logto')} -> :${p.logto}, ${s.host('logtoAdmin')} -> :${p.logtoAdmin} (LAN only), ${s.host('glitchtip')} -> :${p.glitchtip}`
    : '';
  return `# Reverse proxy (DSM): ${s.host('web')} -> :${p.web}, ${s.host('api')} -> :${p.api},
# ${s.host('admin')} -> :${p.admin} (LAN only)${sharedHosts}`;
}

function compose(s, pair) {
  const shared = s.sharedServices;
  const local = s.target === 'local';
  const p = s.ports;
  return `# ${s.stack} — RENDERED by infra/bootstrap.mjs, do not edit by hand.
${composeHeader(s)}
${local ? `
# explicit project name: the dev stack (deploy/docker-compose.local.yml)
# already OWNS the "munni-local" project — without this line the twin
# rendered into a same-named directory would absorb/recreate the dev
# stack's containers mid-flight (live incident 2026-08-26: postgres got
# recreated under a seeding Logto, leaving a half-seeded db in a
# crash-loop)
name: ${s.stack}-twin
` : ''}
services:
  web:
    image: \${REGISTRY}/munni-web:\${TAG}
    restart: unless-stopped
    # runtime-config overlay: the image is stack-agnostic; these MUNNI_*
    # vars become /runtime-config.js at container start
    environment:
      MUNNI_API_URL: ${s.urls.api}
      MUNNI_LOGTO_ENDPOINT: ${pair.urls.logto}
      MUNNI_LOGTO_APP_ID: \${WEB_LOGTO_APP_ID}
      MUNNI_LOGTO_RESOURCE: ${s.urls.api}
      MUNNI_GLITCHTIP_DSN: \${WEB_GLITCHTIP_DSN}
      MUNNI_CHANNEL: ${s.role === 'prod' ? 'production' : 'staging'}
      MUNNI_NATIVE_SCHEME: ${s.native.scheme}
      MUNNI_PUBLIC_ORIGIN: ${s.urls.web}
    ports:
      - "${p.web}:80"

  admin:
    image: \${REGISTRY}/munni-admin:\${TAG}
    restart: unless-stopped
    environment:
      MUNNI_API_URL: ${s.urls.api}
      MUNNI_LOGTO_ENDPOINT: ${pair.urls.logto}
      MUNNI_LOGTO_APP_ID: \${ADMIN_LOGTO_APP_ID}
      MUNNI_LOGTO_RESOURCE: ${s.urls.api}
      MUNNI_GLITCHTIP_DSN: \${ADMIN_GLITCHTIP_DSN}
    ports:
      - "${p.admin}:80"

  api:
    image: \${REGISTRY}/munni-api:\${TAG}
    restart: unless-stopped
    environment:
      ASPNETCORE_URLS: http://+:8080
      ConnectionStrings__Db: Host=postgres;Database=munni;Username=munni;Password=\${POSTGRES_PASSWORD}
      Db__AutoMigrate: "true"
      Auth__Authority: ${pair.urls.logto}/oidc${local ? `
      # localhost issuer for browsers; metadata fetched in-network over http
      Auth__MetadataAddress: http://logto:${p.logto}/oidc/.well-known/openid-configuration
      Auth__RequireHttps: "false"` : ''}
      Auth__Audience: ${s.urls.api}
      Cors__Origins__0: ${s.urls.web}
      Cors__Origins__1: ${s.urls.admin}
      Cors__Origins__2: https://localhost
      Cors__Origins__3: capacitor://localhost
      GoCardless__SecretId: \${GOCARDLESS_SECRET_ID}
      GoCardless__SecretKey: \${GOCARDLESS_SECRET_KEY}
      EnableBanking__ApplicationId: \${ENABLEBANKING_APPLICATION_ID:-}
      EnableBanking__PrivateKeyPem: \${ENABLEBANKING_PRIVATE_KEY_PEM:-}
      Push__VapidPublicKey: \${PUSH_VAPID_PUBLIC_KEY:-}
      Push__VapidPrivateKey: \${PUSH_VAPID_PRIVATE_KEY:-}
      Push__Subject: \${PUSH_VAPID_SUBJECT:-mailto:admin@localhost}
      Fcm__ServiceAccountJson: \${FCM_SERVICE_ACCOUNT_JSON:-}
      Logos__SecretKey: \${LOGODEV_SECRET_KEY:-}
      Logos__PublicToken: \${LOGODEV_PUBLIC_TOKEN:-}
      Admin__Subs: \${ADMIN_SUBS:-}
      Sentry__Dsn: \${API_SENTRY_DSN:-}
      Logto__M2mAppId: \${LOGTO_M2M_APP_ID:-}
      Logto__M2mAppSecret: \${LOGTO_M2M_APP_SECRET:-}${s.role === 'staging' ? '\n      # staging must never delete a shared-Logto identity\n      Logto__DeleteIdentityOnAccountDeletion: "false"' : ''}
      BUILD_NUMBER: \${TAG}
      Ocr__BaseUrl: http://ocr:8884
    ports:
      - "${p.api}:8080"
    depends_on:
      postgres:
        condition: service_healthy

  ocr:
    image: hertzg/tesseract-server:latest
    restart: unless-stopped

  postgres:
    image: postgres:18.6-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: munni
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: munni
    volumes:
      - pgdata:/var/lib/postgresql
      - ./initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U munni"]
      interval: 5s
      timeout: 3s
      retries: 10
${shared ? sharedServices(s, pair) : ''}
volumes:
  pgdata:${shared ? '\n  vaultdata:' : ''}
`;
}

function sharedServices(s, pair) {
  const local = s.target === 'local';
  const p = s.ports;
  return `
  logto:
    image: svhd/logto:1.41
    restart: unless-stopped
    # SEED FIRST: alteration-before-seed on an EMPTY db half-creates
    # tables ("248 alterations" against no schema), then seed --swe sees
    # them and SKIPS — a permanent RLS crash-loop (live incident
    # 2026-08-26). Seed is a no-op on seeded dbs; alteration handles
    # upgrades after it.
    entrypoint: ["sh", "-c", "npm run cli db seed -- --swe && npm run alteration deploy latest && npm start"]
    environment:
      TRUST_PROXY_HEADER: "${local ? '0' : '1'}"
      DB_URL: postgres://munni:\${POSTGRES_PASSWORD}@postgres:5432/logto
      ENDPOINT: ${pair.urls.logto}
      ADMIN_ENDPOINT: ${pair.urls.logtoAdmin}
      PORT: "${p.logto}"
      ADMIN_PORT: "${p.logtoAdmin}"${local ? '' : `
    extra_hosts:
      - "${s.host('logto')}:host-gateway"
      - "${s.host('logtoAdmin')}:host-gateway"`}
    ports:
      - "${p.logto}:${p.logto}"
      - "${p.logtoAdmin}:${p.logtoAdmin}"
    depends_on:
      postgres:
        condition: service_healthy

  # migrations run INSIDE the web service (no one-shot migrate container
  # lingering as "exited"); the worker waits until they are applied
  glitchtip:
    image: glitchtip/glitchtip:latest
    restart: unless-stopped
    command: sh -c "./manage.py migrate && ./bin/start.sh"
    environment: &glitchtip_env
      DATABASE_URL: postgres://munni:\${POSTGRES_PASSWORD}@postgres:5432/glitchtip
      REDIS_URL: redis://valkey:6379/0
      SECRET_KEY: \${GLITCHTIP_SECRET_KEY}
      GLITCHTIP_DOMAIN: ${pair.urls.glitchtip}
      EMAIL_URL: \${GLITCHTIP_EMAIL_URL:-consolemail://}
      CELERY_WORKER_AUTOSCALE: "1,3"
    ports:
      - "${p.glitchtip}:8000"
    depends_on:
      postgres:
        condition: service_healthy
      valkey:
        condition: service_started

  glitchtip-worker:
    image: glitchtip/glitchtip:latest
    restart: unless-stopped
    command: sh -c "until ./manage.py migrate --check >/dev/null 2>&1; do sleep 3; done; ./bin/run-celery-with-beat.sh"
    environment: *glitchtip_env
    depends_on:
      postgres:
        condition: service_healthy

  valkey:
    image: valkey/valkey:9-alpine
    restart: unless-stopped

  # the pair's secrets vault (docs/secrets-access-plan.md SA1): the HUMAN
  # copy of every credential — read with the Bitwarden apps/extension.
  # Never internet-facing (LAN-only reverse proxy / localhost). Flip
  # VAULT_SIGNUPS_ALLOWED=false once your one account exists.
  vaultwarden:
    image: vaultwarden/server:latest
    restart: unless-stopped
    environment:
      DOMAIN: ${pair.urls.vault}
      SIGNUPS_ALLOWED: \${VAULT_SIGNUPS_ALLOWED:-true}
    volumes:
      - vaultdata:/data
    ports:
      - "${p.vault}:80"
`;
}

function envHeader(s) {
  if (s.target === 'local') return `# ${s.stack} env (local twin: values inlined by bootstrap — never commit this file)`;
  return `# ${s.stack} env TEMPLATE — rendered secrets come from the GitHub
# Environment "${s.githubEnvironment}" (same NAS_* substitution contract as
# deploy/env/.env.nas; VITE_* placeholders come from the environment's
# VARIABLES). Never edit the rendered .env on the host.`;
}

function envTemplate(s) {
  return `${envHeader(s)}
DOMAIN=${s.domain}
REGISTRY=${s.registry}
TAG=${s.channel}
GHCR_USER=okkes
GHCR_PAT=\${NAS_GHCR_PAT}

POSTGRES_PASSWORD=\${NAS_POSTGRES_PASSWORD}

LOGTO_API_RESOURCE=${s.urls.api}
LOGTO_M2M_APP_ID=\${NAS_LOGTO_M2M_APP_ID}
LOGTO_M2M_APP_SECRET=\${NAS_LOGTO_M2M_APP_SECRET}

# frontend runtime-config (written back by the logto + glitchtip modules)
WEB_LOGTO_APP_ID=\${VITE_LOGTO_APP_ID}
ADMIN_LOGTO_APP_ID=\${VITE_LOGTO_APP_ID_ADMIN}
WEB_GLITCHTIP_DSN=\${VITE_GLITCHTIP_DSN}
ADMIN_GLITCHTIP_DSN=\${VITE_GLITCHTIP_DSN_ADMIN}

GLITCHTIP_SECRET_KEY=\${NAS_GLITCHTIP_SECRET_KEY}
GLITCHTIP_EMAIL_URL=\${NAS_GLITCHTIP_EMAIL_URL}
API_SENTRY_DSN=\${NAS_API_SENTRY_DSN}

# empty = signups OPEN (first account); set to false once yours exists
VAULT_SIGNUPS_ALLOWED=\${VAULT_SIGNUPS_ALLOWED}

GOCARDLESS_SECRET_ID=\${NAS_GOCARDLESS_SECRET_ID}
GOCARDLESS_SECRET_KEY=\${NAS_GOCARDLESS_SECRET_KEY}
ENABLEBANKING_APPLICATION_ID=\${NAS_ENABLEBANKING_APPLICATION_ID}
ENABLEBANKING_PRIVATE_KEY_PEM='\${NAS_ENABLEBANKING_PRIVATE_KEY_PEM}'

ADMIN_SUBS=\${NAS_ADMIN_SUBS}

PUSH_VAPID_PUBLIC_KEY=\${NAS_PUSH_VAPID_PUBLIC_KEY}
PUSH_VAPID_PRIVATE_KEY=\${NAS_PUSH_VAPID_PRIVATE_KEY}
PUSH_VAPID_SUBJECT=mailto:admin@${s.target === 'local' ? 'localhost' : s.domain}

FCM_SERVICE_ACCOUNT_JSON='\${NAS_FCM_SERVICE_ACCOUNT_JSON}'

LOGODEV_SECRET_KEY=\${NAS_LOGODEV_SECRET_KEY}
LOGODEV_PUBLIC_TOKEN=\${NAS_LOGODEV_PUBLIC_TOKEN}
`;
}

/**
 * The names the env template references, in template order — the local
 * substitution and its tests derive from the template itself so the two
 * can never drift.
 */
export function templatePlaceholders(stack) {
  let text;
  if (stack.target === 'local' && stack.role === 'shared') text = sharedLocalTemplate(stack);
  else if (stack.target === 'local' && stack.sharedStack) text = envLocalTemplate(stack);
  else text = envTemplate(stack);
  return [...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]);
}

function envFile(stack, values) {
  const text = envTemplate(stack);
  // values (local target): substitute inline. Values are single-line by
  // construction except the PEM/JSON entries, which the template
  // single-quotes — embedded single quotes stay out (dotenv limits).
  return substitute(text, values);
}

/* ── the local three-stack topology (plan LS1-LS3) ─────────────────── */

function sharedLocalCompose(s) {
  const p = s.ports;
  const control = loadStack(s.controlApi);
  return `# ${s.stack} — RENDERED by infra/bootstrap.mjs, do not edit by hand.
# The local machine's cross-environment services. Environment stacks join
# the "${LOCAL_SHARED_NET}" network to reach glitchtip/ocr by service
# name; each environment runs its OWN postgres (isolation ruling) and
# only publishes a pgAdmin-facing alias here.
name: ${s.stack}

networks:
  shared:
    name: ${LOCAL_SHARED_NET}

services:
  # GlitchTip's OWN database — nothing else lives on this server (the
  # environments each run their own postgres)
  glitchtip-db:
    image: postgres:18.6-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: munni
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: glitchtip
    volumes:
      - glitchtipdb:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U munni"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [shared]

  # migrations run INSIDE the web service (no one-shot migrate container
  # lingering as "exited" in docker ps — user request 2026-08-30); the
  # worker waits until they are applied
  glitchtip:
    image: glitchtip/glitchtip:latest
    restart: unless-stopped
    command: sh -c "./manage.py migrate && ./bin/start.sh"
    environment: &glitchtip_env
      DATABASE_URL: postgres://munni:\${POSTGRES_PASSWORD}@glitchtip-db:5432/glitchtip
      REDIS_URL: redis://valkey:6379/0
      SECRET_KEY: \${GLITCHTIP_SECRET_KEY}
      GLITCHTIP_DOMAIN: ${s.urls.glitchtip}
      EMAIL_URL: \${GLITCHTIP_EMAIL_URL:-consolemail://}
      CELERY_WORKER_AUTOSCALE: "1,3"
    ports:
      - "${p.glitchtip}:8000"
    depends_on:
      glitchtip-db:
        condition: service_healthy
      valkey:
        condition: service_started
    networks: [shared]

  glitchtip-worker:
    image: glitchtip/glitchtip:latest
    restart: unless-stopped
    command: sh -c "until ./manage.py migrate --check >/dev/null 2>&1; do sleep 3; done; ./bin/run-celery-with-beat.sh"
    environment: *glitchtip_env
    depends_on:
      glitchtip-db:
        condition: service_healthy
    networks: [shared]

  valkey:
    image: valkey/valkey:9-alpine
    restart: unless-stopped
    networks: [shared]

  ocr:
    image: hertzg/tesseract-server:latest
    restart: unless-stopped
    networks: [shared]

  vaultwarden:
    image: vaultwarden/server:latest
    restart: unless-stopped
    environment:
      DOMAIN: ${s.urls.vault}
      SIGNUPS_ALLOWED: \${VAULT_SIGNUPS_ALLOWED:-true}
    volumes:
      - vaultdata:/data

  # ONE Caddy for the family's https (local CA, persisted so the
  # one-time trust sticks): always the vault (the Bitwarden web client
  # refuses plain http), and in LAN mode every service as a REAL
  # hostname — <name>.<ip-dashed>.sslip.io on 443 — so browsers get no
  # mixed content and Enable Banking gets a registrable https redirect.
  # http://ca.<base> serves the root certificate for one-time install.
  family-tls:
    image: caddy:2-alpine
    restart: unless-stopped
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - vaulttls:/data
    ports:
      - "${p.vault}:${p.vault}"${lanHost() ? '\n      - "443:443"\n      - "80:80"' : ''}
    networks: [default, shared]

  # the shared-services cockpit (plan LS5): its OWN app + image (not the
  # env dashboard), signed in through ${s.controlApi}'s Logto + API
  control:
    image: \${REGISTRY}/munni-control:\${TAG}
    restart: unless-stopped
    environment:
      MUNNI_API_URL: ${control.urls.api}
      MUNNI_LOGTO_ENDPOINT: ${control.urls.logto}
      MUNNI_LOGTO_APP_ID: \${CONTROL_LOGTO_APP_ID}
      MUNNI_LOGTO_RESOURCE: ${control.urls.api}
    ports:
      - "${p.control}:80"

  # ONE console over every database in the family: glitchtip-db here plus
  # each environment's own postgres (reachable as postgres-prod /
  # postgres-dev on the shared network). Passwords differ per server —
  # they live under Reveal secrets in the setup wizard.
  pgadmin:
    image: dpage/pgadmin4:latest
    restart: unless-stopped
    environment:
      # must be a resolvable-TLD address — pgadmin refuses .local
      PGADMIN_DEFAULT_EMAIL: admin@munni.dev
      PGADMIN_DEFAULT_PASSWORD: \${PGADMIN_PASSWORD}
      PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED: "False"
    volumes:
      - pgadmindata:/var/lib/pgadmin
      - ./pgadmin-servers.json:/pgadmin4/servers.json:ro
    ports:
      - "${p.pgadmin}:80"
    depends_on:
      glitchtip-db:
        condition: service_healthy
    networks: [shared]

volumes:
  glitchtipdb:
  vaultdata:
  vaulttls:
  pgadmindata:
`;
}

/** the family Caddy: local-CA https for the vault always, and for EVERY
 * service as a real sslip.io hostname when LAN mode is on */
function familyCaddyfile(shared) {
  const lan = lanHost();
  const site = (address, proxy) => `${address} {\n\treverse_proxy ${proxy}\n}\n`;
  // the vault's localhost site exists in BOTH modes (Bitwarden needs https)
  let sites = site(`https://localhost:${shared.ports.vault}`, 'vaultwarden:80');
  if (lan) {
    const base = `${lan.replaceAll('.', '-')}.sslip.io`;
    const envSites = localEnvRegistry().map((env) => {
      const logtoPort = 3201 + 100 * env.slot;
      // unique per-env SERVICE names on the shared net (web-prod, …)
      const up = (svc, port) => `${svc}-${env.name}:${port}`;
      return [
        site(`https://munni-${env.name}.${base}`, up('web', 80)),
        site(`https://munni-${env.name}-admin.${base}`, up('admin', 80)),
        site(`https://munni-${env.name}-api.${base}`, up('api', 8080)),
        site(`https://munni-${env.name}-logto.${base}`, up('logto', logtoPort)),
        site(`https://munni-${env.name}-logto-admin.${base}`, up('logto', logtoPort + 1)),
      ].join('');
    }).join('');
    // the root certificate stays downloadable over plain http for the
    // one-time trust on phones/browsers (chicken-and-egg otherwise)
    sites += envSites
      + site(`https://glitchtip.${base}`, 'glitchtip:8000')
      + site(`https://control.${base}`, 'control:80')
      + site(`https://pgadmin.${base}`, 'pgadmin:80')
      + site(`https://vault.${base}`, 'vaultwarden:80')
      + `http://ca.${base} {\n\troot * /data/caddy/pki/authorities/local\n\t# a certificate mime + attachment makes phones DOWNLOAD root.crt for\n\t# the installer instead of rendering the PEM as text (user ss 2026-08-31)\n\theader /root.crt Content-Type application/x-x509-ca-cert\n\theader /root.crt Content-Disposition "attachment; filename=munni-family-ca.crt"\n\tfile_server browse\n}\n`;
  }
  return `{\n\tlocal_certs\n}\n${sites}`;
}

/** pgAdmin's preregistered server list — one entry per database server
 * in the family (dynamic: one per registry environment + glitchtip).
 * Passwords are NOT stored here (pgAdmin prompts once; tick "save
 * password" — the values live under Reveal secrets). */
function pgadminServers() {
  const envServer = (name, host) => ({
    Name: name,
    Group: 'munni local',
    Host: host,
    Port: 5432,
    MaintenanceDB: 'munni',
    Username: 'munni',
    SSLMode: 'prefer',
  });
  const servers = {};
  let i = 1;
  for (const env of localEnvRegistry()) {
    servers[i] = envServer(env.name, `postgres-${env.name}`);
    i += 1;
  }
  servers[i] = { ...envServer('glitchtip (shared)', 'glitchtip-db'), MaintenanceDB: 'glitchtip' };
  return JSON.stringify({ Servers: servers }, null, 2);
}

function sharedLocalTemplate(s) {
  return `# ${s.stack} env (local: values inlined by bootstrap — never commit this file)
REGISTRY=${s.registry}
TAG=${s.channel}
GHCR_USER=okkes
GHCR_PAT=\${NAS_GHCR_PAT}

# glitchtip-db ONLY — each environment's postgres has its own password
POSTGRES_PASSWORD=\${NAS_POSTGRES_PASSWORD}
GLITCHTIP_SECRET_KEY=\${NAS_GLITCHTIP_SECRET_KEY}
GLITCHTIP_EMAIL_URL=\${NAS_GLITCHTIP_EMAIL_URL}
PGADMIN_PASSWORD=\${NAS_PGADMIN_PASSWORD}

# empty = signups OPEN (first account); set false once yours exists
VAULT_SIGNUPS_ALLOWED=\${VAULT_SIGNUPS_ALLOWED}

# munni-control's OWN Logto app id (registered in ${s.controlApi}'s Logto)
CONTROL_LOGTO_APP_ID=\${CONTROL_LOGTO_APP_ID}
`;
}

/** browser origins the env api accepts — in LAN mode both the LAN and
 * the localhost forms work (phones use LAN, the host browser either) */
function corsOrigins(s) {
  const origins = [s.urls.web, s.urls.admin];
  if (s.target === 'local' && !s.urls.web.includes('//localhost:')) {
    origins.push(`http://localhost:${s.ports.web}`, `http://localhost:${s.ports.admin}`);
  }
  // munni-control signs into THIS env's api when it is the family's
  // controlApi — its own origin must pass CORS too (found live
  // 2026-08-28: the browser blocked /control/ping and the cockpit
  // misread the failure as "not on the admin list")
  if (s.sharedStack) {
    const shared = loadStack(s.sharedStack);
    if (shared.controlApi === s.stack && shared.urls.control) {
      origins.push(shared.urls.control);
      if (!shared.urls.control.includes('//localhost:')) {
        origins.push(`http://localhost:${shared.ports.control}`);
      }
    }
  }
  origins.push('https://localhost', 'capacitor://localhost');
  return origins;
}

function envLocalCompose(s) {
  const p = s.ports;
  const appChannel = s.appChannel ?? (s.role === 'prod' ? 'production' : 'staging');
  const shortName = s.envName ?? s.stack.replace('munni-local-', '');
  return `# ${s.stack} — RENDERED by infra/bootstrap.mjs, do not edit by hand.
# A complete local environment: own web/admin/api, OWN Logto and OWN
# postgres (data isolation — deleting this stack can never touch another
# environment), riding ${s.sharedStack} only for glitchtip/ocr over
# "${LOCAL_SHARED_NET}" (start the shared stack first).
name: ${s.stack}

networks:
  default: {}
  shared:
    external: true
    name: ${LOCAL_SHARED_NET}

services:
  # this environment's OWN database server. UNIQUE service name — a
  # compose service name registers on EVERY network it joins, so a plain
  # "postgres" service would collide with every other environment's on
  # the shared network (found live 2026-08-28: a new env's logto
  # round-robined onto ANOTHER env's postgres and poisoned its own seed;
  # only the per-env passwords stopped cross-environment writes). The
  # in-stack alias keeps "postgres" working for THIS stack's consumers.
  postgres-${shortName}:
    image: postgres:18.6-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: munni
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: munni
    volumes:
      - pgdata:/var/lib/postgresql
      - ./initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U munni"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks:
      default:
        aliases: [postgres]
      shared: {}

  # web/admin/api/logto join the shared net so the family Caddy can front
  # them with https hostnames in LAN mode — under the SAME unique-name
  # rule as postgres above: a plain "web"/"api"/"logto" service name
  # would register on the shared network for EVERY environment and
  # round-robin lookups across them. Unique service names, in-stack
  # aliases keep the plain names working for THIS stack's consumers.
  web-${shortName}:
    image: \${REGISTRY}/munni-web:\${TAG}
    restart: unless-stopped
    environment:
      MUNNI_API_URL: ${s.urls.api}
      MUNNI_LOGTO_ENDPOINT: ${s.urls.logto}
      MUNNI_LOGTO_APP_ID: \${WEB_LOGTO_APP_ID}
      MUNNI_LOGTO_RESOURCE: ${s.urls.api}
      MUNNI_GLITCHTIP_DSN: \${WEB_GLITCHTIP_DSN}
      MUNNI_CHANNEL: ${appChannel}
      MUNNI_NATIVE_SCHEME: ${s.native.scheme}
      MUNNI_PUBLIC_ORIGIN: ${s.urls.web}
    ports:
      - "${p.web}:80"
    networks:
      default:
        aliases: [web]
      shared: {}

  admin-${shortName}:
    image: \${REGISTRY}/munni-admin:\${TAG}
    restart: unless-stopped
    environment:
      MUNNI_API_URL: ${s.urls.api}
      MUNNI_LOGTO_ENDPOINT: ${s.urls.logto}
      MUNNI_LOGTO_APP_ID: \${ADMIN_LOGTO_APP_ID}
      MUNNI_LOGTO_RESOURCE: ${s.urls.api}
      MUNNI_GLITCHTIP_DSN: \${ADMIN_GLITCHTIP_DSN}
    ports:
      - "${p.admin}:80"
    networks:
      default:
        aliases: [admin]
      shared: {}

  api-${shortName}:
    image: \${REGISTRY}/munni-api:\${TAG}
    restart: unless-stopped
    environment:
      ASPNETCORE_URLS: http://+:8080
      ConnectionStrings__Db: Host=postgres;Database=munni;Username=munni;Password=\${POSTGRES_PASSWORD}
      Db__AutoMigrate: "true"
      Auth__Authority: ${s.urls.logto}/oidc
      # localhost issuer for browsers; metadata fetched in-network over http
      Auth__MetadataAddress: http://logto:${p.logto}/oidc/.well-known/openid-configuration
      Auth__RequireHttps: "false"
      Auth__Audience: ${s.urls.api}
${corsOrigins(s).map((o, i) => `      Cors__Origins__${i}: ${o}`).join('\n')}
      GoCardless__SecretId: \${GOCARDLESS_SECRET_ID}
      GoCardless__SecretKey: \${GOCARDLESS_SECRET_KEY}
      EnableBanking__ApplicationId: \${ENABLEBANKING_APPLICATION_ID:-}
      EnableBanking__PrivateKeyPem: \${ENABLEBANKING_PRIVATE_KEY_PEM:-}
      Push__VapidPublicKey: \${PUSH_VAPID_PUBLIC_KEY:-}
      Push__VapidPrivateKey: \${PUSH_VAPID_PRIVATE_KEY:-}
      Push__Subject: \${PUSH_VAPID_SUBJECT:-mailto:admin@localhost}
      Fcm__ServiceAccountJson: \${FCM_SERVICE_ACCOUNT_JSON:-}
      Logos__SecretKey: \${LOGODEV_SECRET_KEY:-}
      Logos__PublicToken: \${LOGODEV_PUBLIC_TOKEN:-}
      Admin__Subs: \${ADMIN_SUBS:-}
      # container-form DSN (glitchtip:8000 via the shared network) — the
      # api cannot resolve the browser's localhost:8383 form
      Sentry__Dsn: \${API_SENTRY_DSN:-}
      Logto__M2mAppId: \${LOGTO_M2M_APP_ID:-}
      Logto__M2mAppSecret: \${LOGTO_M2M_APP_SECRET:-}
      BUILD_NUMBER: \${TAG}
      Ocr__BaseUrl: http://ocr:8884
    ports:
      - "${p.api}:8080"
    depends_on:
      postgres-${shortName}:
        condition: service_healthy
      logto-${shortName}:
        condition: service_started
    networks:
      default:
        aliases: [api]
      shared: {}

  logto-${shortName}:
    image: svhd/logto:1.41
    restart: unless-stopped
    # SEED FIRST (see the iac render note): alteration-before-seed on an
    # empty db half-creates tables and seed --swe then skips forever
    entrypoint: ["sh", "-c", "npm run cli db seed -- --swe && npm run alteration deploy latest && npm start"]
    environment:
      # LAN mode: logto sits behind the family Caddy on its https hostname
      TRUST_PROXY_HEADER: "${lanHost() ? 1 : 0}"
      DB_URL: postgres://munni:\${POSTGRES_PASSWORD}@postgres:5432/logto
      ENDPOINT: ${s.urls.logto}
      ADMIN_ENDPOINT: ${s.urls.logtoAdmin}
      PORT: "${p.logto}"
      ADMIN_PORT: "${p.logtoAdmin}"
    ports:
      - "${p.logto}:${p.logto}"
      - "${p.logtoAdmin}:${p.logtoAdmin}"
    depends_on:
      postgres-${shortName}:
        condition: service_healthy
    networks:
      default:
        aliases: [logto]
      shared: {}

volumes:
  pgdata:
`;
}

function envLocalTemplate(s) {
  return `# ${s.stack} env (local: values inlined by bootstrap — never commit this file)
REGISTRY=${s.registry}
TAG=${s.channel}
GHCR_USER=okkes
GHCR_PAT=\${NAS_GHCR_PAT}

POSTGRES_PASSWORD=\${NAS_POSTGRES_PASSWORD}

LOGTO_M2M_APP_ID=\${NAS_LOGTO_M2M_APP_ID}
LOGTO_M2M_APP_SECRET=\${NAS_LOGTO_M2M_APP_SECRET}

WEB_LOGTO_APP_ID=\${VITE_LOGTO_APP_ID}
ADMIN_LOGTO_APP_ID=\${VITE_LOGTO_APP_ID_ADMIN}
WEB_GLITCHTIP_DSN=\${VITE_GLITCHTIP_DSN}
ADMIN_GLITCHTIP_DSN=\${VITE_GLITCHTIP_DSN_ADMIN}
API_SENTRY_DSN=\${NAS_API_SENTRY_DSN}

GOCARDLESS_SECRET_ID=\${NAS_GOCARDLESS_SECRET_ID}
GOCARDLESS_SECRET_KEY=\${NAS_GOCARDLESS_SECRET_KEY}
ENABLEBANKING_APPLICATION_ID=\${NAS_ENABLEBANKING_APPLICATION_ID}
ENABLEBANKING_PRIVATE_KEY_PEM='\${NAS_ENABLEBANKING_PRIVATE_KEY_PEM}'

ADMIN_SUBS=\${NAS_ADMIN_SUBS}

PUSH_VAPID_PUBLIC_KEY=\${NAS_PUSH_VAPID_PUBLIC_KEY}
PUSH_VAPID_PRIVATE_KEY=\${NAS_PUSH_VAPID_PRIVATE_KEY}
PUSH_VAPID_SUBJECT=mailto:admin@localhost

FCM_SERVICE_ACCOUNT_JSON='\${NAS_FCM_SERVICE_ACCOUNT_JSON}'

LOGODEV_SECRET_KEY=\${NAS_LOGODEV_SECRET_KEY}
LOGODEV_PUBLIC_TOKEN=\${NAS_LOGODEV_PUBLIC_TOKEN}
`;
}
