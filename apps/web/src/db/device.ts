import { HlcClock } from '@/sync/hlc';
import type { HlcState } from '@/sync/hlc';

const DEVICE_KEY = 'munni_device_id';
const HLC_KEY = 'munni_hlc_state';

/** Stable per-browser-profile device id, shared across identities. */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    // short id: HLCs embed it in every field version, so keep it compact
    id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function readHlcState(): HlcState | undefined {
  try {
    const raw = localStorage.getItem(HLC_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as HlcState;
    if (typeof parsed.lastWallMs === 'number' && typeof parsed.counter === 'number') return parsed;
  } catch {
    // corrupted state — start fresh; HLC still moves forward via wall clock
  }
  return undefined;
}

let clock: HlcClock | null = null;

/** The one clock for this device. Persisted so restarts never reissue stamps. */
export function getClock(): HlcClock {
  clock ??= new HlcClock(getDeviceId(), readHlcState(), Date.now, (state) => {
    localStorage.setItem(HLC_KEY, JSON.stringify(state));
  });
  return clock;
}
