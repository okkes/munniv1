// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setOidcSignIn } from '@/app/authToken';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { USER_TEST_DB, renderApp, renderAppAsUser } from '@/test/harness';

// deterministic regardless of the developer's .env.local — with Logto
// "configured", the real TokenBridge would overwrite the test's
// setOidcSignIn spy and auth-ready would wait on a live provider
vi.mock('@/app/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config')>()),
  logtoConfigured: false,
}));

/**
 * Local-first startup: a RETURNING device (local spaces exist) must render
 * from its database immediately — a hanging server/OIDC endpoint may not
 * hold users on the connecting screen (field bug: app stuck on
 * "Connecting to your account" until the NAS came back, despite months of
 * local data).
 */
describe('DataProvider startup (local-first)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  it('renders the app from local data while every server request hangs forever', async () => {
    // returning device: the identity db already holds a space
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed'), { trackOutbox: false });
    await repo.upsert('space', 's-local', 's-local', {
      name: 'Mine',
      kind: 'personal',
      currency: 'EUR',
      periodType: 'month',
      periodDay: 1,
    });
    db.close();

    const hang = () => new Promise<never>(() => undefined); // never settles
    renderAppAsUser('/', {
      api: {
        'GET /health': hang,
        'GET /me/spaces': hang,
        'GET /me': hang,
      },
    });

    // the Home screen appears despite zero completed requests
    expect(await screen.findByTestId('screen-home', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByTestId('data-loading')).toBeNull();
  });

  it('a brand-new device (no local data) keeps waiting on the connecting screen', async () => {
    const hang = () => new Promise<never>(() => undefined);
    renderAppAsUser('/', {
      api: {
        'GET /health': hang,
        'GET /me/spaces': hang,
        'GET /me': hang,
      },
    });

    expect(await screen.findByTestId('data-loading', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByTestId('screen-home')).toBeNull();
  });

  it(
    'repeated failures surface Diagnose, whose report includes the auth probes',
    async () => {
      // a REFUSING server (vs the hang above): bootstrap rounds fail fast,
      // failedAttempts climbs, and the screen names the problem
      const refuse = () => Promise.reject(new Error('connection refused'));
      renderAppAsUser('/', {
        api: {
          'GET /health': refuse,
          'GET /me/spaces': refuse,
          'GET /me': refuse,
        },
      });

      // round 1 fails instantly, round 2 after the 2s base backoff — from
      // then on the Diagnose button is offered alongside Sign out
      fireEvent.click(await screen.findByTestId('connect-diagnose', {}, { timeout: 9000 }));

      const report = await screen.findByTestId('connect-diagnose-report', {}, { timeout: 4000 });
      const text = (report as HTMLTextAreaElement).value;
      expect(text).toContain('logtoKeys: 0');
      expect(text).toContain('accessToken: ABSENT'); // no OIDC getter registered in tests
      expect(text).toContain('GET /me threw'); // the refusing server, verbatim
      // the 2026-07-29 probes: session kind, storage write, wipe breadcrumb
      expect(text).toContain('session: user');
      expect(text).toContain('lsWrite: true');
      expect(text).toContain('lastLogtoWipe: -');
    },
    15_000,
  );

  it(
    'a signed-in OIDC user with 401s and no mintable token silently re-enters sign-in (capped)',
    async () => {
      const calls: string[] = [];
      setOidcSignIn(async (uri) => {
        calls.push(uri);
      });
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('munni_user_heal-user');
        req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
      });
      // a NON-testAuth user: the self-heal only fires for real OIDC
      // sessions whose client-side keys are gone (evicted/wiped) while
      // the server keeps saying 401 to tokenless requests
      renderApp('/', { identity: { kind: 'user', sub: 'heal-user' } });

      await waitFor(() => expect(calls.length).toBeGreaterThan(0), { timeout: 8000 });
      expect(calls[0]).toContain('/auth-callback');
      expect(sessionStorage.getItem('munni_auth_reheal')).toBe('1');
      setOidcSignIn(null);
    },
    15_000,
  );
});
