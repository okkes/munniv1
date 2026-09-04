/**
 * Hybrid Logical Clock.
 *
 * Every edit is stamped with an HLC so that "most recent edit wins" stays
 * correct across devices with skewed clocks and long offline periods.
 * Encoded as a fixed-width sortable string: plain string comparison of two
 * encoded HLCs is equivalent to comparing (wallMs, counter, deviceId).
 */

export interface Hlc {
  wallMs: number;
  counter: number;
  deviceId: string;
}

// 9 base36 chars cover timestamps far beyond year 5000; 4 chars cover
// counters up to 1.6M ticks within one millisecond.
const WALL_WIDTH = 9;
const COUNTER_WIDTH = 4;
const MAX_COUNTER = 36 ** COUNTER_WIDTH - 1;

export function encodeHlc(hlc: Hlc): string {
  return (
    hlc.wallMs.toString(36).padStart(WALL_WIDTH, '0') +
    '-' +
    hlc.counter.toString(36).padStart(COUNTER_WIDTH, '0') +
    '-' +
    hlc.deviceId
  );
}

export function decodeHlc(encoded: string): Hlc {
  const wallMs = Number.parseInt(encoded.slice(0, WALL_WIDTH), 36);
  const counter = Number.parseInt(encoded.slice(WALL_WIDTH + 1, WALL_WIDTH + 1 + COUNTER_WIDTH), 36);
  const deviceId = encoded.slice(WALL_WIDTH + 1 + COUNTER_WIDTH + 1);
  return { wallMs, counter, deviceId };
}

/** later > earlier; deviceId breaks exact ties deterministically. */
export function compareHlc(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export interface HlcState {
  lastWallMs: number;
  counter: number;
}

/**
 * Clock for one device. `now()` produces monotonically increasing stamps even
 * if the wall clock jumps backwards; `observe()` folds in stamps received
 * from other devices so local time never falls behind what we've seen.
 */
export class HlcClock {
  private state: HlcState;

  constructor(
    private readonly deviceId: string,
    initial?: HlcState,
    private readonly wallClock: () => number = Date.now,
    private readonly onStateChange?: (state: HlcState) => void,
  ) {
    this.state = initial ?? { lastWallMs: 0, counter: 0 };
  }

  now(): string {
    const wall = this.wallClock();
    if (wall > this.state.lastWallMs) {
      this.state = { lastWallMs: wall, counter: 0 };
    } else if (this.state.counter >= MAX_COUNTER) {
      // counter exhausted within one ms — bump logical time instead
      this.state = { lastWallMs: this.state.lastWallMs + 1, counter: 0 };
    } else {
      this.state = { lastWallMs: this.state.lastWallMs, counter: this.state.counter + 1 };
    }
    this.onStateChange?.(this.state);
    return encodeHlc({ wallMs: this.state.lastWallMs, counter: this.state.counter, deviceId: this.deviceId });
  }

  /** Fold in a remote stamp so subsequent local stamps sort after it. */
  observe(remoteEncoded: string): void {
    const remote = decodeHlc(remoteEncoded);
    const wall = this.wallClock();
    if (remote.wallMs > this.state.lastWallMs && remote.wallMs > wall) {
      this.state = { lastWallMs: remote.wallMs, counter: remote.counter + 1 };
    } else if (remote.wallMs === this.state.lastWallMs && remote.counter >= this.state.counter) {
      this.state = { lastWallMs: this.state.lastWallMs, counter: remote.counter + 1 };
    }
    // else: our clock is already ahead — nothing to do
    this.onStateChange?.(this.state);
  }

  /** How far a remote wall-clock stamp is ahead of this device (ms). Used to warn on skew. */
  skewMs(remoteEncoded: string): number {
    return decodeHlc(remoteEncoded).wallMs - this.wallClock();
  }
}
