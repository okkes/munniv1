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

  it('a categorization in space X teaches the FALLBACK layer of space Y (#161: own space first)', async () => {
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
    // branch city differs: normalization still finds the same merchant —
    // in the OTHERS layer, since sy itself never saw the merchant
    expect(predictFromMemory(memory.own, 'Albert Heijn Amsterdam', -1900)).toBeNull();
    const hit = predictFromMemory(memory.others, 'Albert Heijn Amsterdam', -1900);
    expect(hit?.catId).toBe('movie');
  });

  it("#161: the own space's history OUTRANKS other spaces for the same merchant", async () => {
    await repo.upsert('transaction', 'sx', 'txg', {
      accountId: 'a1', date: '2026-07-01', amountCents: -2500, currency: 'EUR',
      merchant: 'Albert Heijn', catId: 'movie', txType: 'expense', needsReview: 0,
    });
    await repo.upsert('transaction', 'sy', 'tyg', {
      accountId: 'a2', date: '2026-06-01', amountCents: -1800, currency: 'EUR',
      merchant: 'Albert Heijn', catId: 'groceries', txType: 'expense', needsReview: 0,
    });
    const memory = await buildSpaceMerchantMemory(new DexieBackend(db), 'sy');
    // sy's own single groceries answer wins over sx's newer movie one
    expect(predictFromMemory(memory.own, 'Albert Heijn', -2000)?.catId).toBe('groceries');
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
    expect(predictFromMemory(memory.own, 'Padel Baan', -2500)).toBeNull();
    expect(predictFromMemory(memory.others, 'Padel Baan', -2500)).toBeNull();
    // …while the owning space keeps its own history
    const own = await buildSpaceMerchantMemory(new DexieBackend(db), 'sx');
    expect(predictFromMemory(own.own, 'Padel Baan', -2500)?.catId).toBe('custom_padel_x');
  });
});
