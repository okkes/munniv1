// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { visibleTransactions } from '@/db/joined';
import { accountLinkId } from '@/domain/feedIds';
import { applyHistoryMove, historyMoveImpact } from './historyStart';

const SPACE = 's1';
const FEED = 'feed1';

describe('history start moves (arc 5)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  const seeded = async () => {
    const store = new DexieBackend(new MunniDB(`munni_hs_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('hs'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, {
      name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1, historyStartDate: '2026-05-01',
    });
    const base = { accountId: 'a-own', currency: 'EUR', merchant: 'X', txType: 'expense' as const, needsReview: 0 as const };
    // own rows: one safely inside, one before the current start (hidden)
    await repo.upsert('transaction', SPACE, 'own-in', { ...base, date: '2026-06-01', amountCents: -100 });
    await repo.upsert('transaction', SPACE, 'own-old', { ...base, date: '2026-04-10', amountCents: -200 });
    // an attached feed with rows on both sides of its gate
    await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, FEED), {
      feedSpaceId: FEED, accountId: 'a-feed', historyFrom: '2026-05-01', archived: 0,
    });
    const feedBase = { accountId: 'a-feed', currency: 'EUR', merchant: 'BANK', txType: 'expense' as const, needsReview: 0 as const };
    await repo.upsert('transaction', FEED, 'feed-in', { ...feedBase, date: '2026-05-20', amountCents: -300 });
    await repo.upsert('transaction', FEED, 'feed-older', { ...feedBase, date: '2026-04-20', amountCents: -400 });
    return { store, repo };
  };

  it('the display gate hides own rows before the start — stored in full', async () => {
    const { store } = await seeded();
    const visible = (await visibleTransactions(store, SPACE)).map((t) => t.id).sort((a, b) => a.localeCompare(b));
    // own-old (before the gate) and feed-older (behind the link gate) stay stored but unseen
    expect(visible).toEqual(['feed-in', 'own-in']);
  });

  it('counts the consequences in both directions before anything happens', async () => {
    const { store } = await seeded();
    // newer: the visible feed row falls out, BOTH own rows are before 2026-07-01
    expect(await historyMoveImpact(store, SPACE, '2026-07-01')).toEqual({
      direction: 'newer', feedHiddenCount: 1, manualDeleteCount: 2, surfacedCount: 0,
    });
    // older: the hidden own row + the gated feed row surface
    expect(await historyMoveImpact(store, SPACE, '2026-04-01')).toEqual({
      direction: 'older', feedHiddenCount: 0, manualDeleteCount: 0, surfacedCount: 2,
    });
    expect((await historyMoveImpact(store, SPACE, '2026-05-01')).direction).toBe('none');
  });

  it('moving newer writes the date, moves every link gate, and tombstones own rows', async () => {
    const { store, repo } = await seeded();
    await applyHistoryMove(store, repo, SPACE, '2026-07-01');
    expect((await store.get('space', SPACE))?.historyStartDate).toBe('2026-07-01');
    expect((await store.get('accountLink', accountLinkId(SPACE, FEED)))?.historyFrom).toBe('2026-07-01');
    // own rows before the new start are gone for good; feed rows survive stored
    expect((await store.get('transaction', 'own-in'))?.deleted).toBe(1);
    expect((await store.get('transaction', 'own-old'))?.deleted).toBe(1);
    expect((await store.get('transaction', 'feed-in'))?.deleted).toBe(0);
    expect(await visibleTransactions(store, SPACE)).toHaveLength(0);
  });

  it('moving older deletes nothing — the stored rows simply surface', async () => {
    const { store, repo } = await seeded();
    await applyHistoryMove(store, repo, SPACE, '2026-04-01');
    const visible = (await visibleTransactions(store, SPACE)).map((t) => t.id).sort((a, b) => a.localeCompare(b));
    expect(visible).toEqual(['feed-in', 'feed-older', 'own-in', 'own-old']);
  });

  it('#259: back-fills gateless links from the space start — every boot, no marker', async () => {
    const { healGatelessLinks } = await import('./historyStart');
    const { store, repo } = await seeded();
    // a server-minted link: the connect mirror op carries NO gate
    await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, 'feed2'), {
      feedSpaceId: 'feed2', accountId: 'a-feed2', archived: 0,
    });
    expect(await healGatelessLinks(store, repo)).toBe(1);
    expect((await store.get('accountLink', accountLinkId(SPACE, 'feed2')))?.historyFrom).toBe('2026-05-01');
    // the seeded link already had its gate — untouched
    expect((await store.get('accountLink', accountLinkId(SPACE, FEED)))?.historyFrom).toBe('2026-05-01');
    // idempotent: a second boot writes nothing
    expect(await healGatelessLinks(store, repo)).toBe(0);
    // a link syncing in AFTER the first pass (the marker bug's blind
    // spot: device B booted against an empty DB) still heals next boot
    await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, 'feed3'), {
      feedSpaceId: 'feed3', accountId: 'a-feed3', archived: 0,
    });
    expect(await healGatelessLinks(store, repo)).toBe(1);
    expect((await store.get('accountLink', accountLinkId(SPACE, 'feed3')))?.historyFrom).toBe('2026-05-01');
  });

  it('#259: a gateless link falls back to the SPACE start at read time — no heal needed', async () => {
    const { store, repo } = await seeded();
    // device B's reality: the link arrived by sync without a gate and
    // no heal has run yet — the space date must still govern the list
    await repo.upsert('accountLink', SPACE, accountLinkId(SPACE, 'feed2'), {
      feedSpaceId: 'feed2', accountId: 'a-feed2', archived: 0,
    });
    const feedBase = { accountId: 'a-feed2', currency: 'EUR', merchant: 'BANK2', txType: 'expense' as const, needsReview: 0 as const };
    await repo.upsert('transaction', 'feed2', 'f2-in', { ...feedBase, date: '2026-05-20', amountCents: -300 });
    await repo.upsert('transaction', 'feed2', 'f2-older', { ...feedBase, date: '2026-04-20', amountCents: -400 });
    const visible = (await visibleTransactions(store, SPACE)).map((t) => t.id).sort((a, b) => a.localeCompare(b));
    // f2-older sits before the space start: hidden even with no link gate
    expect(visible).toEqual(['f2-in', 'feed-in', 'own-in']);
  });
});
