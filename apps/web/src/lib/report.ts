import * as Sentry from '@sentry/react';

/**
 * GlitchTip capture with a scope tag (user rule: send every exception
 * that helps troubleshooting). Safe to call anywhere: the global
 * beforeSend gate in main.tsx drops events for zero-network identities
 * (demo/offline), and the offline transport queues for signed-in users
 * without connectivity.
 */
export function reportError(scope: string, err: unknown): void {
  Sentry.captureException(err instanceof Error ? err : new Error(String(err)), { tags: { scope } });
}

/** a non-crash observation (#135: the memory watcher) — same gates as
 *  reportError: zero-network identities never send, offline queues */
export function reportWarning(scope: string, message: string, extra: Record<string, unknown>): void {
  Sentry.captureMessage(message, { level: 'warning', tags: { scope }, extra });
}
