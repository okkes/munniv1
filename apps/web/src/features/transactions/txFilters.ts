import { EMPTY_FILTERS } from './FilterSheet';
import type { SheetFilters } from './FilterSheet';

/**
 * #140 (user): the list's filters survive a detour into a transaction
 * (mobile unmounts the list screen) but reset on a fresh app start and
 * whenever another TAB is chosen. Module state gives exactly that
 * lifetime — same idea as the scroll memory, minus the persistence.
 */
export interface TxFilterState {
  query: string;
  uncatOnly: boolean;
  unsettledOnly: boolean;
  counterOnly: boolean;
  /** #148: the home block's "see all" lens — unreviewed rows only */
  newOnly: boolean;
  filters: SheetFilters;
}

export const EMPTY_TX_FILTERS: TxFilterState = {
  query: '',
  uncatOnly: false,
  unsettledOnly: false,
  counterOnly: false,
  newOnly: false,
  filters: EMPTY_FILTERS,
};

let snapshot: TxFilterState = EMPTY_TX_FILTERS;

export const readTxFilters = (): TxFilterState => snapshot;
export const writeTxFilters = (next: TxFilterState): void => {
  snapshot = next;
};
/** a different tab was chosen — the lens resets (user rule, #140) */
export const clearTxFilters = (): void => {
  snapshot = EMPTY_TX_FILTERS;
};
/** arrive with a lens pre-set (#148: home's "see all" → the new ones) */
export const presetTxFilters = (partial: Partial<TxFilterState>): void => {
  snapshot = { ...EMPTY_TX_FILTERS, ...partial };
};
