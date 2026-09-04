# Local three-stack topology, Logto isolation & the admin split — plan

Status: **LS1–LS6 SHIPPED** (2026-08-27; approved same day from live
wizard feedback). They build on the approved 2026-07-24 amendment in
docs/iac-plan.md (shared stack + per-env stacks, split admin) and
re-rule one part of it (Logto). LS7 (iac pair + NAS adopt the split)
stays open. One deviation from the LS5 sketch, on a later user ruling:
NO mode flag — the portal (apps/admin) and the cockpit (apps/control)
are two completely separate apps in two separate images
(munni-admin / munni-control).

## 1. Local goes three-stack: munni-local-dev / munni-local-prod / munni-local-shared

Today `munni-local` is ONE twin. The user wants the local machine to
mirror the real topology:

- **munni-local-shared** — the cross-environment services: GlitchTip,
  Vaultwarden, OCR, and the shared Postgres server (one container,
  databases per consumer). *Not Logto — see §2.*
- **munni-local-dev** and **munni-local-prod** — each its OWN web,
  admin, api, Logto and databases on the shared Postgres. Two fully
  isolated munnis on one machine, pointing at the shared stack for
  crash reporting and secrets lookup.

Mechanics (all existing machinery generalizes):

- Stack files gain `"sharedStack": "munni-local-shared"`; `render.mjs`
  splits services by role: `role:"shared"` renders glitchtip + vault +
  ocr + postgres; env stacks render web/admin/api/logto and point their
  connection strings + DSNs at the shared stack's localhost ports.
- Ports: shared keeps 8383 (glitchtip), 8384 (vault), 5433 (postgres,
  published for env stacks); dev = 84xx block + logto 3301/3302;
  prod = 83xx block + logto 3201/3202 (unchanged → the current twin
  becomes munni-local-prod with zero re-learning).
- The wizard's step 4 grows a stack switcher (prod / dev / shared
  status) and Set up orchestrates: shared first, then each env. The
  cleanup buttons already exist per stack.
- The iac pair adopts the same split AFTER local proves it
  (munni-iac-shared + twins), exactly as the 2026-07-24 amendment
  planned; the NAS bundle channels gain a `shared` channel.

## 2. Logto: per-ENVIRONMENT instances (re-ruling "shared per pair")

The user's pain is real: one shared Logto means one user pool across
dev and prod — account deletion in one environment cannot delete the
Logto identity (the other environment may still use it; this exact
knob exists today as `Logto:DeleteIdentityOnAccountDeletion=false` on
staging — a workaround, not a design).

Options considered:

- **Logto organizations**: first-class in Logto 1.x, but users remain
  TENANT-global — deletion and sign-up isolation stay unsolved. Orgs
  model teams inside one product, not environments. ✗
- **Logto multi-tenancy**: cloud-only; OSS ships the single `default`
  tenant. ✗
- **One Logto per environment**: full isolation — separate user pools,
  deletion is trivially safe, per-env branding/connectors, and env
  cleanup nukes its own identities. Historic cost was the manual OOBE
  per instance — which the wizard has now AUTOMATED end to end (infra
  M2M seeding + console claim + admin user). The cost argument is gone. ✓

**Recommendation: Logto moves into each environment stack.** The
shared stack keeps GlitchTip/Vaultwarden/OCR. Consequences: each env
stack's compose renders its own logto service + logto database; the
account-deletion knob dies (every env may always delete its own
identities); social connectors register per environment (Google allows
multiple redirect URIs per client — one client can serve all envs, or
one client per env for full separation).

## 3. GoCardless: environment scoping (first slice SHIPPED 2026-08-27)

The GC account is shared by every environment, and the admin portal
listed the ENTIRE account — foreign consents appeared as "stale" with
a working delete button (a staging admin could revoke prod's bank
access). Shipped now: the admin lists ONLY requisitions this
environment's database knows (stale = dead at the provider), foreign
ones are counted but never listed and never deletable; the local
cleanup buttons purge exactly the requisitions whose redirect carries
the stack's own origin. The scheduled idle cleanup was already
own-DB-scoped (verified).

Remaining slice: the per-env redirect origin is the natural consent
discriminator — record it on GcRequisitions at creation so future
tooling (quota dashboards in the shared portal, §4) can attribute
consents per environment without joining databases.

## 4. The admin split: env portal + shared-services portal

Today apps/admin mixes environment concerns (categories, keywords,
users, diagnosis) with SHARED concerns (GoCardless quota + connection
slots across the whole account). Target per the 2026-07-24 amendment,
now concretized:

- **munni portal** (per environment, exists today minus the shared
  bits): categories/keyword catalog, users + diagnosis, THIS env's
  bank connections, env health. Auth: the env's own Logto admin app +
  Admin:Subs, unchanged.
- **munni control** (one deployment, lives in the shared stack): the
  cross-env cockpit — GoCardless credential + quota + ALL consents
  attributed per environment (via §3's origin attribution), Enable
  Banking application, GlitchTip org overview, Vaultwarden pointer,
  environment inventory (which stacks exist, their versions/health
  probes). Auth: its own Logto app on ONE designated environment's
  Logto (prod's) with a dedicated `control-admin` role — the shared
  stack deliberately has no identity provider of its own.
- **Codebase**: one `apps/admin` with two Vite build TARGETS
  (`--mode portal` / `--mode control`) sharing components; two docker
  images (`munni-admin`, `munni-control`) or one image with a
  runtime-config `MUNNI_ADMIN_MODE` switch (preferred — matches the
  one-image-serves-every-stack doctrine).
- **API**: env portals talk to their env API (as today). munni control
  needs a small shared-services API surface; rather than a new
  service, the DESIGNATED env's API (prod) exposes `/control/*`
  endpoints gated on the control role — quota, cross-env consent
  attribution, environment inventory (fed by each env's /health).

## Slices & order

- LS1 ✅ render/stack support for `role:"shared"` + munni-local-shared
  (glitchtip, vault, ocr, control) — RE-RULED same day (user): NO
  shared postgres. Each environment runs its OWN postgres under its OWN
  minted password (deleting one env can never touch another; no env
  holds another's credentials); glitchtip keeps a dedicated glitchtip-db
  in the shared stack, and pgAdmin (8386) joins it as the one console
  over all three servers (preregistered via rendered
  pgadmin-servers.json; env servers publish postgres-prod/postgres-dev
  aliases on the shared network)
- LS2 ✅ munni-local-dev + munni-local-prod stack files; wizard family
  UI + one-button orchestration; local data declared WIP — rebuilt
  fresh on the postgres re-ruling (twin backup volumes deleted too)
- LS3 ✅ Logto-per-env locally (own logto per env stack, wizard seeds
  the M2M in-database idempotently; iac pair follows with LS7)
- LS4 ✅ GcRequisitions.RedirectOrigin column + attribution (also:
  admin list env-scoped with foreignCount, delete refuses foreign)
- LS5 ✅ admin split — re-ruled to TWO SEPARATE APPS (no runtime mode):
  apps/admin stays the per-env portal; apps/control is the cockpit
  (own codebase, image munni-control, own Logto app)
- LS6 ✅ /control/* API surface (ping/consents/quota, admin-gated,
  read-only — no delete by design); control app signs in via the
  designated env's dedicated `control` Logto app
- LS7 iac pair + NAS adopt the three-stack split (bundle channel
  `shared`, DSM rules, runbook)
