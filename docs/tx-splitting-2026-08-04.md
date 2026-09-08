# Transaction types & splitting v2 — accounts tell the story (design plan)

Status: **SHIPPED 2026-08-06** (approved 2026-08-05: "the table looks
good. everything else too"). Landed on dev across arcs A–E2: catalog +
markers (e7a16165), the type core — stamps, transfer inversion, mint
engine, funding retirement, category-driven buckets, migrations
(bf880068), typed parts + part cards + per-part mint (6a0271b8), the
connected-parts visuals (90a7d6f4), slice-aware filters/search
(fdb27f34), and the flat-loan question (E2). Deferred to a follow-up:
the pick-existing-row door (Q2's second half — create-new IS the
default and works), the per-part event chip in the editor (per-part
eventId is stored and counted; the UI chip is pending), and the
set-aside twin nudge. Companion visual: the published design artifact.

## The four rules (user model, locked)

- **R1 — the account stamps its rows.** Every transaction on a saving
  account is type *saving*; on a debt account *debt*; on an investment
  account *investment* (Q5: yes). The sign reads the direction: + on
  saving = set aside, + on debt = repaid. Special-account rows only
  offer their own category family (Q1), and rows not caused by a
  transfer — interest, fees, dividends — get their own subs (table
  below, Q4).
- **R2 — transfer is strictly between two tracked accounts.**
  Counterparty mandatory, category locked to Transfer out/in. The
  special-account leg wears its stamp instead (scenario 2: x-leg =
  transfer, y-leg = saving/set aside). With a counterparty set on a
  special-account row, the category is FORCED to the movement pair
  (set aside/withdrawn, repaid/borrowed — Q8: yes).
- **R3 — on regular accounts, special categories carry the meaning.**
  "Set aside" without a tracked savings account, "Loan payment" in the
  flat structure, funding — all are categories on a regular-typed row,
  never transfers. Special categories get a visible marker so they
  never read as 'random' categories (user remark, Q3).
- **R4 — a split parent is a pure container.** No type, category or
  counterparty of its own; the parts carry everything (source account
  derived, immutable). Linking pairs the PART, never the parent. No
  row-pairing inside review.

## Decisions locked by the answers

1. **Funding stops being a type** (Q3). The 2026-08-01 funding TxType
   retires; funding becomes a marked special category on regular rows
   (locked subs fundingOut/In already exist). Migration: funding-typed
   rows → sign-resolved income/expense keeping their funding category
   (marker `txFundingCat_v1`).
2. **Mint-on-link** (Q1): picking a MANUAL special account as transfer
   counterparty auto-creates the mirror row on that account (typed by
   its stamp, movement category by sign) and pairs the two. For
   bank-fed special accounts nothing is minted — the real row arrives
   and pairing links it. On link the user chooses **create new** or
   **pick an existing row** (Q2) — the pick list scored like
   reimbursement suggestions; conflict rule: refuse when either side
   names a different counterparty; auto-fill a null counterparty.
3. **The balance delta relocates to the mirror row's lifecycle.**
   Loans v2's applyLoanLinkDelta fired on the SOURCE row's link; in v2
   the minted mirror row is the visible record, and its create/delete
   carries the manual-balance delta (manual balances stay
   balanceCents-driven — rows never sum into balances, so minting is
   otherwise balance-neutral). Unlink deletes the minted mirror and
   refunds. countsTowardLoan/pre-anchor rules keep gating deltas.
4. **Flat loans structure** (Q1): a "Loan payment"/"Borrowed" special
   category on a regular row asks — optionally — WHICH loan; declining
   files it under the **default loan** (today's Unassigned-payments
   bucket, promoted to that name). Picking a manual loan behaves like
   mint-on-link.
5. **History migration** (my call, flagged): existing
   saving/debtPayment/investment rows that carry a linkedAccountId to
   a tracked special account re-type to transfer + locked category,
   and the special-account mirror is MINTED with a deterministic id
   (`uuidv5('mirror:' + rowId)`) — idempotent, sync-safe, and
   balance-neutral because the old delta already moved the balance at
   link time. Counterparty-less family rows stay as R3 category rows
   untouched.
6. **Buckets read the special categories, wherever they live** (Q6):
   "Saved" = saving-family categories on any account (R1 rows on the
   saving account + R3 bare rows on regular accounts). Done right, the
   regular-account leg of a tracked pair is transfer-categorized and
   never double-counts. The done-wrong edge (bare set-aside on
   checking while the tracked savings twin also lands) gets a
   **nudge**: when a likely twin exists, munni suggests the transfer;
   it never force-blocks.
7. **Review stages fields, never pairs rows** (Q7 clarified): the card
   may set kind = Transfer and pick the counterparty ACCOUNT (plain
   bulk-safe fields — today's own-transfer chip survives as exactly
   this); choosing or creating the specific counter TRANSACTION (and
   any minting) happens after confirm — by the background matcher or
   from the detail screen. Bulk therefore never replays row-pairing.
8. **Splitting details from v1 stand**: labels "split 1/2/…" (A),
   ONE list row with the segment underline + parts unfolding in detail
   (E), and **per-part events ship in this arc** (D): `eventId` joins
   the part fields.

## The category table (Q4 — for approval)

Special categories are LOCKED subs under family mains, marked in every
picker and chip with the family glyph + tint (the "not a random
category" marker). Movement subs are forced when a counterparty is set
(Q8); the others exist for rows no transfer caused.

**Saving account rows** (stamp: saving; regular rows via R3 use the
same family):
| sign | sub | notes |
|---|---|---|
| + | Set aside | movement (forced w/ counterparty) |
| − | Withdrawn | movement (forced w/ counterparty) |
| + | Interest | bank-paid growth; counts in the Saved bucket |
| − | Fees | account costs; subtracts from the Saved bucket |

**Debt account rows** (stamp: debt; flat-structure R3 rows use the
same family; loans v2 already ships Repaid/Borrowed/Interest):
| sign | sub | notes |
|---|---|---|
| + | Repaid | movement (forced w/ counterparty) |
| − | Borrowed | movement (forced w/ counterparty) |
| − | Interest | debt growth charged by the lender |
| − | Fees | account costs |

**Investment account rows** (stamp: investment):
| sign | sub | notes |
|---|---|---|
| + | Contributed | movement (forced w/ counterparty) |
| − | Withdrawn | movement (forced w/ counterparty) |
| − | Buy | cash → position (existing investBuy) |
| + | Sell | position → cash (existing investSell) |
| + | Dividends | payouts landing as cash |
| − | Fees | broker costs |

**Regular account rows**: the full normal catalog, plus — marked — the
special families above (R3), plus Funding (To/From the shared pot,
regular-only by definition), plus locked Transfer out/in (never
pickable by hand; set by R2).

Stored type vocabulary after v2: income, expense, saving, transfer,
debtPayment, investment, adjustment — funding retired. UI kinds stay
Regular / Transfer / Adjustment; stamped rows show their stamp and
lock the kind row.

## What this means per surface (revised pick list)

1. **Catalog & markers** — the family subs above (new: saving
   Interest/Fees, debt Fees, investment Contributed/Withdrawn/
   Dividends/Fees), the special-category marker in CategoryPicker,
   chips and slices, funding→category migration.
2. **Account stamps (R1)** — joined defaults + kind-row lock on
   special accounts, forced movement categories with counterparty
   (Q8), review/detail coherence.
3. **Transfer v2 (R2)** — mandatory tracked counterparty; locked cats;
   mint-on-link with create-new / pick-existing (Q2) and suggestion
   scoring; conflict + auto-fill rules; background matcher unchanged;
   review = fields only (Q7).
4. **Loans handoff** — flat-structure loan pick + default loan bucket;
   linked-history migration minting mirrors (decision 5); delta
   relocation to mirror lifecycle (decision 3); DebtDetail payments
   read the debt account's own ledger.
5. **Splitting** — container parent (R4), typed parts, the part-card
   sheet from v1 (labels, arithmetic amounts, per-part kind +
   counterparty + category, remainder seeding, dirty guard), part
   fields: id, label, txType, linkedAccountId, eventId,
   transferPeerId (+ mirror rows carry transferPeerSplitId back).
6. **Per-part events (D)** — event screens fan per part.
7. **Aggregation** — buckets from special categories (decision 6) via
   the canonical slice-view helper; closes the pre-existing
   split-blind spots; CSV gains type + label columns; double-count
   nudge.
8. **Lists/detail/review visuals** — one row + segment underline (E),
   spine in detail, staged split summary in review, "Multiple" kind
   row.
9. **Filters & search** — slice- and special-category-aware filters,
   part labels searchable.
10. **Polish pack** — i18n EN/NL/TR, tours + guide, demo sample,
    What's New, DEV annotations, unit tests + core-flow e2e, Sonar.

Suggested build order: 1→2→3→4 (the type system lands coherent), then
5→6 (splitting on top), then 7→8→9→10. Each step ships green on its
own.

## Open items

- Approve (or edit) the category table above — the only blocking item.
- Decision 5 (mint historical mirrors) and decision 7 (fields-only
  review) are my calls consistent with the answers — veto if wrong.
