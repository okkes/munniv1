# Backend data security — current state and hardening plan

Status: **DESIGN — awaiting approval** (2026-07-22). User question:
"the backend stores a copy of the online user's data — is it
encrypted? what stops a hacker who reaches the database from stealing
it?"

## What the server stores, honestly

Yes: for syncing accounts the API's Postgres holds a full copy —
the per-space oplog (every field of every synced entity: transactions,
notes, budgets, spaces, members) plus server-side bank data
(GoCardless/EnableBanking ingested transactions, consent references)
and Logto's identity database and GlitchTip's error events beside it.

## What is already in place

- **Transport**: HTTPS everywhere (DSM-terminated), Bearer JWT auth
  (Logto), per-space membership checks on every sync route, rate
  limiting, CORS pinned to the app origins.
- **Network**: Postgres has NO host port — only containers on the
  compose network reach it; pgadmin and logto-admin are LAN-only via
  the DSM firewall. PSD2 access is read-only by design (munni can
  never move money).
- **Secrets**: never in git; GitHub Environment secrets → rendered
  .env on the NAS (and the IaC manifest now tracks owner/rotation).
- **E2EE precedent**: store-connection credentials already sync
  END-TO-END encrypted (ECIES per device) — the server stores only
  ciphertext for the most sensitive secret we handle.
- **Supply chain**: CodeQL, Renovate, Sonar; API error paths carry no
  data payloads into GlitchTip.

## What is NOT in place (the honest gaps)

1. **No encryption at rest.** The Postgres volume is plain ext4 on
   the NAS; a stolen disk or filesystem-level intruder reads
   everything.
2. **Backups are plaintext.** `db-backup` writes nightly
   `pg_dumpall` SQL into /volume1/backups — the most portable copy
   of all user data is the least protected.
3. **One database credential.** The `munni` role owns munni, logto
   AND glitchtip databases; any single service compromise reads all
   three.
4. **Bank data is server-readable.** Necessarily — the SERVER talks
   to GoCardless, so it must see what it ingests. Full E2EE is
   impossible for bank feeds without moving ingestion client-side.

## Threat model → measures

| Threat | Measure |
|---|---|
| Stolen NAS disk / offline copy | Volume encryption + encrypted backups (SEC1/2) |
| DB credential leak / SQLi pivot | Per-service roles, scram-sha-256, least privilege (SEC3) |
| Full DB dump exfiltration | Application-layer encryption of sensitive columns (SEC4), client-side E2EE for client-originated data (SEC5) |
| API auth bypass | already: JWT + membership checks + rate limits; add authz tests per route as a standing checklist |
| Backup location compromise | age-encrypted dumps, key NOT on the NAS (SEC1) |

## Slices

- **SEC1 Encrypted backups (quick win, do first).** db-backup pipes
  `pg_dumpall` through `age -r <public key>`; the private key lives
  ONLY in the operator's password manager + GitHub secret (restore =
  CI or laptop, never the NAS). Old plaintext dumps shredded after
  verification. Weekly restore-test workflow proves the backups are
  real.
- **SEC2 Volume encryption.** DSM shared-folder encryption (or LUKS
  on the Pi) for the postgres + backups volumes; key in DSM's key
  vault, NOT auto-mount-on-boot for the backup share. Documented
  reboot procedure.
- **SEC3 Database least privilege.** initdb creates `logto_svc` and
  `glitchtip_svc` roles owning only their databases; `munni` role
  loses superuser; `password_encryption=scram-sha-256`; pgadmin gets
  a read-only role. Rolled out via the IaC pair first.
- **SEC4 Column-level encryption for bank data.** pgcrypto (or
  app-side AES-GCM with a key from the environment, rotated via the
  IaC manifest) for IBANs, counterparty names and consent references
  — a DB dump without the app env then leaks structure, not
  identities. Server can still serve/query by id.
- **SEC5 E2EE for client-originated data (the local-first endgame).**
  Notes, budgets, goals, titles, categories-assignments originate on
  devices — they can sync as ciphertext exactly like store
  connections do today (per-space key, wrapped for each member's
  device keys, fingerprint verification UI reused). The server keeps
  serving opaque ops; admin diagnosis loses content visibility for
  those fields (by design). Bank-fed raw rows stay SEC4-protected
  instead. This is a large arc — design doc of its own before build.
- **SEC6 Standing hygiene.** Quarterly restore drill + secret
  rotation via `bootstrap --rotate`; dependency and image scanning
  stays on; a `SECURITY.md` with the disclosure contact.

Suggested order: SEC1 (an evening) → SEC3 (IaC pair) → SEC2 →
SEC4 → SEC6 → SEC5 (own design round).
