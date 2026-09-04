// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { HlcClock } from '@/sync/hlc';
import { adoptedCategoryId } from '@/domain/feedIds';
import { adoptUserCategoriesOnShare, createSubCategory, directionForType } from './categoryOps';

describe('#244: direction derives from the parent — the user never states it', () => {
  it('income subs are credit, expense subs debit, anything else open', () => {
    expect(directionForType('income')).toBe('credit');
    expect(directionForType('expense')).toBe('debit');
    expect(directionForType('saving')).toBe('both');
  });

  it('createSubCategory stamps the derived direction', async () => {
    const db = new MunniDB(`munni_test_dir_${Math.random().toString(36).slice(2)}`);
    const store = new DexieBackend(db);
    const repo = new Repo(store, new HlcClock('d'), { trackOutbox: false });
    const underIncome = await createSubCategory(store, repo, 'p1', { parentId: 'income', name: 'Royalties', icon: 'cash' });
    const underSport = await createSubCategory(store, repo, 'p1', { parentId: 'sport', name: 'Padel', icon: 'dumbbell' });
    expect(await store.get('category', underIncome)).toMatchObject({ txType: 'income', direction: 'credit' });
    expect(await store.get('category', underSport)).toMatchObject({ txType: 'expense', direction: 'debit' });
  });
});

describe('adoptUserCategoriesOnShare', () => {
  let db: MunniDB;
  let repo: Repo;

  beforeEach(async () => {
    db = new MunniDB(`munni_test_adopt_${Math.random().toString(36).slice(2)}`);
    repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });

    await repo.upsert('space', 'p1', 'p1', { name: 'Personal', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await repo.upsert('space', 'tgt', 'tgt', { name: 'Family', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });

    // user-scoped custom main with two subs (one is the locked Other)
    await repo.upsert('category', 'p1', 'main1', { name: 'Padel Club', icon: 'dumbbell', color: '#112233', txType: 'expense', isParent: 1, sortOrder: 1, builtin: 0 });
    await repo.upsert('category', 'p1', 'sub1', { parentId: 'main1', name: 'Gear', icon: 'bag-personal', color: '', txType: 'expense', direction: 'debit', sortOrder: 2, builtin: 0 });
    await repo.upsert('category', 'p1', 'subOther', { parentId: 'main1', name: 'Other', icon: 'dumbbell', color: '', txType: 'expense', direction: 'both', isOther: 1, sortOrder: 9999, builtin: 0 });
    // user-scoped custom sub under a BUILTIN parent
    await repo.upsert('category', 'p1', 'lonesub', { parentId: 'sport', name: 'Padel', icon: 'dumbbell', color: '', txType: 'expense', direction: 'both', sortOrder: 3, builtin: 0 });

    // the soon-to-be-shared space uses them: directly, in splits and in an overlay
    await repo.upsert('transaction', 'tgt', 'tx1', { accountId: 'a', date: '2026-07-01', amountCents: -1000, currency: 'EUR', merchant: 'Decathlon', catId: 'sub1', txType: 'expense', needsReview: 0 });
    await repo.upsert('transaction', 'tgt', 'tx2', {
      accountId: 'a', date: '2026-07-02', amountCents: -2000, currency: 'EUR', merchant: 'Mix', catId: 'groceries',
      splits: [{ catId: 'lonesub', amountCents: 500 }, { catId: 'groceries', amountCents: 1500 }],
      txType: 'expense', needsReview: 0,
    });
    await repo.upsert('txMeta', 'tgt', 'meta1', { txId: 'raw1', catId: 'sub1', txType: 'expense', needsReview: 0 });
  });

  it('copies used units into the space and rewrites every reference', async () => {
    await adoptUserCategoriesOnShare(new DexieBackend(db), repo, 'tgt');

    const newMain = adoptedCategoryId('tgt', 'main1');
    const newSub1 = adoptedCategoryId('tgt', 'sub1');
    const newOther = adoptedCategoryId('tgt', 'subOther');
    const newLone = adoptedCategoryId('tgt', 'lonesub');

    // the whole unit moved: parent, the used sub AND its Other sibling
    const copies = await db.categories.filter((c) => c.spaceId === 'tgt' && c.deleted === 0).toArray();
    expect(new Set(copies.map((c) => c.id))).toEqual(new Set([newMain, newSub1, newOther, newLone]));
    expect(copies.find((c) => c.id === newMain)?.isParent).toBe(1);
    expect(copies.find((c) => c.id === newSub1)?.parentId).toBe(newMain);
    expect(copies.find((c) => c.id === newOther)?.isOther).toBe(1);
    // sub under a builtin parent keeps pointing at the builtin
    expect(copies.find((c) => c.id === newLone)?.parentId).toBe('sport');

    // references rewritten — builtin references untouched
    expect((await db.transactions.get('tx1'))?.catId).toBe(newSub1);
    const tx2 = await db.transactions.get('tx2');
    expect(tx2?.catId).toBe('groceries');
    expect(tx2?.splits).toEqual([
      { catId: newLone, amountCents: 500 },
      { catId: 'groceries', amountCents: 1500 },
    ]);
    expect((await db.txMeta.get('meta1'))?.catId).toBe(newSub1);

    // originals stay in the personal space, untouched
    expect((await db.categories.get('sub1'))?.spaceId).toBe('p1');
    expect((await db.categories.get('main1'))?.deleted).toBe(0);
  });

  it('is idempotent — a second run copies nothing new', async () => {
    await adoptUserCategoriesOnShare(new DexieBackend(db), repo, 'tgt');
    const after1 = await db.categories.filter((c) => c.spaceId === 'tgt' && c.deleted === 0).count();
    await adoptUserCategoriesOnShare(new DexieBackend(db), repo, 'tgt');
    expect(await db.categories.filter((c) => c.spaceId === 'tgt' && c.deleted === 0).count()).toBe(after1);
  });

  it('does nothing when the space only uses builtin categories', async () => {
    await repo.upsert('transaction', 'tgt', 'tx1', { catId: 'groceries' });
    await repo.upsert('transaction', 'tgt', 'tx2', { catId: 'groceries', splits: undefined });
    await repo.upsert('txMeta', 'tgt', 'meta1', { catId: 'restaurants' });
    await adoptUserCategoriesOnShare(new DexieBackend(db), repo, 'tgt');
    expect(await db.categories.filter((c) => c.spaceId === 'tgt').count()).toBe(0);
  });
});
