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
