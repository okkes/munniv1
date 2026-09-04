# Financial accounts — the master plan

Status: **IMPLEMENTED (v1) 2026-07-25** — see the slice ledger at the
bottom for what shipped versus what is deliberately deferred. Supersedes
`manual-accounts-global-plan.md` (AT1/AT3 shipped; AT2/AT4 fold in
here). Input: the user's ChatGPT consultation — its core insight is
adopted wholesale, mapped onto what munni already has.

## The one architectural decision

> **"Imported" and "linked" describe how data ARRIVES, not what the
> account IS.** There are only two kinds of financial account:
>
> - **Manual** — space-scoped, hand-maintained, dies with its space.
> - **External** — represents a real account at an institution; lives
>   at user level, attached to 0..n spaces, never takes hand-typed
>   rows, and is fed by one or MORE data sources (statement uploads
>   today, a provider connection tomorrow — the same account).

This dissolves the current awkwardness: an ASN account started via
CAMT uploads and later connected through GoCardless is ONE account
with two sources — not a migration problem. The three-tier LABELS
shipped in the UI stay (users see "linked/imported/manual" as the
current *feeding* state), but the model beneath stops treating them
as different account species.

## Mapping onto what exists (honest inventory)

| Concept (target) | Today in munni | Gap |
|---|---|---|
| External account + raw transactions | Feed space (`uuidv5("feed:"+IBAN)`) with op-log rows | none — keep |
| Space attachment (`SpaceAccountLink` + visibleFrom) | `accountLink` + `historyFrom` + attach/detach UI | none — keep |
| Per-space overlay (category, notes, receipts, splits…) | Per-space transform data riding the attaching space | none — keep |
| Data source: provider connection | `GcLinkedAccount` / EB consents, per user | rename-in-model only |
| Data source: import batch | **missing** — imports write ops directly, uploader untracked | **IB slice** |
| Source layer (raw payload retained) | **missing** — parser output only | **IB slice (payload per batch)** |
| Evidence links (1 canonical ⇐ n sources) | approximated by deterministic ids (re-import dedupes) | **EV slice** |
| Account identity fingerprint (HMAC) | plain IBAN-derived uuidv5 (guessable-by-design) | **ID slice** |
| Roles on an external account | owner-only feeds (+ family co-consent for GC) | **RO slice** |
| Shared-space import pooling | 409 → personal-feed fallback → duplicate pools | **AT4/EV slice** |
| Import rollback | impossible (no batch concept) | **IB slice** |

## The slices

### IB — Import batches (the load-bearing new concept)

`ImportBatch { id, feedSpaceId, uploadedBy, format (camt053|ing-csv),
fileHash, statementFrom/To, importedAt }` server-side; each imported
op carries its `batchId`. The original parsed rows (not the whole
file) are retained per batch — enabling: uploader attribution in the
activity history, re-parse on parser upgrades, and **rollback**:
removing a batch removes only canonical rows whose ONLY evidence was
that batch (overlapping statements from someone else keep the shared
months alive — the Alice-Jan-Mar / Bob-Feb-Apr case). ING CSV joins
as a second format behind the same preview UI (old AT2).

### EV — Evidence-based dedupe + shared-space pooling (old AT4)

Canonical row identity keeps the deterministic-id fast path (bank
reference when present) and gains a fallback fingerprint (date +
amount + direction + counterparty + normalized description) for
reference-less CSVs. A `TransactionEvidence(canonicalId, batchId)`
table records which sources vouch for a row. Pooling rule (privacy
boundary, unchanged from AT4): a second importer of the same account
identity joins the existing feed **only when that feed is already
attached to a space they're a member of** — they can see the data
anyway, so co-contribution leaks nothing. No shared space → separate
personal feed, and munni never reveals that someone else has the same
account. When two such records later meet in one space, offer a
controlled merge. The import preview learns to say: "belongs to 'ASN
Family', already in Family — 186 known, 14 new, 2 possible
duplicates."

### ID — Account identity hardening

Replace guessable `uuidv5("feed:"+IBAN)` for NEW feeds with
`HMAC(serverSecret, normalizedIBAN)` as the identity fingerprint, and
encrypt the display IBAN at rest (ties into backend-security SEC4).
Existing feeds keep their ids (migration writes the fingerprint
alongside). This kills the crafted-file probe class for good.

### RO — Roles on external accounts

`AccountAccessGrant { feedSpaceId, userId, role }` with three roles,
defaulted so the UI barely changes:

- **Administrator** (first importer/connector): rename/archive,
  attach/detach, manage grants, roll back any batch, merge dupes.
- **Contributor** (space members the admin enables, or automatic via
  the pooling rule): upload statements, own provider connections,
  roll back their own batches.
- **Viewer** (everyone else in an attached space): sees transactions,
  edits per-space overlays per their space role.

Provider connections stay personal (a contributor's GoCardless
consent is theirs; revoking it stops sync but deletes nothing — the
existing family-account behavior, generalized). Leaving a space keeps
today's explicit choice (remove vs keep-shared with a hand-over),
now expressed as a grant transfer.

### LC — Lifecycle (mostly current behavior, stated as law)

- Manual: space deleted → account + rows deleted (danger sheet
  already warns).
- External: space deleted/detached → link + that space's overlays go
  (shipped warning); account + raw data live while ANY grant or
  attachment remains; none left → archive, then scheduled erasure
  (today's delete-account cascade becomes the terminal step).

## Order & effort

1. **IB** (server model + uploader attribution + rollback; ING CSV) —
   the enabler, medium.
2. **EV** (fingerprint dedupe + evidence + pooling + merge offer) —
   the user-visible payoff, large.
3. **RO** (grants; UI: a "who can contribute" row on the account
   sheet) — medium.
4. **ID** (HMAC identities + IBAN encryption, with SEC4) — small,
   server-heavy.
5. **LC** — mostly documentation + one archival job, small.

Migration-compat check (standing rule): offline profiles have no
external accounts (imports there stay local feeds, unchanged);
online→offline flips external accounts to manual-continuation per
docs/online-to-offline-plan.md; offline→online uploads local feeds as
fresh external accounts with the migrating user as administrator.

## Answers (user, 2026-07-24)

1. Auto-grant Contributor — "decide based on what you think is
   actually good, UX and security wise".
2. Rollback in the **member app's account sheet from day 1**.
3. Merge: **worth building in v1**. Plus requirement x: linked is the
   truth; mismatches judged on in-between dates (never the edges);
   the user sees EVERY mismatched transaction before deletion; edit
   migration is offered per match and can be ignored; munni
   auto-suggests when IBANs match.

## Slice ledger (v1, shipped 2026-07-25)

- **EV / requirement x — SHIPPED**: `domain/reconcile.ts` +
  `application/reconcile.ts` + ReconcileSheet. Provenance by reference
  shape (synthetic `ing:`/`paypal:` vs bank references; CAMT real refs
  dedupe against providers by id already). Linked coverage judged with
  exclusive edges; matches migrate edits across all space overlays
  (per-match opt-out), receipts follow, reimbursement links re-point,
  mismatches listed in full before deletion, pre-coverage history
  survives. Auto-suggest on the accounts screen for mixed-source
  accounts AND same-IBAN linked+imported pairs.
  *Deferred within EV*: a physical `TransactionEvidence` table and
  moving pre-coverage rows INTO the linked feed (the old imported
  account remains as the history holder after a pair reconcile) — do
  this when someone actually needs the old account gone.
- **IB — SHIPPED (derived form)**: every imported row is stamped
  `importBatchId` + `importedBy` (one batch per statement per run);
  the account sheet lists uploads (count, date range, uploader) with
  per-batch rollback — a batch removes only rows it created, deduped
  rows keep their first batch. A separate server-side ImportBatch
  table (raw payload retention, re-parse) is deferred: the derived
  form already gives attribution + rollback with zero new sync
  surface.
- **RO — DEFERRED**: today's de-facto roles (feed owner = admin;
  pooling rule for co-contribution) match the plan's defaults; the
  explicit grant table waits until a real second-contributor case
  appears.
- **ID — DEFERRED to SEC4**: HMAC identities + IBAN encryption belong
  in the backend-security arc; the orphaned-feed reclaim (2026-07-25)
  removed the sharpest edge of the guessable-id class meanwhile.
- **LC — DOCUMENTED**: lifecycle is current behavior as stated above;
  the account-deletion cascade is the terminal step.
