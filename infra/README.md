# infra/ — from zero to a running munni pair, step by step

**Start here: open `infra/setup/index.html` in your browser** (straight
from the checkout — no server, no install). The setup wizard walks this
whole document interactively: it explains every third-party account,
stores the secrets for you (client-side sealed-box encryption, straight
to the GitHub API), runs the bootstrap and deploy workflows at the click
of a button, and shows live per-step status. It only ever talks to
api.github.com; the PAT you paste stays in the tab's memory.

The text below is the same flow as prose — the fallback and the
reference. The NAS and Raspberry Pi tracks share Part A and split in
Part B; the **local track** (full ecosystem on Docker Desktop) is
self-contained in the wizard and in `runbook.munni-local.md` after a
`node infra/bootstrap.mjs --stack munni-local`.

> The NAS domain is a SECRET here (public repo): wherever you see
> `<domain>`, that's the value of the `IAC_DOMAIN` secret.

---

## Part A — shared groundwork (once ever)

**A1. Repo secrets.** The wizard's step 0–3 create all of these for you
(GitHub → Settings → Secrets and variables → Actions → *Repository*
secrets, if doing it by hand):

| Secret | What |
|---|---|
| `IAC_DOMAIN` | your DDNS domain (e.g. `xxxx.synology.me`) |
| `IAC_GH_PAT` | fine-grained PAT, THIS repo, permissions: Administration RW + Secrets RW + Variables RW + Actions RW (bootstrap writes environment secrets — `GITHUB_TOKEN` cannot; the wizard also dispatches workflows with it) |
| `SYNOLOGY_URL` / `_USER` / `_PASS` / `_PATH` | DSM deploy account (FileStation + reverse-proxy writes; admin rights, 2FA off) — shared with deploy-nas.yml |
| `NAS_GHCR_PAT` | PAT with read:packages (image pulls) |
| `NAS_GOCARDLESS_SECRET_ID` / `_KEY` | GoCardless portal |
| optional: `NAS_ENABLEBANKING_*`, `NAS_FCM_SERVICE_ACCOUNT_JSON`, `NAS_LOGODEV_*`, `LOGTO_GOOGLE_*`, `LOGTO_APPLE_*` | as per feature |

`infra/secrets.manifest.json` is the authoritative inventory (owners,
scopes, platform tags); `bootstrap --verify` fails loudly on drift and
the wizard cross-checks its own coverage against it.

**A2. First bootstrap run.** Wizard step 4 — or Actions → *IaC
bootstrap* → Run workflow → stack `munni-iac-prod`, then
`munni-iac-staging`. It creates the `iac-production`/`iac-staging`
environments, mints every generated secret (postgres, VAPID, GlitchTip
key…), renders compose+env and uploads them plus a personalized
`runbook.<stack>.md` as the run artifact; the bootstrap output also
lands in the run's step summary. **The runbook artifact is your
worksheet for everything below.**

**A3. DNS.** With Synology DDNS the `*.<domain>` wildcard already
resolves; external registrars need records for the hosts listed in the
runbook (`munni-iac.<domain>`, `munni-iac-test.<domain>`, …).

---

## Part B1 — NAS track

**B1-1 (once per NAS).** Make sure the deploy account (SYNOLOGY_USER)
has DSM *administrator* rights — the reverse-proxy module needs them.
The IaC workflow creates every reverse-proxy rule via the DSM API. Only
two things stay manual (the workflow's verify step probes both):
- Firewall: allow `172.16.0.0/12` in the access profile; restrict the
  `*-admin` hosts to LAN.
- Certificate: the `*.synology.me` wildcard from DSM covers the hosts;
  for own domains run acme.sh with the `synology_dsm` deploy hook (see
  docs/iac-plan.md §4).

**B1-2 (once per stack — one workflow click).** Wizard step 5, or
Actions → *Deploy to NAS* → Run workflow → channel `iac-prod` /
`iac-staging` / `iac-both`. The workflow renders the stack from its
GitHub Environment (secrets AND written-back variables), publishes the
bundle via FileStation, and the NAS poller unpacks it into
`/volume1/docker/<stack>/` and runs `docker compose up -d` there. No
SSH, no manual copying.

## Part B2 — Raspberry Pi track (after PI3 lands)

**B2-1 (once per Pi).** Flash Raspberry Pi OS Lite (64-bit), attach an
SSD (Postgres on SD cards dies young), then run
`deploy/pi/install.sh` — it installs docker + compose, creates
`/opt/munni`, and arms the systemd bundle-poll timer. *(install.sh is
slice PI3 of docs/raspberry-pi-plan.md — until it lands, this track
is not yet available; the wizard shows it as planned.)*

**B2-2 (once per stack).** Same artifact files to `/opt/munni/<stack>/`,
`docker compose up -d`. The bundled Caddy (PI4) terminates HTTPS with
Let's Encrypt — no DSM, no reverse-proxy console, DNS must point at
the Pi.

---

## Part C — auth + observability (once per PAIR)

**C1. Logto OOBE (the ONE manual auth step).** Wizard step 6 — open
`https://logto-iac-admin.<domain>` → create the admin user →
Applications → Create → *Machine-to-machine* → name `infra` → assign
the Logto Management API role (all permissions). Paste its id/secret
into the wizard (it stores them in BOTH iac environments), or:

```sh
gh secret set IAC_LOGTO_INFRA_M2M_ID --env iac-production   # and --env iac-staging
gh secret set IAC_LOGTO_INFRA_M2M_SECRET --env iac-production
```

Re-run the IaC workflow for BOTH stacks — apps, redirect URIs, CORS,
API resources and the account-deletion M2M app are now code, and the
ids land in the GitHub environments automatically. Deploy again so the
frontends pick them up (they read runtime config from their container
env — one public image serves every stack).

**C2. Google sign-in (optional, once).** Google Cloud console →
Credentials → Create OAuth client (Web) → authorized redirect URI
`https://logto-iac.<domain>/callback/google-universal` → store
`LOGTO_GOOGLE_CLIENT_ID` + `LOGTO_GOOGLE_CLIENT_SECRET` (wizard step 3)
→ re-run the workflow. The connector + sign-in-experience wiring is code.

**C3. Apple sign-in (optional, once).** Apple developer portal →
Identifiers → new *Services ID* (this is `LOGTO_APPLE_CLIENT_ID`),
enable Sign in with Apple, return URL
`https://logto-iac.<domain>/callback/apple-universal`; Keys → new key
with Sign in with Apple → store `LOGTO_APPLE_TEAM_ID`,
`LOGTO_APPLE_KEY_ID`, `LOGTO_APPLE_PRIVATE_KEY` (the .p8 contents) →
re-run the workflow.

**C4. GlitchTip (one account + one token).** Wizard step 7 — open
`https://glitchtip-iac.<domain>` → register the first account → profile
→ Auth Tokens → create → store as `IAC_GLITCHTIP_API_TOKEN` (both iac
environments). Re-run the workflow: the glitchtip module creates the
org + per-stack projects and writes every DSN back itself
(`NAS_API_SENTRY_DSN` secret, `VITE_GLITCHTIP_DSN`/`_ADMIN` variables).

---

## Part D — native apps (store-mandated manual firsts)

Wizard step 9, or the runbook's §5: dispatch `native-android.yml` /
`native-ios.yml` with the `environment` input set to `iac-production`,
upload the first `.aab` to a new Play app (`app.munni.iac`) and create
the ASC record for TestFlight. Every build after the first is CI.

---

## The local track (full ecosystem on one machine)

**Double-click `infra/setup/start.cmd`** (or `node infra/setup/serve.mjs`).
That starts the wizard's LOCAL HELPER: it serves the same page on
127.0.0.1 and gives it hands — the page then stores the values you paste
(gitignored local store, GitHub not involved), runs bootstrap and
`docker compose` for you, streams every step's output live, and offers
one-click buttons for the dev stack and the tooling containers
(SonarQube + analyze, e2e stack, WebKit lane). The helper executes only
a fixed command allowlist, binds to 127.0.0.1, and requires the per-run
token it injects into the page.

The same flow by hand, if you prefer a terminal:

```sh
$env:NAS_GHCR_PAT = '<read:packages PAT>'
node infra/bootstrap.mjs --stack munni-local
cd infra/rendered/munni-local
docker compose --env-file .env.munni-local -f docker-compose.munni-local.yml up -d
```

Secrets are minted into `infra/rendered/munni-local/.secrets.local.json`
(gitignored, stable across re-runs); the rendered `.env` carries real
values. The generated `runbook.munni-local.md` walks the Logto OOBE and
GlitchTip token steps against `localhost`. This is distinct from the
from-source DEV stack (`deploy/docker-compose.local.yml`) — the wizard's
local track covers both.

---

## Day-2: how it stays healthy

- Pushes touching `infra/` run the module tests and VERIFY both stacks
  in CI (no writes).
- Manual dispatch of *IaC bootstrap* re-applies a stack idempotently;
  its output lands in the run's step summary.
- The `rotate` input (or `--rotate NAME`) re-mints a generated secret;
  redeploy afterwards.
- Retrieving generated passwords: see docs/secrets-access-plan.md —
  GitHub secrets are write-only by design.
