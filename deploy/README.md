# Deploying munni on the Synology NAS

## What runs where (container inventory)

| Stack | File | Services |
|---|---|---|
| **Production** (NAS) | `docker-compose.yml` | `web` (nginx, :8090) · `admin` (operator console, :8085, LAN-only) · `api` (:8091) · `ocr` (receipt-photo OCR sidecar, internal-only) · `postgres` (munni + logto + glitchtip DBs) · `logto` (+ console :3002) · `glitchtip` + `glitchtip-worker` + `valkey` (+ one-shot `glitchtip-migrate`) · `pgadmin` (:8093, LAN-only) · `db-backup` (nightly dumps) |
| **Staging** (NAS, `:dev` images) | `docker-compose.staging.yml` | `web` (:8095) · `api` (:8096) · `ocr` · own `postgres`; shares production Logto/GlitchTip |
| **Local full stack** | `docker-compose.local.yml` | `api` (:8180) · `ocr` · `logto` (:3001/:3002) · `pgadmin` (:8183) · `postgres` — the web app runs via `npm run dev` (:5173), admin via `npm run dev -w @munni/admin` (:5175) |
| **Test / e2e** | `docker-compose.test.yml` | `api` (:8181, header auth) · `postgres` — used by CI and by Playwright sync tests (project name `munni-e2e`) |
| **Sonar** (local only) | `docker-compose.sonar.yml` | `sonarqube` (:9000) |

The `ocr` sidecar (`hertzg/tesseract-server`) powers receipt-photo
scanning. It is stateless, needs no configuration or volume, and is never
exposed — the API reaches it via `Ocr__BaseUrl`. Without it the API
answers receipt scans with "OCR unavailable" and the app falls back to
manual entry.

## One-time setup

0. **Images**: GitHub Actions builds and pushes `munni-api` / `munni-web`
   to **GHCR** (`ghcr.io/okkes/...`, private) on every push to master
   (`.github/workflows/release-images.yml`). The Synology registry stays
   LAN-only — GitHub runners cannot reach it, so it is not used for CI.
   Nothing can be pulled before that workflow has run green at least once.
1. **Folders**: create a share for the stack, e.g. `/volume1/docker/munni`,
   and copy this `deploy/` folder into it. Fill in `env/.env.example` →
   `env/.env.local`, then copy it to a file named exactly `.env` **next to
   `docker-compose.yml`** — Container Manager has no env-file picker;
   docker compose only auto-reads a sibling `.env`:
   ```sh
   cp env/.env.local .env
   ```
2. **Registry login** (pulling private GHCR images needs credentials —
   the "no basic auth credentials" error means this step is missing):
   - Create a GitHub **fine-grained PAT** (or classic token) with only
     `read:packages`: github.com → Settings → Developer settings →
     Personal access tokens.
   - Once via SSH on the NAS (covers Container Manager and scheduled
     tasks): `sudo docker login ghcr.io -u okkes` and paste the token as
     the password.
   Then create the *Project* in Container Manager pointing at
   `docker-compose.yml` in that folder.
3. **Reverse proxy** (DSM → Login Portal → Advanced → Reverse Proxy), all
   HTTPS with the `*.<your-domain>` wildcard certificate:
   | Source | Destination |
   |---|---|
   | `munni.<your-domain>:443` | `localhost:8090` |
   | `munni-api.<your-domain>:443` | `localhost:8091` |
   | `logto.<your-domain>:443` | `localhost:3001` |
   | `logto-admin.<your-domain>:443` | `localhost:3002` |
   | `glitchtip.<your-domain>:443` | `localhost:8092` |
   | `pgadmin.<your-domain>:443` | `localhost:8093` |
   | `munni-admin.<your-domain>:443` | `localhost:8085` (LAN-only) |

   For `munni-api` add WebSocket support off, and for all of them enable
   HTTP/2. Restrict `logto-admin` **and `pgadmin`** to LAN in DSM firewall
   rules — pgAdmin can read every database. First pgAdmin login uses
   `PGADMIN_EMAIL`/`PGADMIN_PASSWORD` from `.env`; register the server as
   host `postgres`, user `munni`, the `POSTGRES_PASSWORD` — the munni,
   logto and glitchtip databases all live in that one instance.
4. **Logto** (first run): open `https://logto-admin.<domain>`, create the
   admin account, then:
   - Application → *munni* (Single-page app), redirect URI
     `https://munni.<domain>/#/auth/callback`, post-logout
     `https://munni.<domain>/`.
   - API resource → `https://munni-api.<domain>` (must equal
     `LOGTO_API_RESOURCE` in the env file).
5. **GlitchTip** — error monitoring. The service is already in the compose
   stack (`glitchtip` + `glitchtip-worker` + `valkey`, sharing the Postgres
   instance; the `glitchtip` database is auto-created on first Postgres
   start). Setup is two parts — the service, then a DSN per app:

   a. **Before starting**, set two values in `.env`:
      ```sh
      GLITCHTIP_SECRET_KEY=   # python -c "import secrets; print(secrets.token_hex(32))"
      GLITCHTIP_EMAIL_URL=    # optional; blank -> mail goes to the container log
      ```
      `GLITCHTIP_DOMAIN` is derived from `DOMAIN` automatically. Add the
      reverse-proxy entry `glitchtip.<domain>:443 → localhost:8092`.

   b. **First run**: open `https://glitchtip.<domain>` and **register the
      first account immediately** — the first user to sign up becomes
      superuser (open registration is on by default; turn it off afterwards
      in *Settings → do not allow open registration*). Create an
      organization, then **two projects** under it: `munni-web` and
      `munni-api`. Each project shows a **DSN** like
      `https://<key>@glitchtip.<domain>/<project-id>`.

   c. **Wire the two DSNs — they go to different places.** The API reads its
      DSN at *runtime*; the web app bakes its DSN in at *build time*, so
      they are configured differently:
      - **API → runtime env.** In `.env`:
        `API_SENTRY_DSN=<munni-api project DSN>`. It flows into `Sentry__Dsn`;
        restart the api container — no rebuild.
      - **Web → build-time, via a GitHub Actions repo Variable.** The web
        image compiles `VITE_GLITCHTIP_DSN` in during the CI image build
        (`release-images.yml`), so putting it in `.env` does nothing for the
        web app. Set it under **GitHub → repo Settings → Secrets and
        variables → Actions → Variables**, name `VITE_GLITCHTIP_DSN`, value
        = the `munni-web` project DSN, then trigger a rebuild (push/merge to
        master) and pull the new image.

   Notes: local/dev builds leave `VITE_GLITCHTIP_DSN` empty and Sentry
   no-ops when the DSN is unset, so **local dev reports nothing** by design.
   Even with a real DSN, demo/offline identities send zero events, and
   signed-in users who lose network queue reports and flush on reconnect
   (`apps/web/src/main.tsx`). To verify: sign in as a real user, trigger a
   thrown error, and watch it appear in the project within seconds.
6. **Backups**: point Hyper Backup at `${BACKUP_DIR}` (nightly SQL dumps,
   14-day retention inside the container, longer retention via Hyper
   Backup). Do one restore drill: `psql -f munni-<date>.sql`.

## Updating

Images are built by GitHub Actions and pushed to GHCR. On the NAS, a DSM
Scheduled Task (user: root, daily or on demand) runs:

```sh
bash /volume1/docker/munni/update.sh
```

`update.sh` re-authenticates to ghcr.io from the `GHCR_USER`/`GHCR_PAT`
values in `.env` on every run, then pulls and restarts changed services —
so it keeps working across reboots and even if Docker's stored login is
ever wiped. The one-time manual `docker login` in step 2 is only needed
for the very first pull via the Container Manager GUI.

## Staging environment (dev branch)

Pushes to the `dev` branch build `:dev`-tagged images. The staging stack
(`docker-compose.staging.yml`) runs beside production with its own
database, sharing the production Logto/GlitchTip containers:

1. Reverse proxy: `munni-test.` → `localhost:8095`, `munni-test-api.` →
   `localhost:8096` (same wildcard cert).
2. Logto console: register a second SPA app for
   `https://munni-test.<domain>` (redirect `/auth-callback`, post
   sign-out `/`, CORS origin) and an API resource
   `https://munni-test-api.<domain>`; put the app id in the repo's
   Actions **Variables** as `VITE_LOGTO_APP_ID_DEV`.
3. Copy `.env` to `.env.staging` next to `update.sh` and adjust: its own
   `POSTGRES_PASSWORD`, same `GHCR_USER`/`GHCR_PAT`/`ADMIN_SUBS`,
   GoCardless keys optional. `update.sh` picks the env file by compose
   file (`.env` for production, `.env.staging` for staging), so the two
   environments never share secrets.
4. Start/update: `bash update.sh docker-compose.staging.yml` (own
   scheduled task, or run on demand).

Flow: feature work merges into `dev` → verify at munni-test → merge
`dev` into `master` → production picks it up on the next update.

## Local full-stack test (before touching the NAS)

Everything except HTTPS/reverse-proxy, on localhost:

1. `docker compose --env-file deploy/env/.env.local -f deploy/docker-compose.local.yml up -d --build`
   (from the repo root; GoCardless keys are passed through if present)
2. Open the Logto admin console at **http://localhost:3002**, create the
   admin account, then:
   - *Applications* → Create → **Single-page app**, name `munni`:
     - Redirect URI: `http://localhost:5173/auth-callback`
     - Post sign-out redirect URI: `http://localhost:5173/`
     - CORS allowed origin: `http://localhost:5173`
   - *API resources* → Create: identifier exactly `http://localhost:8180`
3. Put the app id into `apps/web/.env.local` (git-ignored):
   ```
   VITE_API_URL=http://localhost:8180
   VITE_LOGTO_ENDPOINT=http://localhost:3001
   VITE_LOGTO_APP_ID=<the app id from step 2>
   VITE_LOGTO_RESOURCE=http://localhost:8180
   ```
4. `npm run dev` (repo root) and open http://localhost:5173 — the login
   screen now shows the real **Sign in** button. Create a user in the
   Logto sign-up flow, and you're in a fully syncing account: open a
   second browser (or private window), sign in with the same user, and
   watch edits flow between them.
5. Bank connect (optional, uses your real GoCardless account): add
   account → *Connect your bank*. The consent redirect returns to
   `http://localhost:5173/gc-callback`.

Tear down with `docker compose -f deploy/docker-compose.local.yml down`
(add `-v` to also wipe the local database volume).

## Local test stack (CI / development)

`docker-compose.test.yml` runs api+postgres only, with header-based test
auth (`X-User-Sub`) instead of Logto:

```sh
docker compose -f deploy/docker-compose.test.yml up --build -d
curl -H "X-User-Sub: alice" http://localhost:8181/health
```

The Playwright suite's sync/friends tests expect this stack under the
compose project name `munni-e2e` and skip themselves when it's absent:

```sh
docker compose -p munni-e2e -f deploy/docker-compose.test.yml up --build -d
```

## Admin console (separate app + container)

The operator console lives in `apps/admin` and ships as its own image
(`munni-admin`), listed in the production compose on port **8085**.
One-time setup:

1. Reverse proxy: `munni-admin.<domain>` → `localhost:8085` and
   **restrict it to LAN** in the DSM firewall.
2. Logto console: register a *third* SPA app for
   `https://munni-admin.<domain>` (redirect `/auth-callback`, post
   sign-out `/`, CORS that origin) and set the repo Actions Variable
   `VITE_LOGTO_APP_ID_ADMIN` (and `VITE_LOGTO_APP_ID_ADMIN_DEV` if you
   ever want a staging admin).
3. Admin authority stays server-side: only subs listed in `ADMIN_SUBS`
   can use `/admin/*`, regardless of who opens the page.

Local dev: `npm run dev -w @munni/admin` (port 5175) against the local
API — without Logto configured it shows a test-subject box (test auth).

**Using it.** Both sections stay empty ("not on the admin list") until
the caller's sub is in the API's `Admin__Subs`:

- **Production/staging**: sign in via Logto; your Logto user's *sub*
  (Logto console → User management → the user → ID) must be one of the
  comma-separated values in `ADMIN_SUBS` in `.env`.
- **Local**: put any name in `ADMIN_SUBS` in `deploy/env/.env.local`
  (e.g. `ADMIN_SUBS=admin`), restart the api container, and type that
  same name into the test-subject box — it authenticates as that sub.

*Users* lists every provisioned account with its space count. *Bank
connections* lists everything the GoCardless account knows: rows marked
**stale** exist at GoCardless but not in this environment's database —
that's either true leftovers or *the other environment* (staging and
production share one GC account), so deleting them is a manual,
informed decision. Select + **Delete** frees GC connection slots (the
free tier caps these).

**Automatic idle cleanup**: the API now cleans up after itself daily —
local requisitions older than 2 days with no linked bank accounts
(abandoned consent journeys, connections whose accounts were removed)
are deleted at GoCardless and locally. Stale rows from other
environments are deliberately never auto-deleted.

## SonarQube analysis (local machine only)

SonarQube needs ~2-3 GB RAM, so it never runs on the NAS — spin it up
locally when you want a quality report:

1. `docker compose -f deploy/docker-compose.sonar.yml up -d` and wait
   for http://localhost:9000 (first boot takes a minute or two).
2. First time only: log in `admin` / `admin`, set a new password, then
   *My Account → Security → Generate token* and add
   `SONAR_TOKEN=<token>` to `deploy/env/.env.local`.
3. `./deploy/sonar/analyze.ps1` — analyzes all three projects, each with
   coverage, entirely through Docker (nothing to install):
   - `munni-web` and `munni-admin`: vitest coverage → scanner CLI.
   - `munni-api`: `dotnet test` runs on the host (Testcontainers need
     Docker), then the opencover report's paths are rewritten to the
     scanner container's mount so Sonar can match the source files.

   The run fails fast if any project's tests fail. Standing floor: all
   three projects stay at **85%+ coverage** with **0 open issues**
   (suppress false positives explicitly in each `sonar-project.properties`).
4. `docker compose -f deploy/docker-compose.sonar.yml down` when done
   (analysis history survives in the named volumes).

## Watch-folder import (manual bank exports)

Some accounts (savings, credit cards) never arrive via PSD2. Drop their
CAMT.053 exports into the watch folder and the api ingests them as raw
bank feeds — identical deterministic ids to device imports and
GoCardless, so every path dedupes against the others.

1. Set `IMPORT_WATCH_OWNER_SUB` (your Logto subject — the feeds' owner)
   and optionally `IMPORT_WATCH_HOST_DIR` (default `./import-watch`) in
   the env file; recreate the api container.
2. Drop `*.xml` files into the folder. Every ~30s the api imports them,
   moving files to `processed/` (or `failed/` with a warning in the api
   logs). Re-drops are no-ops.
3. The account appears under Financial accounts on your devices — attach
   it to spaces as usual. A personal scraper container can target the
   same folder; munni itself never holds bank credentials.
