import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Sheet as ModalSheet, type SheetRef } from 'react-modal-sheet';
import { useLang } from '@/i18n';
import { isMinaSheetGuarded } from '@/features/mina/lock';
// desktop ruling (2026-07-17, replaces §4.3's right panel the user
// disliked): at lg a sheet renders as a centered dialog — the familiar
// desktop shape, with the page still visible around it
import { useLgViewport as usePanelMode } from '@/lib/viewport';
import { isIOS, isNativeApp } from '@/lib/platform';
import { Button } from './Button';

/** the three sheet heights; per-pixel values stay out of call sites */
export type SheetSize = 'compact' | 'form' | 'tall';
const SIZE_PX: Record<SheetSize, number> = { compact: 320, form: 440, tall: 600 };

// framer-motion animates in real wall-clock time even in jsdom (vaul's
// CSS transitions never ran there) — under parallel test load those
// ~300ms opens/closes eat waitFor budgets at random. Instant in tests.
const IS_TEST = import.meta.env.MODE === 'test';

// Keyboard avoidance (translating the sheet up by the keyboard height)
// is only for environments where the viewport does NOT resize for the
// keyboard — plain iOS Safari/PWA. Everywhere the viewport resizes it
// stacks on top and strands sheets past the status bar with a
// keyboard-sized gap at the bottom (user ss 2026-07-19):
//  - Android: the interactive-widget viewport meta resizes the layout
//  - native shells: @capacitor/keyboard resize:"native" shrinks the webview
const IS_ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
const VIEWPORT_RESIZES = IS_ANDROID || isNativeApp();

// ── #134: iOS keeps NATIVE tap-to-focus ─────────────────────────────
// The library's iOS scroll lock intercepted every tap on an editable
// (preventDefault + teleport the field -2000px + programmatic focus +
// restore a frame later), and its keyboard avoidance smooth-scrolled
// the tapped field to the sheet's top on EVERY focus hop. WebKit keeps
// the caret invisible until all of that settles — the reported ~2s
// stall, worst when switching between fields. iOS opts out of both:
// the tap focuses natively (caret lands immediately), and AppLayout's
// settled-viewport reveal — which pads the sheet's scroller and only
// scrolls when a field is actually hidden — takes over inside sheets.
// The document itself can't scroll (fixed app frame, html/body
// overflow:hidden), so the lock's page-pinning bought nothing here.
const ON_IOS = isIOS();

// The one job the teleport DID do for us: focusing a field the
// keyboard covers makes WebKit shove scrollTop onto overflow:hidden
// ancestors (the sheet chrome — "scroll jail"), which shears the
// sheet's content out of its frame. A non-scroller has no business
// holding a scroll offset, so while an iOS sheet is open, every
// editable focus sweeps the chain and zeroes shoved offsets — once in
// the focus beat, once after the keyboard has landed.
let jailGuardUsers = 0;
let removeJailGuard: (() => void) | null = null;

function unshoveFrom(el: HTMLElement | null): void {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (node.scrollTop !== 0) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') node.scrollTop = 0;
    }
  }
}

function pushJailGuard(): void {
  jailGuardUsers++;
  if (jailGuardUsers > 1) return;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const onFocusIn = (e: FocusEvent) => {
    const target = e.target;
    if (!(target instanceof HTMLElement) || !target.closest('input, textarea, select, [contenteditable="true"]')) return;
    requestAnimationFrame(() => unshoveFrom(target));
    const timer = setTimeout(() => {
      timers.delete(timer);
      unshoveFrom(target);
    }, 400);
    timers.add(timer);
  };
  document.addEventListener('focusin', onFocusIn);
  removeJailGuard = () => {
    document.removeEventListener('focusin', onFocusIn);
    for (const timer of timers) clearTimeout(timer);
  };
}

function popJailGuard(): void {
  jailGuardUsers = Math.max(0, jailGuardUsers - 1);
  if (jailGuardUsers === 0) {
    removeJailGuard?.();
    removeJailGuard = null;
  }
}

/** true where the SHEET surface owns keyboard handling — the global
 *  keyboard reveal must stand down inside sheets there (AppLayout).
 *  No longer true on iOS (#134): there AppLayout owns the reveal.
 *  #290 r2: "owns" now means the library where an on-screen keyboard
 *  is plausible, and NOTHING on fine-pointer machines — with no
 *  keyboard there is nothing to reveal, and every scripted scroll on
 *  focus is a pure yank. */
export const SHEET_OWNS_KEYBOARD = !VIEWPORT_RESIZES && !ON_IOS;

/** #290 r2 (user): the mobile sheet library's keyboard avoidance may
 *  engage only where an on-screen keyboard is PLAUSIBLE — a coarse
 *  primary pointer (touch). Desktop Chromium exposes
 *  navigator.virtualKeyboard even on mouse-only machines, and the
 *  library reads the API's presence as "keyboard open" the moment a
 *  field is focused (it flips overlaysContent itself and a zero-height
 *  keyboard rect still counts) — then smooth-scrolls the focused field
 *  flush under the sheet header (the "fields fall behind the New loan
 *  header" report). Android/native keep their resize path and iOS its
 *  #134 opt-out; evaluated at render so docking/undocking a tablet
 *  keyboard is honored. Exported for the Sheet.desktop smoke. */
export const sheetLibAvoidsKeyboard = (): boolean =>
  !VIEWPORT_RESIZES && !ON_IOS && typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// ── sheet stack ──────────────────────────────────────────────────────────
// Only the TOP sheet may dismiss. Without this, opening a picker sheet on
// top of a form sheet made every tap inside the picker count as an
// outside-click on the form — which silently cancelled the whole flow
// (the recurring-create bug). Registering automatically beats requiring
// every caller to remember a `locked` prop.
let nextSheetId = 0;
let sheetStack: number[] = [];
const stackListeners = new Set<() => void>();
const pendingRemovals = new Map<number, ReturnType<typeof setTimeout>>();
const notifyStack = () => stackListeners.forEach((listener) => listener());
const subscribeStack = (listener: () => void) => {
  stackListeners.add(listener);
  return () => stackListeners.delete(listener);
};
const topOfStack = () => sheetStack.at(-1) ?? -1;
// visual stack: pops IMMEDIATELY on close so the parent un-shrinks in
// step with the child's exit animation (the dismissal stack keeps its
// grace period — an outside tap during the exit must not hit the parent)
let visualStack: number[] = [];
const visualOf = () => visualStack.join(',');
function pushVisual(id: number) {
  visualStack = [...visualStack.filter((entry) => entry !== id), id];
  notifyStack();
  syncCoveredStyles();
}
function popVisual(id: number) {
  visualStack = visualStack.filter((entry) => entry !== id);
  notifyStack();
  syncCoveredStyles();
}

/** true while any sheet is open — global gestures (edge-swipe back) must stand down */
export const hasOpenSheet = (): boolean => visualStack.length > 0;

/** #136: is this element visible on the TOP layer — the topmost sheet,
 *  or the base screen when no sheet is open? The Mina glow pierced any
 *  sheet stacked ABOVE its anchor (the overlay outranks every sheet at
 *  z-60); the tutorial stands its glow down when this says no. */
export function elementOnTopLayer(el: HTMLElement): boolean {
  if (visualStack.length === 0) return true; // no sheets — the screen IS the top
  const topEl = coveredEls.get(visualStack.at(-1)!);
  if (!topEl) return true; // top sheet not measurable yet — don't flicker
  return topEl.contains(el);
}

// every open sheet registers its close callback; the Mina tutorial (and
// only flows like it) dismisses leftovers before moving to a step whose
// target lives outside any sheet
const sheetClosers = new Map<number, () => void>();
export function closeAllSheets(): void {
  for (const close of [...sheetClosers.values()].reverse()) close();
}

// ── drag-linked zoom (imperative) ────────────────────────────────────────
// Covered parents recede; while the TOP sheet is dragged toward dismissal
// they grow back IN STEP with the finger, both directions. This is driven
// by writing styles straight onto registered elements: routing per-frame
// drag progress through React re-rendered every stacked sheet per
// pointermove and made the whole thing stutter (2026-07-24 user feedback).
const COVERED_SCALE = 0.92;
const COVERED_OPACITY = 0.55;
const SETTLE_TRANSITION = 'transform 300ms ease-out, opacity 300ms ease-out';
const coveredEls = new Map<number, HTMLElement>();

const isCoveredNow = (id: number) => visualStack.includes(id) && visualStack.at(-1) !== id;

/** settled state: full covered recede (or none), animated */
function syncCoveredStyles() {
  for (const [id, el] of coveredEls) {
    el.style.transition = SETTLE_TRANSITION;
    if (isCoveredNow(id)) {
      el.style.transform = `scale(${COVERED_SCALE})`;
      el.style.opacity = `${COVERED_OPACITY}`;
    } else {
      el.style.transform = '';
      el.style.opacity = '';
    }
  }
}

/** mid-drag: parents TRACK the finger — no transition, interpolated */
function applyDragToCovered(pct: number) {
  const clamped = Math.min(1, Math.max(0, pct));
  for (const [id, el] of coveredEls) {
    if (!isCoveredNow(id)) continue;
    el.style.transition = 'none';
    el.style.transform = `scale(${COVERED_SCALE + (1 - COVERED_SCALE) * clamped})`;
    el.style.opacity = `${COVERED_OPACITY + (1 - COVERED_OPACITY) * clamped}`;
  }
}

function registerCoveredEl(id: number, el: HTMLElement | null) {
  if (el) {
    coveredEls.set(id, el);
    syncCoveredStyles();
  } else {
    coveredEls.delete(id);
  }
}

/** stack facts for one sheet: dismissal lock + visual depth */
function useSheetStack(open: boolean): { id: number; isLocked: boolean; depth: number } {
  const idRef = useRef(-1);
  if (idRef.current === -1) idRef.current = nextSheetId++;
  useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    pushSheet(id);
    return () => popSheetSoon(id);
  }, [open]);
  const top = useSyncExternalStore(subscribeStack, topOfStack);
  useSyncExternalStore(subscribeStack, visualOf); // re-render on visual changes
  const visualIndex = visualStack.indexOf(idRef.current);
  return {
    id: idRef.current,
    isLocked: open && top !== idRef.current,
    /** how many sheets sit BELOW this one (0 = root sheet) */
    depth: Math.max(0, visualIndex),
  };
}

function pushSheet(id: number) {
  const pending = pendingRemovals.get(id);
  if (pending) {
    clearTimeout(pending);
    pendingRemovals.delete(id);
  }
  sheetStack = [...sheetStack.filter((entry) => entry !== id), id];
  pushVisual(id);
  notifyStack();
}

function popSheetSoon(id: number) {
  popVisual(id); // the parent starts growing back right away
  // keep the slot through the exit animation: a tap while the child is
  // sliding out must not count as an outside-click on the parent below
  pendingRemovals.set(
    id,
    setTimeout(() => {
      pendingRemovals.delete(id);
      sheetStack = sheetStack.filter((entry) => entry !== id);
      notifyStack();
    }, 500),
  );
}

// ── desktop grow-from-source ─────────────────────────────────────────────
// The dialog grows out of where the user clicked and shrinks back there on
// close (user request 2026-07-24) — an instant popup felt wrong. The last
// pointerdown is the best available proxy for "the source place".
let lastPointer = { x: 0, y: 0 };
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => {
      lastPointer = { x: e.clientX, y: e.clientY };
    },
    { capture: true, passive: true },
  );
}
const PANEL_MS = 220;

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
  /** named height — use this for every new sheet */
  size?: SheetSize;
  /** escape hatch for truly odd content; prefer `size` */
  height?: number;
  /** pinned below the scroll area (save/confirm rows) — never `position:
   *  sticky` inside the scrollport: the keyboard translation and
   *  safe-area padding sent it drifting over the content (user ss) */
  footer?: ReactNode;
  /** DEPRECATED no-op (2026-08-01): content drag is back for every
   *  sheet — the capture guard below hands the gesture to whichever
   *  scroller isn't at its top, which is what the header-only regime
   *  tried (and failed) to approximate. Kept so ~20 call sites don't
   *  churn; remove opportunistically. */
  dragHandle?: boolean;
  /** unsaved edits present (user request 2026-08-01): a dismissal
   *  gesture (backdrop tap, drag-down, Escape) asks "discard changes?"
   *  first instead of silently dropping the form. Programmatic closes
   *  (the host's own save calling onOpenChange) are unaffected. */
  dirty?: boolean;
  /** #203 (user): work in flight — dismissal gestures flash this note
   *  ("still running") instead of closing; the drag springs back. The
   *  host clears it (and may close) when the work lands. */
  busyNote?: string | null;
  /** #311 r3 (user): data-dense sheets may take the desktop width —
   *  the dialog widens; the mobile sheet is untouched */
  wide?: boolean;
}

/**
 * Should this pointer/touch stay with the CONTENT instead of arming the
 * sheet drag? Yes when it lands on an editable, an element that owns its
 * gesture (`data-sheet-no-drag`, e.g. the color wheel), or inside ANY
 * scroller — nested or the lib's own — that is not scrolled to its top:
 * there, the gesture is a scroll. At the top, the drag arms and
 * downward movement dismisses — scroll when you can, drag when you
 * can't, the behavior the user asked for (2026-08-01, replacing the
 * header-only drag regime of 2026-07-31).
 */
function gestureBelongsToContent(target: HTMLElement, stopAt: HTMLElement): boolean {
  if (target.closest('input, textarea, select, [contenteditable="true"], [data-sheet-no-drag]')) return true;
  for (let el: HTMLElement | null = target; el && el !== stopAt; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return true;
    }
  }
  return false;
}

interface DesktopDialogProps {
  id: number;
  open: boolean;
  isLocked: boolean;
  fixedHeight: number | undefined;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** #311 r3: the widened desktop shape for data-dense sheets */
  wide?: boolean;
  /** USER dismissal request (backdrop/ESC) — the owner decides whether
   *  it closes, asks about unsaved edits, or is tutorial-locked */
  onDismiss: () => void;
}

/** desktop (2026-07-18 fix): a plain centered dialog — vaul's drawer
 *  transforms fought the centered layout and pinned it to the top */
function DesktopDialog({ id, open, isLocked, fixedHeight, title, children, footer, wide, onDismiss }: Readonly<DesktopDialogProps>) {
  // enter/exit: grow from the click point, shrink back to it
  const [phase, setPhase] = useState<'closed' | 'hidden' | 'open'>('closed');
  const originRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (open) {
      originRef.current = { ...lastPointer };
      setPhase('hidden'); // mounted at the source point…
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
      return () => cancelAnimationFrame(raf);
    }
    setPhase((prev) => (prev === 'closed' ? 'closed' : 'hidden')); // …shrink back
    const timer = setTimeout(() => setPhase('closed'), PANEL_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // ESC closes the TOP desktop dialog only
  useEffect(() => {
    if (!open || isLocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isLocked, onDismiss]);

  if (!open && phase === 'closed') return null;
  const hidden = phase !== 'open';
  const from = originRef.current;
  const dx = from.x - window.innerWidth / 2;
  const dy = from.y - window.innerHeight / 2;
  // PORTALED to body (user ss): rendered inside the master-detail pane,
  // the pane's slide transform turned `fixed` into pane-relative — the
  // overlay grayed only half the app, the list beside it stayed
  // clickable, and the grow-from-click origin missed by the pane offset.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        aria-label="close"
        tabIndex={-1}
        onClick={() => !isLocked && onDismiss()}
        className="absolute inset-0 cursor-default border-none bg-black/40"
        style={{ opacity: hidden ? 0 : 1, transition: `opacity ${PANEL_MS}ms ease-out` }}
      />
      {/* a real <dialog> (a11y): UA border/padding/color neutralized */}
      {/* #290 (user): clicking a field at mid sizes scrolled the dialog
          "way up" — AppLayout's keyboard reveal CENTERS any focused
          editable in its nearest scroller, a scripted scrollTo no CSS
          scroll-padding can temper, and with no on-screen keyboard the
          centering is a pure yank (big screens hid it: #276 auto-height
          leaves nothing to scroll). AppLayout already stands down inside
          `.react-modal-sheet-container` wherever SHEET_OWNS_KEYBOARD, so
          the dialog wears the same class; where a keyboard really exists
          (iPad / Android tablets at lg) the reveal keeps working. */}
      <dialog
        open
        aria-modal="true"
        data-sheet-body=""
        ref={(el) => registerCoveredEl(id, el)}
        className={`react-modal-sheet-container relative z-10 m-0 flex ${wide ? 'w-[760px] max-w-[94vw]' : 'w-[480px] max-w-[92vw]'} flex-col rounded-[20px] border-none bg-bg p-0 text-ink shadow-2xl outline-none`}
        style={{
          // #276: the dialog grows with its content — the phone's fixed
          // heights left half-empty dialogs and clipped tall content on
          // large screens. The size still sets a floor so short content
          // keeps a recognizable shape; the ceiling is viewport-relative.
          // (The MOBILE sheet keeps its mount-locked height — hard rule.)
          height: 'auto',
          minHeight: fixedHeight === undefined ? undefined : Math.round(fixedHeight * 0.6),
          maxHeight: 'min(85dvh, 900px)',
          // grow from the source, shrink back to it — the covered-parent
          // recede writes to the same properties, so hand them over only
          // while entering/exiting
          ...(hidden || !isCoveredNow(id)
            ? {
                transform: hidden ? `translate(${dx}px, ${dy}px) scale(0.2)` : undefined,
                opacity: hidden ? 0 : undefined,
                transition: `transform ${PANEL_MS}ms cubic-bezier(0.32, 0.72, 0, 1), opacity ${PANEL_MS}ms ease-out`,
              }
            : {}),
        }}
      >
        {title && <div className="m-h3 shrink-0 px-5 pt-5 pb-1 text-ink">{title}</div>}
        {/* flex-auto, not flex-1: with no `size` this dialog is
            auto-height, where basis 0% collapses in WebKit (Safari on
            macOS/iPad) exactly like the mobile sheet did on iOS */}
        {/* #290: with the app-level reveal standing down, the BROWSER's
            native focus scroll is what shows a hidden field — it scrolls
            minimally; scroll-padding gives the revealed field a little
            air instead of landing flush against the clipped edge */}
        <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-5 pt-2 pb-5 [scroll-padding-block:16px]">{children}</div>
        {footer && <div className="shrink-0 border-t border-line-2 bg-bg px-5 pt-3 pb-5">{footer}</div>}
      </dialog>
    </div>,
    document.body,
  );
}

/**
 * The one shared bottom sheet for the whole app: swipe-to-dismiss,
 * drag/scroll coordination and background scroll locking come from
 * react-modal-sheet (replaced vaul 2026-07-26 — its gesture capture kept
 * cancelling inputs mid-typing, user report); stacked sheets lock their
 * parents automatically. Never build inline overlays.
 */
export function Sheet({ open, onOpenChange, title, children, size, height, footer, dirty, busyNote, wide }: Readonly<SheetProps>) {
  const { t } = useLang();
  const requested = height ?? (size ? SIZE_PX[size] : undefined);
  const { id, isLocked, depth } = useSheetStack(open);
  // USER-initiated dismissals route through here: the Mina tutorial owns
  // the flow while it runs, and unsaved edits get a conscious "discard?"
  // before the form is dropped (both 2026-08-01 user requests)
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // #203: a dismissal attempt while work runs flashes the note briefly
  const [busyFlash, setBusyFlash] = useState(false);
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashBusy = () => {
    setBusyFlash(true);
    if (busyTimer.current) clearTimeout(busyTimer.current);
    busyTimer.current = setTimeout(() => setBusyFlash(false), 2500);
  };
  // #253 (user): a DRAG on a dirty sheet completes — the sheet hides,
  // the "discard?" ask shows, and Keep editing slides it back up. This
  // flag is the hidden-while-asking state; a ref mirror keeps the
  // lib's late animation callbacks from re-arming the ask.
  const [hiddenForDiscard, setHiddenForDiscard] = useState(false);
  const hiddenRef = useRef(false);
  const setHidden = (value: boolean) => {
    hiddenRef.current = value;
    setHiddenForDiscard(value);
  };
  useEffect(() => {
    if (!open) {
      setConfirmDiscard(false);
      hiddenRef.current = false;
      setHiddenForDiscard(false);
    }
  }, [open]);
  const requestDismiss = () => {
    // the tutorial locks only the ROOT sheet (the lesson's form) — a
    // nested picker (budget period, currency…) must stay dismissible or
    // the user is trapped one level down (user ss 2026-08-01)
    if (isMinaSheetGuarded() && depth === 0) return;
    // #203: work in flight — say so instead of closing over it
    if (busyNote) {
      flashBusy();
      return;
    }
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  };
  // registered while open so closeAllSheets() can dismiss leftovers
  useEffect(() => {
    if (!open) return;
    sheetClosers.set(id, () => onOpenChange(false));
    return () => void sheetClosers.delete(id);
  }, [open, id, onOpenChange]);
  // stacked sheets step DOWN in height (28px per level, floor 280) so
  // the parent's receded edge stays visible — the depth cue the thin
  // drag bar alone never gave (user request)
  const fixedHeight = requested === undefined ? undefined : Math.max(280, requested - depth * 28);
  const panel = usePanelMode();
  // #134: while an iOS mobile sheet is open, undo WebKit scroll-jail
  // shoves on every editable focus (see module block)
  useEffect(() => {
    if (!open || panel || !ON_IOS) return;
    pushJailGuard();
    return () => popJailGuard();
  }, [open, panel]);

  // the whole test corpus was written against vaul's jsdom behavior: a
  // closed sheet STAYED MOUNTED (its exit transition never ran there),
  // and tests observe post-close state through the still-mounted inputs.
  // framer-motion's real unmount-after-exit races those assertions under
  // load — so in tests, once opened, the sheet stays mounted for good.
  const [everOpen, setEverOpen] = useState(false);
  useEffect(() => {
    if (open) setEverOpen(true);
  }, [open]);

  // the sheet's y-progress (1 = resting open, 0 = dismissed) drives the
  // covered parents: they recede in step with the child's slide-in and
  // grow back in step with its drag/dismissal — both directions, every
  // frame, without React re-renders
  const sheetRef = useRef<SheetRef>(null);
  const isLockedRef = useRef(isLocked);
  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);
  // ESC closes the TOP sheet (vaul inherited this from Radix; the lib
  // doesn't do keyboard dismissal itself)
  const requestRef = useRef(requestDismiss);
  requestRef.current = requestDismiss;
  useEffect(() => {
    if (!open || panel || isLocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, panel, isLocked]);
  useEffect(() => {
    if (!open || panel) return;
    // the ref populates once the portal mounts — subscribe a frame later
    let unsubscribe: (() => void) | undefined;
    const raf = requestAnimationFrame(() => {
      const progress = sheetRef.current?.yProgress;
      if (!progress) return;
      unsubscribe = progress.on('change', (value) => {
        if (isLockedRef.current) return; // only the top sheet drives parents
        if (value >= 0.999) syncCoveredStyles();
        else applyDragToCovered(1 - value);
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe?.();
    };
  }, [open, panel]);

  // the "discard changes?" ask — its own stacked sheet, so the parent
  // recedes and the choice is explicit (never window.confirm)
  const discardConfirm = dirty ? (
    <Sheet
      open={confirmDiscard}
      onOpenChange={(next) => {
        setConfirmDiscard(next);
        // dismissing the ask itself (backdrop/drag) keeps the edits —
        // the hidden form slides back up (#253)
        if (!next) setHidden(false);
      }}
      title={t('sheet.discardTitle')}
      size="compact"
    >
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-[13px] leading-relaxed text-ink-2">{t('sheet.discardBody')}</p>
        <Button
          data-testid="sheet-keep-editing"
          onClick={() => {
            setConfirmDiscard(false);
            setHidden(false);
          }}
        >
          {t('sheet.keepEditing')}
        </Button>
        <Button
          variant="danger"
          data-testid="sheet-discard"
          onClick={() => {
            setConfirmDiscard(false);
            setHidden(false);
            onOpenChange(false);
          }}
        >
          {t('sheet.discardConfirm')}
        </Button>
      </div>
    </Sheet>
  ) : null;

  // #203: the flash itself — rendered at the top of the content in
  // both shapes (mobile sheet + desktop dialog)
  const busyBanner =
    busyFlash && busyNote ? (
      <div className="mb-2 rounded-card bg-warning-soft px-3 py-2 text-[12px] text-ink-2" data-testid="sheet-busy-note">
        {busyNote}
      </div>
    ) : null;

  if (panel) {
    return (
      <>
        <DesktopDialog id={id} open={open} isLocked={isLocked} fixedHeight={fixedHeight} title={title} footer={footer} wide={wide} onDismiss={requestDismiss}>
          {busyBanner}
          {children}
        </DesktopDialog>
        {discardConfirm}
      </>
    );
  }

  return (
    <>
    <ModalSheet
      ref={sheetRef}
      isOpen={IS_TEST ? everOpen : open && !hiddenForDiscard}
      onClose={() => {
        syncCoveredStyles(); // a settled dismissal ends the drag
        if (!open) return; // a programmatic close is already handled
        if (isLocked || (isMinaSheetGuarded() && depth === 0)) return;
        // #203: belt for the drag path — disableDismiss already refuses
        if (busyNote) {
          flashBusy();
          return;
        }
        if (dirty) {
          // #253 (user): the drag COMPLETES — the sheet hides and the
          // "discard?" ask takes over; Keep editing brings it back
          if (!hiddenRef.current) {
            setHidden(true);
            setConfirmDiscard(true);
          }
          return;
        }
        onOpenChange(false);
      }}
      onCloseStart={() => {
        syncCoveredStyles();
        // the exiting copy stays mounted through the close animation —
        // taps in that window must fall through to what's underneath,
        // not be swallowed by a ghost whose handlers are about to die
        const ghost = coveredEls.get(id);
        if (ghost) ghost.style.pointerEvents = 'none';
      }}
      detent="content"
      // #134: on iOS BOTH library behaviors stand down (see the block
      // at the top) — AppLayout reveals, the jail guard keeps chrome
      // straight, and the fixed app frame already pins the page.
      // #290 r2: fine-pointer machines have no on-screen keyboard —
      // the library stands down there too, or its virtualKeyboard
      // misfire scrolls every focused field under the sheet header
      avoidKeyboard={sheetLibAvoidsKeyboard()}
      disableScrollLocking={ON_IOS}
      // the Mina tutorial refuses the drag-dismissal (root sheet only —
      // nested pickers stay dismissible). #253: dirty forms no longer
      // refuse it — the drag completes, the sheet hides, and the
      // "discard?" ask decides whether it comes back. #203: in-flight
      // work refuses the drag (it springs back, the note flashes).
      disableDismiss={isLocked || (isMinaSheetGuarded() && depth === 0) || !!busyNote}
      prefersReducedMotion={IS_TEST}
      unstyled
      // z-50 like the old drawer: the Mina tutorial overlay must still be
      // able to sit above sheets (the lib's default is 9999)
      style={{ zIndex: 50 }}
    >
      <ModalSheet.Backdrop
        className="bg-black/40"
        onTap={() => {
          if (!isLocked) requestDismiss();
        }}
        // plain-click fallback (mouse/emulated environments where the
        // tap gesture doesn't materialize); double-firing is a no-op
        onClick={() => {
          if (!isLocked) requestDismiss();
        }}
      />
      <ModalSheet.Container className="inset-x-0 mx-auto w-full max-w-[560px] overflow-hidden rounded-t-[20px] bg-bg shadow-[0_-16px_48px_rgba(0,0,0,0.30)] outline-none">
        {/* stacked-sheet depth (user request): a sheet buried under a
            child visibly recedes instead of hiding behind a thin bar —
            and grows back in step with the child's dismissal drag
            (styles written imperatively via registerCoveredEl) */}
        {/* WebKit rule (iOS ss 2026-07-26): inside the auto-height
            container (detent "content"), `flex-1`'s basis 0% overrides
            `height` and min-h-0 drops the content minimum — WebKit then
            resolves the body to ZERO and sheets open header-only, while
            Blink grows it to content and hides the bug. Basis stays AUTO
            (flex-initial) so `height` rules; min-h-0 only lets the
            container's own max clamp shrink it on short screens. */}
        <div
          ref={(el) => registerCoveredEl(id, el)}
          data-sheet-body=""
          className="flex min-h-0 flex-initial flex-col"
          style={{ transformOrigin: 'top center', height: fixedHeight }}
          // a gesture landing on an editable, a self-handling element or
          // a mid-scroll list must NEVER become a sheet drag (inputs:
          // cancelled-while-typing report; lists: scroll moved list +
          // sheet together, ss 2026-07-31). Capture phase on BOTH event
          // families: the lib's drag binds pointer events, its scroll
          // coordination touch events — a bubble-phase stop fires too
          // late for either.
          onPointerDownCapture={(e) => {
            if (gestureBelongsToContent(e.target as HTMLElement, e.currentTarget)) e.stopPropagation();
          }}
          onTouchStartCapture={(e) => {
            if (gestureBelongsToContent(e.target as HTMLElement, e.currentTarget)) e.stopPropagation();
          }}
        >
          {/* full-height drag zone across the title area */}
          <ModalSheet.Header className="shrink-0 cursor-grab pt-2.5 pb-1">
            <div className="mx-auto h-1.5 w-10 rounded-full bg-line" />
            {title && <div className="m-h3 px-5 pt-3 pb-1 text-ink">{title}</div>}
          </ModalSheet.Header>
          {/* content drags the sheet only at scroll-top or when nothing
              scrolls: the lib coordinates its OWN scroller, and the
              capture guard above extends the same at-top rule to every
              nested scroller; bottom padding lives INSIDE the scroller
              because the lib writes its keyboard inset onto the
              scroller's own style */}
          {/* flex-auto (basis auto), same WebKit rule as the wrapper;
              the scroller swaps the lib's `height: 100%` (indefinite
              inside a flex-sized parent in WebKit) for flex sizing */}
          <ModalSheet.Content
            className="min-h-0 flex-auto"
            scrollClassName="px-5"
            scrollStyle={{ height: 'auto', flex: '1 1 auto', minHeight: 0 }}
          >
            <div className={footer ? 'pb-2' : 'pb-[max(20px,env(safe-area-inset-bottom))]'}>
              {busyBanner}
              {children}
            </div>
          </ModalSheet.Content>
          {/* pinned footer: OUTSIDE the scrollport, so it can never
              drift over the content (the sticky-in-scroll version did,
              user ss) and survives the keyboard translation intact */}
          {footer && (
            <div className="shrink-0 border-t border-line-2 bg-bg px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </div>
      </ModalSheet.Container>
    </ModalSheet>
    {discardConfirm}
    </>
  );
}
