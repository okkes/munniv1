import { describe, expect, it } from 'vitest';
import { nativeStoreUrl, shouldCheckForUpdate, updateAvailable } from './updateCheck';

describe('update check (native-benefits §4)', () => {
  it('checks roughly daily', () => {
    const now = Date.now();
    expect(shouldCheckForUpdate({}, now)).toBe(true);
    expect(shouldCheckForUpdate({ lastCheckedAt: now - 1 * 3600_000 }, now)).toBe(false);
    expect(shouldCheckForUpdate({ lastCheckedAt: now - 21 * 3600_000 }, now)).toBe(true);
  });

  it('newer remote build means update — unless that build was dismissed', () => {
    expect(updateAvailable(600, 640)).toBe(true);
    expect(updateAvailable(640, 640)).toBe(false);
    expect(updateAvailable(650, 640)).toBe(false);
    expect(updateAvailable(600, 640, 640)).toBe(false); // dismissed
    expect(updateAvailable(600, 650, 640)).toBe(true); // NEXT release nudges again
    expect(updateAvailable(Number.NaN, 640)).toBe(false);
  });

  it('links the right store per platform and channel', () => {
    expect(nativeStoreUrl('android', 'production')).toBe('market://details?id=app.munni');
    expect(nativeStoreUrl('android', 'staging')).toBe('market://details?id=app.munni.dev');
    expect(nativeStoreUrl('ios', 'production')).toBe('itms-beta://'); // TestFlight until the App Store launch
    expect(nativeStoreUrl('ios', 'staging')).toBe('itms-beta://'); // TestFlight has no store page
    expect(nativeStoreUrl(undefined, 'production')).toBeNull();
  });
});
