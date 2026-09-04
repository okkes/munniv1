# Online → offline migration — plan

Status: **SHIPPED** (2026-07-24, OO1-OO4). Global settings → "Go
offline" opens the consent screen (kept list, ends list, keep/remove
per shared space, delete-server-data default ON), and confirm performs
the identity REBIND: the new offline profile carries a `storeKey`
pointing at the signed-in identity's existing store (identityKey
resolves it — zero copying), bank-linked accounts flip to the manual
tier (user ruling: manual continuation, not frozen), dropped shared
spaces purge locally, memberships end server-side (or the whole
account is deleted). One offline profile per device stands — the
screen refuses with an explanation when one exists. Deleting an
adopted offline profile destroys the adopted store. The open question
below was answered by the user: manual, not frozen.

## Feasibility: high — the architecture already carries it

munni is local-first: a syncing device already holds a complete copy
of every space it belongs to, in the same Dexie/SQL store an offline
profile uses. Converting is not a data migration, it's an IDENTITY
rebind plus an honest triage of the server-only features. The reverse
(offline→online) is the hard one (approved elsewhere); this direction
is mostly deletion.

## What each data class does on conversion

| Data | Fate offline |
|---|---|
| Own spaces, transactions, budgets, goals, notes, receipts, history | Kept verbatim — already local |
| Bank-linked (GoCardless/EB) accounts | Frozen: data stays, feed stops; account is relabeled "imported (frozen)" — statement uploads can keep it alive manually |
| Imported (CAMT) accounts | Kept — uploads keep working, they never needed the server |
| Shared spaces (others') | Choice per space: keep a frozen read-only snapshot, or drop it. Membership itself ends (server-mediated) |
| Friends, invites, splits with others | End — listed plainly in the consent screen; splits are settled or exported first |
| Web/native push, store-connection E2EE sync | End (single device now) |
| App lock, activity history, tours | Kept (already local) |

## Flow

1. Settings → "Go offline" (danger-adjacent, not hidden): a consent
   screen in the offline-intro style — kept list vs ends list, per
   shared space a keep-snapshot/drop choice, and the no-way-back
   warning (re-joining online later = a fresh account; the offline
   data can then migrate up via the offline→online arc).
2. On confirm: create an offline profile from the current display
   name/avatar; REBIND the identity key so the existing local store
   is adopted as-is (no copying); mark bank accounts frozen; strip
   server-only rows (friends, memberships); best-effort server calls:
   leave shared spaces, revoke consents, delete-account (user picks:
   "delete my server data" checkbox, default ON — GDPR-clean exit).
3. The engine never starts for offline identities — everything else
   already behaves.

## Slices

- OO1 identity rebind (adopt an existing store under an offline
  profile) + engine/telemetry gates re-verified
- OO2 consent screen with per-space triage + frozen-account labeling
- OO3 server-side exit calls (leave/revoke/delete) + tests
- OO4 payment-plan integration: the cancel screen's "keep using munni offline" becomes this flow

Open question: should frozen bank accounts allow manual continuation
(flip them to tier 'manual' at the user's request) rather than
staying frozen? My lean: yes, one-way flip with a confirm.
