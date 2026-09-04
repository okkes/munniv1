# Guided onboarding — spaces, accounts, first transaction

Status: **IMPLEMENTED 2026-07-25** — the `welcome` tour: a Home card
(one-nudge skip), act-steps that watch the user's REAL form submissions
land (non-blocking card, appear-prefix detection), per-step screen
navigation, data-driven resume/fast-forward (`welcomeStartStep`), and
re-entry via the help index like every other tour. Demo identities are
excluded. Formerly: **DESIGN v3 — realigned** (2026-07-23) with the shipped
onboarding v2 (profile/lock only, bank step gone — THIS walkthrough
owns account setup now), the three account tiers (manual accounts are
SPACE-scoped, created on the space's own screen), and the approved
account-entry chooser (docs/account-entry-flow-plan.md).

Formerly: **DESIGN v2 — user-scaled scope** (2026-07-22). The original
idea (create/delete a space mid-tour) grew into a full guided
onboarding: the tutorial now IS how a fresh identity gets its first
space, first financial account and first transaction. This version
merges the user's flow with my recommendations.

## The flow (signed-in and offline identities alike)

Runs right after onboarding completes, driving the REAL screens with
real writes — no sandbox, nothing to throw away afterwards.

1. **Meet your space.** "Everything in munni lives in a space." The
   personal space already exists (onboarding v2 named it after you) —
   the walkthrough shows it and offers a rename in the real settings
   form. Teaches the concept without duplicating onboarding.
2. **Create a financial account.** On THIS space's Financial
   accounts screen, open the Add-account chooser and create a MANUAL
   account (cash/checking, starting balance + currency). Teaches the
   tier rule: manual accounts live inside a space; bank connections
   and imports are global. (Tier v2 changed this step: manual
   creation is space-scoped now, so no Global-settings detour.)
3. **See the global side.** Point (never force) at the chooser's
   Connect-a-bank and Import rows: "these live at your account level
   and get ATTACHED to spaces — the spaceAccounts tour picks this up
   any time via the ? button." Teaches attach vs create without
   requiring a bank.
4. **First transaction.** Add a groceries expense on that account
   (amount prefilled €12.34, editable). The review/home blocks light
   up with real data — the payoff moment.
5. **A second space.** Create "Family" together, switch to it via the
   Home avatar switcher, and see it EMPTY: the manual account belongs
   to the first space. The scoping lesson lands by observation. Note
   (tier rule): a MANUAL account cannot be attached elsewhere — the
   walkthrough says exactly that and points at where a linked/imported
   account WOULD be attached ("+ attach" on this screen).
6. **Wrap.** Point at (never press) the danger zone: "Spaces and
   accounts can be removed here — munni always asks twice." Card
   summarizes what now exists: 2 spaces, 1 account, 1 transaction.

## Skipping (encouraged to stay, free to go)

- Every step shows "Skip tour" (small, secondary). The FIRST skip tap
  gets one encouragement line ("2 minutes — it sets up your space and
  first account"); a second tap skips for real. Never nag twice.
- Skip before step 1 completes → the default "Personal" space already
  exists (onboarding v2 creates/renames it), so nothing is missing —
  the tour simply ends. Skip later → whatever real data exists stays; nothing
  is rolled back (it's THEIR data — created through real forms).
- Re-entry: Settings → Help → "Restart the welcome tour". Resume
  detection: completed steps (space exists, account exists, …) show
  as pre-ticked and the tour fast-forwards to the first unmet step.

## Offline / demo parity

Offline profiles run the identical flow (all steps are local-first
writes; the attach step uses the local link mirror — no server).
Demo identities skip it: demo data already demonstrates everything.

## Mechanics: the `acts` tour mode

Extends today's point-and-tell tours with state-driven steps:

- `TourStep.act: 'await-testid' | 'await-value'` — the step completes
  when the environment reaches the state (space row exists, account
  row exists, tx row exists), not when Next is pressed. Card shows a
  live checklist tick per condition.
- The walkthrough itself writes NOTHING — every change goes through
  the real forms the user submits (the default space predates it).
- Escape hatches: End tour keeps whatever exists; navigation away
  pauses the tour (resume card on Home); all copy EN/NL/TR.

## Slices

- SW1 tour engine `act` steps (await-state completion + checklist UI
  + resume/fast-forward detection)
- SW2 steps 1–4 (space, account, attach, transaction) + skip paths +
  silent default-space fallback
- SW3 steps 5–6 (second space, switcher, scoping offer, wrap) + Home
  resume card + once-per-identity persistence + EN/NL/TR
- SW4 offline parity + tests: full run, early skip (default space
  appears), mid skip (data kept), abandonment + resume, re-run
  idempotency.

Open items (small, my call unless you object): the encouragement copy
tone and the prefilled amounts/names. (The old "attach to Family too"
question is moot — manual accounts can't attach elsewhere by design.)
