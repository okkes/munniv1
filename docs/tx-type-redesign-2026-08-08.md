# Categories carry everything — the transaction-type retirement (#133)

Status: **APPROVED** (C1–C3 yes, 2026-08-08) — step A landed; B–F follow, C/D after the
#126 arc settles. Supersedes the *user-facing* half of the kind model in
`docs/tx-splitting-2026-08-04.md` (R1/R2 storage + mint engine stay; their surfaces change).

## The rulings (user, 2026-08-07)

1. Default special accounts are **lazy**: minted automatically, **per space**, the first
   time the user accepts "default" as a counterparty. No pre-creation, no setup step.
2. Defaults are scoped **per space**.
3. Existing bare rows (set-aside without a pot, default-loan bucket, …) **migrate** onto
   the minted defaults — their balances then move by those amounts. Visible, accepted.
4. **Transfer is a special category** too: its question is "which of my accounts received
   this" (any money-holding account — bank, cash wallet). Transfer = zero net-worth
   impact, money moved within the space.
5. **Funding stays the one counterparty-less special category.**
6. **The kind concept dies at transaction level.** No type row, no tracked type decision.
   Categories carry the meaning; the **account type gates the category list** (a savings
   account's rows offer the saving family, a regular account's rows offer everything).
7. **Review is all about categories**: the user picks one or more categories, and each
   special pick asks its counterparty question inline. The split flow barely changes.
8. **Adjustment survives for manual rows only.**
9. Sequenced **after** the #126 split arc settles.

Plus the counterparty rule that shapes every flow:

- Counter = **default** → the row wears **the special category itself** (Set aside, Loan
  payment, …); the mirror leg is minted on the default account.
- Counter = **imported/linked (bank-fed) account** → the row is labeled **Transfer**
  (locked transfer subs) — the real arriving row on the other side pairs with it.
- Counter = **manual account** → the user chooses: **pick an existing "duplicate"**
  transaction already living on that account, or **quick-create** the mirror (today's
  mint-on-link becomes one of two explicit options).

## The model

**`txType` is REMOVED — in two phases** (user ruling 2026-08-08: "remove it"). The
CONCEPT dies now; the stored FIELD dies one release later, because ~52 files, every
historical row and every not-yet-updated device still speak it:

- **Phase 1 (this arc):** no UI asks for or shows a type, and no reader depends on it —
  readers go category/counterparty-driven (buckets already are, since arc B). The ONE
  write choke (`writeTxTransform`) still WRITES a derived value —
  `deriveTxType(adjustment > account stamp > split-container=sign > default-counter=its
  family > any-counter=transfer > ◆ category > sign)` — purely so old app versions
  syncing the same spaces keep rendering coherent rows. New code never reads it.
- **Phase 2 (a later release, once fleets update):** the choke stops writing it; the
  schema keeps ACCEPTING it from old rows/devices forever (read-tolerant, write-never).

**Splits answer the "multiple types" question:** a split already has no single type —
each PART derives its own meaning from its category + counterparty, and the container
is a sign-only vessel. The one stored `txType` per row was already a fiction for splits
(a "largest part" shadow); removal makes the model honest. Adjustment stops being a
type too: it becomes a manual-row marker (C3's toggle) in step D.

- `saving/debtPayment/investment`: category family or counterparty-derived, as today.
- `transfer`: the transfer category (locked subs) — now reachable as a ◆ pick.
- `income/expense`: sign, as today.
- `funding`: its category (unchanged, counterparty-less).
- `adjustment`: manual rows only, kept as a small "correction" entry in the manual form
  (not in bank-row pickers).

**Default accounts.** New `AccountRow.defaultFor?: 'saving' | 'debtPayment' | 'investment'`
(one per family per space; names localized "Default savings/loan/investments"). Minted at
`defaultacct_<family>_<spaceId>` (deterministic — two devices converge by LWW, the loans-v2
fold lesson). Manual, balance-tracked, excluded from "pick counterparty" lists as a
separate "Default" row pinned on top. Transfer has **no** default (a real account is the
point). Funding has none (ruling 5).

**Category list gating.** `CategoryPicker` today gates by direction + txType. It changes
to gate by **account type + sign**: regular accounts → full catalog incl. ◆ families +
funding + transfer; special accounts → their own family only (R1's list rule, kept —
the stamp becomes a *picker scope*, not a row type). The ◆ mark stays.

## The flows

**Review card**: the Kind row disappears. The category row (or the split parts' rows)
is the whole decision. Picking a ◆ category unfolds the counterparty question inline
(sheet): `[Default — no setup]` / attached accounts (bank-fed marked) / `[Create]`.
The pick applies the counterparty rule above — picking a bank-fed account relabels the
row Transfer on the spot (with the explainer line). Confirm writes category +
counterparty; type is derived silently. Own-transfer auto-detection and the settle chip
keep working (they now pre-answer the counterparty question instead of pre-picking a type).

**Split parts**: the deck card's Type row disappears; the part's category editor picks
drive the same counterparty question per part (ruling 7: "during split not much
changes"). `TxKindSheet` retires from the deck.

**Detail screen**: type row gone; the category block + the same inline counterparty
question. Manual rows keep Adjustment as a form option.

**Manual form (TxFormSheet)**: kind grid dies; category + (conditional) counterparty +
Adjustment toggle for corrections.

**Pick-existing "duplicate"** (manual counterparties): reuses the reimbursement-style
scorer from the mint engine plan (same-amount ±tolerance, date window, unlinked rows on
the counter account); "quick create" = today's mint. This closes the deferred Q2 door
from the splitting arc.

## Migration (one-time, per space, marker `txCategoryModel_v1`)

1. Rows with bare special categories and **no** linkedAccountId (set-aside without pot,
   default-loan bucket, funding excluded) → mint the space's default account for that
   family (if absent), link the row, mint its mirror **with balance delta** (ruling 3:
   balances move — the mirror lifecycle already does this; `countsTowardLoan`/pre-anchor
   gates still apply).
2. Default-loan-bucket payments (`linkedAccountId` absent, debt family) → same, onto the
   default loan account.
3. Nothing else re-types: existing typed/linked/stamped rows already satisfy the derived
   model. `txType` values on historical rows stay as-written.
4. Offline↔online: the migration is device-local and idempotent (deterministic ids);
   late-syncing old-device rows heal on next boot — both directions stay legal
   (migration-compat rule).

## Cascade — every touched surface (pick what's in scope)

1. **ReviewScreen** — kind row + TxKindSheet usage removed; category-driven counterparty
   question; own-transfer/settle chips re-wired.
2. **Part deck + part page (#126 surfaces)** — Type row removed; per-part counterparty
   question via the category editor.
3. **TxDetailScreen** — type row removed; counterparty question; Adjustment on manual.
4. **TxFormSheet** — kind grid removed; category-first; Adjustment toggle.
5. **CategoryPicker** — account-type + sign gating; "Default" pinned row in counterparty
   sheets.
6. **CounterpartySheet** — gains the Default entry, bank-fed marking, and the
   pick-existing/quick-create fork for manual counters.
7. **Migration + default-account mint engine** (application layer + boot chain).
8. **Filters/search** ("type" filter becomes a category-family filter), **CSV export**
   (type column stays, derived), **insights/buckets** (already category-driven — audit
   only), **recurring/reimburse flows** (no type reads left? audit), **tours + guide +
   demo data + WhatsNew** (at release), **e2e specs** (kind-row pins).
9. **Server/admin**: none — `txType` stays in the sync payload as-is.

## Build order (each lands green, after #126 settles)

A. Derivation + default-account engine + migration (no UI change; `deriveTxType` at the
   choke; buckets audit). B. Counterparty question component + CounterpartySheet rework
   (Default/bank-fed/manual fork + pick-existing). C. Review + split surfaces. D. Detail
   + manual form + Adjustment. E. Pickers/filters/search/CSV. F. Polish: i18n ×3, tours,
   guide, demo, e2e repins.

## Confirmations (all answered YES, 2026-08-08)

- C1. Minted default accounts appear in normal account lists/overview.
- C2. A bank-fed counterparty relabels the row Transfer, with the explainer at pick time.
- C3. The manual form keeps Adjustment as a small toggle under the category.
