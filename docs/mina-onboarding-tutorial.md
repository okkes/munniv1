# Mina onboarding tutorial — forced-navigation first-run walkthrough

Status: **DESIGN v2 — awaiting approval** (2026-07-26; v1 questions
answered: replayable WITH a revert ledger, offline profiles included,
EN scenario art for all languages, guided delete stays)

Supersedes the shipped `welcome` walkthrough (docs/space-onboarding-walkthrough.md,
2026-07-25): that one was opt-in via a Home card and teleported between
screens. This one auto-starts right after onboarding, is fronted by the
Mina persona, and never teleports — the user is made to CLICK the real
navigation so the paths stick.

## Core decisions

1. **Auto-start.** After the onboarding info form (avatar/name/lock),
   the app routes straight into the tutorial — no opt-in card, no Home
   in between. One-time: `minaTutorialDone` meta marker. Existing users
   (any space already present) never see it.
2. **No space exists yet.** Bootstrap for brand-new users stops creating
   the personal space; the ≥1-space rule is suspended *only while the
   tutorial is pending*. The user creates their first space inside the
   tutorial. Skip (at any point) creates the default space "Private"
   (Privé / Özel) if none exists — the app never exits the tutorial
   space-less. Killing the app mid-tutorial resumes it at the first
   unmet step on next launch (data-driven, like welcomeStartStep).
3. **Forced navigation.** Guided steps use a *gated spotlight*: the
   overlay blocks every tap except the highlighted element. The user
   physically walks the real path (tab bar → screen → button). Info-only
   highlights (e.g. the settings icon) stay non-tappable with only a
   Next button. "Skip tutorial" stays reachable in a corner at every step.
4. **The tutorial writes nothing.** Every space/account/transaction is
   created by the user through the real forms (act-step detection by
   testid appearance, engine reused from the welcome walkthrough).
   Exception: the skip-path default space, and step prefills (form
   fields pre-filled with suggested values, user still presses save).
5. **Mina.** Three presentation forms:
   - **Fullscreen pages**: full-body/scenario art + a short paragraph +
     Continue (and Skip).
   - **Bubble**: the existing small popup card anchored bottom, with a
     round Mina expression avatar on the LEFT, as if she's talking.
   - **Skip confirm sheet**: mina-expression-surprised, "Are you sure?"
     with confirm labeled "Yes, I'm already familiar with munni".
6. **Revert ledger (user ruling).** Everything the user creates during
   a tutorial run is tracked, and both the wrap screen and the skip
   sheet ask: "Undo everything you made during the tour?" — accepting
   deletes those spaces/accounts/transactions. Mechanics:
   - At tutorial start AND at each create-act-step start, snapshot the
     live ids of the step's entity type; on completion, the diff (new
     ids) is appended to a `minaTutorialLedger` meta entry.
   - Safety rails: rows with `importRef`/`feedSpaceId` (bank data) are
     NEVER ledgered — a sync landing mid-replay can't get swept into a
     revert. Deleting a ledgered space uses the real space-deletion
     cascade. Rows the user already deleted in-run (Family) just fall
     out of the ledger.
   - After a revert the ≥1-space rule is re-asserted: if nothing live
     remains, the default localized "Private" space is created empty.
   - Declining the revert (or finishing without it) clears the ledger —
     the data is theirs now. Replays start a fresh ledger.
7. **Assets.** `mina/` (30 MB PNGs) is optimized into
   `apps/web/src/assets/mina/*.webp` (expressions downscaled to bubble
   size ~96 px, fullscreen art ≤ ~150 KB), precached for offline. The
   scenario images carry baked-in English labels — v1 ships them for all
   three languages; localized variants can drop in later using the same
   filenames.

## Step script (exact wording mine, message per user spec)

Legend: [F] fullscreen page · [B] bubble · [G] gated click (forced) ·
[A] act-step (completes when the user's own write appears).

| # | Step | Asset | Form |
|---|------|-------|------|
| S1 | **Welcome.** "Hi! I'm Mina, your munni financial assistant." One-time tutorial, highly recommended for first-time users, ±5 minutes, teaches spaces + bank accounts. Start / Skip. | mina-greeting-hd | F |
| S⨯ | **Skip confirm** (reachable from every step): "Skip the tutorial?" → "Yes, I'm already familiar with munni" / "Keep going". When the run's ledger is non-empty, a second question follows: "Undo everything you made during the tour?" (keep / undo). Confirm ⇒ optional revert, then default space if none live, → Home. | mina-expression-surprised | sheet |
| S2 | **Home intro.** Land on the (empty) Home: "This is Home — everything comes together here: overview, goals, budgets, investments." Continue. | mina-smile-expression | B |
| S3 | **Spaces concept.** "Almost everything you manage lives in a space — private, family, business…" | mina-spaces-pointing | F |
| S4 | **Sharing.** "With a munni account you can invite others into a space and manage it together." (offline profiles: same page + one line that sharing needs a synced account) | family-spaces | F |
| S5 | **First space — the walk.** Back on Home, the space icon (question-mark since no space exists) is spotlighted: "Let's create your first space." Gated clicks: space icon → Manage spaces → the + button. | mina-arm-crossed-expression | B+G |
| S6 | **First space — the form.** Space form opens with the name pre-filled "Private" (Privé/Özel): "This one is for your own money." User presses Create. | mina-thinking-expression | B+A |
| S7 | **Space design (info only).** Settings icon of the fresh space highlighted, NOT tappable: "You can restyle it later — name, picture, color." Next only. | mina-expression-laugh-smile | B |
| S8a-c | **Account kinds.** Three fullscreen pages: Manual (you keep it by hand, lives in this space), Import (statement exports feed it), Linked (open banking keeps it fresh automatically). | manual-import-linked-finacc-01/02/03 + mina-thinking | F×3 |
| S9 | **Create a manual account.** "In real life, linked or imported is the better choice — but for the demo we'll make a manual one." Gated walk to the space's Financial accounts → Add account → Add manually → pick Checking → name pre-filled "Wallet", balance €100 → Create. | mina-expression-sad | B+G+A |
| S10 | **Transactions concept.** "Every transaction belongs to exactly ONE account — the account's balance is simply everything that happened on it." | mina-transaction-account-relationship | F |
| S11 | **Create a transaction.** Gated walk: Transactions tab → + → form pre-filled (Groceries, −€12.34, today, the Wallet account) → Add. | mina-smile-expression | B+G+A |
| S12 | **See the impact.** Gated click Home tab; the overview block spotlighted: "There it is — your spending shows up here the moment it lands." | mina-smile-expression | B+G |
| S13 | **Second space.** Same walk as S5/S6, name pre-filled "Family": create it and switch into it. | mina-arm-crossed-expression | B+G+A |
| S14 | **Isolation, part 1.** In Family: Transactions tab → + → the form shows its real "no account yet" empty state: "See? A new space starts empty — accounts belong to the space that made them." | mina-thinking-expression | B+G |
| S15 | **Isolation, part 2.** Point at the empty transaction list: "And your groceries transaction? Not here — it lives in Private. Spaces keep their books separate." | mina-thinking-expression | B |
| S16 | **Clean up.** Gated walk: Settings → Family's space settings → danger zone → Delete space (real confirm sheet). Auto-switch back to Private. | mina-arm-crossed-expression | B+G+A |
| S17 | **Wrap.** "That's the tour! You have a space, an account and a first transaction. I'm around — the ? button explains every screen." Choice: "Keep what I made" / "Undo the tour's changes" (revert ledger; a fresh empty Private space is created if the revert leaves nothing). Done → Home, `minaTutorialDone`, ledger cleared. | mina-full-hand-open | F |

## Approval remarks (2026-07-26, folded into M1)

1. **The bubble must never cover the target.** The old walkthrough's
   card sat on top of the very button it asked the user to press. The
   Mina bubble measures the highlighted element and anchors to the
   OPPOSITE half of the screen (target in the lower half → bubble on
   top, and vice versa), re-measuring on resize/scroll.
2. **Act detection: instant and value-flexible.** DOM-polling missed
   creations until an app restart. Act-steps now subscribe to the STORE
   (useQuery live emissions — the same channel every screen renders
   from): "an account row exists that didn't at step start". Detection
   is by row EXISTENCE diff, never by the suggested values — a €12
   transaction satisfies the €13-prefilled step, any name works.
3. **Desktop-quality.** The HD art is used at full quality on lg:
   fullscreen pages become a two-column layout (art left, copy right,
   capped ~1080px); bubbles anchor to the highlighted element instead
   of the screen edge; the gated spotlight dims the WHOLE viewport
   including the left navigation (portaled to body, same fix as the
   desktop dialogs).

## Engineering slices

- **M1 — engine v2**: gated spotlight (overlay blocks all but the
  anchor), Mina bubble component (avatar left + text + Continue/Skip),
  fullscreen Mina page component, tutorial step machine + resume;
  retire WelcomeTourCard + the `welcome` tour (help-index re-entry
  becomes "Replay the Mina tutorial", act-steps fast-forward past
  outcomes that already exist).
- **M2 — no-space mode**: bootstrap stops auto-creating the personal
  space for new users (online AND offline identities); DataProvider /
  Home / space switcher survive zero spaces; skip & abandonment
  guarantees; migration-compat check both directions (an account
  created mid-tutorial then taken offline, and vice versa).
- **M3 — assets**: optimize mina/ → webp bundle, precache, EN-labeled
  scenario art for all languages (swap-in point for localized files).
- **M4 — steps S1–S17** with EN/NL/TR copy.
- **M4b — revert ledger**: snapshot/diff tracking around create
  act-steps, the revert executor (space cascade, account, transaction
  deletes through the normal repo paths — synced identities revert on
  every device), wrap + skip integration, ≥1-space re-assertion.
- **M5 — upkeep**: guide + What's New + help index + activity log
  review; delete obsolete welcome-tour tests.
- **M6 — tests**: step machine units, no-space bootstrap, skip paths
  (fresh + mid-tutorial), full happy-path run, resume-after-kill;
  e2e single core-flow spec + gallery shots.

## Resolved questions (2026-07-26)

1. Replay from Help: **replayable**, with the revert ledger above so a
   run's creations can be undone at the wrap or on skip.
2. Offline profiles: **included** — S4 gains one line that inviting
   others needs a synced munni account.
3. Scenario images: **EN-labeled art for all languages in v1**;
   localized files can swap in later by filename.
4. S16 guided Family-space delete: **stays** — the real double-confirm
   flow on a safe, tutorial-created target.
