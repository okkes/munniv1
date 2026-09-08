// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { linkAllCounterparties } from './counterLink';

/**
 * User rule 2026-07-17: connect the credit card AFTER months of checking
 * history → every old top-up (matching counter-IBAN) links to the card
 * and becomes a transfer. Deliberate types and existing links survive.
 */
describe('linkAllCounterparties', () => {
  const setup = async () => {
    const db = new MunniDB(`counterlink_${Math.random().toString(36).slice(2)}`);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('space', 's1', 's1', { name: 'P', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await repo.upsert('account', 's1', 'acct-main', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', iban: 'NL01MAIN0000000001' });
    return { db, repo };
  };

  it('links matching rows, retypes plain expenses, keeps deliberate types and existing links', async () => {
    const { db, repo } = await setup();
    const base = { accountId: 'acct-main', currency: 'EUR', needsReview: 0 as const };
    await repo.upsert('transaction', 's1', 'tx-topup', {
      ...base, date: '2026-07-01', amountCents: -50000, merchant: 'CC TOPUP',
      txType: 'expense', counterIban: 'NL91 ABNA 0417 1643 00', // spaces: bank formatting
    });
    await repo.upsert('transaction', 's1', 'tx-deliberate', {
      ...base, date: '2026-07-02', amountCents: -100, merchant: 'ADJ',
      txType: 'adjustment', counterIban: 'NL91ABNA0417164300',
    });
    await repo.upsert('transaction', 's1', 'tx-linked', {
      ...base, date: '2026-07-03', amountCents: -200, merchant: 'OLD LINK',
      txType: 'expense', counterIban: 'NL91ABNA0417164300', linkedAccountId: 'acct-other',
    });
    await repo.upsert('transaction', 's1', 'tx-foreign', {
      ...base, date: '2026-07-04', amountCents: -300, merchant: 'RENT',
      txType: 'expense', counterIban: 'NL00LANDLORD000001',
    });

    // the card arrives later — the sweep runs
    await repo.upsert('account', 's1', 'acct-cc', { name: 'Card', type: 'credit', source: 'manual', currency: 'EUR', iban: 'NL91ABNA0417164300' });
    expect(await linkAllCounterparties(new DexieBackend(db), repo, 's1')).toBe(2);

    const topup = await db.transactions.get('tx-topup');
    // credit = transfer (user ruling); the placeholder category files the
    // sign-picked locked sub at the write edge (arc 2)
    expect(topup).toMatchObject({ linkedAccountId: 'acct-cc', txType: 'transfer', catId: 'transferOut' });
    const deliberate = await db.transactions.get('tx-deliberate');
    expect(deliberate).toMatchObject({ linkedAccountId: 'acct-cc', txType: 'adjustment' }); // linked, type kept
    expect((await db.transactions.get('tx-linked'))?.linkedAccountId).toBe('acct-other'); // untouched
    expect((await db.transactions.get('tx-foreign'))?.linkedAccountId).toBeUndefined();

    // idempotent: a second pass changes nothing
    expect(await linkAllCounterparties(new DexieBackend(db), repo, 's1')).toBe(0);
    db.close();
  });

  it('a savings counterparty retypes to saving', async () => {
    const { db, repo } = await setup();
    await repo.upsert('transaction', 's1', 'tx-save', {
      accountId: 'acct-main', currency: 'EUR', needsReview: 0, date: '2026-07-01',
      amountCents: -10000, merchant: 'TO SAVINGS', txType: 'expense', counterIban: 'NL02SAVE0000000002',
    });
    await repo.upsert('account', 's1', 'acct-save', { name: 'Buffer', type: 'savings', source: 'manual', currency: 'EUR', iban: 'NL02 SAVE 0000 0000 02' });
    await linkAllCounterparties(new DexieBackend(db), repo, 's1');
    expect(await db.transactions.get('tx-save')).toMatchObject({ linkedAccountId: 'acct-save', txType: 'saving', catId: 'savingDeposit' });
    db.close();
  });
});
