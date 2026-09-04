import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairProd } from './stack.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'rendered');

/**
 * Render docker-compose.<stack>.yml + .env.<stack> (NAS_* placeholder
 * template, same contract as deploy/env/.env.nas: CI substitutes the
 * placeholders from the stack's GitHub Environment secrets at bundle
 * time). Output goes to infra/rendered/<stack>/ and ships through the
 * SAME NAS bundle pipeline as the live stacks — just a new channel.
 */
export function renderStack(stack) {
  const pair = pairProd(stack);
  const dir = join(OUT_DIR, stack.stack);
  mkdirSync(join(dir, 'initdb'), { recursive: true });
  writeFileSync(join(dir, `docker-compose.${stack.stack}.yml`), compose(stack, pair));
  writeFileSync(join(dir, `.env.${stack.stack}`), envTemplate(stack));
  // first postgres boot: side databases for the pair's shared services
  writeFileSync(
    join(dir, 'initdb', '01-create-databases.sql'),
    stack.sharedServices ? 'CREATE DATABASE logto;\nCREATE DATABASE glitchtip;\n' : '-- no side databases: shared services live on the prod twin\n',
  );
  return dir;
}

function compose(s, pair) {
  const shared = s.sharedServices;
  const p = s.ports;
  return `# ${s.stack} — RENDERED by infra/bootstrap.mjs, do not edit by hand.
# Reverse proxy (DSM): ${s.host('web')} -> :${p.web}, ${s.host('api')} -> :${p.api},
# ${s.host('admin')} -> :${p.admin} (LAN only)${shared ? `,\n# ${s.host('logto')} -> :${p.logto}, ${s.host('logtoAdmin')} -> :${p.logtoAdmin} (LAN only), ${s.host('glitchtip')} -> :${p.glitchtip}` : ''}

services:
  web:
    image: \${REGISTRY}/munni-web:\${TAG}
    restart: unless-stopped
    ports:
      - "${p.web}:80"

  admin:
    image: \${REGISTRY}/munni-admin:\${TAG}
    restart: unless-stopped
    ports:
      - "${p.admin}:80"

  api:
    image: \${REGISTRY}/munni-api:\${TAG}
    restart: unless-stopped
    environment:
      ASPNETCORE_URLS: http://+:8080
      ConnectionStrings__Db: Host=postgres;Database=munni;Username=munni;Password=\${POSTGRES_PASSWORD}
      Db__AutoMigrate: "true"
      Auth__Authority: ${pair.urls.logto}/oidc
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
    image: postgres:18-alpine
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
  pgdata:
`;
}

function sharedServices(s, pair) {
  const p = s.ports;
  return `
  logto:
    image: svhd/logto:1.41
    restart: unless-stopped
    entrypoint: ["sh", "-c", "npm run alteration deploy latest || true; npm run cli db seed -- --swe && npm run alteration deploy latest && npm start"]
    environment:
      TRUST_PROXY_HEADER: "1"
      DB_URL: postgres://munni:\${POSTGRES_PASSWORD}@postgres:5432/logto
      ENDPOINT: ${pair.urls.logto}
      ADMIN_ENDPOINT: ${pair.urls.logtoAdmin}
      PORT: "${p.logto}"
      ADMIN_PORT: "${p.logtoAdmin}"
    extra_hosts:
      - "${s.host('logto')}:host-gateway"
      - "${s.host('logtoAdmin')}:host-gateway"
    ports:
      - "${p.logto}:${p.logto}"
      - "${p.logtoAdmin}:${p.logtoAdmin}"
    depends_on:
      postgres:
        condition: service_healthy

  glitchtip-migrate:
    image: glitchtip/glitchtip:latest
    restart: "no"
    command: ./manage.py migrate
    environment: &glitchtip_env
      DATABASE_URL: postgres://munni:\${POSTGRES_PASSWORD}@postgres:5432/glitchtip
      REDIS_URL: redis://valkey:6379/0
      SECRET_KEY: \${GLITCHTIP_SECRET_KEY}
      GLITCHTIP_DOMAIN: ${pair.urls.glitchtip}
      EMAIL_URL: \${GLITCHTIP_EMAIL_URL:-consolemail://}
      CELERY_WORKER_AUTOSCALE: "1,3"
    depends_on:
      postgres:
        condition: service_healthy

  glitchtip:
    image: glitchtip/glitchtip:latest
    restart: unless-stopped
    environment: *glitchtip_env
    ports:
      - "${p.glitchtip}:8000"
    depends_on:
      glitchtip-migrate:
        condition: service_completed_successfully
      valkey:
        condition: service_started

  glitchtip-worker:
    image: glitchtip/glitchtip:latest
    restart: unless-stopped
    command: ./bin/run-celery-with-beat.sh
    environment: *glitchtip_env
    depends_on:
      glitchtip-migrate:
        condition: service_completed_successfully

  valkey:
    image: valkey/valkey:9-alpine
    restart: unless-stopped
`;
}

function envTemplate(s) {
  return `# ${s.stack} env TEMPLATE — rendered secrets come from the GitHub
# Environment "${s.githubEnvironment}" (same NAS_* substitution contract as
# deploy/env/.env.nas). Never edit the rendered .env on the host.
DOMAIN=${s.domain}
REGISTRY=${s.registry}
TAG=${s.channel}
GHCR_USER=okkes
GHCR_PAT=\${NAS_GHCR_PAT}

POSTGRES_PASSWORD=\${NAS_POSTGRES_PASSWORD}

LOGTO_API_RESOURCE=${s.urls.api}
LOGTO_M2M_APP_ID=\${NAS_LOGTO_M2M_APP_ID}
LOGTO_M2M_APP_SECRET=\${NAS_LOGTO_M2M_APP_SECRET}

GLITCHTIP_SECRET_KEY=\${NAS_GLITCHTIP_SECRET_KEY}
GLITCHTIP_EMAIL_URL=\${NAS_GLITCHTIP_EMAIL_URL}
API_SENTRY_DSN=\${NAS_API_SENTRY_DSN}

GOCARDLESS_SECRET_ID=\${NAS_GOCARDLESS_SECRET_ID}
GOCARDLESS_SECRET_KEY=\${NAS_GOCARDLESS_SECRET_KEY}
ENABLEBANKING_APPLICATION_ID=\${NAS_ENABLEBANKING_APPLICATION_ID}
ENABLEBANKING_PRIVATE_KEY_PEM='\${NAS_ENABLEBANKING_PRIVATE_KEY_PEM}'

ADMIN_SUBS=\${NAS_ADMIN_SUBS}

PUSH_VAPID_PUBLIC_KEY=\${NAS_PUSH_VAPID_PUBLIC_KEY}
PUSH_VAPID_PRIVATE_KEY=\${NAS_PUSH_VAPID_PRIVATE_KEY}
PUSH_VAPID_SUBJECT=mailto:admin@${s.domain}

FCM_SERVICE_ACCOUNT_JSON='\${NAS_FCM_SERVICE_ACCOUNT_JSON}'

LOGODEV_SECRET_KEY=\${NAS_LOGODEV_SECRET_KEY}
LOGODEV_PUBLIC_TOKEN=\${NAS_LOGODEV_PUBLIC_TOKEN}
`;
}
