// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlApp } from './ControlApp';
import type { ControlConfig } from './config';

const CONFIG: ControlConfig = { apiUrl: 'http://api.test', logtoEndpoint: '', logtoAppId: '', logtoResource: '' };

// every consent on the SHARED GoCardless account, from two environments
// plus one whose redirect carried no usable origin
const CONSENTS = [
  { requisitionId: 'req-prod-00001', status: 'LN', institutionId: 'ING_NL', created: '2026-08-01T00:00:00Z', accountCount: 2, environmentOrigin: 'https://munni.example.com', ownedHere: false },
  { requisitionId: 'req-here-00002', status: 'LN', institutionId: 'RABO_NL', created: '2026-08-10T00:00:00Z', accountCount: 1, environmentOrigin: 'http://localhost:8480', ownedHere: true },
  { requisitionId: 'req-lost-00003', status: 'CR', institutionId: 'ASN_NL', created: null, accountCount: 0, environmentOrigin: null, ownedHere: false },
];
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

const HAPPY_ROUTES = (): Record<string, Handler> => ({
  'GET /control/ping': () => ({}),
  'GET /control/consents': () => ({ body: CONSENTS }),
  'GET /control/quota': () => ({ body: QUOTA }),
  'GET /health': () => ({ body: HEALTH }),
});

function renderControl() {
  localStorage.setItem('munni_control_sub', 'sub-alice');
  render(<ControlApp config={CONFIG} getToken={null} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ControlApp (test-auth mode)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear(); // the persisted screen must not leak between tests
  });

  it('a sub that is not on the admin list sees the denied note and no data', async () => {
    scriptFetch({ 'GET /control/ping': () => ({ status: 403 }) });
    render(<ControlApp config={CONFIG} getToken={null} />);
    fireEvent.change(screen.getByTestId('control-sub'), { target: { value: 'nobody' } });
    await screen.findByText(/not on the admin list/);
    expect(screen.queryByTestId('control-tiles')).toBeNull();
    expect(screen.queryByText(/did not answer/)).toBeNull();
  });

  it('an unanswered ping (network/CORS/5xx) shows the reachability note, NOT the admin-list one', async () => {
    scriptFetch({ 'GET /control/ping': () => ({ status: 500 }) });
    render(<ControlApp config={CONFIG} getToken={null} />);
    fireEvent.change(screen.getByTestId('control-sub'), { target: { value: 'anybody' } });
    await screen.findByText(/did not answer/);
    expect(screen.queryByText(/not on the admin list/)).toBeNull();
    expect(screen.queryByTestId('control-tiles')).toBeNull();
  });

  it('shows the cockpit nav and overview: totals per environment plus env health', async () => {
    const calls = scriptFetch(HAPPY_ROUTES());
    renderControl();
    await screen.findByTestId('nav-quota');
    expect(screen.getByTestId('nav-overview')).toBeTruthy();
    expect(screen.getByTestId('nav-connections')).toBeTruthy();
    // the per-environment portal's screens do not exist here
    expect(screen.queryByTestId('nav-users')).toBeNull();
    expect(screen.queryByTestId('nav-catalog')).toBeNull();

    const tiles = await screen.findByTestId('control-tiles');
    expect(tiles.textContent).toContain('3Consents');
    expect(tiles.textContent).toContain('3Linked accounts'); // 2+1+0
    expect(tiles.textContent).toContain('2Environments'); // unattributed is not an environment
    const origins = screen.getByTestId('control-origins');
    expect(origins.textContent).toContain('https://munni.example.com');
    expect(origins.textContent).toContain('unattributed');
    expect(screen.getByTestId('control-health').textContent).toContain('build 640');

    // the cockpit talks to /control/* only — never the per-env admin surface
    expect(calls.some((c) => c.includes('/admin/'))).toBe(false);
  });

  it('consents group by environment origin, mark this environment, and offer no delete', async () => {
    scriptFetch(HAPPY_ROUTES());
    renderControl();
    fireEvent.click(await screen.findByTestId('nav-connections'));
    await screen.findByText('Bank connections — all environments');

    const prodGroup = await screen.findByTestId('control-group-https://munni.example.com');
    expect(prodGroup.textContent).toContain('ING_NL');
    expect(prodGroup.textContent).not.toContain('this environment');

    const hereGroup = screen.getByTestId('control-group-http://localhost:8480');
    expect(hereGroup.textContent).toContain('RABO_NL');
    expect(hereGroup.textContent).toContain('this environment');

    // no usable redirect origin -> the unattributed bucket
    const lostGroup = screen.getByTestId('control-group-unattributed');
    expect(lostGroup.textContent).toContain('ASN_NL');

    // read-only: no selection checkboxes, no delete anywhere
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText(/Delete/)).toBeNull();

    // the active screen survives the page reload a Logto re-auth causes
    expect(sessionStorage.getItem('munni_control_screen')).toBe('connections');
    cleanup();
    renderControl();
    await screen.findByText('Bank connections — all environments');
  });

  it('the quota screen serves the shared-account snapshots', async () => {
    scriptFetch(HAPPY_ROUTES());
    renderControl();
    fireEvent.click(await screen.findByTestId('nav-quota'));
    const table = await screen.findByTestId('control-quota');
    expect(table.textContent).toContain('accounts:transactions');
    expect(table.textContent).toContain('1 / 4');
  });

  it('empty shared account: placeholder rows instead of blank screens', async () => {
    scriptFetch({
      ...HAPPY_ROUTES(),
      'GET /control/consents': () => ({ body: [] }),
      'GET /control/quota': () => ({ body: [] }),
    });
    renderControl();
    const tiles = await screen.findByTestId('control-tiles');
    expect(tiles.textContent).toContain('0Consents');
    fireEvent.click(screen.getByTestId('nav-connections'));
    await screen.findByText(/No consents on the shared account yet/);
    fireEvent.click(screen.getByTestId('nav-quota'));
    expect((await screen.findByTestId('control-quota')).textContent).toContain('No snapshots yet');
  });

  it('typing a sub persists it and sends it as X-User-Sub', async () => {
    const seenHeaders: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/control/')) seenHeaders.push(new Headers(init?.headers).get('X-User-Sub'));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    render(<ControlApp config={CONFIG} getToken={null} />);
    fireEvent.change(screen.getByTestId('control-sub'), { target: { value: 'sub-admin' } });
    await waitFor(() => expect(seenHeaders.length).toBeGreaterThan(0));
    expect(seenHeaders.every((h) => h === 'sub-admin')).toBe(true);
    expect(localStorage.getItem('munni_control_sub')).toBe('sub-admin');
  });
});

describe('ControlApp (OIDC token mode)', () => {
  beforeEach(() => sessionStorage.clear()); // persisted screen must not leak in

  it('uses the bearer token and hides the sub box', async () => {
    const seenAuth: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/control/')) seenAuth.push(new Headers(init?.headers).get('Authorization'));
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    render(<ControlApp config={CONFIG} getToken={async () => 'tok-abc'} />);
    expect(screen.queryByTestId('control-sub')).toBeNull();
    await waitFor(() => expect(seenAuth.length).toBeGreaterThan(0));
    expect(seenAuth.every((h) => h === 'Bearer tok-abc')).toBe(true);
  });
});
