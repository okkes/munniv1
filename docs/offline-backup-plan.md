# Offline profiles: backup, restore & go-online — plan

Status: **DESIGN — awaiting approval** (2026-07-22). Three user asks in
one arc, because they share machinery: (1) backups for offline users,
(2) restoring them — on any device or install, any age, (3) a one-way
migration from offline to a signed-in account.

## B1 — Backup format (the system's own shape, not an export)

Export (CSV/JSON) stays what it is: human-readable data. A **backup**
is the database's own truth:

```jsonc
{
  "magic": "munni-backup",
  "formatVersion": 1,          // backup ENVELOPE version
  "schemaVersion": 13,          // Dexie schema at write time
  "appVersion": "2.21.0",
  "createdAt": "2026-07-22T…",
  "profile": { "kind": "offline", "profileId": "…" },
  "tables": { "spaces": [...], "transactions": [...], … },  // raw rows
  "checksum": "sha256-…"       // over the canonical tables payload
}
```

- Rows go verbatim (envelope fields included) — restore is a plain
  table load, no interpretation, no lossy round-trip.
- **Integrity fingerprint** (user idea): SHA-256 over the serialized
  tables; restore refuses a mismatch with a clear "this file is
  damaged" instead of a half-import. The checksum also renders as a
  6-group human code next to the backup's date in the UI.
- Compressed with `CompressionStream('gzip')` → `.munnibackup` file.

## B2 — Where backups go

- **Manual**: "Back up now" in Global settings → share sheet / file
  save. Native shells write via the filesystem plugin; web downloads.
- **Auto-backup (opt-in)**: user picks a directory once —
  - Android: Storage Access Framework directory grant; picking a Drive
    /synced folder gives cloud backup for free (user idea — exactly
    how it should work, no Drive API needed).
  - iOS: a folder in the Files app (iCloud Drive included) via a
    security-scoped bookmark.
  - Web PWA: File System Access API directory handle where available;
    otherwise auto-backup is hidden and manual stays.
  - Cadence: after meaningful change, at most once per day, on app
    open; keep the last 7 files (`munni-2026-07-22.munnibackup`),
    prune older.
- **Reminder** (user ask): offline users WITHOUT auto-backup get a
  gentle nudge once a week after their first week — a Home card (not a
  push: offline users may have notifications off / never granted), one
  tap = back up now, one tap = "remind me less".

## B3 — Restore / import

Entry points: the offline-profile login screen ("Restore a backup")
and Global settings. Flow:
1. Pick file → parse envelope → checksum verify → show a SUMMARY card
   (created date, app version, row counts, profile name) before
   anything is touched.
2. Restore into a FRESH profile db always (never merge into an
   existing one — merge semantics are a lie without sync). An existing
   profile with data warns: "this replaces everything in this profile".
3. **Old backups** (user question): restore loads the rows and then
   runs the SAME migration ladder the app already runs on open —
   Dexie's versioned upgrades take a v7-era backup to v13 exactly like
   a dormant install would. That's the point of storing raw rows: a
   backup is indistinguishable from a device that slept 6 months.
   `formatVersion` guards the envelope itself; unknown NEWER versions
   refuse with "this backup came from a newer munni".
4. Cross-device: nothing device-bound goes into the file (no store
   tokens, no lock PIN, no push registrations) — those re-set up.

## B4 — Offline → online migration (one-way, loudly)

1. User signs in (or creates the account) WHILE the offline profile is
   active → "Bring your data" flow offers migration.
2. Preflight: a fresh account has empty spaces — clean adopt. An
   account WITH existing data gets a hard choice (keep account data,
   or keep offline data) — no row-level merging, ever.
3. Mechanics: offline rows already carry the sync envelope (fieldVersions,
   HLC) because Repo writes them identically — migration re-homes the
   spaces onto the account (fresh space ids where the server rejects
   feed-shaped/duplicate ids), queues everything through the outbox,
   and lets the normal engine push. Local-first means the UI is usable
   the whole time.
4. **The warning** (updated 2026-07-23 — online→offline now exists, so
   "no way back" is no longer true): before anything moves — "This
   turns your offline profile into this signed-in account. You can go
   offline again later (docs/online-to-offline-plan.md), but this
   exact offline profile is consumed by the migration; your backup is
   the snapshot of this moment." A forced backup download stays the
   confirm button ("Save backup & migrate").
5. After success: the offline profile row is removed from the picker;
   the identity db is deleted after the outbox fully drains (verified
   server-side counts), not before.

## Slices

- OB1 backup writer + checksum + manual "Back up now" (all identities,
  not just offline — signed-in users get it for free)
- OB2 restore flow with summary/preflight + migration-ladder test
  matrix (a fixture backup per schema era, restored in CI)
- OB3 auto-backup directory grants (per platform) + retention + the
  weekly reminder card
- OB4 offline→online migration with forced-backup confirm
- Tests: round-trip equality (backup → wipe → restore → deep-equal),
  checksum tamper refusal, v(old) fixture upgrades, migration outbox
  drain. EN/NL/TR, tours/guide, what's-new per slice.
