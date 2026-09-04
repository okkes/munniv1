/**
 * While the Mina tutorial runs, sheets refuse USER dismissal (backdrop
 * tap, drag-down, Escape) — a stray swipe mid-lesson tore the form out
 * from under the tour (user ss 2026-08-01). Programmatic closes
 * (closeAllSheets, a form's own save) go through untouched. Leaf
 * module: Sheet reads it, MinaTutorial writes it — no import cycle.
 */
let guarded = false;

export const setMinaSheetGuard = (next: boolean): void => {
  guarded = next;
};

export const isMinaSheetGuarded = (): boolean => guarded;
