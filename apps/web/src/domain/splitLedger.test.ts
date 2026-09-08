import { describe, expect, it } from 'vitest';
import { netPositions, settlementPlan } from './splitLedger';

const MEMBERS = ['anna', 'ben', 'carol'];

describe('split ledger (SP1)', () => {
  it('paid minus own shares — the books always balance to zero', () => {
    const nets = netPositions(
      [
        // Anna pays €30 tapas, equal thirds
        { paidByUserId: 'anna', amountCents: 3000, shares: [{ userId: 'anna', cents: 1000 }, { userId: 'ben', cents: 1000 }, { userId: 'carol', cents: 1000 }] },
        // Ben pays €12 metro for Ben+Carol only
        { paidByUserId: 'ben', amountCents: 1200, shares: [{ userId: 'ben', cents: 600 }, { userId: 'carol', cents: 600 }] },
      ],
      MEMBERS,
    );
    expect(nets.get('anna')).toBe(2000);
    expect(nets.get('ben')).toBe(-400);
    expect(nets.get('carol')).toBe(-1600);
    expect([...nets.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('a settlement is just an entry whose only share holder is the receiver', () => {
    const nets = netPositions(
      [
        { paidByUserId: 'anna', amountCents: 3000, shares: [{ userId: 'anna', cents: 1500 }, { userId: 'ben', cents: 1500 }] },
        // Ben settles: pays Anna €15
        { paidByUserId: 'ben', amountCents: 1500, shares: [{ userId: 'anna', cents: 1500 }] },
      ],
      ['anna', 'ben'],
    );
    expect(nets.get('anna')).toBe(0);
    expect(nets.get('ben')).toBe(0);
    expect(settlementPlan(nets)).toEqual([]);
  });

  it('greedy netting produces at most n-1 transfers, deterministically', () => {
    const nets = new Map([
      ['anna', 2000],
      ['ben', -400],
      ['carol', -1600],
    ]);
    expect(settlementPlan(nets)).toEqual([
      { fromUserId: 'carol', toUserId: 'anna', cents: 1600 },
      { fromUserId: 'ben', toUserId: 'anna', cents: 400 },
    ]);
  });

  it('ties break by user id so every member computes the identical plan', () => {
    const nets = new Map([
      ['zoe', -500],
      ['abe', -500],
      ['mia', 1000],
    ]);
    expect(settlementPlan(nets)).toEqual([
      { fromUserId: 'abe', toUserId: 'mia', cents: 500 },
      { fromUserId: 'zoe', toUserId: 'mia', cents: 500 },
    ]);
  });

  it('members without entries stay at zero and out of the plan', () => {
    const nets = netPositions([], MEMBERS);
    expect([...nets.values()]).toEqual([0, 0, 0]);
    expect(settlementPlan(nets)).toEqual([]);
  });
});
