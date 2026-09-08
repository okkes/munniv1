/**
 * Native update detection (native-benefits §4). Web deploys and store
 * binaries are stamped with the SAME git commit count, so the hosted
 * /version.json build being newer than the shell's own build means an
 * update sits on the store. Pure logic here; IO lives in the caller.
 */

export interface UpdateCheckState {
  lastCheckedAt?: number;
  dismissedBuild?: number;
}

const CHECK_INTERVAL_MS = 20 * 3600 * 1000; // roughly daily, DST-proof

export function shouldCheckForUpdate(state: UpdateCheckState, now: number): boolean {
  return now - (state.lastCheckedAt ?? 0) >= CHECK_INTERVAL_MS;
}

export function updateAvailable(appBuild: number, remoteBuild: number, dismissedBuild?: number): boolean {
  if (!Number.isFinite(appBuild) || !Number.isFinite(remoteBuild)) return false;
  return remoteBuild > appBuild && remoteBuild !== dismissedBuild;
}

/** the store page for this shell — null when there is none to link (staging iOS lives in TestFlight) */
export function nativeStoreUrl(platform: string | undefined, channel: string): string | null {
  const appId = channel === 'staging' ? 'app.munni.dev' : 'app.munni';
  if (platform === 'android') return `market://details?id=${appId}`;
  // both iOS channels ship via TestFlight today — the deep link opens the
  // TestFlight app where the update sits. Swap the production branch to
  // https://apps.apple.com/app/id6791102793 at public App Store launch.
  if (platform === 'ios') return 'itms-beta://';
  return null;
}
