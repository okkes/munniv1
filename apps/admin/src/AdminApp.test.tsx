// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp';
import type { AdminConfig } from './config';

const CONFIG: AdminConfig = { apiUrl: 'http://api.test', logtoEndpoint: '', logtoAppId: '', logtoResource: '' };

const USERS = [
  { id: 'u1', sub: 'sub-alice', displayName: 'Alice', email: 'alice@x.nl', createdAt: '2026-01-01T00:00:00Z', spaceCount: 2, isAdmin: true, bootstrap: true },
  { id: 'u2', sub: 'sub-bob', displayName: null, email: null, createdAt: '2026-02-01T00:00:00Z', spaceCount: 1, isAdmin: false, bootstrap: false },
  { id: 'u3', sub: 'sub-carol', displayName: 'Carol', email: null, createdAt: '2026-03-01T00:00:00Z', spaceCount: 3, isAdmin: true, bootstrap: false },
];
const REQUISITIONS = [
  { requisitionId: 'req-live-0001', status: 'LN', institutionId: 'ING_NL', created: new Date(Date.now() - 80 * 86_400_000).toISOString(), accountCount: 2, stale: false, ownerSub: 'sub-alice' },
  { requisitionId: 'req-stale-0002', status: 'EX', institutionId: 'ASN_NL', created: null, accountCount: 0, stale: true, ownerSub: null },
  { requisitionId: 'req-fresh-0003', status: 'LN', institutionId: 'RABO_NL', created: new Date(Date.now() - 5 * 86_400_000).toISOString(), accountCount: 1, stale: false, ownerSub: 'sub-bob' },
];
// the endpoint returns THIS environment's consents + a count of foreign
// ones on the shared GoCardless account
const requisitionList = (requisitions: typeof REQUISITIONS, foreignCount = 2) => ({ requisitions, foreignCount });
const QUOTA = [
  { provider: 'gocardless', scope: 'accounts:transactions', limit: 4, remaining: 1, resetAtUtc: '2026-07-17T06:00:00Z', capturedAtUtc: '2026-07-16T06:00:00Z' },
];
const HEALTH = { status: 'ok', build: '640', capabilities: { gocardless: true, fcm: true, push: false } };

type Handler = (init?: RequestInit) => { status?: number; body?: unknown };

function scriptFetch(routes: Record<string, Handler>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const key = `${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`;
      calls.push(key);
      const out = routes[key]?.(init) ?? { status: 404 };
      return new Response(JSON.stringify(out.body ?? {}), {
        status: out.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

const CATALOG = {
  version: 2,
  categories: [
    { id: 'groceries', names: { en: 'Food shops', nl: 'Eten', tr: 'Gida' }, icon: 'cart' },
  ],
  keywords: [{ catId: 'hobby', keywords: ['padel'] }],
};

const HAPPY_ROUTES = (): Record<string, Handler> => ({
  'GET /catalog': () => ({ body: CATALOG }),
  'GET /admin/ping': () => ({}),
  'GET /admin/users': () => ({ body: USERS }),
  'GET /admin/gocardless/requisitions': () => ({ body: requisitionList(REQUISITIONS) }),
  'GET /admin/quota': () => ({ body: QUOTA }),
  'GET /health': () => ({ body: HEALTH }),
});

function renderAdmin() {
  localStorage.setItem('munni_admin_sub', 'sub-alice');
  render(<AdminApp config={CONFIG} getToken={null} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdminApp (test-auth mode)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear(); // the persisted screen must not leak between tests
  });

  it('a sub that is not on the admin list sees the denied note and no data', async () => {
    scriptFetch({ 'GET /admin/ping': () => ({ status: 403 }) });
    render(<AdminApp config={CONFIG} getToken={null} />);
    fireEvent.change(screen.getByTestId('admin-sub'), { target: { value: 'nobody' } });
    await waitFor(() => expect(screen.getByText(/not on the admin list/)).toBeTruthy());
    expect(screen.queryByTestId('overview-tiles')).toBeNull();
    expect(screen.queryByText(/did not answer/)).toBeNull();
  });

  it('an unanswered ping (network/CORS/5xx) shows the reachability note, NOT the admin-list one', async () => {
    scriptFetch({ 'GET /admin/ping': () => ({ status: 500 }) });
    render(<AdminApp config={CONFIG} getToken={null} />);
    fireEvent.change(screen.getByTestId('admin-sub'), { target: { value: 'anybody' } });
    await screen.findByText(/did not answer/);
    expect(screen.queryByText(/not on the admin list/)).toBeNull();
    expect(screen.queryByTestId('overview-tiles')).toBeNull();
  });

  it('overview shows tiles, the quota table with reset time, and capability chips', async () => {
    scriptFetch(HAPPY_ROUTES());
    renderAdmin();
    const tiles = await screen.findByTestId('overview-tiles');
    expect(tiles.textContent).toContain('Users');
    expect(tiles.textContent).toContain('3'); // 3 users
    expect(tiles.textContent).toContain('6'); // 2+1+3 space memberships
    expect(tiles.textContent).toContain('Linked banks');
    expect(tiles.textContent).toContain('Expiring ≤14d');

    const quota = screen.getByTestId('overview-quota');
    expect(quota.textContent).toContain('accounts:transactions');
    expect(quota.textContent).toContain('1 / 4');

    const caps = screen.getByTestId('overview-capabilities');
    expect(caps.textContent).toContain('build 640');
    expect(caps.textContent).toContain('fcm');
  });

  it('users screen filters by search and shows admin badges', async () => {
    scriptFetch(HAPPY_ROUTES());
    renderAdmin();
    fireEvent.click(await screen.findByTestId('nav-users'));

    const table = await screen.findByTestId('admin-users');
    expect(table.textContent).toContain('Alice');
    expect(table.textContent).toContain('bootstrap admin');
    expect(table.textContent).toContain('sub-bob'); // nameless users fall back to sub

    fireEvent.change(screen.getByTestId('users-search'), { target: { value: 'carol' } });
    expect(screen.getByTestId('admin-users').textContent).not.toContain('Alice');
    expect(screen.getByTestId('admin-users').textContent).toContain('Carol');
  });

  it('diagnose shows the sync chain; failures show a message; the screen survives a reload', async () => {
    scriptFetch({
      ...HAPPY_ROUTES(),
      'GET /admin/users/sub-bob/diagnosis': () => ({
        body: {
          userId: 'u2',
          memberSpaces: ['space-main'],
          ownedFeeds: [{ feedSpaceId: 'feed12345678', maxSeq: 42 }],
          attachments: [],
          gcLinks: [{ gcAccountId: 'gc-1', spaceId: 'space-dead-1', accountEntityId: 'a1', iban: 'NL69INGB0123456789', provider: 'gocardless', lastFetchAt: null, requisitionId: 'req-abcd1234' }],
        },
      }),
      'GET /admin/users/sub-carol/diagnosis': () => ({ status: 500 }),
    });
    renderAdmin();
    fireEvent.click(await screen.findByTestId('nav-users'));
    await screen.findByTestId('admin-users');

    fireEvent.click(screen.getByTestId('diagnose-sub-bob'));
    const panel = await screen.findByTestId('user-diagnosis');
    await waitFor(() => expect(panel.textContent).toContain('space-main'));
    expect(panel.textContent).toContain('ops 42');
    expect(panel.textContent).toContain('NONE — feeds never attached');
    expect(panel.textContent).toContain('fetched never');
    expect(panel.textContent).toContain('consent req-abcd'); // names the consent carrying the account

    // a dead call must not spin forever — it says what went wrong
    fireEvent.click(screen.getByTestId('diagnose-sub-carol'));
    await waitFor(() => expect(screen.getByTestId('user-diagnosis').textContent).toContain('HTTP 500'));

    // the active screen survives the page reload a Logto re-auth causes
    expect(sessionStorage.getItem('munni_admin_screen')).toBe('users');
    cleanup();
    renderAdmin();
    await screen.findByTestId('admin-users');
  });

  it('promote and demote call the grants API; bootstrap admins have no demote button', async () => {
    const calls = scriptFetch({
      ...HAPPY_ROUTES(),
      'POST /admin/admins/sub-bob': () => ({}),
      'DELETE /admin/admins/sub-carol': () => ({}),
    });
    renderAdmin();
    fireEvent.click(await screen.findByTestId('nav-users'));
    await screen.findByTestId('admin-users');

    expect(screen.queryByTestId('demote-sub-alice')).toBeNull(); // bootstrap: untouchable
    fireEvent.click(screen.getByTestId('promote-sub-bob'));
    await waitFor(() => expect(calls).toContain('POST /admin/admins/sub-bob'));
    fireEvent.click(screen.getByTestId('demote-sub-carol'));
    await waitFor(() => expect(calls).toContain('DELETE /admin/admins/sub-carol'));
  });

  it('a failed action surfaces the server error', async () => {
    scriptFetch({
      ...HAPPY_ROUTES(),
      'DELETE /admin/admins/sub-carol': () => ({ status: 400, body: { error: 'cannot demote yourself' } }),
    });
    renderAdmin();
    fireEvent.click(await screen.findByTestId('nav-users'));
    await screen.findByTestId('admin-users');
    fireEvent.click(screen.getByTestId('demote-sub-carol'));
    await waitFor(() => expect(screen.getByTestId('admin-error').textContent).toContain('cannot demote yourself'));
  });

  it('connections: expiring filter narrows the list; delete removes selected and reloads', async () => {
    let requisitions = [...REQUISITIONS];
    const calls = scriptFetch({
      ...HAPPY_ROUTES(),
      'GET /admin/gocardless/requisitions': () => ({ body: requisitionList(requisitions) }),
      'DELETE /admin/gocardless/requisitions/req-stale-0002': () => {
        requisitions = requisitions.filter((r) => r.requisitionId !== 'req-stale-0002');
        return {};
      },
    });
    renderAdmin();
    fireEvent.click(await screen.findByTestId('nav-connections'));
    const table = await screen.findByTestId('admin-requisitions');
    expect(table.textContent).toContain('ASN_NL');
    expect(table.textContent).toContain('expiring'); // the 80-day-old linked one
    expect(table.textContent).toContain('stale');

    // expiring-only filter narrows to the ING requisition
    fireEvent.click(screen.getByTestId('connections-expiring-filter'));
    expect(screen.getByTestId('admin-requisitions').textContent).not.toContain('RABO_NL');
    expect(screen.getByTestId('admin-requisitions').textContent).toContain('ING_NL');
    fireEvent.click(screen.getByTestId('connections-expiring-filter'));

    // select + bulk delete
    expect(screen.queryByText(/Delete selected/)).toBeNull();
    const staleRow = screen.getAllByRole('checkbox').find((box) => box.closest('tr')?.textContent?.includes('ASN_NL'))!;
    fireEvent.click(staleRow);
    fireEvent.click(screen.getByText('Delete selected (1)'));
    await waitFor(() => expect(screen.getByTestId('admin-requisitions').textContent).not.toContain('ASN_NL'));
    expect(calls).toContain('DELETE /admin/gocardless/requisitions/req-stale-0002');
    expect(screen.queryByText(/Delete selected/)).toBeNull(); // selection cleared
  });

  it('the bank-provider picker is gone from Overview (#175: the end user picks at connect)', async () => {
    const calls = scriptFetch(HAPPY_ROUTES());
    renderAdmin();
    await screen.findByTestId('overview-tiles');
    expect(screen.queryByTestId('admin-bank-provider')).toBeNull();
    expect(screen.queryByText(/Bank-data provider/)).toBeNull();
    expect(calls.some((c) => c.includes('/admin/bank-provider'))).toBe(false);
  });

  it('typing a sub persists it and sends it as X-User-Sub', async () => {
    const seenHeaders: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/admin/')) seenHeaders.push(new Headers(init?.headers).get('X-User-Sub'));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    render(<AdminApp config={CONFIG} getToken={null} />);
    fireEvent.change(screen.getByTestId('admin-sub'), { target: { value: 'sub-admin' } });
    await waitFor(() => expect(seenHeaders.length).toBeGreaterThan(0));
    expect(seenHeaders.every((h) => h === 'sub-admin')).toBe(true);
    expect(localStorage.getItem('munni_admin_sub')).toBe('sub-admin');
  });
});

describe('AdminApp (OIDC token mode)', () => {
  beforeEach(() => sessionStorage.clear()); // persisted screen must not leak in

  it('uses the bearer token and hides the sub box', async () => {
    const seenAuth: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/admin/')) seenAuth.push(new Headers(init?.headers).get('Authorization'));
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    render(<AdminApp config={CONFIG} getToken={async () => 'tok-abc'} />);
    expect(screen.queryByTestId('admin-sub')).toBeNull();
    await waitFor(() => expect(seenAuth.length).toBeGreaterThan(0));
    expect(seenAuth.every((h) => h === 'Bearer tok-abc')).toBe(true);
  });

  it('catalog: shows the published document and retires with a typed-id gate', async () => {
    scriptFetch(HAPPY_ROUTES());
    renderAdmin();
    fireEvent.click(await screen.findByTestId('nav-catalog'));
    // the published overlay renders
    await screen.findByTestId('catalog-cat-groceries');
    expect(screen.getByTestId('catalog-categories').textContent).toContain('Food shops');

    // retiring demands the exact id before the button arms
    fireEvent.click(screen.getByTestId('catalog-delete-groceries'));
    const confirmBtn = screen.getByTestId('catalog-delete-confirm') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('catalog-delete-typed'), { target: { value: 'grocery' } });
    expect((screen.getByTestId('catalog-delete-confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('catalog-delete-typed'), { target: { value: 'groceries' } });
    fireEvent.click(screen.getByTestId('catalog-delete-confirm'));
    // tombstoned: struck through with a restore action
    expect(screen.getByTestId('catalog-restore-groceries')).toBeTruthy();
  });

  it('catalog tree: search filters, bundled rows retire via synthetic tombstones, restore removes them again', async () => {
    scriptFetch(HAPPY_ROUTES());
    renderAdmin();
    fireEvent.click(await screen.findByTestId('nav-catalog'));
    await screen.findByTestId('catalog-cat-groceries');

    // the merged tree shows bundled mains; search narrows it
    expect(screen.getByTestId('catalog-row-transport')).toBeTruthy();
    fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: 'transport' } });
    expect(screen.queryByTestId('catalog-row-housing')).toBeNull();
    expect(screen.getByTestId('catalog-row-transport')).toBeTruthy();
    fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: '' } });

    // a bundled-only category retires through a synthesized tombstone…
    fireEvent.click(screen.getByTestId('catalog-delete-transport'));
    fireEvent.change(screen.getByTestId('catalog-delete-typed'), { target: { value: 'transport' } });
    fireEvent.click(screen.getByTestId('catalog-delete-confirm'));
    expect(screen.getByTestId('catalog-cat-transport').className).toContain('retired');

    // …and restoring it removes the synthetic entry (back to bundled-only)
    fireEvent.click(screen.getByTestId('catalog-restore-transport'));
    expect(screen.queryByTestId('catalog-cat-transport')).toBeNull();
    expect(screen.getByTestId('catalog-row-transport')).toBeTruthy();

    // "+ sub" pre-fills the editor with the parent; rename pre-fills the id
    fireEvent.click(screen.getByTestId('catalog-addsub-transport'));
    expect((screen.getByTestId('catalog-new-parent') as HTMLInputElement).value).toBe('transport');
    fireEvent.click(screen.getByTestId('catalog-editor-cancel'));
    fireEvent.click(screen.getByTestId('catalog-prefill-transport'));
    expect((screen.getByTestId('catalog-new-id') as HTMLInputElement).value).toBe('transport');
  });

  it('catalog: adding entries and publishing PUTs the document', async () => {
    let published: unknown = null;
    scriptFetch({
      ...HAPPY_ROUTES(),
      'PUT /admin/catalog': (init) => {
        published = JSON.parse(String(init?.body));
        return { body: { version: 3 } };
      },
    });
    renderAdmin();
    fireEvent.click(await screen.findByTestId('nav-catalog'));
    await screen.findByTestId('catalog-cat-groceries');

    // a new category entry (all three languages required) — the editor
    // panel opens from the tree toolbar (catalog redesign)
    fireEvent.click(screen.getByTestId('catalog-add-main'));
    fireEvent.change(screen.getByTestId('catalog-new-id'), { target: { value: 'padelClub' } });
    fireEvent.change(screen.getByTestId('catalog-new-parent'), { target: { value: 'hobby' } });
    fireEvent.change(screen.getByTestId('catalog-new-en'), { target: { value: 'Padel' } });
    fireEvent.change(screen.getByTestId('catalog-new-nl'), { target: { value: 'Padel' } });
    fireEvent.change(screen.getByTestId('catalog-new-tr'), { target: { value: 'Padel' } });
    fireEvent.change(screen.getByTestId('catalog-new-icon'), { target: { value: 'tennis' } });
    fireEvent.click(screen.getByTestId('catalog-add-category'));
    await screen.findByTestId('catalog-cat-padelClub');

    // a keyword rule
    fireEvent.change(screen.getByTestId('catalog-kw-cat'), { target: { value: 'padelClub' } });
    fireEvent.change(screen.getByTestId('catalog-kw-words'), { target: { value: 'Padelbaan, PADEL CLUB' } });
    fireEvent.click(screen.getByTestId('catalog-add-keyword'));

    // store merchant patterns (receipts v3 R9) publish alongside
    fireEvent.change(screen.getByTestId('catalog-store-ah'), { target: { value: 'albert heijn, AH to go' } });

    fireEvent.click(screen.getByTestId('catalog-publish'));
    await waitFor(() => expect(published).not.toBeNull());
    const doc = published as {
      categories: { id: string }[];
      keywords: { catId: string; keywords: string[] }[];
      stores: { id: string; patterns: string[] }[];
    };
    expect(doc.categories.map((c) => c.id)).toEqual(['groceries', 'padelClub']);
    expect(doc.keywords.at(-1)).toEqual({ catId: 'padelClub', keywords: ['padelbaan', 'padel club'] });
    expect(doc.stores).toEqual([{ id: 'ah', patterns: ['albert heijn', 'AH to go'] }]);
  });
});
