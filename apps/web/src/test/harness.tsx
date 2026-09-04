import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, vi } from 'vitest';
import { routeTree } from '@/app/router';
import { LogtoAppProvider } from '@/features/auth/logto';
import { LangProvider } from '@/i18n';
import { ThemeProvider } from '@/app/theme';
import { DataProvider } from '@/app/data';
import { useSession } from '@/app/session';
import type { Identity } from '@/app/session';

// vitest runs without globals, so RTL cannot self-register its cleanup
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals(); // renderAppAsUser stubs fetch
});

/** static providers only (i18n + theme) */
export function renderWithProviders(ui: ReactElement) {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider>
        <LangProvider>{children}</LangProvider>
      </ThemeProvider>
    ),
  });
}

/**
 * Full data harness: demo identity + seeded Dexie (fake-indexeddb).
 * Await findBy* queries — DataProvider renders children only once the
 * seed is in place.
 */
export function renderWithData(ui: ReactElement) {
  localStorage.setItem('munni_lang', 'en');
  useSession.setState({ identity: { kind: 'demo' } });
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider>
        <LangProvider>
          <DataProvider>{children}</DataProvider>
        </LangProvider>
      </ThemeProvider>
    ),
  });
}

/**
 * Renders the real route tree at `path` with a memory history, signed in
 * as the demo identity (AppLayout provides DataProvider). Await the
 * screen's `screen-*` testid before asserting.
 */
export function renderApp(path: string, { signedIn = true, identity }: { signedIn?: boolean; identity?: Identity } = {}) {
  localStorage.setItem('munni_lang', 'en');
  if (identity) useSession.getState().login(identity);
  else if (signedIn) useSession.getState().login({ kind: 'demo' });
  else useSession.getState().logout();
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  return render(
    <LogtoAppProvider>
      <ThemeProvider>
        <LangProvider>
          <RouterProvider router={router} />
        </LangProvider>
      </ThemeProvider>
    </LogtoAppProvider>,
  );
}

// ── user-identity harness ────────────────────────────────────────────────

export const USER_TEST_SUB = 'test-user';
/** the identity database renderAppAsUser uses — delete it in beforeEach */
export const USER_TEST_DB = `munni_user_${USER_TEST_SUB}`;

export interface UserAppOptions {
  /** spaces the fake server owns; their rows arrive via the bootstrap pull */
  spaces?: { id: string; name: string; kind?: 'personal' | 'shared'; inviteLock?: 0 | 1 }[];
  /** REST handlers keyed `${METHOD} ${pathname}` — everything unhandled is 404 */
  api?: Record<string, (body: unknown, url: URL) => unknown>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Renders the app signed in as a TEST-AUTH USER against a scripted
 * server: global fetch is stubbed with a router that answers the sync
 * protocol (bootstrap pull delivers the given spaces) plus whatever REST
 * handlers the test supplies. This is how user-only UI — members,
 * friends, invites, bank connect — gets exercised without a server.
 */
/** the bootstrap pull's one space op (S3776: out of the fetch mock) */
const bootstrapSpaceOp = (space: NonNullable<UserAppOptions['spaces']>[number]) => ({
  opId: `srv-${space.id}`,
  spaceId: space.id,
  entity: 'space',
  entityId: space.id,
  fields: {
    name: space.name,
    kind: space.kind ?? 'personal',
    currency: 'EUR',
    periodType: 'month',
    periodDay: 1,
    ...(space.inviteLock !== undefined ? { inviteLock: space.inviteLock } : {}),
  },
  hlc: '000000100-0000-server',
});

export function renderAppAsUser(path: string, { spaces = [{ id: 's-user', name: 'Personal' }], api = {} }: UserAppOptions = {}) {
  localStorage.setItem('munni_lang', 'en');
  useSession.getState().login({ kind: 'user', sub: USER_TEST_SUB, testAuth: true });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = api[`${method} ${url.pathname}`];
    if (handler) {
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      // awaited so a handler can return a never-resolving promise to
      // simulate a hanging (down-but-not-refusing) server
      const out = await handler(body, url);
      return out instanceof Response ? out : json(out);
    }
    if (url.pathname === '/me/spaces') return json(spaces.map((s) => s.id));
    if (/^\/sync\/[^/]+\/push$/.test(url.pathname)) return json({ lastSeq: 0 });
    const pull = /^\/sync\/([^/]+)\/pull$/.exec(url.pathname);
    if (pull) {
      const space = spaces.find((s) => s.id === decodeURIComponent(pull[1]));
      const since = Number(url.searchParams.get('since') ?? 0);
      if (space && since === 0) return json({ ops: [bootstrapSpaceOp(space)], latestSeq: 1 });
      return json({ ops: [], latestSeq: since });
    }
    // SSE stream: an immediately-closed stream — the engine falls back to polling
    if (url.pathname === '/sync/events') return new Response('', { status: 200 });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);

  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  const result = render(
    <LogtoAppProvider>
      <ThemeProvider>
        <LangProvider>
          <RouterProvider router={router} />
        </LangProvider>
      </ThemeProvider>
    </LogtoAppProvider>,
  );
  return { ...result, fetchMock };
}
