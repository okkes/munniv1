// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { CLIENT_PROTOCOL } from '@/lib/protocol';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_TEST_DB, renderAppAsUser, renderWithProviders } from '@/test/harness';
import { GcCallbackScreen } from './BankConnect';

// deterministic: no Logto in these tests, whatever the dev env provides
vi.mock('@/app/config', () => ({
  config: { apiUrl: 'http://localhost:8180', logto: { endpoint: '', appId: '', resource: '' }, glitchtipDsn: '', channel: '' },
  logtoConfigured: false,
  publicOrigin: () => window.location.origin,
}));

const ING = { id: 'ING_NL', name: 'ING', bic: 'INGBNL2A' };
const ASN = { id: 'ASN_NL', name: 'ASN Bank', bic: 'ASNBNL21' };

describe('BankConnectSheet (user identity, GoCardless enabled)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  it('lists institutions, filters by search, and starts a requisition', async () => {
    const requisitions: unknown[] = [];
    // window.location.href assignment would leave happy-dom — capture it
    const hrefSpy = vi.fn();
    const { fetchMock } = renderAppAsUser('/accounts', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: true }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /me/feeds': () => [],
        'GET /gocardless/institutions': () => [ING, ASN],
        'POST /gocardless/requisitions': (body) => {
          requisitions.push(body);
          return { reference: 'ref-123', link: 'https://bank.example/authorize' };
        },
      },
    });
    const location = window.location as unknown as Record<string, unknown>;
    Object.defineProperty(location, 'href', { configurable: true, set: hrefSpy, get: () => 'http://localhost/' });

    fireEvent.click(await screen.findByTestId('accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-connect'));

    // both institutions load; the search narrows them
    await screen.findByTestId('gc-bank-ING_NL');
    fireEvent.change(screen.getByTestId('gc-bank-search'), { target: { value: 'asn' } });
    expect(screen.queryByTestId('gc-bank-ING_NL')).toBeNull();

    fireEvent.click(screen.getByTestId('gc-bank-ASN_NL'));
    await waitFor(() => expect(hrefSpy).toHaveBeenCalledWith('https://bank.example/authorize'));
    expect(sessionStorage.getItem('munni_gc_ref')).toBe('ref-123');
    expect(requisitions[0]).toMatchObject({ institutionId: 'ASN_NL', spaceId: 's-user' });
    expect(fetchMock).toHaveBeenCalled();
  }, 15_000);

  it('shows the error strip when the institution list cannot load', async () => {
    renderAppAsUser('/accounts', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: true }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /me/feeds': () => [],
        'GET /gocardless/institutions': () => new Response('', { status: 502 }),
      },
    });
    fireEvent.click(await screen.findByTestId('accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-connect'));
    expect(await screen.findByTestId('gc-error')).toBeTruthy();
  }, 15_000);

  it('#175: two providers ask WHO connects — Enable Banking wears its portal tails, the pick rides the requisition', async () => {
    const requisitions: unknown[] = [];
    const institutionCalls: (string | null)[] = [];
    const hrefSpy = vi.fn();
    renderAppAsUser('/accounts', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: true }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /me/feeds': () => [],
        'GET /gocardless/providers': () => ({
          providers: [
            { id: 'gocardless' },
            { id: 'enablebanking', knownAccounts: ['8507', '9507'] },
          ],
        }),
        'GET /gocardless/institutions': (_body, url) => {
          institutionCalls.push(url.searchParams.get('provider'));
          return url.searchParams.get('provider') === 'enablebanking' ? [ASN] : [ING];
        },
        'POST /gocardless/requisitions': (body) => {
          requisitions.push(body);
          return { reference: 'ref-eb', link: 'https://bank.example/authorize' };
        },
      },
    });
    const location = window.location as unknown as Record<string, unknown>;
    Object.defineProperty(location, 'href', { configurable: true, set: hrefSpy, get: () => 'http://localhost/' });

    fireEvent.click(await screen.findByTestId('accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-connect'));

    // the choice leads — no bank list yet; EB explains itself and shows
    // the masked accounts already known to work through it
    await screen.findByTestId('gc-provider-choice');
    expect(screen.queryByTestId('gc-bank-search')).toBeNull();
    expect(screen.getByTestId('gc-provider-enablebanking').textContent).toContain('Enable Banking');
    expect(screen.getByTestId('gc-provider-eb-known').textContent).toContain('8507');

    fireEvent.click(screen.getByTestId('gc-provider-enablebanking'));
    await screen.findByTestId('gc-bank-ASN_NL');
    expect(institutionCalls).toEqual(['enablebanking']);

    // back re-opens the choice; the GoCardless lane lists ITS banks
    fireEvent.click(screen.getByTestId('gc-provider-back'));
    await screen.findByTestId('gc-provider-choice');
    fireEvent.click(screen.getByTestId('gc-provider-gocardless'));
    await screen.findByTestId('gc-bank-ING_NL');

    fireEvent.click(screen.getByTestId('gc-bank-ING_NL'));
    await waitFor(() => expect(hrefSpy).toHaveBeenCalledWith('https://bank.example/authorize'));
    expect(requisitions[0]).toMatchObject({ institutionId: 'ING_NL', provider: 'gocardless' });
  }, 15_000);

  it('#175: a single configured provider skips the choice entirely', async () => {
    renderAppAsUser('/accounts', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: true }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /me/feeds': () => [],
        'GET /gocardless/providers': () => ({ providers: [{ id: 'gocardless' }] }),
        'GET /gocardless/institutions': () => [ING],
      },
    });
    fireEvent.click(await screen.findByTestId('accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-connect'));
    await screen.findByTestId('gc-bank-ING_NL');
    expect(screen.queryByTestId('gc-provider-choice')).toBeNull();
    expect(screen.queryByTestId('gc-provider-back')).toBeNull();
  }, 15_000);

  it('#308: a SHARED space goes straight to the bank list — the connect-time warning is gone (it lives on the attach step now)', async () => {
    // the space row is shared BEFORE the app boots, so the chooser sees
    // the kind at click time — no race with the bootstrap pull
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('space', 's-user', 's-user', {
      name: 'Familie',
      kind: 'shared',
      currency: 'EUR',
      periodType: 'month',
      periodDay: 1,
    });
    db.close();

    renderAppAsUser('/accounts', {
      spaces: [{ id: 's-user', name: 'Familie', kind: 'shared' }],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: true }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /me/feeds': () => [],
        'GET /gocardless/institutions': () => [ING],
      },
    });
    fireEvent.click(await screen.findByTestId('accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-connect'));
    // the flow proceeds directly — no "I understand" gate in between
    await screen.findByTestId('gc-bank-ING_NL', {}, { timeout: 10_000 });
    expect(screen.queryByTestId('chooser-share-warn')).toBeNull();
  }, 15_000);
});

describe('GcCallbackScreen (test auth — no Logto)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'user', sub: 'test-user', testAuth: true }));
  });

  it('completes the requisition from the stored reference', async () => {
    sessionStorage.setItem('munni_gc_ref', 'ref-9');
    const completed: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        completed.push(String(input));
        return new Response('{}', { status: 200 });
      }),
    );
    renderWithProviders(<GcCallbackScreen />);
    await screen.findByText('Bank connected');
    expect(completed[0]).toContain('/gocardless/requisitions/ref-9/complete');
    expect(sessionStorage.getItem('munni_gc_ref')).toBeNull(); // consumed
    // #319 (user): ONE next-step line under the headline — the stacked
    // "close this tab" paragraph is gone
    expect(screen.getByTestId('gc-unattached-note').textContent).toContain('accounts screen');
    expect(screen.queryByText(/close this tab/i)).toBeNull();
  });

  it('fails gracefully without a reference or on a server error', async () => {
    renderWithProviders(<GcCallbackScreen />);
    await screen.findByTestId('screen-gc-callback');
    await waitFor(() => expect(screen.getByTestId('screen-gc-callback').textContent).toMatch(/could not|failed/i));
  });
});
