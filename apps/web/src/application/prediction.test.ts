// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { predictFromMemory } from '@/domain/merchantMemory';
import { buildSpaceMerchantMemory } from './prediction';

let counter = 0;
let db: MunniDB;
let repo: Repo;

describe('buildSpaceMerchantMemory (user-scoped cross-space learning)', () => {
  beforeEach(async () => {
    db = new MunniDB(`prediction_test_${++counter}`);
    repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('space', 'sx', 'sx', { name: 'Personal X', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await repo.upsert('space', 'sy', 'sy', { name: 'Shared Y', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
  });

  it('a categorization in space X teaches the suggestion in space Y (user request)', async () => {
    await repo.upsert('transaction', 'sx', 'txx', {
      accountId: 'a1',
      date: '2026-07-01',
      amountCents: -2500,
      currency: 'EUR',
      merchant: 'Albert Heijn Delft',
      catId: 'movie', // deliberate odd builtin choice — must carry over
      txType: 'expense',
      needsReview: 0,
    });

    const memory = await buildSpaceMerchantMemory(new DexieBackend(db), 'sy');
    // branch city differs: normalization still finds the same merchant
    const hit = predictFromMemory(memory, 'Albert Heijn Amsterdam', -1900);
    expect(hit?.catId).toBe('movie');
  });

  it("another space's CUSTOM category never crosses over", async () => {
    await repo.upsert('transaction', 'sx', 'txc', {
      accountId: 'a1',
      date: '2026-07-01',
      amountCents: -2500,
      currency: 'EUR',
      merchant: 'Padel Baan',
      catId: 'custom_padel_x', // not a catalog id — invisible to sy
      txType: 'expense',
      needsReview: 0,
    });

    const memory = await buildSpaceMerchantMemory(new DexieBackend(db), 'sy');
    expect(predictFromMemory(memory, 'Padel Baan', -2500)).toBeNull();
    // …while the owning space keeps its own history
    const own = await buildSpaceMerchantMemory(new DexieBackend(db), 'sx');
    expect(predictFromMemory(own, 'Padel Baan', -2500)?.catId).toBe('custom_padel_x');
  });
});
