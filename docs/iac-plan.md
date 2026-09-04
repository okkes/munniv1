# Infrastructure as Code — whole-ecosystem plan

Status: **APPROVED with amendments** (2026-07-22). Goal (user): "I
provide the root credentials once; everything else is generated, stored
and deployed by code."

User rulings folded in (clarified 2026-07-22, IMPLEMENTATION STARTED):
- **Isolated from the existing stacks, shared within the pair.** The
  IaC pair mirrors today's topology exactly: munni-iac-prod owns the
  heavyweight shared services (Logto, GlitchTip) and munni-iac-staging
  REUSES them — the same way today's staging rides prod's Logto. What
  the pair must never do is touch or reuse anything from the CURRENT
  prod/staging stacks: own Logto instance, own databases, own
  containers, own domains.
- **Twin stacks, iac naming + domains.** **munni-iac-prod** at
  `munni-iac.<domain>` and **munni-iac-staging** at
  `munni-iac-test.<domain>` (`-iac` in every hostname keeps
  the pair visually unmistakable). Both come up from the same
  `bootstrap` path; only the stack file differs. Prod adopts the
  pipeline only after BOTH twins pass.
- **First-time vs steady-state, no shortcuts.** Bootstrap must handle
  BOTH flows explicitly: the FIRST deployment of a stack produces
  every artifact the unavoidable manual steps need (the signed .aab
  for the first Play upload, the .ipa for the first TestFlight push,
  the exact console clicks, in order, with the generated values
  inlined) — a runbook rendered per stack, not generic prose. Every
  deployment after that runs with zero human input.
- **Ordering: Raspberry Pi first.** The Pi arc (multi-arch images,
  docs/raspberry-pi-plan.md) changes what a "host" is; IaC modules
  must target both DSM and the Pi, so the Pi work lands before the
  host-facing IaC slices (IAC4+). IAC1–IAC3 are host-agnostic and can
  proceed in parallel.

## What exists today (baseline)

Deploys are already push-button but the SETUP was manual: GitHub
Environments hold per-stack values, secrets were typed in by hand,
Logto apps/redirects were clicked together in its console, the NAS got
its DSM reverse-proxy rules and certificates by hand, and the compose
files assume those all exist.

## Target architecture

One repo directory `infra/` owns everything:

```
infra/
  stacks/            # one folder per stack
    munni-iac-staging.jsonc  # domains, ports, channels, feature flags
    munni-iac-prod.jsonc
  modules/
    github.ps1|sh    # repo variables/secrets via gh api
    logto.mjs        # Logto Management API: apps, redirects, resources
    postgres.sh      # role/db creation, password rotation
    dsm.mjs          # DSM API: reverse proxy rules, cert deploy
  bootstrap.mjs      # the ONE entry point: reads a stack file, applies all
```

### 1. Secrets: generated, never typed

- `bootstrap.mjs --stack munni-iac` generates every derivable secret on
  the spot (Postgres passwords, GlitchTip SECRET_KEY, VAPID pair, CSK
  salts) with `crypto.randomBytes`, then writes them to GitHub
  **Environment secrets** via `gh api` — the same names the workflows
  already read. Re-running rotates only what `--rotate` names.
- Root credentials the operator must still provide ONCE (stored as
  GitHub secrets, consumed by bootstrap): GoCardless secret id/key,
  EnableBanking app id + PEM, Apple/Play store credentials, Synology
  account, Logto admin M2M credential (see below), logo.dev keys.
- An inventory file `infra/secrets.manifest.json` lists every secret
  with owner (generated | operator), scope, and rotation policy — the
  bootstrap fails loudly when the manifest and reality drift (the
  missing-secret-at-deploy class of surprise dies here).

### 2. Logto as code

Logto has a full Management API (we already use it for user deletion).
- `infra/modules/logto.mjs` + per-stack app definitions: web SPA, admin
  SPA, native iOS, native Android, M2M — each with redirect URIs,
  post-logout URIs, CORS origins, resource indicators derived from the
  stack file's domains. Apply = upsert by app name; ids written back to
  GitHub variables (`VITE_LOGTO_APP_ID`, …).
- **One Logto instance per PAIR, owned by munni-iac-prod** (user
  clarification: staging reuses it, mirroring today's topology; only
  the CURRENT stacks' Logto is off-limits). The container + database
  render with the prod twin; its OOBE + one "infra" M2M credential is
  the single manual step per pair, after which apps/redirects/
  resources for BOTH twins are code. Staging deletion safety knob
  (`Logto:DeleteIdentityOnAccountDeletion=false`) carries over.

### 3. Stack rendering (compose + env)

- Today's `deploy/env/.env.nas` + render-env.sh pattern generalizes:
  `bootstrap` renders `docker-compose.<stack>.yml` + `.env.<stack>`
  from the stack file — ports, domains, image tags, feature flags all
  come from one JSON. The NAS bundle pipeline stays as-is; it just
  gains a third channel (`munni-iac`).

### 4. NAS automation (no SSH, DSM API) — reverse proxy SHIPPED

`.github/workflows/iac.yml` runs bootstrap in CI (user ruling: IaC
lives in GitHub Actions): manual dispatch applies a stack; pushes
touching infra/ verify both. Operator one-timers: **IAC_GH_PAT** repo
secret (fine-grained, environments+secrets+variables — GITHUB_TOKEN
cannot write environment secrets), and the existing SYNOLOGY_* deploy
secrets (the account needs DSM admin for AppPortal writes).
`infra/modules/dsm.mjs` upserts the stack's reverse-proxy rules via
`SYNO.Core.AppPortal.ReverseProxy` (idempotent by source FQDN).

DSM has a full web API (we already drive FileStation):
- **Reverse proxy rules**: `SYNO.Core.AppPortal.ReverseProxy` — create
  `munni-iac.<domain>` → container port mappings from the stack file.
- **Certificates** (approach settled, user-provided reference): use
  acme.sh's `synology_dsm` deploy hook — it logs into DSM, finds or
  creates the named certificate, imports key+chain and reloads HTTP
  services. A scheduled workflow (or NAS task) runs
  `acme.sh --deploy -d <domain> --deploy-hook synology_dsm` with
  SYNO_USERNAME/SYNO_PASSWORD/SYNO_HOSTNAME/SYNO_CERTIFICATE env; the
  wildcard covers the munni-iac subdomains. No hand-rolled
  SYNO.Core.Certificate client needed.
- **Reverse-proxy caveat** (same reference): the entry schema is
  internal and can shift between DSM releases — when a create/update
  400s after a DSM upgrade, capture the request the DSM UI itself
  sends (devtools → copy as cURL) and realign dsm.mjs's `desired`
  object.
- **Firewall**: DSM's firewall API is undocumented/fragile — rules
  stay manual, but `bootstrap --verify` PROBES the outcome (container
  subnets reachable, ports answering) and prints exactly what to fix.
- **Task scheduler**: the apply.sh 5-min task — creatable via
  `SYNO.Core.TaskScheduler`; bootstrap ensures it exists.

### 5. The munni-iac proof twins

Acceptance test for the whole plan: from a clean checkout,
`bootstrap --stack munni-iac-prod` then `--stack munni-iac-staging`
must produce the working pair (prod twin carries Logto + GlitchTip,
staging twin reuses them; own postgres dbs, own `munni-iac*`
subdomains, own secrets) with ZERO console visits beyond the
documented once-per-pair Logto OOBE step, then
`bootstrap --destroy <stack>` removes it all. Only after both twins
pass does prod adopt the same path.

### 6. First-time vs steady-state (explicit, per stack)

`bootstrap --stack X` detects state and prints/does the right flow:

**First run** (nothing exists yet):
1. generate + store all derivable secrets; verify operator-provided
   roots against the manifest
2. render compose/env, deploy containers, run Logto module (after the
   operator completes the pair's one OOBE step, guided)
3. produce the manual-step artifacts: a signed .aab (new appId per
   stack, e.g. `app.munni.iac`) for the first Play upload, the
   TestFlight archive job trigger, DNS records to create, DSM
   firewall expectations — all written into a rendered
   `runbook.<stack>.md` with the actual generated values inlined
4. `--verify` probes everything reachable and lists exactly what
   remains manual

**Steady state** (marker exists, manifest satisfied): render, diff,
apply, verify — no prompts, no manual steps, CI-invokable.

## Inevitably manual (documented, verified, never scripted)

- store uploads (first .aab/.ipa per app), App Store/Play listings
- Apple capabilities (Associated Domains enable per App ID)
- Logto OOBE + the one "infra" M2M credential per instance
- DSM firewall rules (probed by `--verify`)
- DNS records at the registrar (probed by `--verify`)

## Slices

Ordering rule: PI1–PI3 (raspberry-pi-plan.md) land first; IAC1–IAC3
are host-agnostic and may run in parallel with them.

- IAC1 `infra/` skeleton + twin stack files + secrets manifest +
  generator (GitHub secrets writer)
- IAC2 Logto module (own instance per stack; apps as code, ids
  written back)
- IAC3 stack rendering unification (compose/env from stack file)
- IAC4 host module (DSM reverse proxy + task scheduler + verify
  probes; Pi twin of the same interface)
- IAC5 cert automation (DNS-01 in CI, host upload)
- IAC6 munni-iac-staging + munni-iac-prod end-to-end bootstrap +
  destroy + runbook

## North star (user, 2026-07-23)

The end state this plan serves: **anyone — you after a full wipe, or a
friend — can roll out the entire ecosystem on their own hardware (NAS,
Raspberry Pi, or other) from a clean checkout plus a handful of root
credentials.** Consequences already folded in, plus two roadmap items:

- **IAC7 — deploy/ folds into infra/**: today `deploy/` (hand-written
  composes, render-env, apply.sh) and `infra/` (rendered stacks)
  overlap. End state: infra renders EVERYTHING — the live prod/staging
  stacks become stack files like the iac pair, deploy/ keeps only the
  host-side poller. Migration happens after the munni-iac pair proves
  the pipeline (§5), never before.
- **IAC8 — shrink the manual list relentlessly**: every runbook item
  is a bug with a priority. Current list and their fates: Logto OOBE
  (scriptable via bootstrap once Logto ships headless OOBE — watch
  upstream), GlitchTip org/DSN creation (has an API — automate, easy),
  DSM firewall (probe-only, DSM API too fragile), DNS (registrar API
  optional profile), store uploads (Apple/Google mandate the first
  manual upload — irreducible).


## Amendment 2026-07-24 (corrected per user): shared-services stack + per-env stacks, split admin

The user's actual topology (my earlier "three environments" reading was
wrong):

### Stacks

- **One SHARED stack** owning the cross-environment services: Logto,
  GlitchTip, pgAdmin (and the shared postgres they ride). Deployed once,
  upgraded on its own cadence — an env deploy can never take the login
  or the error tracker down.
- **One stack PER ENVIRONMENT** (staging, production, x, y, z…): api,
  web, ocr, import-watch — everything that IS the app. Each env stack
  points at the shared stack for identity/monitoring and at its own
  database on the shared postgres.

Infra consequence: `infra/stacks/` gains `munni-shared.jsonc` next to
the per-env files; the render module splits services accordingly; the
NAS poller applies the shared stack with its own marker (rarely moves).
Env stacks list the shared endpoints as inputs — nothing shared is
duplicated per env.

### Split admin portal

Two APPS, not one app with modes:

- **munni portal <env>** (one deployment per env stack): manages that
  environment's DATA — categories, category keywords, users/diagnosis,
  quota view for that env. Talks only to its own env's API.
- **munni shared services portal** (one deployment, lives in the shared
  stack): manages what is genuinely cross-env — GoCardless/Enable
  Banking credentials + provider quota (limits are per credential,
  shared by every env), Logto administration, and other shared-service
  concerns as they appear.

Codebase: keep one apps/admin codebase with two build TARGETS (env
portal / shared portal) so components stay shared while the deployed
apps stay separate. Auth: env portals use their env's Logto app; the
shared portal gets its own Logto app with an explicit shared-admin
scope.

Migration order: introduce the shared stack in the IaC pair first
(munni-iac-shared + the twins consuming it), prove it, then fold the
LIVE deployment the same way during IAC7.

## Amendment 2026-08-26 (user request): setup wizard + the automation sweep

The user's ask — "an HTML file that walks the whole initial setup,
explains each account, fills the secrets in for us, and clicks the
follow-ups" — landed as `infra/setup/index.html` (engine ruling:
**static HTML driving the GitHub API directly**; the browser writes
sealed-box secrets, dispatches workflows and reads live status with the
one IAC_GH_PAT — nothing installed, works for any fork). Alongside it,
the re-audit of every manual step shipped:

- **Runtime-config overlay (user-approved)**: web + admin read
  `window.__MUNNI_CONFIG__` (from `/runtime-config.js`, rendered by the
  nginx entrypoint from `MUNNI_*` env) before their baked Vite env. The
  bake had silently pinned every published image to the LIVE stacks —
  the iac pair and any fork would have served frontends pointing at
  prod. One public image now serves every stack, which is what the CSP
  design ("connect-src stays open so one image serves every
  environment") always assumed.
- **IAC4 completed**: deploy-nas.yml channel input (`iac-prod` /
  `iac-staging` / `iac-both`) renders via `bootstrap --render-only`,
  substitutes secrets AND written-back variables (render-env.sh now
  resolves any `${NAME}`, secrets-then-vars), and the NAS poller unpacks
  each twin into its own `/volume1/docker/<stack>/`. B1-2's manual copy
  is gone. update.sh guards the pg-migration volume names so an
  iac-staging deploy can never touch live staging volumes.
- **IAC8 progress — GlitchTip as code**: `infra/modules/glitchtip.mjs`
  ensures org/team/per-stack projects and writes the DSNs back once the
  operator stores one API token (`IAC_GLITCHTIP_API_TOKEN`). Runbook §4
  shrank to "register + create token".
- **Local target**: `munni-iac` gained a sibling `munni-local` stack
  (target:"local") — the whole ecosystem on Docker Desktop, http on
  localhost ports, secrets minted into a gitignored store, .env rendered
  with real values, its own short runbook. User ruling: the wizard's
  local track covers the twin AND the dev flow AND the tooling
  containers (SonarQube, e2e, WebKit).
- **Native works for the pair**: native-android/ios gained an
  `environment` dispatch input (`iac-production`/`iac-staging`) — the
  branch-derived environment had made runbook §5 impossible to execute.
- **Manifest hardening**: SYNOLOGY_*, IAC_GH_PAT and the GlitchTip
  token joined `secrets.manifest.json` with platform tags (nas/ci);
  scope:"global" roots are now accepted at repository level by
  ensure/verify; NAS_API_SENTRY_DSN became module-owned.
- **Raspberry Pi**: wizard shows a placeholder card until PI3 lands
  (user ruling: don't build install.sh in this arc).
- Tests: `infra/tests/` (node --test, wired into iac.yml) — glitchtip
  module against a faked API, local store/render contracts, and the
  wizard's sealed-box crypto extracted from the shipped HTML and pinned
  to RFC 7748/7693 vectors.
- **Local helper (user feedback round 2: "I want to avoid running
  commands myself")**: `infra/setup/serve.mjs` + `start.cmd` — a
  zero-dependency localhost server that serves the SAME wizard page and
  executes the local track for it (store values, bootstrap, compose
  up/down, dev/sonar/e2e/webkit tools) over a token-gated, fixed
  command allowlist, streaming output into the page. file:// keeps the
  guided-manual fallback. Credential cards now apply to the local
  platform too (feature toggles visibly add/remove them; values land in
  the machine's gitignored store instead of GitHub).
- **Credential validation (user feedback round 3: "check if the pat is
  correct, like GitHub")**: every credential card gained a Check button
  and Store validates first — a definitive provider rejection blocks the
  store (Store anyway overrides), an unreachable provider only warns.
  `infra/modules/validate.mjs` mirrors the SERVER's real auth per
  provider (GoCardless token/new, Enable Banking RS256 JWT kid=app id,
  FCM jwt-bearer token mint, logo.dev sk search + pk image + swap
  detection, Google/Apple OAuth dummy-code trick where only
  invalid_client fails, DSM login via dsm.mjs, local Logto M2M +
  GlitchTip token). GitHub-token checks (ghcr PAT scopes) run in the
  browser; CORS-bound providers validate through the helper's
  /api/validate (field values merged over the local store, transient,
  never logged).
