// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MunniDB } from '@/db/schema';
import { DexieBackend } from '@/db/backend';
import { Repo } from '@/db/repo';
import { HlcClock } from '@/sync/hlc';
import { matchTransferPairs } from '@/domain/transferMatch';
import { createCounterTransaction, linkTransferPairs } from './transferMatch';

describe('matchTransferPairs (domain rules)', () => {
  const leg = (id: string, accountId: string, amountCents: number, date: string, extra: object = {}) => ({
    id,
    accountId,
    amountCents,
    date,
    ...extra,
  });

  it('pairs opposite legs on amount + window; ambiguity leaves both alone', () => {
    const pairs = matchTransferPairs([
      leg('out1', 'A', -5000, '2026-07-10'),
      leg('in1', 'B', 5000, '2026-07-11'),
      // ambiguous pair: two equal candidates on the SAME date
      leg('out2', 'A', -700, '2026-07-20'),
      leg('in2', 'B', 700, '2026-07-20'),
      leg('in3', 'C', 700, '2026-07-20'),
    ]);
    expect(pairs.get('out1')).toBe('in1');
    expect(pairs.has('out2')).toBe(false); // tie → a human's call
  });

  it('a deliberate linkedAccountId beats nearest-date and breaks ties', () => {
    const pairs = matchTransferPairs([
      leg('out', 'A', -700, '2026-07-20', { linkedAccountId: 'C' }),
      leg('near', 'B', 700, '2026-07-20'),
      leg('pointed', 'C', 700, '2026-07-21'),
    ]);
    expect(pairs.get('out')).toBe('pointed');
  });

  it('never pairs same-account legs, out-of-window dates, or peered rows', () => {
    const pairs = matchTransferPairs([
      leg('outA', 'A', -100, '2026-07-01'),
      leg('inA', 'A', 100, '2026-07-01'), // same account
      leg('late', 'B', 100, '2026-07-05'), // 4 days out
      leg('done', 'B', 100, '2026-07-01', { transferPeerId: 'x' }), // already peered
    ]);
    expect(pairs.size).toBe(0);
  });
});

describe('linkTransferPairs (application, per space)', () => {
  const DB = 'munni_transfer_match';
  let db: MunniDB;
  let store: DexieBackend;
  let repo: Repo;

  beforeEach(async () => {
    indexedDB.deleteDatabase(DB);
    db = new MunniDB(DB);
    store = new DexieBackend(db);
    repo = new Repo(store, new HlcClock('tm'), { trackOutbox: false });
    for (const [id, name] of [
      ['priv', 'Private'],
      ['fam', 'Family'],
    ] as const) {
      await repo.upsert('space', id, id, { name, kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    }
    await repo.upsert('account', 'priv', 'checking', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('account', 'priv', 'pot', { name: 'Pot', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('account', 'fam', 'joint', { name: 'Joint', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });
  });

  it('pairs typed legs within one space; never ACROSS spaces (funding covers that)', async () => {
    // same-space pair: checking → pot, both legs in 'priv'
    await repo.upsert('transaction', 'priv', 'out', {
      accountId: 'checking',
      date: '2026-07-25',
      amountCents: -50000,
      currency: 'EUR',
      merchant: 'To the pot',
      txType: 'saving',
      linkedAccountId: 'pot',
      needsReview: 0,
    });
    await repo.upsert('transaction', 'priv', 'in', {
      accountId: 'pot',
      date: '2026-07-26',
      amountCents: 50000,
      currency: 'EUR',
      merchant: 'From checking',
      txType: 'saving',
      needsReview: 0,
    });
    // a cross-space would-be twin: same amount, in the family space —
    // spaces keep their own books, so this must never be referenced
    await repo.upsert('transaction', 'fam', 'famIn', {
      accountId: 'joint',
      date: '2026-07-26',
      amountCents: 50000,
      currency: 'EUR',
      merchant: 'From Okkes',
      txType: 'transfer',
      needsReview: 0,
    });

    expect(await linkTransferPairs(store, repo)).toBe(1);
    expect((await db.transactions.get('out'))?.transferPeerId).toBe('in');
    expect((await db.transactions.get('in'))?.transferPeerId).toBe('out');
    expect((await db.transactions.get('famIn'))?.transferPeerId).toBeUndefined();
    // idempotent: a second run finds nothing new
    expect(await linkTransferPairs(store, repo)).toBe(0);
  });

  it('a deliberate out-leg claims its RAW income twin and types the mirror', async () => {
    await repo.upsert('transaction', 'priv', 'out', {
      accountId: 'checking',
      date: '2026-07-25',
      amountCents: -10000,
      currency: 'EUR',
      merchant: 'To savings',
      txType: 'saving',
      linkedAccountId: 'pot',
      needsReview: 0,
    });
    // the other side sits as plain income, untouched
    await repo.upsert('transaction', 'priv', 'twin', {
      accountId: 'pot',
      date: '2026-07-25',
      amountCents: 10000,
      currency: 'EUR',
      merchant: 'OKKES DOKER',
      txType: 'income',
      needsReview: 1,
    });

    expect(await linkTransferPairs(store, repo)).toBe(1);
    const twin = await db.transactions.get('twin');
    expect(twin?.transferPeerId).toBe('out');
    expect(twin?.txType).toBe('saving'); // typed as the mirror
    expect(twin?.linkedAccountId).toBe('checking'); // points back
    expect(twin?.needsReview).toBe(0);
  });

  it('createCounterTransaction writes the mirror, peers both legs, moves the manual balance', async () => {
    await repo.upsert('transaction', 'priv', 'out', {
      accountId: 'checking',
      date: '2026-07-25',
      amountCents: -10000,
      currency: 'EUR',
      merchant: 'To the pot',
      txType: 'saving',
      linkedAccountId: 'pot',
      needsReview: 0,
    });
    const out = (await db.transactions.get('out'))!;
    const mirrorId = await createCounterTransaction(store, repo, { ...out }, 'pot');

    const mirror = await db.transactions.get(mirrorId);
    expect(mirror).toMatchObject({
      accountId: 'pot',
      amountCents: 10000,
      txType: 'saving',
      linkedAccountId: 'checking',
      transferPeerId: 'out',
      needsReview: 0,
    });
    expect((await db.transactions.get('out'))?.transferPeerId).toBe(mirrorId);
    // the manual pot's live balance moved by the mirror amount
    expect((await db.accounts.get('pot'))?.balanceCents).toBe(10000);
  });

  it('an ambiguous raw twin stays untouched', async () => {
    await repo.upsert('transaction', 'priv', 'out', {
      accountId: 'checking',
      date: '2026-07-25',
      amountCents: -10000,
      currency: 'EUR',
      merchant: 'To savings',
      txType: 'saving',
      linkedAccountId: 'pot',
      needsReview: 0,
    });
    for (const id of ['twin1', 'twin2']) {
      await repo.upsert('transaction', 'priv', id, {
        accountId: 'pot',
        date: '2026-07-25',
        amountCents: 10000,
        currency: 'EUR',
        merchant: 'DEPOSIT',
        txType: 'income',
        needsReview: 1,
      });
    }
    expect(await linkTransferPairs(store, repo)).toBe(0);
    expect((await db.transactions.get('twin1'))?.transferPeerId).toBeUndefined();
  });
});
