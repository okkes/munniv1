import { create } from 'zustand';

/**
 * #173 (user): being kicked out of a space must not be a silent vanish.
 * The sync engine's 403 → purge path records the eviction here; the
 * layout shows the takeover sheet and the data provider hops the active
 * space to a surviving one. Module store — the engine has no React.
 */
export interface EvictedInfo {
  spaceId: string;
  spaceName: string;
  /** filled by the data provider when it had to switch the active space */
  switchedToName?: string;
}

interface EvictedState {
  evicted: EvictedInfo | null;
  report: (info: EvictedInfo) => void;
  markSwitched: (name: string) => void;
  clear: () => void;
}

export const useEvicted = create<EvictedState>((set) => ({
  evicted: null,
  report: (info) => set({ evicted: info }),
  markSwitched: (name) => set((s) => (s.evicted ? { evicted: { ...s.evicted, switchedToName: name } } : s)),
  clear: () => set({ evicted: null }),
}));

/** engine-side door (no hooks there) */
export const reportEviction = (info: EvictedInfo): void => useEvicted.getState().report(info);
