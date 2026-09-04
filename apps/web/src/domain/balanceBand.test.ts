import { describe, expect, it } from 'vitest';
import { bandEligible, bandIncludes, bandModeOf } from './balanceBand';
import type { AccountRow } from '@/db/types';

const acct = (id: string, type: AccountRow['type']) => ({ id, type });

describe('balance band modes', () => {
  it('defaults to net worth (the pre-config behavior)', () => {
    expect(bandModeOf(undefined)).toBe('networth');
    expect(bandModeOf({})).toBe('networth');
    expect(bandModeOf({ balanceBandMode: 'cash' })).toBe('cash');
  });

  it('cash counts liquid types only; exclusions bite; spendable takes no toggles', () => {
    expect(bandIncludes('cash', acct('a', 'checking'), {})).toBe(true);
    expect(bandIncludes('cash', acct('a', 'loan'), {})).toBe(false);
    expect(bandIncludes('cash', acct('a', 'cash'), { balanceBandExclude: ['a'] })).toBe(false);
    expect(bandEligible('spendable', acct('a', 'checking'))).toBe(false);
  });

  it('net worth counts everything minus exclusions; custom is an explicit include list', () => {
    expect(bandIncludes('networth', acct('l', 'loan'), {})).toBe(true);
    expect(bandIncludes('networth', acct('l', 'loan'), { balanceBandExclude: ['l'] })).toBe(false);
    expect(bandIncludes('custom', acct('a', 'checking'), {})).toBe(false);
    expect(bandIncludes('custom', acct('a', 'checking'), { balanceBandAccounts: ['a'] })).toBe(true);
  });
});
