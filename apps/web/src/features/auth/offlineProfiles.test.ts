// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { addOfflineProfile, listOfflineProfiles, offlineProfileName } from './offlineProfiles';

describe('offline profile registry', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and mints a FRESH profile every time (arc 8)', () => {
    expect(listOfflineProfiles()).toEqual([]);
    const a = addOfflineProfile('  Okkes ');
    expect(a.name).toBe('Okkes');
    // arc 8 lifted one-per-device: each profile is its own world — the
    // old silent return-the-first was a landmine once multiples exist
    const b = addOfflineProfile('Partner');
    expect(b.id).not.toBe(a.id);
    expect(listOfflineProfiles().map((p) => p.name)).toEqual(['Okkes', 'Partner']);
    expect(offlineProfileName(a.id)).toBe('Okkes');
    expect(offlineProfileName(b.id)).toBe('Partner');
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('munni_offline_profiles', '{nope');
    expect(listOfflineProfiles()).toEqual([]);
    localStorage.setItem('munni_offline_profiles', JSON.stringify([{ bad: true }, { id: 'x', name: 'ok', createdAt: 1 }]));
    expect(listOfflineProfiles()).toEqual([{ id: 'x', name: 'ok', createdAt: 1 }]);
  });

  it('unknown ids resolve to undefined', () => {
    expect(offlineProfileName('nope')).toBeUndefined();
  });
});
