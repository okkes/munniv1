import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { DexieBackend } from '@/db/backend';
import { Repo } from '@/db/repo';
import { accountLinkId } from '@/domain/feedIds';
import { reconcileSpaceLinks } from './accountAttach';
import { fetchSpaceLinks } from '@/features/accounts/feedGateway';

vi.mock('@/features/accounts/feedGateway', () => ({
  fetchSpaceLinks: vi.fn(async () => []),
  attachAccount: vi.fn(),
  detachAccount: vi.fn(),
}));

const SPACE = 'sp1';

describe('reconcileSpaceLinks', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
    vi.mocked(fetchSpaceLinks).mockReset();
    vi.mocked(fetchSpaceLinks).mockResolvedValue([]);
  });

  async function makeStore() {
    const store = new DexieBackend(new MunniDB(`munni_rsl_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('rsl'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month', historyStartDate: '2026-01-01' });
    return { store, repo };
  }

  it('mirrors server links no device ever wrote (the anonymous bank-connect completion)', async () => {
    const { store, repo } = await makeStore();
    vi.mocked(fetchSpaceLinks).mockResolvedValue([
      { id: 'srv1', feedSpaceId: 'feedA', accountId: 'accA' },
      { id: 'srv2', feedSpaceId: 'feedB', accountId: 'accB' },
    ]);

    expect(await reconcileSpaceLinks(store, repo, SPACE)).toBe(2);
    const mirrors = (await store.bySpace('accountLink', SPACE)).filter((l) => l.deleted === 0);
    expect(mirrors).toHaveLength(2);
    const a = mirrors.find((l) => l.feedSpaceId === 'feedA');
    expect(a?.accountId).toBe('accA');
    // the space's own history start seeds the mirror
    expect(a?.historyFrom).toBe('2026-01-01');
  });

  it('existing mirrors are left alone — the pass is idempotent', async () => {
    const { store, repo } = await makeStore();
    await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, 'feedA'), {
      feedSpaceId: 'feedA',
      accountId: 'accA',
      historyFrom: '2025-06-01',
      archived: 0,
    });
    vi.mocked(fetchSpaceLinks).mockResolvedValue([{ id: 'srv1', feedSpaceId: 'feedA', accountId: 'accA' }]);

    expect(await reconcileSpaceLinks(store, repo, SPACE)).toBe(0);
    const mirrors = (await store.bySpace('accountLink', SPACE)).filter((l) => l.deleted === 0);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0].historyFrom).toBe('2025-06-01'); // untouched
  });

  it('an empty server answer changes nothing', async () => {
    const { store, repo } = await makeStore();
    expect(await reconcileSpaceLinks(store, repo, SPACE)).toBe(0);
    expect((await store.bySpace('accountLink', SPACE)).filter((l) => l.deleted === 0)).toHaveLength(0);
  });
});
