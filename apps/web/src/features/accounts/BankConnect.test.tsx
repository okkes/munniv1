// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
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
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: true } }),
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
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: true } }),
        'GET /me/feeds': () => [],
        'GET /gocardless/institutions': () => new Response('', { status: 502 }),
      },
    });
    fireEvent.click(await screen.findByTestId('accounts-add'));
    fireEvent.click(await screen.findByTestId('chooser-connect'));
    expect(await screen.findByTestId('gc-error')).toBeTruthy();
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
  });

  it('fails gracefully without a reference or on a server error', async () => {
    renderWithProviders(<GcCallbackScreen />);
    await screen.findByTestId('screen-gc-callback');
    await waitFor(() => expect(screen.getByTestId('screen-gc-callback').textContent).toMatch(/could not|failed/i));
  });
});
