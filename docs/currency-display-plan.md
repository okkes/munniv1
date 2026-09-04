# Multi-currency & display conversion — plan v2

Status: **CD1–CD3 + CD5 SHIPPED** (2026-07-23): server `/rates` (ECB
daily + 90d + full history, cached), client rate cache in meta +
`fmtDisplay`/`sumCents` with the ≈ marker, user-level display currency
(profile + `/me.displayCurrency`, offline manual pairs), adopted on the
balance band (convert-then-sum), every TxRow list (per-day rates), and
the tx detail headline; space currency renamed to "Ledger currency"
with the explainer. **CD4 SHIPPED (2026-07-24)**: the lens now covers
Home blocks, Overview + drill, Trends, Budgets, Goals, Debts, Events,
Allocation, Recurring and Insights (all via useDisplayMoney's fmt, at
the latest fixing; budget/goal progress stays computed in ledger
terms), plus a quick display-currency picker in the balance-band
fold-out and guide/tour touch-ups. Deliberately NOT lensed: portfolio
(its own quote-based conversion), splits (multi-party amounts stay in
their own currency), receipts (store-item data), and the tx/account
FORM inputs (editing happens in the recorded currency). The plan is
complete.

## What the field studies say

- **YNAB**: one budget = ONE currency, hard. No conversion at all;
  multi-currency users are told to run separate budgets. Praised for
  predictability, cursed by every expat forum thread.
- **Revolut / Wise**: accounts (pockets) each have a real currency; a
  single user-level **home currency** renders totals, marked as
  approximate. The canonical modern model.
- **Spendee / Wallet by BudgetBakers**: per-wallet currency + one
  user "main currency" for dashboards; conversions marked, rates
  daily.
- **Copilot / Monarch (US)**: effectively single-currency; where they
  convert, it's at display level with a per-user setting.
- **Actual Budget** (closest architectural cousin, local-first):
  deliberately single-currency per budget file — they punted, and
  it's their most-requested feature.

Pattern: **facts carry their own currency; ONE preference, owned by
the PERSON (not the group), converts rendering; budgets/limits live
in a stable ledger currency.**

## Verdict on our model

Space currency was half right. Split its two jobs:

1. **Ledger currency (space-level, KEEP).** Budgets, goals, period
   totals and allocation envelopes need a stable unit shared by every
   member — that is genuinely a property of the shared bookkeeping,
   exactly like YNAB's budget currency. It stays `space.currency`,
   renamed in the UI to "Ledger currency" with a line explaining what
   it anchors.
2. **Display currency (USER-level, NEW — this replaces v1's
   space-level idea).** How amounts RENDER is a personal preference:
   a Turkish family member viewing the shared NL space should see ₺
   without changing anything for anyone else. It lives on the profile
   (meta + `/me`, next to country), applies across all spaces and
   surfaces, defaults to "as recorded" (no conversion).

Why user-level beats space-level for display: conversion is a reading
aid, not bookkeeping; space-level would force one member's preference
on everyone and create edit wars; and every reference app (Revolut,
Wise, Spendee) landed on person-level for exactly this reason.

## Mechanics (unchanged from v1 where it was already right)

- Raw amounts are NEVER converted in storage — display-layer only,
  every converted value marked `≈` (user-approved; no extra banner).
- **Rates**: `GET /rates?date=` on our API — server fetches/caches the
  ECB daily reference XML (~30 currencies, no key). Client caches
  every seen day (device table) → offline renders the last known rate;
  offline profiles can pin a manual rate per pair.
- **Which day's rate**: transaction rows convert at their transaction
  date's rate (historically honest lists); balances, totals and
  forecasts use the latest rate. Detail lines name rate + date.
- **Cross-currency totals**: the balance band / overview convert-then-
  sum into the display currency (or the ledger currency when display
  is "as recorded") — fixing today's silent numeric mixing of
  differing account currencies.
- **Budgets/goals**: limits stay in the ledger currency; when a
  display currency is active their AMOUNTS render converted (`≈`) but
  progress percentages are computed in ledger terms, so a bar never
  moves because the dollar moved (answers v1's open question — my
  recommendation stands, awaiting your verdict).

## Slices

- CD1 server /rates (ECB fetch + day cache + history) + tests
- CD2 client rate cache + `fmtDisplay` + manual-rate fallback
  (offline) + the ≈ marker
- CD3 profile-level display-currency setting (onboarding untouched;
  Profile + quick toggle in the balance band overflow) + adoption on
  lists/band/overview + EN/NL/TR
- CD4 budgets/goals/charts adoption + guide/tour touch-ups
- CD5 space settings rename to "Ledger currency" + explainer line

Open question (the one from v1, restated): agree that budget LIMITS
stay ledger-anchored with converted display only?
