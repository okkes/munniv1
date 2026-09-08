# infra/ — from zero to a running munni pair, step by step

This is the ONE checklist to stand up the IaC dev+prod pair
(`munni-iac-staging` + `munni-iac-prod`). Follow it top to bottom;
every step says whether it is once-ever, once-per-host, or automatic.
The NAS and Raspberry Pi tracks share Part A and split in Part B.

> The NAS domain is a SECRET here (public repo): wherever you see
> `<domain>`, that's the value of the `IAC_DOMAIN` secret.

---

## Part A — shared groundwork (once ever)

**A1. Repo secrets (GitHub → Settings → Secrets and variables →
Actions → *Repository* secrets).** Create:

| Secret | What |
|---|---|
| `IAC_DOMAIN` | your DDNS domain (e.g. `xxxx.synology.me`) |
| `IAC_GH_PAT` | fine-grained PAT, THIS repo, permissions: Administration RW + Secrets RW + Variables RW (bootstrap writes environment secrets — `GITHUB_TOKEN` cannot) |
| `NAS_GHCR_PAT` | fine-grained PAT, read:packages (image pulls) |
| `NAS_GOCARDLESS_SECRET_ID` / `_KEY` | GoCardless portal |
| `NAS_ADMIN_SUBS` | your OIDC sub(s), comma-separated |
| optional: `NAS_ENABLEBANKING_*`, `NAS_FCM_SERVICE_ACCOUNT_JSON`, `NAS_LOGODEV_*` | as per feature |

**A2. First bootstrap run.** Actions → *IaC bootstrap* → Run
workflow → stack `munni-iac-prod`. It creates the
`iac-production` environment, mints every generated secret (postgres,
VAPID, GlitchTip key…), renders compose+env and uploads them plus a
personalized `runbook.munni-iac-prod.md` as the run artifact.
**Download that artifact — it is your worksheet for everything below.**
Repeat for `munni-iac-staging`.

**A3. DNS.** With Synology DDNS the `*.<domain>` wildcard already
resolves; external registrars need records for the hosts listed in the
runbook (`munni-iac.<domain>`, `munni-iac-test.<domain>`, …).

---

## Part B1 — NAS track

**B1-1 (once per NAS).** Make sure the deploy account (SYNOLOGY_USER
secret, already used by deploy-nas.yml) has DSM *administrator* rights
— the reverse-proxy module needs them. Re-run the IaC workflow: it now
creates every reverse-proxy rule via the DSM API. Only two things stay
manual (the workflow's verify step probes both):
- Firewall: allow `172.16.0.0/12` in the access profile; restrict the
  `*-admin` hosts to LAN.
- Certificate: the `*.synology.me` wildcard from DSM covers the hosts;
  for own domains run acme.sh with the `synology_dsm` deploy hook (see
  docs/iac-plan.md §4).

**B1-2 (once per stack).** Copy the artifact's
`docker-compose.<stack>.yml`, `.env.<stack>` and `initdb/` to
`/volume1/docker/<stack>/` and run `docker compose up -d` there
(Container Manager → Project works too). The NAS bundle poller takes
over updates once the deploy pipeline gains the iac channels (IAC4).

## Part B2 — Raspberry Pi track (after PI3 lands)

**B2-1 (once per Pi).** Flash Raspberry Pi OS Lite (64-bit), attach an
SSD (Postgres on SD cards dies young), then run
`deploy/pi/install.sh` — it installs docker + compose, creates
`/opt/munni`, and arms the systemd bundle-poll timer. *(install.sh is
slice PI3 of docs/raspberry-pi-plan.md — until it lands, this track
is not yet available.)*

**B2-2 (once per stack).** Same artifact files to `/opt/munni/<stack>/`,
`docker compose up -d`. The bundled Caddy (PI4) terminates HTTPS with
Let's Encrypt — no DSM, no reverse-proxy console, DNS must point at
the Pi.

---

## Part C — auth + observability (once per PAIR)

**C1. Logto OOBE (the ONE manual auth step).** Open
`https://logto-iac-admin.<domain>` → create the admin user →
Applications → Create → *Machine-to-machine* → name `infra` → assign
the Logto Management API role (all permissions). Store its id/secret:

```sh
gh secret set IAC_LOGTO_INFRA_M2M_ID --env iac-production
gh secret set IAC_LOGTO_INFRA_M2M_SECRET --env iac-production
```

Re-run the IaC workflow for BOTH stacks — apps, redirect URIs, CORS,
API resources and the account-deletion M2M app are now code, and the
ids land in the GitHub environments automatically.

**C2. Google sign-in (optional, once).** Google Cloud console →
Credentials → Create OAuth client (Web) → authorized redirect URI
`https://logto-iac.<domain>/callback/google-universal` → store
`LOGTO_GOOGLE_CLIENT_ID` + `LOGTO_GOOGLE_CLIENT_SECRET` as repo
secrets → re-run the workflow. The connector + sign-in-experience
wiring is code.

**C3. Apple sign-in (optional, once).** Apple developer portal →
Identifiers → new *Services ID* (this is `LOGTO_APPLE_CLIENT_ID`),
enable Sign in with Apple, return URL
`https://logto-iac.<domain>/callback/apple-universal`; Keys → new key
with Sign in with Apple → store `LOGTO_APPLE_TEAM_ID`,
`LOGTO_APPLE_KEY_ID`, `LOGTO_APPLE_PRIVATE_KEY` (the .p8 contents) as
repo secrets → re-run the workflow.

**C4. GlitchTip DSNs (once).** Open `https://glitchtip-iac.<domain>`,
create the org + projects, store each DSN per the runbook's §4
commands.

---

## Part D — native apps (store-mandated manual firsts)

Follow the runbook's §5: trigger the native workflows against the iac
environment, upload the first `.aab` to a new Play app
(`app.munni.iac`) and create the ASC record for TestFlight. Every
build after the first is CI.

---

## Day-2: how it stays healthy

- Pushes touching `infra/` VERIFY both stacks in CI (no writes).
- Manual dispatch of *IaC bootstrap* re-applies a stack idempotently.
- `--rotate NAME` re-mints a generated secret.
- Retrieving generated passwords: see docs/secrets-access-plan.md —
  GitHub secrets are write-only by design.
