import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { DexieBackend } from '@/db/backend';
import { Repo } from '@/db/repo';
import { adoptUserCategoriesOnShare } from '@/features/categories/categoryOps';
import { ensureSpaceShared, healSharedKind, stampJoinedSharedSpace } from './spaces';

vi.mock('@/features/categories/categoryOps', () => ({
  adoptUserCategoriesOnShare: vi.fn(async () => undefined),
}));

const SPACE = 'sp-277';
const spaceFields = (name: string) =>
  ({ name, kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 }) as const;

describe('application/spaces (#277 r2)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
    vi.mocked(adoptUserCategoriesOnShare).mockClear();
  });

  async function makeStore() {
    const store = new DexieBackend(new MunniDB(`munni_sp277_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('t277'), { trackOutbox: false });
    return { store, repo };
  }

  it('ensureSpaceShared flips personal → shared once, adopting categories BEFORE the flip', async () => {
    const { store, repo } = await makeStore();
    await repo.upsert('space', SPACE, SPACE, spaceFields('Fam'));

    expect(await ensureSpaceShared(store, repo, SPACE, 'Bob')).toBe(true);
    const row = await store.get('space', SPACE);
    expect(row?.kind).toBe('shared');
    expect(row?.createdByName).toBe('Bob');
    expect(adoptUserCategoriesOnShare).toHaveBeenCalledTimes(1);

    // idempotent — and an established creator is never overwritten
    expect(await ensureSpaceShared(store, repo, SPACE, 'Mallory')).toBe(false);
    expect((await store.get('space', SPACE))?.createdByName).toBe('Bob');
    expect(adoptUserCategoriesOnShare).toHaveBeenCalledTimes(1);
  });

  it('a row the store does not have is left alone', async () => {
    const { store, repo } = await makeStore();
    expect(await ensureSpaceShared(store, repo, 'ghost', 'Bob')).toBe(false);
  });

  it('healSharedKind flips only at 2+ members and backfills the owner as creator', async () => {
    const { store, repo } = await makeStore();
    await repo.upsert('space', SPACE, SPACE, spaceFields('Fam'));

    await healSharedKind(store, repo, SPACE, [{ userId: 'u1', displayName: 'Solo', role: 'owner' }]);
    expect((await store.get('space', SPACE))?.kind).toBe('personal');

    await healSharedKind(store, repo, SPACE, [
      { userId: 'u1', displayName: 'Owen', role: 'owner' },
      { userId: 'u2', displayName: 'Joiner', role: 'contributor' },
    ]);
    const row = await store.get('space', SPACE);
    expect(row?.kind).toBe('shared');
    expect(row?.createdByName).toBe('Owen');
  });

  it('stampJoinedSharedSpace retries the sync until the invited space arrives', async () => {
    const { store, repo } = await makeStore();
    let calls = 0;
    const sync = vi.fn(async () => {
      calls += 1;
      if (calls === 2) await repo.upsert('space', SPACE, SPACE, spaceFields('Fam'));
    });

    await stampJoinedSharedSpace(store, repo, sync, { spaceId: SPACE }, 'Inviter');
    expect(sync).toHaveBeenCalledTimes(2);
    const row = await store.get('space', SPACE);
    expect(row?.kind).toBe('shared');
    expect(row?.createdByName).toBe('Inviter');
  }, 15_000);

  it('the friend-accept target stamps only the NEW row wearing the request name', async () => {
    const { store, repo } = await makeStore();
    await repo.upsert('space', 'sp-personal', 'sp-personal', spaceFields('Personal'));
    const sync = vi.fn(async () => {
      await repo.upsert('space', 'sp-joined', 'sp-joined', spaceFields('Big Family'));
      await repo.upsert('space', 'sp-other', 'sp-other', spaceFields('Other'));
    });

    await stampJoinedSharedSpace(store, repo, sync, { except: new Set(['sp-personal']), name: 'Big Family' }, 'Cara');
    const joined = await store.get('space', 'sp-joined');
    expect(joined?.kind).toBe('shared');
    expect(joined?.createdByName).toBe('Cara');
    // the known personal space and the name-mismatched arrival stay put
    expect((await store.get('space', 'sp-personal'))?.kind).toBe('personal');
    expect((await store.get('space', 'sp-other'))?.kind).toBe('personal');
  });

  it('gives up quietly when nothing ever arrives', async () => {
    const { store, repo } = await makeStore();
    const sync = vi.fn(async () => undefined);
    await stampJoinedSharedSpace(store, repo, sync, { spaceId: 'never' }, null, 2);
    expect(sync).toHaveBeenCalledTimes(2);
  }, 15_000);
});
