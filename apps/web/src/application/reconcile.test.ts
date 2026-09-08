// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { HlcClock } from '@/sync/hlc';
import { txMetaId } from '@/domain/feedIds';
import { applyReconcile, buildReconcilePlan } from './reconcile';

const FEED = 'feed-1';
const SPACE = 'space-1';

describe('applyReconcile (linked is the truth)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  async function seeded() {
    const store = new DexieBackend(new MunniDB(`munni_rec_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('rec'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month' });
    await repo.upsert('space', FEED, FEED, { name: 'feed', kind: 'personal', currency: 'EUR', periodType: 'month' });

    const raw = { accountId: 'acct-1', currency: 'EUR', txType: 'expense' as const, needsReview: 0 as const };
    // linked truth: GC rows with the bank's own references
    await repo.upsert('transaction', FEED, 'L1', { ...raw, date: '2026-06-01', amountCents: -5000, merchant: 'EDGE', importRef: 'REF-EDGE' });
    await repo.upsert('transaction', FEED, 'L2', { ...raw, date: '2026-06-10', amountCents: -1200, merchant: 'SHELL', importRef: 'REF-B' });
    await repo.upsert('transaction', FEED, 'L3', { ...raw, date: '2026-06-20', amountCents: 90000, merchant: 'EMPLOYER', importRef: 'REF-C', txType: 'income' });
    // imported CSV rows: one match (I1↔L2), one mismatch (I2), one pre-coverage keeper (I3)
    await repo.upsert('transaction', FEED, 'I1', { ...raw, date: '2026-06-10', amountCents: -1200, merchant: 'Shell station', importRef: 'ing:x:1' });
    await repo.upsert('transaction', FEED, 'I2', { ...raw, date: '2026-06-12', amountCents: -999, merchant: 'GHOST', importRef: 'ing:x:2' });
    await repo.upsert('transaction', FEED, 'I3', { ...raw, date: '2023-01-05', amountCents: -700, merchant: 'OLD', importRef: 'ing:x:3' });

    // the space's edits on the matched import + a receipt + a reimb link
    await repo.upsert('txMeta', SPACE, txMetaId(SPACE, 'I1'), { txId: 'I1', catId: 'transport', txType: 'expense', needsReview: 0, notes: 'tank beurt' });
    await repo.upsert('receipt', SPACE, 'rcpt-1', { txId: 'I1', source: 'photo', date: '2026-06-10', totalCents: 1200, merchant: 'Shell' });
    // an expense in the space claims the MISMATCHED import as its refund
    await repo.upsert('txMeta', SPACE, txMetaId(SPACE, 'L3'), { txId: 'L3', catId: 'salary', txType: 'income', needsReview: 0, reimbursements: [{ txId: 'I2', amountCents: 500 }, { txId: 'I1', amountCents: 100 }] });
    return { store, repo };
  }

  it('migrates edits to the truth row, deletes judged imports, keeps history, re-points links', async () => {
    const { store, repo } = await seeded();
    const plan = (await buildReconcilePlan(store, 'acct-1'))!;
    expect(plan.matches.map((m) => [m.imported.id, m.linked.id])).toEqual([['I1', 'L2']]);
    expect(plan.mismatched.map((r) => r.id)).toEqual(['I2']);
    expect(plan.kept.map((r) => r.id).sort((a, b) => a.localeCompare(b))).toEqual(['I3']);

    const result = await applyReconcile(store, repo, SPACE, plan, new Set());
    expect(result).toEqual({ migrated: 1, removed: 2 });

    // the truth row inherited the edits in the attaching space
    const meta = await store.get('txMeta', txMetaId(SPACE, 'L2'));
    expect(meta).toMatchObject({ txId: 'L2', catId: 'transport', notes: 'tank beurt' });
    // the receipt follows
    expect((await store.get('receipt', 'rcpt-1'))?.txId).toBe('L2');
    // judged imports are gone, history survives
    expect((await store.get('transaction', 'I1'))?.deleted).toBe(1);
    expect((await store.get('transaction', 'I2'))?.deleted).toBe(1);
    expect((await store.get('transaction', 'I3'))?.deleted).toBe(0);
    // reimbursement links: matched id re-points, deleted mismatch drops
    const salary = await store.get('txMeta', txMetaId(SPACE, 'L3'));
    expect(salary?.reimbursements).toEqual([{ txId: 'L2', amountCents: 100 }]);
  });

  it('an ignored match still falls as a duplicate, but keeps its edits to itself', async () => {
    const { store, repo } = await seeded();
    const plan = (await buildReconcilePlan(store, 'acct-1'))!;
    const result = await applyReconcile(store, repo, SPACE, plan, new Set(['I1']));
    expect(result).toEqual({ migrated: 0, removed: 2 });
    expect(await store.get('txMeta', txMetaId(SPACE, 'L2'))).toBeUndefined();
    expect((await store.get('transaction', 'I1'))?.deleted).toBe(1);
  });
});
