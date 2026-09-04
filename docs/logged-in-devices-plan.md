# Logged-in devices — design plan (2026-07-24, APPROVED)

User request: see which devices are signed in to my account, when each
was last seen, and disconnect one remotely.

## What exists to build on

- Every client already has a **stable device identity**: the HLC node
  id that stamps every oplog write (persisted locally, unique per
  install). The server therefore already SEES a device id on every
  sync push — no new client identity needed.
- Push subscriptions are stored per device with platform + language.
- The remote-wipe machinery exists: `enforceAccountBinding` wipes a
  device whose local data doesn't belong to the signed-in account.
  Remote disconnect can ride the same choke point.

## Design

**Server** — new `devices` table: `(userId, deviceId, platform,
userAgent summary, createdAt, lastSeenAt, revokedAt?)`. Rows upsert
lazily: every authenticated `/sync` stamps `lastSeenAt` (cheap
UPDATE, throttled to once per ~15 min per device). Two routes:
`GET /me/devices`, `POST /me/devices/{id}/revoke` (cannot revoke the
calling device — the UI offers sign-out for that).

**Client** — sync requests already carry the node id; add it as an
explicit header. When the server answers a sync from a revoked device
it returns a typed `deviceRevoked` error; the client routes that into
the existing account-binding wipe path: local data erased, back to the
login screen. Offline devices are wiped on their next successful
connection — same guarantee the account-binding wipe gives today.

**UI** — Profile → "Devices" screen: one row per device (platform
icon, name like "Android app" / "Chrome on Windows", last seen via
fmtTimeAgo, "this device" badge), trailing Disconnect with the
standard two-step danger confirm. Activity history logs a
`deviceRevoke` line. EN/NL/TR, browser-back, works in the phone frame.

## Decisions (user, 2026-07-24)

1. Disconnect = **wipe** — the revoked device erases its local data via
   the account-binding wipe path.
2. Offline/demo profiles do **not** appear — signed-in concept only.
3. Names are **auto-derived AND editable** — rows get a rename affordance.
