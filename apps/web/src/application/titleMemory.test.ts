// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { applyTitleMemory, buildTitleMemory } from './titleMemory';

/**
 * User rule 2026-07-18: renaming a transaction teaches the app — the
 * next arrival of the same merchant gets the preferred title
 * automatically; the bank's original merchant is never touched.
 */
describe('title memory', () => {
  it('learns the majority rename per merchant, ties break alphabetically', () => {
    const memory = buildTitleMemory([
      { merchant: 'ALBERT HEIJN 1842', titleOverride: 'Albert Heijn' },
      { merchant: 'ALBERT HEIJN 1473', titleOverride: 'Albert Heijn' },
      { merchant: 'ALBERT HEIJN 1473', titleOverride: 'Groceries AH' },
      { merchant: 'SHELL M 154', titleOverride: 'Shell', deleted: 1 }, // deleted rows teach nothing
      { merchant: 'ESSO MECHELEN' }, // no rename, no vote
    ]);
    expect(memory.get('albert heijn')).toBe('Albert Heijn');
    expect(memory.has('shell m')).toBe(false);
  });

  it('applies remembered renames to rows without an override (idempotent)', async () => {
    const db = new MunniDB(`titlemem_${Math.random().toString(36).slice(2)}`);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('space', 's1', 's1', { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    const base = { accountId: 'a1', currency: 'EUR', txType: 'expense' as const, needsReview: 0 as const, amountCents: -500 };
    await repo.upsert('transaction', 's1', 'tx-1', { ...base, date: '2026-07-01', merchant: 'ODIDO NETHERLANDS B.V.', titleOverride: 'Odido' });
    await repo.upsert('transaction', 's1', 'tx-2', { ...base, date: '2026-07-02', merchant: 'ODIDO NETHERLANDS B.V.' });
    await repo.upsert('transaction', 's1', 'tx-3', { ...base, date: '2026-07-03', merchant: 'LA FLOBETTE' });

    expect(await applyTitleMemory(new DexieBackend(db), repo, 's1')).toBe(1);
    expect((await db.transactions.get('tx-2'))?.titleOverride).toBe('Odido');
    expect((await db.transactions.get('tx-3'))?.titleOverride).toBeUndefined();
    // second pass finds nothing left to do
    expect(await applyTitleMemory(new DexieBackend(db), repo, 's1')).toBe(0);
    db.close();
  });
});
