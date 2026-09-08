import { useEffect, useRef, useState } from 'react';
import type { StorageBackend } from './backend';

/** #361: last-emitted values by explicit cacheKey — a REMOUNT renders
 * the previous data instantly instead of flashing the loading state
 * while the subscription warms (every home-tab return re-created the
 * hooks from scratch). Session-scoped; keys must carry the space id so
 * a space switch never shows another space's rows. */
const LAST_VALUES = new Map<string, unknown>();

/** test seam: specs re-seed fresh databases under the same space id —
 *  the harness clears the cache so no rows bleed between tests */
export function __clearQueryCache(): void {
  LAST_VALUES.clear();
}

/**
 * Live query over the storage seam (replaces dexie-react-hooks'
 * useLiveQuery on the way to E2): undefined while loading, then the
 * result, re-emitted on every relevant data change. Errors rethrow into
 * the render so boundaries see them — same contract as useLiveQuery.
 * An optional `cacheKey` opts into the remount cache above.
 */
export function useQuery<T>(backend: StorageBackend, query: () => Promise<T>, deps: unknown[]): T | undefined;
export function useQuery<T, I>(
  backend: StorageBackend,
  query: () => Promise<T>,
  deps: unknown[],
  initial: I,
  cacheKey?: string,
): T | I;
export function useQuery<T, I>(
  backend: StorageBackend,
  query: () => Promise<T>,
  deps: unknown[],
  initial?: I,
  cacheKey?: string,
): T | I | undefined {
  const seed = (key: string | undefined): { value?: T | I } =>
    key !== undefined && LAST_VALUES.has(key) ? { value: LAST_VALUES.get(key) as T } : { value: initial };
  const [state, setState] = useState<{ value?: T | I; error?: unknown }>(() => seed(cacheKey));
  // a CHANGED key resets synchronously (render-time reset pattern) — the
  // old key's rows must not survive even one frame under the new key
  const keyRef = useRef(cacheKey);
  if (keyRef.current !== cacheKey) {
    keyRef.current = cacheKey;
    setState(seed(cacheKey));
  }
  useEffect(
    () =>
      backend.subscribe(
        query,
        (value) => {
          if (cacheKey !== undefined) LAST_VALUES.set(cacheKey, value);
          setState({ value });
        },
        (error) => setState({ error }),
      ),
    // the query closure is rebuilt every render — deps decide re-subscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backend, ...deps],
  );
  if (state.error !== undefined) throw state.error;
  return state.value;
}
