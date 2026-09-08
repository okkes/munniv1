// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feedSpaceId, personalFeedSpaceId } from '@/domain/feedIds';
import { apiFetch } from '@/lib/api';
import { apiFeedGateway, attachAccount, detachAccount, fetchMyFeedIds, fetchSpaceLinks } from './feedGateway';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
const apiFetchMock = vi.mocked(apiFetch);

const respond = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('apiFeedGateway.register', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('keeps the deterministic feed id when the server accepts it', async () => {
    apiFetchMock.mockResolvedValueOnce(respond(200));
    const preferred = feedSpaceId('NL69INGB0123456789');
    expect(await apiFeedGateway('sub-a').register(preferred, 'NL69INGB0123456789')).toBe(preferred);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('409 (someone else owns the feed) falls back to the personal, sub-salted id', async () => {
    apiFetchMock.mockResolvedValueOnce(respond(409)).mockResolvedValueOnce(respond(200));
    const granted = await apiFeedGateway('sub-a').register(feedSpaceId('NL69INGB0123456789'), 'NL69INGB0123456789');
    expect(granted).toBe(personalFeedSpaceId('NL69INGB0123456789', 'sub-a'));
    const retryBody = JSON.parse(apiFetchMock.mock.calls[1][1]!.body as string);
    expect(retryBody.feedSpaceId).toBe(granted);
  });

  it('other failures throw — the import must not proceed on a broken registration', async () => {
    apiFetchMock.mockResolvedValueOnce(respond(500));
    await expect(apiFeedGateway('s').register('feed-x', 'IBAN')).rejects.toThrow('500');
    // 409 whose personal retry also fails throws too
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValueOnce(respond(409)).mockResolvedValueOnce(respond(400));
    await expect(apiFeedGateway('s').register('feed-x', 'IBAN')).rejects.toThrow('409');
  });

  it('attach posts the link and surfaces failure', async () => {
    apiFetchMock.mockResolvedValueOnce(respond(200));
    await apiFeedGateway('s').attach('space1', 'feed1', 'acct1');
    expect(apiFetchMock).toHaveBeenCalledWith('/spaces/space1/accounts', expect.objectContaining({ method: 'POST' }));
    apiFetchMock.mockResolvedValueOnce(respond(403));
    await expect(apiFeedGateway('s').attach('space1', 'feed1', 'acct1')).rejects.toThrow('403');
  });
});

describe('feed helpers', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('fetchMyFeedIds returns the owned set, empty on failure', async () => {
    apiFetchMock.mockResolvedValueOnce(respond(200, [{ feedSpaceId: 'f1' }, { feedSpaceId: 'f2' }]));
    expect([...(await fetchMyFeedIds())]).toEqual(['f1', 'f2']);
    apiFetchMock.mockResolvedValueOnce(respond(401));
    expect((await fetchMyFeedIds()).size).toBe(0);
  });

  it('attachAccount sends historyFrom only when set', async () => {
    apiFetchMock.mockResolvedValue(respond(200));
    await attachAccount('s1', 'f1', 'a1', '2026-01-01');
    expect(JSON.parse(apiFetchMock.mock.calls[0][1]!.body as string).historyFrom).toBe('2026-01-01');
    await attachAccount('s1', 'f1', 'a1');
    expect(JSON.parse(apiFetchMock.mock.calls[1][1]!.body as string).historyFrom).toBeUndefined();
    apiFetchMock.mockResolvedValueOnce(respond(403));
    await expect(attachAccount('s1', 'f1', 'a1')).rejects.toThrow('403');
  });

  it('detachAccount deletes the server link; fetchSpaceLinks lists them (empty on error)', async () => {
    apiFetchMock.mockResolvedValueOnce(respond(200));
    await detachAccount('s1', 'link9');
    expect(apiFetchMock).toHaveBeenCalledWith('/spaces/s1/accounts/link9', { method: 'DELETE' });
    apiFetchMock.mockResolvedValueOnce(respond(200, [{ id: 'l1', feedSpaceId: 'f1', accountId: 'a1' }]));
    expect(await fetchSpaceLinks('s1')).toHaveLength(1);
    apiFetchMock.mockResolvedValueOnce(respond(500));
    expect(await fetchSpaceLinks('s1')).toEqual([]);
  });
});
