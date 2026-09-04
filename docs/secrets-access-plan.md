# Reading back generated secrets — plan

Status: **APPROVED with one ruling** (2026-07-23): the vault is PART
OF THE STACK — it deploys inside the IaC prod twin's compose (one
vault per pair, next to Logto/GlitchTip), never a centralized
instance shared across deployments. Problem (user):
bootstrap now GENERATES passwords straight into GitHub Environment
secrets — which are **write-only**. There is no API to read a secret
back, so "what's the pgadmin password?" currently has no answer except
rotating it.

## Recommendation: Vaultwarden on the NAS, written by bootstrap

Your instinct is right. **Vaultwarden** (the lightweight Bitwarden
server, one ~10 MB container + SQLite) is the best fit:

- Runs beside the stacks, reverse-proxied LAN-ONLY (`vault.<domain>`
  restricted in the DSM firewall like pgadmin) — never internet-facing.
- You read secrets with the real Bitwarden apps/extension (mobile,
  browser) — no new UI to learn, and it doubles as a personal
  password manager if you want.
- Bitwarden's `bw` CLI lets BOOTSTRAP write items programmatically:
  every secret it mints is stored under a `munni-iac/<stack>` folder
  at generation time — the only moment the value exists in plaintext.

### Design

1. **Container**: `vaultwarden/server` joins the prod-twin compose
   (`SIGNUPS_ALLOWED=false` after your one account; `DOMAIN=` the LAN
   host; data volume in the nightly backup path — the backup is
   already planned to be age-encrypted, SEC1).
2. **Bootstrap integration**: a new module `vault.mjs` — when
   `VAULTWARDEN_URL` + a machine account's `BW_CLIENTID/BW_CLIENTSECRET/BW_PASSWORD`
   are in the env, every minted secret is ALSO upserted as a login
   item (`name = <stack>/<SECRET_NAME>`, username = the tool's user,
   uri = the tool's LAN url). No env → mint-only, exactly as today.
   CI caveat: the runner can't reach the LAN vault — so CI runs mint
   into GitHub only, and prints a reminder to run
   `bootstrap --stack X --sync-vault` once from a LAN machine, which
   re-mints-and-stores rotating only what it must (VAPID excluded).
   Cleaner alternative (preferred): bootstrap runs the vault write
   THROUGH the NAS itself — the deploy poller executes a
   `vault-sync` script from the bundle with the values injected via
   the rendered env, so no LAN detour is needed. Decide in review.
3. **What lands in the vault**: pgadmin, postgres, GlitchTip
   SECRET_KEY + your GlitchTip login, Logto admin + infra M2M,
   Sonar tokens — everything a human might type into a login form.
   NOT the VAPID private key or store E2EE material (no human ever
   types those; fewer copies is better).
4. **Recovery**: Vaultwarden's data lives on the NAS volume + in the
   encrypted backups; your master password is the one secret that
   lives only in your head (write it on paper, not in the vault).

### Rejected alternatives

- *Reveal in CI logs* — secrets in logs are forever.
- *SOPS/age-encrypted file in the repo* — solid, but rotating means
  commits, and you wanted convenient login lookup on your phone.
- *1Password/Bitwarden cloud* — external custody of everything;
  against the self-hosted posture.

## Slices

- SA1 vaultwarden service in the prod-twin render + runbook step
  (create account, disable signups, firewall note)
- SA2 vault.mjs + bootstrap `--sync-vault` (or poller-side script —
  pick during review) writing minted secrets as items
- SA3 backfill: one guided rotation pass so today's already-minted
  (unreadable) secrets get replaced by vault-known ones
