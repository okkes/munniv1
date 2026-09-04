# Settle-up for shared spaces — design (PLAN, awaiting approval)

Status: proposal 2026-07-15 (shortlist #5, the largest). Splitwise's
core loop inside shared spaces: *who paid what, who owes whom, one tap
to record the settlement.* Reimbursements built the plumbing; this
adds the ledger on top.

## Model

**Who paid** is already known: every transaction belongs to an
account, every attached account has an owner (`attachedBy` on the
account link). **Who benefited** is new — a per-transaction overlay
field on txMeta:

```
shares?: { userId: string; cents: number }[]   // omitted = split equally
```

- Default: every expense in a shared space is split **equally among
  current members** at read time (nothing stored — joins stay cheap
  and late joiners don't rewrite history: equal split uses the members
  at computation time; if that's too loose, we store the member set on
  first computation — decision point ①).
- Editing: the tx detail (shared spaces only) gets a "Shared between"
  row → sheet with member checkboxes + optional custom amounts (same
  editor pattern as splits). "Just mine" removes it from the ledger.
- Excluded automatically: transfers, savings, investments, and
  transactions marked "just mine".

## The ledger

`domain/settleUp.ts`: for each member,
`paid − fairShare = net position`; pairwise debts minimized to the
fewest transfers (standard greedy netting). Pure + heavily unit-tested.

**Settle-up screen** (space settings → "Settle up", plus a Home block
for shared spaces): per-member net positions, then "A owes B €123.45"
lines with a **Settle** button.

## Settling

Tapping Settle records a settlement marker (overlay row
`settlement: {from, to, cents, date}` — synced, so every member sees
it) and the ledger nets it in. When the actual bank transfer later
arrives in the feed, the review flow suggests linking it to the open
settlement (same candidate mechanics as reimbursements) — linking
confirms it; unlinked settlements stay visible as "recorded by hand".

Reimbursement links keep working unchanged and REDUCE the payer's paid
total (a reimbursed expense isn't something the group owes you for —
consistent with the same-space reimbursement ruling).

## Decision points

1. Equal split: live member set (simple, drifts on join/leave) or
   frozen member set per tx (stored, stable)? Proposal: **frozen on
   first ledger computation** for txs older than the join.
2. Should readers see the ledger? Proposal: yes (read-only, no Settle
   button).
3. Home block default: on for shared spaces?

## Impacted screens (cascade rule — pick what's in)

1. Tx detail (shared spaces): "Shared between" row + editor sheet
2. New settle-up screen (space settings door)
3. Home block (shared spaces): "you owe / you're owed" one-liner
4. Review: suggest linking incoming transfers to open settlements
5. Space members screen: leaving with an open balance → warning line
6. i18n EN/NL/TR, tour, guide, what's-new

## Slices

- **SU1**: shares model + ledger domain + settle-up screen (equal
  splits only)
- **SU2**: per-tx share editor + "just mine"
- **SU3**: settle action + transfer linking in review
- **SU4**: Home block + leave-space warning

Effort: SU1 ≈ one arc; SU2–SU4 each ~half.
