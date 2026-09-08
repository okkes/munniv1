# Bottom-sheet gestures: investigation + plan (2026-07-24)

User report: dragging is flaky — "sometimes I feel like I should be able to
drag it, but nothing happens", "the dragging animation gets interrupted even
though I did not let go my finger". This doc is the root-cause investigation
(our wrapper vs the vaul 1.1.2 source) and the proposed fix plan.

## 1. What vaul already does (verified in `vaul/dist/index.mjs`)

The physics model the user described is ALREADY vaul's model — the release
behavior is not the problem:

- **Velocity gate**: release with downward velocity > **0.4 px/ms** closes,
  regardless of distance (`VELOCITY_THRESHOLD`, line 446). A small quick
  flick closes the sheet. A slow drag does NOT close below the threshold.
- **Distance gate**: otherwise it closes only past **25% of sheet height**
  (`CLOSE_THRESHOLD`) — else springs back. (User asked "70% hidden? less?" —
  industry: iOS ≈ 50% of *detent distance* w/ velocity projection; Material ≈
  50%; vaul's 25%-or-velocity is on the eager side but feels fine in practice.)
- **Upward wiggle**: dragging up is dampened (`dampenValue`) and release
  upward just resets. A sheet never closes while the finger is down.
- **Drag from anywhere**: `handleOnly=false` (default) — the whole drawer is
  draggable, including content, buttons, images. Interactivity is preserved
  because a drag only "becomes" a drag after movement.
- **Scroll/drag cooperation at gesture start**: `shouldDrag()` climbs the DOM;
  a scrollable ancestor NOT at `scrollTop 0` → the gesture is a scroll. At
  the top → dragging down moves the sheet, dragging up scrolls. This is the
  "list edge" behavior the user asked for — *across* gestures.
- **Pointer capture**: vaul calls `event.target.setPointerCapture()` on press
  (line 968). Our own capture added on the header (2026-07-24) is redundant.

## 2. Root causes of the flakiness (ranked)

**RC1 — text selection fights every drag.** `shouldDrag()` returns false when
`window.getSelection()` is non-empty, and long-press on selectable text
STARTS a selection. Our app never sets `user-select`; virtually all sheet
text is selectable. So: long-press-ish drag on text → selection starts →
drag refused → "nothing happens". Also: a selection left over from earlier
blocks ALL sheet drags until it's dismissed. vaul only disables selection on
desktop (`@media (hover:hover)` sets `user-select:none`) — on touch it's our
job. **This is almost certainly the #1 "nothing happens".**

**RC2 — the 500ms open blackout.** `shouldDrag()` refuses everything within
500ms of open ("allow scrolling when animating"). Grab a sheet immediately
after it opens → nothing happens, and because `isAllowedToDrag` stays false
the whole gesture stays dead even after 500ms. Feels random because it
depends on reaction time.

**RC3 — pointercancel kills mid-air drags.** The content area is a native
scroll container (`overflow-y-auto`). When the browser decides the touch is
a scroll (drag starting on a mid-scrolled list, or starting vertical-ish on
scrollable content), it fires `pointercancel` — vaul's move stream dies and
the sheet freezes wherever it was: "interrupted even though I did not let
go". Our `touch-action: none` fix only covered the header; content is where
people actually drag.

**RC4 — scrollLockTimeout after flicks.** For 100ms after any scroll (and
refreshed while momentum keeps scrolling), drags are refused. Flick the list,
then immediately try to drag the sheet → dead gesture.

**RC5 — stuck sheet on bad release.** `onRelease` re-runs `shouldDrag()`;
if it fails there (e.g. text got selected mid-drag), it returns WITHOUT
`resetDrawer()` — the sheet can be left mid-air until the next interaction.

**RC6 — our stacked-zoom animation is re-render-driven.** `topDragPct` goes
through `useSyncExternalStore` → React re-renders every sheet in the stack on
every pointermove. Janky under load, and the covered-parent transition
none/300ms toggling makes settled motion inconsistent ("does not feel right
everywhere"). vaul has NATIVE nested-drawer support (`Drawer.NestedRoot` +
`onNestedDrag`) that scales/offsets the parent imperatively (no re-render,
same easing as the sheet itself) — we rebuilt a worse version of it.

**One real gap vs native apps (not a bug):** mid-gesture handoff. Native
sheets hand a SINGLE gesture from list-scroll to sheet-drag when the list
edge is hit (with the rubber-band "capture net" the user described). On the
web this cannot work with native scrolling — the browser's `pointercancel`
ends the stream the moment scrolling starts. Doing it requires a custom
touch-event gesture layer that drives the scroll position itself (what
gorhom/bottom-sheet does on React Native). No web library does this well;
react-modal-sheet has the same per-gesture-decision model as vaul.

## 3. Plan

**Phase A — remove the fights (small, high yield):**
1. App-wide `user-select: none` on touch-relevant UI; opt back in
   (`select-text`) only where copying matters: user/space IDs, IBANs, bank
   text in tx details, error codes, invite links. Kills RC1 and the user's
   "disable hold-to-copy in most of the app" ask in one move.
2. Remove our redundant header pointer-capture + `touch-none` (vaul captures
   already; RC3 needs content treatment, not header).
3. `touch-action: pan-y` is wrong for content (it invites the browser to
   claim pans). Instead: keep native scroll, but when the content is NOT
   scrollable (fits the sheet), mark the scroll container `touch-action:
   none` so every touch is vaul's. Most small sheets become fully drag-safe;
   scrollable ones keep list behavior. (Cheap CSS/JS: toggle a class when
   `scrollHeight <= clientHeight`.)
4. Patch the two vaul timing traps via wrapper-level workarounds:
   - RC2: we cannot reach `openTime`, but we CAN mount the sheet with
     `data-vaul-no-drag` absent and simply accept 500ms — OR fork the check
     via patch-package (set 200ms). Decide by feel on device.
   - RC4: pass `scrollLockTimeout={0}` on sheets whose content rarely
     scrolls (compact/form sizes) — flick-then-drag stops dying there.
5. RC5: after `onRelease` with `staysOpen`, force a reset if the sheet's
   translate is non-zero ~100ms later (wrapper-level guard, no fork).

**Phase B — stacking done right:**
6. Replace our visual-stack scaling with vaul's `Drawer.NestedRoot` where
   sheets genuinely nest (picker over form). Where they're siblings, keep the
   registry but drive the covered style imperatively via a ref + CSS var (no
   per-frame React re-render). Same drag-linked growth, correct easing both
   directions, no jank.

**Phase C — evaluate, then decide on the handoff gap:**
7. Test-drive A+B on device (native shell + PWA). If the per-gesture model
   still feels wrong on the long sheets (tx detail pickers, category
   manager), prototype a custom touch-driven handoff ONLY for those: touch
   events (they keep firing during native scroll), `overscroll-behavior:
   none`, and when the list edge is reached mid-gesture, take over by
   driving `scrollTop` manually and translating the drawer. Ship behind a
   dev-mode flag first. This is the expensive 20% — only pay it if A+B
   don't get us to "feels native".

**Explicit non-goals:** replacing vaul wholesale. The evaluated alternatives
(react-modal-sheet, @silk-hq/components, headless custom) share the same
web-platform constraints; vaul's model is the closest to the requested UX and
battle-tested (shadcn). The problems found are integration bugs, not library
choice.

## 4. Tuning answers to the user's specific questions

- Draggable area → everything (already vaul default); selection was the thief.
- Close threshold → keep 25%-of-height OR velocity >0.4 px/ms; revisit only
  after Phase A on device.
- Slow-drag-release below threshold → springs back today (vaul); the reason
  it sometimes didn't is RC5.
- Wiggle → vaul follows the finger and never closes while held (confirmed in
  source); perceived violations were RC3 pointercancels.
