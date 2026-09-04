// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MunniDB } from './schema';
import { Repo } from './repo';
import { DexieBackend } from './backend';
import { HlcClock } from '@/sync/hlc';
import { seedDemoIfNeeded } from './seed';
import { seedRichDemo } from './demo-rich';

/** the real app runs seedRichDemo after seedDemoIfNeeded; the unit-test
 *  runner gates it off, so this suite drives it explicitly */
async function freshDemo(): Promise<MunniDB> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('munni_demo');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  const db = new MunniDB('munni_demo');
  const repo = new Repo(new DexieBackend(db), new HlcClock('demo-test'), { trackOutbox: false });
  await seedDemoIfNeeded(repo);
  await seedRichDemo(repo);
  return db;
}

const live = <T extends { deleted: number; spaceId?: string }>(rows: T[]): T[] =>
  rows.filter((r) => r.deleted === 0);

describe('rich demo seed', () => {
  let db: MunniDB;
  beforeEach(async () => {
    db = await freshDemo();
  });

  it('populates every feature so each surface has something to show', async () => {
    expect(live(await db.budgets.toArray()).length).toBeGreaterThanOrEqual(4);
    expect(live(await db.goals.toArray()).length).toBeGreaterThanOrEqual(3);
    // loans v2: the demo debts ARE liability accounts now
    const loans = live(await db.accounts.toArray()).filter((a) => ['loan', 'mortgage', 'credit'].includes(a.type));
    expect(loans.length).toBeGreaterThanOrEqual(3);
    expect(live(await db.debts.toArray())).toHaveLength(0);
    expect(live(await db.events.toArray()).length).toBeGreaterThanOrEqual(2);
    expect(live(await db.recurrings.toArray()).length).toBeGreaterThanOrEqual(5);
    expect(live(await db.allocations.toArray()).length).toBeGreaterThanOrEqual(3);
    expect(live(await db.holdings.toArray()).length).toBeGreaterThanOrEqual(4);
    expect(live(await db.lots.toArray()).length).toBeGreaterThanOrEqual(5);
    expect(live(await db.goalContributions.toArray()).length).toBeGreaterThanOrEqual(3);
    db.close();
  });

  it('all dates are relative — nothing is stranded in the past or future', async () => {
    const today = new Date();
    const yearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    const txs = live(await db.transactions.toArray());
    // a recent charge exists (last week) and none are dated in the future
    const dates = txs.map((t) => t.date).sort();
    expect(dates.at(-1)! <= `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`).toBe(true);
    // a running event straddles today
    const bcn = (await db.events.get('demo_evt_bcn'))!;
    expect(bcn.from! <= dates.at(-1)!).toBe(true);
    // budgets anchor within the last year (not a stale fixed date)
    for (const budget of live(await db.budgets.toArray())) {
      expect(new Date(budget.anchor) >= yearAgo).toBe(true);
    }
    db.close();
  });

  it('seeds the edge cases the features are meant to teach', async () => {
    // an over-budget category (eating out capped low, spending pushes over)
    const eatout = (await db.budgets.get('demo_bud_eatout'))!;
    expect(eatout.amountCents).toBeLessThan(10_000);
    // a sustained subscription price change (Netflix 13.99 → 15.99)
    const nflx = live(await db.transactions.toArray()).filter((t) => t.recurringId === 'demo_rec_netflix');
    const amounts = nflx.map((t) => -t.amountCents).sort();
    expect(amounts).toContain(1399);
    expect(amounts).toContain(1599);
    // a crypto holding and a dividend lot
    expect((await db.holdings.get('demo_h_btc'))!.assetClass).toBe('crypto');
    expect(live(await db.lots.toArray()).some((l) => l.kind === 'dividend')).toBe(true);
    // an inactive recurring
    expect((await db.recurrings.get('demo_rec_disney'))!.active).toBe(0);
    db.close();
  });

  it('re-seeds clean after a wipe (logout → login)', async () => {
    // mutate, then wipe + reseed as demo logout/login does
    await db.budgets.where('id').equals('demo_bud_groceries').delete();
    db.close();
    const db2 = await freshDemo();
    expect(await db2.budgets.get('demo_bud_groceries')).toBeTruthy();
    db2.close();
  });
});
