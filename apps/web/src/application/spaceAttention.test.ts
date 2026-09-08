// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { localToday } from './recurring';
import { anyOtherSpaceNeedsAttention, spaceAttention } from './spaceAttention';

describe('space attention (arc 7)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  const seeded = async () => {
    const store = new DexieBackend(new MunniDB(`munni_sa_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('sa'), { trackOutbox: false });
    const spaceBase = { kind: 'personal' as const, currency: 'EUR', periodType: 'month' as const, periodDay: 1 };
    await repo.upsert('space', 'calm', 'calm', { ...spaceBase, name: 'Calm' });
    await repo.upsert('space', 'busy', 'busy', { ...spaceBase, name: 'Busy' });
    const today = localToday();
    const txBase = { accountId: 'a', currency: 'EUR', merchant: 'X', txType: 'expense' as const };
    // busy: two unreviewed rows + a busted groceries budget this month
    await repo.upsert('transaction', 'busy', 'b1', { ...txBase, date: today, amountCents: -5_000, needsReview: 1 });
    await repo.upsert('transaction', 'busy', 'b2', { ...txBase, date: today, amountCents: -7_000, needsReview: 1, catId: 'groceries' });
    await repo.upsert('budget', 'busy', 'bud1', { name: 'Food', amountCents: 5_000, every: 'month', anchor: today, catIds: ['groceries'] });
    // calm: one reviewed row, budget comfortably under
    await repo.upsert('transaction', 'calm', 'c1', { ...txBase, date: today, amountCents: -1_000, needsReview: 0, catId: 'groceries' });
    await repo.upsert('budget', 'calm', 'bud2', { name: 'Food', amountCents: 50_000, every: 'month', anchor: today, catIds: ['groceries'] });
    return { store };
  };

  it('counts unreviewed rows and flags busted budgets per space', async () => {
    const { store } = await seeded();
    expect(await spaceAttention(store, 'busy')).toEqual({ reviewCount: 2, budgetOver: true });
    expect(await spaceAttention(store, 'calm')).toEqual({ reviewCount: 0, budgetOver: false });
  });

  it('the avatar dot asks only about OTHER spaces', async () => {
    const { store } = await seeded();
    // sitting in calm: busy needs you → dot
    expect(await anyOtherSpaceNeedsAttention(store, 'calm')).toBe(true);
    // sitting in busy: calm is fine → no dot
    expect(await anyOtherSpaceNeedsAttention(store, 'busy')).toBe(false);
  });
});
