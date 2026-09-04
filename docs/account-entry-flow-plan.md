# One way to add an account — entry-flow UX plan

Status: **COMPLETE** — AE1+AE3 shipped 2026-07-23 (shared
AddAccountChooser everywhere, tx empty state opens it in place);
AE2 shipped 2026-07-24 as an attach-offer card on the global accounts
screen (any of MY feed accounts visible in no space → one-tap "Attach
to {active space}" with the default history start, dismissible and
remembered; imports already attach to the importing space, so the
offer's real job is fresh/broken bank connects); AE4 shipped
2026-07-24 (tours + guide use the locked Connect/Import/Add/Attach
verbs and mention ING CSV alongside CAMT). Original diagnosis below.

User observation:
three places can add an account today (the Transactions empty-state
button, the space's Financial accounts screen, Global settings →
Financial Accounts) "and how they are connected does still not feel
right."

## Diagnosis

The three surfaces exist for three different JOBS, but they all say
"add an account", so the user can't predict where they'll land:

| Surface | Its real job | What "add" means there today |
|---|---|---|
| Global settings → Financial Accounts | Manage what YOU own (bank consents, imports) | Bank connect + import + manual create |
| Space → Financial accounts | Manage what THIS SPACE sees | Attach + space-scoped manual create |
| Transactions empty state | "I have no data, help" | Door to the global screen |

The mental model shipped with the tier redesign is sound: **global =
what you own, space = what the space sees, manual = space-scoped.**
The fix is not moving features again — it's making every entry point
route by INTENT and land with context.

## Design

1. **One shared "Add an account" chooser** (bottom sheet, used by all
   three surfaces) with three intent rows, each stating where the
   result lives:
   - 🔗 *Connect a bank* — "automatic transactions · available to all
     your spaces" → bank connect flow (global).
   - 📄 *Import a statement* — "CAMT/CSV upload · available to all
     your spaces" → import flow (global).
   - ✍️ *Add a manual account* — "typed by hand · lives only in
     {active space}" → the space-scoped manual form.
   The chooser replaces today's mixed type-grid entry on the global
   screen and the two separate buttons on the space screen; the same
   component everywhere kills the where-am-I problem.
2. **Auto-attach on creation from a space context.** A bank/import
   account created while the chooser was opened FROM a space (or from
   Transactions) offers "attach to {space} now?" pre-checked with the
   default history window — the user never has to find the attach
   button for the account they literally just created.
3. **Transactions empty state** keeps its button but opens the
   chooser in place instead of teleporting to Global settings; after
   the flow it returns to Transactions (which now has data).
4. **Vocabulary lock-in**: "Connect" (bank), "Import" (statement),
   "Add" (manual), "Attach"/"Detach" (space visibility). Buttons and
   the tutorial use exactly these verbs and never each other's.
5. The space screen's list stays the tier/provenance overview it
   became; the global screen stays the ownership overview (rename its
   title to "My accounts & connections" to sharpen the contrast).

## Slices

- AE1 shared AddAccountChooser sheet + vocabulary pass over buttons
- AE2 auto-attach offer after global creation from a space context
- AE3 Transactions empty state opens the chooser in place
- AE4 tutorial + guide updates to the locked vocabulary
