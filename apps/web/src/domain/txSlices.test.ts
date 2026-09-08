import { describe, expect, it } from 'vitest';
import { hasSliceOfType, hasTypedParts, scaleSplitsTo, txSliceViews } from './txSlices';
import type { TransactionRow, TxSplit } from '@/db/types';

const row = (over: Partial<TransactionRow>): Parameters<typeof txSliceViews>[0] =>
  ({ amountCents: -8740, catId: 'groceries', txType: 'expense', ...over }) as never;

describe('txSliceViews (typed-splits v2 canonical fan-out)', () => {
  it('an unsplit row is one view of the whole', () => {
    const views = txSliceViews(row({ eventId: 'ev1', linkedAccountId: 'loan' }));
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      amountCents: -8740, catId: 'groceries', effType: 'expense', eventId: 'ev1', linkedAccountId: 'loan', index: 0, count: 1,
    });
  });

  it('a split row is exactly its parts — signed, typed, the parent a container', () => {
    const views = txSliceViews(
      row({
        splits: [
          { catId: 'groceries', amountCents: 5240 },
          { id: 's2', label: "Sarah's loan", catId: 'loanRepayment', amountCents: 2500, txType: 'debtPayment', linkedAccountId: 'loan' },
          { catId: 'housingUtility', amountCents: 1000 },
        ],
      }),
    );
    expect(views).toHaveLength(3);
    // magnitudes wear the row's sign; the bare slice inherits the row type
    expect(views[0]).toMatchObject({ amountCents: -5240, effType: 'expense', sliceId: undefined, count: 3 });
    // a typed part carries its own story
    expect(views[1]).toMatchObject({
      amountCents: -2500, effType: 'debtPayment', catId: 'loanRepayment', sliceId: 's2', label: "Sarah's loan", linkedAccountId: 'loan',
    });
    expect(views[2]).toMatchObject({ amountCents: -1000, index: 2 });
  });

  it('zero-value slices vanish; a part inherits the row event unless it names its own', () => {
    const views = txSliceViews(
      row({
        eventId: 'trip',
        splits: [
          { catId: 'restaurants', amountCents: 3000 },
          { catId: 'restaurants', amountCents: 0 },
          { id: 's3', catId: 'groceries', amountCents: 700, eventId: 'other' },
        ],
      }),
    );
    expect(views).toHaveLength(2);
    expect(views[0].eventId).toBe('trip');
    expect(views[1].eventId).toBe('other');
  });

  it('a part spread across categories fans one view per entry, the story riding each (v2.1)', () => {
    const views = txSliceViews(
      row({
        splits: [
          {
            id: 'p1',
            label: 'Weekly shop',
            catId: 'groceries',
            amountCents: 3000,
            eventId: 'trip',
            cats: [
              { catId: 'groceries', amountCents: 2000 },
              { catId: 'householdSupplies', amountCents: 1000 },
            ],
          },
          { catId: 'restaurants', amountCents: 2240 },
        ],
      }),
    );
    expect(views).toHaveLength(3);
    expect(views[0]).toMatchObject({ amountCents: -2000, catId: 'groceries', label: 'Weekly shop', eventId: 'trip', sliceId: 'p1', count: 3 });
    expect(views[1]).toMatchObject({ amountCents: -1000, catId: 'householdSupplies', label: 'Weekly shop', sliceId: 'p1', index: 1 });
    expect(views[2]).toMatchObject({ amountCents: -2240, catId: 'restaurants', index: 2 });
  });

  it('hasTypedParts: plain multi-category (even with minted ids) is NOT a part story; labels, types, links, events or spreads are', () => {
    const classic = row({ splits: [{ id: 'a', catId: 'groceries', amountCents: 5000 }, { id: 'b', catId: 'restaurants', amountCents: 3740 }] });
    expect(hasTypedParts(classic)).toBe(false);
    expect(hasTypedParts(row({}))).toBe(false);
    expect(hasTypedParts(row({ splits: [{ catId: 'g', amountCents: 1, label: 'x' }] }))).toBe(true);
    expect(hasTypedParts(row({ splits: [{ catId: 'g', amountCents: 1, txType: 'saving' }] }))).toBe(true);
    expect(hasTypedParts(row({ splits: [{ catId: 'g', amountCents: 2, cats: [{ catId: 'g', amountCents: 1 }, { catId: 'h', amountCents: 1 }] }] }))).toBe(true);
  });

  it('slices carry per-part recurring links, inheriting the row default (#126 r7)', () => {
    const views = txSliceViews(
      row({
        recurringId: 'rec-row',
        splits: [
          { catId: 'a', amountCents: 1, recurringId: 'rec-part' },
          { catId: 'b', amountCents: 1 },
        ],
      }),
    );
    expect(views.map((v) => v.recurringId)).toEqual(['rec-part', 'rec-row']);
    expect(txSliceViews(row({ recurringId: 'rec-row' }))[0].recurringId).toBe('rec-row');
  });

  it('#211: a row category spread fans one view per entry — the whole story riding each, fromParts false', () => {
    const views = txSliceViews(
      row({
        eventId: 'trip',
        recurringId: 'rec',
        cats: [
          { catId: 'groceries', amountCents: 6000 },
          { catId: 'householdSupplies', amountCents: 2740 },
        ],
      }),
    );
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      amountCents: -6000, catId: 'groceries', effType: 'expense', eventId: 'trip', recurringId: 'rec', fromParts: false, count: 2,
    });
    expect(views[1]).toMatchObject({ amountCents: -2740, catId: 'householdSupplies', fromParts: false, index: 1 });
    // a refund row's spread stays signed — positive entries
    const refund = txSliceViews(row({ amountCents: 500, cats: [{ catId: 'a', amountCents: 300 }, { catId: 'b', amountCents: 200 }] }));
    expect(refund.map((v) => v.amountCents)).toEqual([300, 200]);
  });

  it('#211: parts wear fromParts, whole rows do not; splits win when both exist (legacy shape)', () => {
    expect(txSliceViews(row({}))[0].fromParts).toBe(false);
    const split = txSliceViews(row({ splits: [{ catId: 'a', amountCents: 5000 }, { catId: 'b', amountCents: 3740 }] }));
    expect(split.every((v) => v.fromParts)).toBe(true);
  });

  it('#228: spread entries carry the OWNER\'s one counterparty — the row\'s on row spreads, the part\'s on part spreads', () => {
    const views = txSliceViews(
      row({
        linkedAccountId: 'row-acct',
        transferPeerId: 'row-peer',
        cats: [
          { catId: 'savingDeposit', amountCents: 6000, txType: 'saving' },
          { catId: 'reimbursed', amountCents: 2740 },
        ],
      }),
    );
    expect(views[0]).toMatchObject({ effType: 'saving', linkedAccountId: 'row-acct', transferPeerId: 'row-peer' });
    expect(views[1]).toMatchObject({ linkedAccountId: 'row-acct' });

    // a PART's spread entries ride the part's story the same way
    const partViews = txSliceViews(
      row({
        splits: [
          {
            id: 'p1', catId: 'a', amountCents: 8740, linkedAccountId: 'part-acct',
            cats: [
              { catId: 'a', amountCents: 5000 },
              { catId: 'b', amountCents: 3740 },
            ],
          },
        ],
      }),
    );
    expect(partViews[0].linkedAccountId).toBe('part-acct');
    expect(partViews[1].linkedAccountId).toBe('part-acct');
  });

  it('hasSliceOfType answers filters per effective type', () => {
    const split = row({
      splits: [
        { catId: 'groceries', amountCents: 5240 },
        { catId: 'loanRepayment', amountCents: 2500, txType: 'debtPayment' },
      ],
    });
    expect(hasSliceOfType(split, 'debtPayment')).toBe(true);
    expect(hasSliceOfType(split, 'saving')).toBe(false);
    expect(hasSliceOfType(row({}), 'expense')).toBe(true);
  });
});

describe('scaleSplitsTo (#141: the split bulk copy)', () => {
  const mint = () => {
    let n = 0;
    return () => `id-${++n}`;
  };

  it('resizes proportionally, sums exactly, mints fresh ids, drops per-transaction stories', () => {
    const source: TxSplit[] = [
      { id: 'a', catId: 'telecom', amountCents: 4000, label: 'Base', txType: 'expense' },
      {
        id: 'b', catId: 'savingDeposit', amountCents: 2500, txType: 'saving',
        linkedAccountId: 'pot', transferPeerId: 'peer', eventId: 'ev', recurringId: 'rec', notes: 'x',
      },
    ];
    const scaled = scaleSplitsTo(source, 13000, mint());
    expect(scaled.map((s) => s.amountCents)).toEqual([8000, 5000]);
    expect(scaled[0]).toMatchObject({ id: 'id-1', catId: 'telecom', label: 'Base', txType: 'expense' });
    // the linked part travels as its category only — no account, no
    // event, no recurring link, no type that leans on the link
    expect(scaled[1].txType).toBeUndefined();
    expect(scaled[1].linkedAccountId).toBeUndefined();
    expect(scaled[1].transferPeerId).toBeUndefined();
    expect(scaled[1].eventId).toBeUndefined();
    expect(scaled[1].recurringId).toBeUndefined();
    expect(scaled[1].notes).toBeUndefined();
  });

  it('scales category spreads inside a part; odd cents land by largest remainder', () => {
    const source: TxSplit[] = [
      { id: 'a', catId: 'telecom', amountCents: 40, cats: [{ catId: 'coffee', amountCents: 15 }, { catId: 'telecom', amountCents: 25 }] },
      { id: 'b', catId: 'groceries', amountCents: 25 },
    ];
    const scaled = scaleSplitsTo(source, 100, () => 'x');
    expect(scaled.map((s) => s.amountCents)).toEqual([62, 38]);
    expect(scaled[0].cats).toEqual([
      { catId: 'coffee', amountCents: 23 },
      { catId: 'telecom', amountCents: 39 },
    ]);
  });

  it('refuses degenerate copies: lone parts, zero weights, zero targets, settled slices', () => {
    expect(scaleSplitsTo([{ catId: 'g', amountCents: 10 }], 100, () => 'x')).toEqual([]);
    expect(scaleSplitsTo([{ catId: 'g', amountCents: 0 }, { catId: 'h', amountCents: 0 }], 100, () => 'x')).toEqual([]);
    expect(scaleSplitsTo([{ catId: 'g', amountCents: 5 }, { catId: 'h', amountCents: 5 }], 0, () => 'x')).toEqual([]);
    // a settled Reimbursed slice never travels
    const withSettled: TxSplit[] = [
      { catId: 'g', amountCents: 30 },
      { catId: 'h', amountCents: 30 },
      { catId: 'reimbursed', amountCents: 40 },
    ];
    expect(scaleSplitsTo(withSettled, 60, () => 'x').map((s) => s.catId)).toEqual(['g', 'h']);
  });
});
