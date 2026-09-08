import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemWatch } from './memWatch';

const SAMPLE_MS = 5 * 60_000;

describe('memWatch (#135): sustained heap growth pages once, noise never', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports ONE memory-growth event after an hour of near-monotonic rise', () => {
    const report = vi.fn();
    let used = 100 * 1024 * 1024;
    const stop = installMemWatch(report, { get usedJSHeapSize() { return used; } });
    for (let i = 0; i < 12; i++) {
      used += 16 * 1024 * 1024; // +16MB per sample → +192MB over the window
      vi.advanceTimersByTime(SAMPLE_MS);
    }
    expect(report).toHaveBeenCalledTimes(1);
    const [message, extra] = report.mock.calls[0];
    expect(message).toBe('memory-growth');
    expect(extra.samples).toHaveLength(12);
    expect(extra.lastBytes).toBeGreaterThan(extra.firstBytes);
    // the alarm fires once per session, however long the rise continues
    for (let i = 0; i < 12; i++) {
      used += 16 * 1024 * 1024;
      vi.advanceTimersByTime(SAMPLE_MS);
    }
    expect(report).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stays silent for flat or sawtooth heaps and without a heap API', () => {
    const report = vi.fn();
    let used = 400 * 1024 * 1024;
    const stop = installMemWatch(report, { get usedJSHeapSize() { return used; } });
    for (let i = 0; i < 24; i++) {
      // GC sawtooth: big rises followed by drops — never sustained
      used += i % 2 === 0 ? 120 * 1024 * 1024 : -110 * 1024 * 1024;
      vi.advanceTimersByTime(SAMPLE_MS);
    }
    expect(report).not.toHaveBeenCalled();
    stop();

    // no heap API (iOS WebKit): install is a no-op
    const stopNone = installMemWatch(report, undefined);
    vi.advanceTimersByTime(SAMPLE_MS * 24);
    expect(report).not.toHaveBeenCalled();
    stopNone();
  });
});
