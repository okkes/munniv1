import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from './schema';
import { Repo } from './repo';
import { DexieBackend } from './backend';
import { DEMO_SPACE_ID, seedDemoIfNeeded } from './seed';
import { DEMO_ACCOUNTS, DEMO_TXS } from './demo-data';
import { DEFAULT_FAMILIES } from '@/domain/defaultAccounts';

let counter = 0;

describe('seedDemoIfNeeded', () => {
  let db: MunniDB;
  let repo: Repo;
  let wall = 1_000_000;

  beforeEach(() => {
    db = new MunniDB(`seed_test_${++counter}`);
    repo = new Repo(new DexieBackend(db), new HlcClock('dev', undefined, () => ++wall), { trackOutbox: false });
  });
  afterEach(async () => db.delete());

  it('seeds the demo space, accounts and full transaction set', async () => {
    await seedDemoIfNeeded(repo);
    expect((await db.spaces.get(DEMO_SPACE_ID))?.kind).toBe('personal');
    // #221: the demo space is born with its six default accounts too
    expect(await db.accounts.count()).toBe(DEMO_ACCOUNTS.length + DEFAULT_FAMILIES.length);
    expect(await db.accounts.filter((a) => !!a.defaultFor).count()).toBe(DEFAULT_FAMILIES.length);
    expect(await db.transactions.count()).toBe(DEMO_TXS.length);
    // demo never syncs — nothing may land in the outbox
    expect(await db.outbox.count()).toBe(0);
  });

  it('is idempotent (second call is a no-op)', async () => {
    await seedDemoIfNeeded(repo);
    await seedDemoIfNeeded(repo);
    expect(await db.transactions.count()).toBe(DEMO_TXS.length);
  });

  it('carries review flags and reimbursement amounts through', async () => {
    await seedDemoIfNeeded(repo);
    const review = await db.transactions.filter((t) => t.needsReview === 1).count();
    expect(review).toBe(DEMO_TXS.filter((t) => t.needsReview).length);

    const withReimb = DEMO_TXS.find((t) => t.reimbursements?.length);
    if (withReimb) {
      const row = await db.transactions.get(withReimb.id);
      expect(row?.reimbursements).toEqual(withReimb.reimbursements);
    }
  });

  it('dates are relative to now (newest tx is recent)', async () => {
    await seedDemoIfNeeded(repo);
    const newest = (await db.transactions.orderBy('[spaceId+date]').reverse().first())!;
    const ageDays = (Date.now() - new Date(newest.date).getTime()) / 86_400_000;
    expect(ageDays).toBeLessThan(10);
  });
});
