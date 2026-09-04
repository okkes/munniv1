import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiSyncBackend, SyncHttpError } from './backend';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiSyncBackend', () => {
  afterEach(() => vi.restoreAllMocks());

  const backend = (auth: { bearer?: string; testSub?: string }) =>
    new ApiSyncBackend({ baseUrl: 'http://api', getAuth: async () => auth });

  it('push sends ops with bearer auth and returns the result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ lastSeq: 7 }));
    const result = await backend({ bearer: 'tok-123' }).push('s1', 'dev1', []);
    expect(result).toEqual({ lastSeq: 7 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api/sync/s1/push');
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer tok-123');
    expect(init!.method).toBe('POST');
  });

  it('test-auth identities send the X-User-Sub header instead', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ops: [], latestSeq: 0 }));
    await backend({ testSub: 'alice' }).pull('s1', 5);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api/sync/s1/pull?since=5');
    const headers = new Headers(init!.headers);
    expect(headers.get('X-User-Sub')).toBe('alice');
    expect(headers.get('Authorization')).toBeNull();
  });

  it('non-2xx responses raise SyncHttpError with the status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, 403));
    await expect(backend({ testSub: 'x' }).pull('s1', 0)).rejects.toMatchObject(
      new SyncHttpError(403),
    );
    await expect(backend({ testSub: 'x' }).listSpaces()).rejects.toBeInstanceOf(SyncHttpError);
  });

  it('listSpaces returns the id array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(['a', 'b']));
    expect(await backend({ testSub: 'x' }).listSpaces()).toEqual(['a', 'b']);
  });
});
