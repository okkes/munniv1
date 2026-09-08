# Reimbursement redesign — spec (user 2026-07-24, answers received)

Status: APPROVED, implementation in progress. This doc restates the
user's spec + their answers verbatim-in-substance so the arc is
self-contained.

## The category tree (locked, system-owned)

A separate MAIN category `reimbursement` with exactly three subs; the
user cannot add subs under it or edit/delete any of them:

- **reimbursed** — applicable to BOTH positive and negative amounts.
  Replaces today's "category X with €0 left" outcome: the deducted
  value moves into a visible `reimbursed` slice instead of leaving a
  zeroed slice behind.
- **expected reimbursement** — negative amounts only (the part of an
  expense you expect back, BEFORE a credit is linked).
- **received reimbursement** — positive amounts only (money that
  arrived to settle something, BEFORE it is linked).

This replaces the old reimbursement categories (the income-side
`reimburse` sub). Old rows auto-migrate (answer d).

## Unsettled quick filter

Transactions tab gets a quick filter "unsettled reimbursements":
transactions whose `expected reimbursement` or `received
reimbursement` slice ≠ 0 — those still need settling. Settled rows
(slices consumed into `reimbursed`) drop out of the filter.

## Settlement semantics — the four use cases (x = expense, y = credit)

1. x −100 [food 100], y +50 [uncat 50] → full link:
   x −50 [food 50, reimbursed 50], y 0 [reimbursed 50]
2. x −100 [food 50, expected 50], y +60 [received 60] → full link:
   x −40 [food 40, reimbursed 60], y 0 [reimbursed 60]
3. x −100 [expected 100], y +80 [income/other 80] → partial link 50:
   x −50 [expected 50, reimbursed 50], y +30 [other 30, reimbursed 50]
4. x −100 [coffee 30, sweets 15, uncat 5, expected 50], y +51
   [other 51] → full link: x −49 [reimbursed 51, coffee 29, sweets 15,
   uncat 5→consumed second], y 0 [reimbursed 51]
   (the user's stated numbers for UC4 don't sum exactly; the RULE wins:
   deduction order expected/received → uncategorized → largest
   category, alphabetical name tie-break — answer b)

Key change vs today: the deducted value lands in a `reimbursed` slice
on BOTH sides (same amount both sides), not just shrunk away. The
expense keeps its reduced real slices; the credit's own slices shrink
the same way (its `received`/uncat/largest first).

## Answers already given

- (a) un-reimburse: freed value goes to **uncategorized**, no memory
  of the pre-link category.
- (b) tie-break alphabetical — already implemented in deduction order.
- (c) the whole `reimbursement` main is **excluded** from budgets,
  overview and insights math (like transfers).
- (d) old categories auto-migrate.

## Already shipped in earlier arcs (do not redo)

Deduction order expected/received > uncategorized > largest with
alphabetical ties; unlink → uncategorized; credit self-files as the
old `reimburse` category + leaves review; fully-reimbursed keeps one
slice so readers never fall back to catId×gross; both sides patched at
all four link/unlink paths in ReimburseSection.

## Remaining work (this arc)

1. Catalog: add locked main `reimbursement` + 3 subs; retire the old
   `reimburse` sub; guard rails in ManageCategories + pickers (no new
   subs under it, no edit/delete, but pickable where amounts fit its
   direction rules).
2. Settlement math: write `reimbursed` slices on both sides per the
   use cases (today the value just shrinks away / zero-slice).
3. Auto-migration: existing txs categorized `reimburse` → `reimbursed`
   (runs once per space, synced writes, offline↔online safe).
4. Unsettled quick filter chip on the transactions tab.
5. Exclude the `reimbursement` main from budgets/overview/insights.
6. Tests per use case; EN/NL/TR; activity logging already covers
   transforms.
