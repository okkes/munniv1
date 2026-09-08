import { useEffect } from 'react';
import { PUSH_EVENT } from '@/app/pwa';

/**
 * Keeps server-backed lists (members, invites, friend requests) fresh
 * without polling: reload when a push reaches the open app and when the
 * app returns to the foreground. `reload` must be referentially stable
 * (useCallback) or the listeners churn on every render.
 */
export function useServerRefresh(reload: () => void | Promise<void>): void {
  useEffect(() => {
    // refreshes are best-effort: a flaky network must not surface as an
    // unhandled rejection
    const run = () => void Promise.resolve(reload()).catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    window.addEventListener(PUSH_EVENT, run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(PUSH_EVENT, run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);
}
