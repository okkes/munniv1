/**
 * #168 r5 (user): the chosen range tab survives a detour into a
 * transaction — mobile unmounts the list screen, so plain useState
 * always landed the return on the first tab. Module state gives the
 * #140 txFilters lifetime: survives remounts within the session,
 * resets on a fresh app start.
 */
export type RecurringView = 'period' | 'next' | 'year' | 'nextyear' | 'all';

let snapshot: RecurringView = 'period';

export const readRecurringView = (): RecurringView => snapshot;
export const writeRecurringView = (next: RecurringView): void => {
  snapshot = next;
};
/** specs share one module registry — reset between tests */
export const clearRecurringView = (): void => {
  snapshot = 'period';
};
