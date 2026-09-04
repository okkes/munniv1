// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { HlcClock } from '@/sync/hlc';
import { catMirrorSourceId, foldPartId, mirrorTxId } from '@/domain/feedIds';
import { defaultAccountId, ensureDefaultAccount } from './defaultAccounts';
import { migrateBareSpecialRows, migrateEntryCounters } from './categoryModel';

const SPACE = 's1';

describe('#133 step A: default accounts + the bare-row migration', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  function fresh() {
    const store = new DexieBackend(new MunniDB(`munni_catmodel_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('catmodel'), { trackOutbox: false });
    return { store, repo };
  }

  it('mints the default pot lazily, deterministically and idempotently', async () => {
    const { store, repo } = fresh();
    await repo.upsert('space', SPACE, SPACE, { name: 'Home', currency: 'EUR' });
    const id = await ensureDefaultAccount(store, repo, SPACE, 'saving');
    expect(id).toBe(defaultAccountId(SPACE, 'saving'));
    const minted = await store.get('account', id);
    expect(minted).toMatchObject({ type: 'savings', source: 'manual', defaultFor: 'saving', balanceCents: 0, currency: 'EUR' });
    // second call returns the same pot without re-minting
    expect(await ensureDefaultAccount(store, repo, SPACE, 'saving')).toBe(id);
  });

  it('links bare movement rows onto the default pot — type kept, mirror minted; value stories untouched', async () => {
    const { store, repo } = fresh();
    await repo.upsert('space', SPACE, SPACE, { name: 'Home', currency: 'EUR' });
    await repo.upsert('account', SPACE, 'main', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 100_000 });
    await repo.upsert('account', SPACE, 'pot', { name: 'Holiday pot', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 0 });
    // the bare set-aside: ◆ movement category, no counterparty
    await repo.upsert('transaction', SPACE, 'bare1', {
      accountId: 'main', date: '2026-07-01', amountCents: -5000, currency: 'EUR',
      merchant: 'Set aside', catId: 'savingDeposit', txType: 'saving', needsReview: 0,
    });
    // interest is a value story, not a movement — never links
    await repo.upsert('transaction', SPACE, 'interest1', {
      accountId: 'main', date: '2026-07-02', amountCents: 300, currency: 'EUR',
      merchant: 'Interest', catId: 'savingInterest', txType: 'income', needsReview: 0,
    });
    // rows ON a special account are the pot's own ledger — untouched
    await repo.upsert('transaction', SPACE, 'onpot1', {
      accountId: 'pot', date: '2026-07-03', amountCents: 2000, currency: 'EUR',
      merchant: 'Deposit', catId: 'savingDeposit', txType: 'saving', needsReview: 0,
    });

    const touched = await migrateBareSpecialRows(store, repo);
    expect(touched).toBe(1);

    const migrated = await store.get('transaction', 'bare1');
    expect(migrated?.linkedAccountId).toBe(defaultAccountId(SPACE, 'saving'));
    // the counterparty rule: a DEFAULT pot keeps the special category's type
    expect(migrated?.txType).toBe('saving');
    expect(migrated?.transferPeerId).toBeTruthy();
    // the pot's leg exists and carries the money
    const mirror = await store.get('transaction', migrated!.transferPeerId!);
    expect(mirror).toMatchObject({ accountId: defaultAccountId(SPACE, 'saving'), amountCents: 5000 });

    expect((await store.get('transaction', 'interest1'))?.linkedAccountId).toBeUndefined();
    expect((await store.get('transaction', 'onpot1'))?.linkedAccountId).toBeUndefined();
    // #221: no marker — the fold runs every boot; idempotence comes from
    // the rows being linked now
    expect(await migrateBareSpecialRows(store, repo)).toBe(0);
  });

  it('#221: bare movement rows link — the ATM pair onto the CASH wallet; #228 r3: a clueless transfer stands down instead', async () => {
    const { store, repo } = fresh();
    await repo.upsert('space', SPACE, SPACE, { name: 'Home', currency: 'EUR' });
    await repo.upsert('account', SPACE, 'main', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 100_000 });
    // the screenshot case: munni predicted Cash Withdraw, no counterparty
    await repo.upsert('transaction', SPACE, 'atm1', {
      accountId: 'main', date: '2026-07-10', amountCents: -100, currency: 'EUR',
      merchant: 'Geldmaat', catId: 'cashWithdraw', txType: 'transfer', needsReview: 1,
    });
    await repo.upsert('transaction', SPACE, 'tout1', {
      accountId: 'main', date: '2026-07-11', amountCents: -2500, currency: 'EUR',
      merchant: 'Moved out', catId: 'transferOut', txType: 'transfer', needsReview: 0,
    });
    await repo.upsert('transaction', SPACE, 'fund1', {
      accountId: 'main', date: '2026-07-12', amountCents: -4000, currency: 'EUR',
      merchant: 'To the pot', catId: 'fundingOut', txType: 'funding', needsReview: 0,
    });

    expect(await migrateBareSpecialRows(store, repo)).toBe(3);

    const atm = await store.get('transaction', 'atm1');
    expect(atm?.linkedAccountId).toBe(defaultAccountId(SPACE, 'cash'));
    expect(atm?.needsReview).toBe(1); // healing is not reviewing
    // the wallet's leg files by ITS counter's kind (the checking source)
    const atmMirror = await store.get('transaction', atm!.transferPeerId!);
    expect(atmMirror).toMatchObject({ accountId: defaultAccountId(SPACE, 'cash'), amountCents: 100, catId: 'transferIn' });
    // the wallet's balance moved with the leg
    expect((await store.get('account', defaultAccountId(SPACE, 'cash')))?.balanceCents).toBe(100);

    // #228 r3 (user rule): "Moved out" names no tracked account — the
    // transfer stands down to Uncategorized and goes back to review;
    // the transfer default is never minted for it
    const tout = await store.get('transaction', 'tout1');
    expect(tout).toMatchObject({ catId: 'uncategorized', txType: 'expense', needsReview: 1 });
    expect(tout?.linkedAccountId).toBeUndefined();
    expect(await store.get('account', defaultAccountId(SPACE, 'transfer'))).toBeUndefined();
    // funding links its pot but mints NOTHING (#152: funding shows no rows)
    const fund = await store.get('transaction', 'fund1');
    expect(fund?.linkedAccountId).toBe(defaultAccountId(SPACE, 'funding'));
    expect(fund?.transferPeerId).toBeUndefined();

    // every-boot idempotence: nothing left to do
    expect(await migrateBareSpecialRows(store, repo)).toBe(0);
  });

  it('#228 r3: a bare transfer whose text names a tracked account links IT — the bijection refiles the category', async () => {
    const { store, repo } = fresh();
    await repo.upsert('space', SPACE, SPACE, { name: 'Home', currency: 'EUR' });
    await repo.upsert('account', SPACE, 'main', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 100_000 });
    // the user's PayPal case: a camt-imported PayPal account exists in the space
    await repo.upsert('account', SPACE, 'pp', { name: 'PayPal o.doker@live.nl', type: 'checking', source: 'camt053', currency: 'EUR', balanceCents: 0 });
    // and a manual savings pot with a distinctive name
    await repo.upsert('account', SPACE, 'vak', { name: 'Vakantiepot', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('transaction', SPACE, 'pp1', {
      accountId: 'main', date: '2026-07-14', amountCents: -799, currency: 'EUR',
      merchant: 'PayPal Europe S.a.r.l. et Cie S.C.A', catId: 'transferOut', txType: 'transfer', needsReview: 0,
      description: 'Incasso · Naam: PayPal Europe S.a.r.l. et Cie S.C.A Omschrijving: 1051635911097/PAYPAL',
      counterIban: 'LU89751000135104200E',
    });
    await repo.upsert('transaction', SPACE, 'vak1', {
      accountId: 'main', date: '2026-07-15', amountCents: -12_000, currency: 'EUR',
      merchant: 'Overboeking naar Vakantiepot', catId: 'transferOut', txType: 'transfer', needsReview: 0,
    });

    expect(await migrateBareSpecialRows(store, repo)).toBe(2);

    // the PayPal feed account is bank-fed: linked, no mirror minted —
    // the real PayPal-side row pairs later
    const pp = await store.get('transaction', 'pp1');
    expect(pp?.linkedAccountId).toBe('pp');
    expect(pp?.catId).toBe('transferOut');
    expect(pp?.transferPeerId).toBeUndefined();
    // the savings pot is manual: the link mints its leg and the category
    // refiles by the counter's kind (transfer → set aside)
    const vak = await store.get('transaction', 'vak1');
    expect(vak?.linkedAccountId).toBe('vak');
    expect(vak?.catId).toBe('savingDeposit');
    expect(vak?.transferPeerId).toBeTruthy();
    expect((await store.get('account', 'vak'))?.balanceCents).toBe(12_000);

    expect(await migrateBareSpecialRows(store, repo)).toBe(0);
  });

  it('#228 r3: bare transfer PARTS resolve the same way — matched parts link, clueless parts go uncategorized and the container returns to review', async () => {
    const { store, repo } = fresh();
    await repo.upsert('space', SPACE, SPACE, { name: 'Home', currency: 'EUR' });
    await repo.upsert('account', SPACE, 'main', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('account', SPACE, 'pp', { name: 'PayPal o.doker@live.nl', type: 'checking', source: 'camt053', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('transaction', SPACE, 'split1', {
      accountId: 'main', date: '2026-07-16', amountCents: -3000, currency: 'EUR',
      merchant: 'PayPal Europe S.a.r.l. et Cie S.C.A', catId: 'transferOut', txType: 'transfer', needsReview: 0,
      splits: [
        { id: 'p1', catId: 'transferOut', amountCents: 2000, txType: 'transfer' },
        { id: 'p2', catId: 'groceries', amountCents: 1000 },
      ],
    });
    await repo.upsert('transaction', SPACE, 'split2', {
      accountId: 'main', date: '2026-07-17', amountCents: -3000, currency: 'EUR',
      merchant: 'Verzamelbetaling', catId: 'transferOut', txType: 'transfer', needsReview: 0,
      splits: [
        { id: 'q1', catId: 'transferOut', amountCents: 2000, txType: 'transfer' },
        { id: 'q2', catId: 'groceries', amountCents: 1000 },
      ],
    });

    expect(await migrateBareSpecialRows(store, repo)).toBe(2);

    const matched = await store.get('transaction', 'split1');
    expect(matched?.splits?.[0]).toMatchObject({ id: 'p1', catId: 'transferOut', linkedAccountId: 'pp' });
    expect(matched?.needsReview).toBe(0);
    // no clue: the part stands down and the human decides again
    const clueless = await store.get('transaction', 'split2');
    expect(clueless?.splits?.[0]).toMatchObject({ id: 'q1', catId: 'uncategorized' });
    expect(clueless?.splits?.[0]?.linkedAccountId).toBeUndefined();
    expect(clueless?.splits?.[0]?.txType).toBeUndefined();
    expect(clueless?.needsReview).toBe(1);

    expect(await migrateBareSpecialRows(store, repo)).toBe(0);
  });

  it('#221: ensureSpaceDefaultAccounts mints all six, once', async () => {
    const { store, repo } = fresh();
    await repo.upsert('space', SPACE, SPACE, { name: 'Home', currency: 'EUR' });
    const { ensureSpaceDefaultAccounts } = await import('./defaultAccounts');
    await ensureSpaceDefaultAccounts(store, repo, SPACE);
    await ensureSpaceDefaultAccounts(store, repo, SPACE); // idempotent
    const defaults = (await store.bySpace('account', SPACE)).filter((a) => a.deleted === 0 && a.defaultFor);
    expect(defaults).toHaveLength(6);
    const byFamily = new Map(defaults.map((a) => [a.defaultFor, a.type]));
    expect(byFamily.get('saving')).toBe('savings');
    expect(byFamily.get('debtPayment')).toBe('loan');
    expect(byFamily.get('investment')).toBe('brokerage');
    expect(byFamily.get('transfer')).toBe('checking');
    expect(byFamily.get('cash')).toBe('cash');
    expect(byFamily.get('funding')).toBe('funding');
  });

  it('migrates bare movement PARTS of a split through the part-mirror machinery', async () => {
    const { store, repo } = fresh();
    await repo.upsert('space', SPACE, SPACE, { name: 'Home', currency: 'EUR' });
    await repo.upsert('account', SPACE, 'main', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 100_000 });
    await repo.upsert('transaction', SPACE, 'split1', {
      accountId: 'main', date: '2026-07-05', amountCents: -6500, currency: 'EUR',
      merchant: 'Phone bill', catId: 'telecom', txType: 'expense', needsReview: 0,
      splits: [
        { id: 'p1', catId: 'telecom', amountCents: 4000 },
        { id: 'p2', catId: 'savingDeposit', amountCents: 2500, txType: 'saving', label: 'Device pot' },
      ],
    });

    expect(await migrateBareSpecialRows(store, repo)).toBe(1);
    const row = await store.get('transaction', 'split1');
    const part = row?.splits?.find((s) => s.id === 'p2');
    expect(part?.linkedAccountId).toBe(defaultAccountId(SPACE, 'saving'));
    expect(part?.transferPeerId).toBeTruthy();
    const partMirror = await store.get('transaction', part!.transferPeerId!);
    expect(partMirror).toMatchObject({ accountId: defaultAccountId(SPACE, 'saving'), amountCents: 2500 });
    // the untouched part stays untouched
    expect(row?.splits?.find((s) => s.id === 'p1')?.linkedAccountId).toBeUndefined();
  });
});

/** #228 (user): ONE counterparty per (split) transaction — the fold
 *  that rewrites what the retired per-entry model stored */
describe('#228: the entry-counter fold', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });

  async function seeded() {
    const store = new DexieBackend(new MunniDB(`munni_fold228_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    const repo = new Repo(store, new HlcClock('fold228'), { trackOutbox: false });
    await repo.upsert('space', SPACE, SPACE, { name: 'Home', currency: 'EUR' });
    await repo.upsert('account', SPACE, 'main', { name: 'Checking', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 100_000 });
    await repo.upsert('account', SPACE, 'pot', { name: 'Pot', type: 'savings', source: 'manual', currency: 'EUR', balanceCents: 0 });
    return { store, repo };
  }

  /** the retired shape: an entry carrying its own link + own-key mint */
  const legacyEntry = (catId: string, amountCents: number, over: object = {}) =>
    ({ catId, amountCents, ...over }) as never;

  it('relocates a lone linked entry onto the ROW — the old entry mint retires, the row mint takes over, balances hold', async () => {
    const { store, repo } = await seeded();
    const oldMid = mirrorTxId(catMirrorSourceId('r1', 'savingDeposit'));
    // the r4 world already minted the entry-keyed leg and moved €40
    await repo.upsert('transaction', SPACE, oldMid, {
      accountId: 'pot', date: '2026-08-01', amountCents: 4000, currency: 'EUR',
      merchant: 'Set aside', txType: 'saving', catId: 'savingDeposit', needsReview: 0,
      linkedAccountId: 'main', transferPeerId: 'r1',
    });
    await repo.upsert('account', SPACE, 'pot', { balanceCents: 4000 });
    await repo.upsert('transaction', SPACE, 'r1', {
      accountId: 'main', date: '2026-08-01', amountCents: -4000, currency: 'EUR',
      merchant: 'Set aside', txType: 'saving', needsReview: 0, catId: 'savingDeposit',
      cats: [legacyEntry('savingDeposit', 4000, { linkedAccountId: 'pot', transferPeerId: oldMid })],
    });

    expect(await migrateEntryCounters(store, repo)).toBe(1);
    const row = await store.get('transaction', 'r1');
    expect(row?.linkedAccountId).toBe('pot');
    expect(row?.cats ?? undefined).toBeUndefined();
    // the mirror now lives under the ROW key; the old entry key is gone
    expect(row?.transferPeerId).toBe(mirrorTxId('r1'));
    expect((await store.get('transaction', oldMid))?.deleted).toBe(1);
    expect(await store.get('transaction', mirrorTxId('r1'))).toMatchObject({ accountId: 'pot', amountCents: 4000 });
    // retire refunded €40, the fresh row-key mint moved it again
    expect((await store.get('account', 'pot'))?.balanceCents).toBe(4000);
    // every-boot idempotence
    expect(await migrateEntryCounters(store, repo)).toBe(0);
  });

  it('converts a mixed special spread into a REAL split — deterministic parts, links riding, mints re-keyed', async () => {
    const { store, repo } = await seeded();
    const oldMid = mirrorTxId(catMirrorSourceId('r2', 'savingDeposit'));
    await repo.upsert('transaction', SPACE, oldMid, {
      accountId: 'pot', date: '2026-08-02', amountCents: 4000, currency: 'EUR',
      merchant: 'Mixed', txType: 'saving', catId: 'savingDeposit', needsReview: 0,
      linkedAccountId: 'main', transferPeerId: 'r2',
    });
    await repo.upsert('account', SPACE, 'pot', { balanceCents: 4000 });
    await repo.upsert('transaction', SPACE, 'r2', {
      accountId: 'main', date: '2026-08-02', amountCents: -10_000, currency: 'EUR',
      merchant: 'Mixed', txType: 'expense', needsReview: 0, catId: 'groceries',
      cats: [
        legacyEntry('groceries', 6000),
        legacyEntry('savingDeposit', 4000, { linkedAccountId: 'pot', transferPeerId: oldMid }),
      ],
    });

    expect(await migrateEntryCounters(store, repo)).toBe(1);
    const row = await store.get('transaction', 'r2');
    expect(row?.cats ?? undefined).toBeUndefined();
    const parts = row?.splits ?? [];
    expect(parts).toHaveLength(2);
    // deterministic ids: two devices folding concurrently converge
    const savePart = parts.find((p) => p.catId === 'savingDeposit');
    expect(savePart?.id).toBe(foldPartId('r2', 'savingDeposit'));
    expect(savePart?.linkedAccountId).toBe('pot');
    expect(parts.find((p) => p.catId === 'groceries')?.id).toBe(foldPartId('r2', 'groceries'));
    // the compat shadow follows the largest part
    expect(row?.catId).toBe('groceries');
    // the entry mint re-keyed to the PART: old key tombstoned, part key live
    expect((await store.get('transaction', oldMid))?.deleted).toBe(1);
    expect(savePart?.transferPeerId).toBeTruthy();
    expect(await store.get('transaction', savePart!.transferPeerId!)).toMatchObject({ accountId: 'pot', amountCents: 4000 });
    expect((await store.get('account', 'pot'))?.balanceCents).toBe(4000);
    expect(await migrateEntryCounters(store, repo)).toBe(0);
  });

  it('keeps regular spreads untouched; settled shapes collapse around the lone real entry', async () => {
    const { store, repo } = await seeded();
    // a plain regular spread is the SUPPORTED shape — not a candidate
    await repo.upsert('transaction', SPACE, 'ok1', {
      accountId: 'main', date: '2026-08-03', amountCents: -5000, currency: 'EUR',
      merchant: 'Groceries + sweets', txType: 'expense', needsReview: 0, catId: 'groceries',
      cats: [legacyEntry('groceries', 3000), legacyEntry('sweets', 2000)],
    });
    // settled + linked single entry: the link moves up, the settled
    // spread shape stays (gross invariant intact)
    await repo.upsert('transaction', SPACE, 'r3', {
      accountId: 'main', date: '2026-08-04', amountCents: -8000, currency: 'EUR',
      merchant: 'Settled saver', txType: 'saving', needsReview: 0, catId: 'savingDeposit',
      cats: [
        legacyEntry('savingDeposit', 5000, { linkedAccountId: 'pot' }),
        legacyEntry('reimbursed', 3000),
      ],
    });

    expect(await migrateEntryCounters(store, repo)).toBe(1);
    expect((await store.get('transaction', 'ok1'))?.cats).toHaveLength(2);
    const row = await store.get('transaction', 'r3');
    expect(row?.linkedAccountId).toBe('pot');
    expect(row?.catId).toBe('savingDeposit');
    expect(row?.cats).toHaveLength(2);
    expect(row?.cats?.map((c) => c.catId)).toEqual(['savingDeposit', 'reimbursed']);
    // no stray link fields survive on entries
    expect(row?.cats?.some((c) => (c as { linkedAccountId?: string }).linkedAccountId)).toBe(false);
  });

  it('flattens a PART whose spread mixed a special — each entry its own part, the part story carried', async () => {
    const { store, repo } = await seeded();
    await repo.upsert('transaction', SPACE, 'r4', {
      accountId: 'main', date: '2026-08-05', amountCents: -9000, currency: 'EUR',
      merchant: 'Deep split', txType: 'expense', needsReview: 0, catId: 'telecom',
      splits: [
        { id: 'p1', catId: 'telecom', amountCents: 4000 },
        {
          id: 'p2', catId: 'groceries', amountCents: 5000, label: 'Mixed part', eventId: 'ev1',
          cats: [
            legacyEntry('groceries', 3000),
            legacyEntry('savingDeposit', 2000, { linkedAccountId: 'pot' }),
          ],
        },
      ],
    });

    expect(await migrateEntryCounters(store, repo)).toBe(1);
    const parts = (await store.get('transaction', 'r4'))?.splits ?? [];
    expect(parts.map((p) => p.catId).sort((a, b) => a.localeCompare(b))).toEqual(['groceries', 'savingDeposit', 'telecom']);
    const savePart = parts.find((p) => p.catId === 'savingDeposit');
    expect(savePart?.linkedAccountId).toBe('pot');
    expect(savePart?.eventId).toBe('ev1'); // the part's event rides every successor
    expect(parts.find((p) => p.catId === 'groceries')?.label).toBe('Mixed part');
    // the part-key mint exists, sized to the ENTRY's money
    expect(savePart?.transferPeerId).toBeTruthy();
    expect(await store.get('transaction', savePart!.transferPeerId!)).toMatchObject({ accountId: 'pot', amountCents: 2000 });
    expect((await store.get('account', 'pot'))?.balanceCents).toBe(2000);
  });
});
