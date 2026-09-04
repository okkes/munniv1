/**
 * Memory-leak WATCH (#135), not a profiler: where the platform exposes a
 * JS heap size (Chromium — Android WebView, desktop/mobile Chrome PWA),
 * sample it on a slow clock and report SUSTAINED growth to GlitchTip
 * once per session, with the samples attached so the leak is
 * diagnosable later. iOS WebKit exposes no heap API — its coverage is
 * the CI leak spec driving the same shared code in Chromium
 * (tests/specs/leak.gallery.spec.js).
 *
 * The bar is deliberately high (near-monotonic rise, big absolute AND
 * relative growth over a full hour) so ordinary churn never pages.
 */

const SAMPLE_MS = 5 * 60_000;
const WINDOW = 12; // one hour of samples
const MIN_RISE_BYTES = 80 * 1024 * 1024;
const MIN_RISE_RATIO = 1.5;

interface HeapSource {
  usedJSHeapSize: number;
}

/** near-monotonic: every step holds or rises (2% jitter allowed) */
const sustainedRise = (samples: readonly number[]): boolean =>
  samples.every((value, i) => i === 0 || value >= samples[i - 1] * 0.98);

export function installMemWatch(
  report: (message: string, extra: Record<string, unknown>) => void,
  heap?: HeapSource,
): () => void {
  const source = heap ?? (performance as { memory?: HeapSource }).memory;
  if (!source) return () => undefined; // iOS WebKit and friends: no heap API
  const samples: number[] = [];
  let reported = false;
  const tick = () => {
    samples.push(source.usedJSHeapSize);
    if (samples.length > WINDOW) samples.shift();
    if (reported || samples.length < WINDOW) return;
    const first = samples[0];
    const last = samples.at(-1) as number;
    if (sustainedRise(samples) && last - first > MIN_RISE_BYTES && last / first > MIN_RISE_RATIO) {
      reported = true; // one alarm per session — the samples say the rest
      report('memory-growth', {
        firstBytes: first,
        lastBytes: last,
        minutes: (WINDOW * SAMPLE_MS) / 60_000,
        samples: [...samples],
      });
    }
  };
  const id = setInterval(tick, SAMPLE_MS);
  return () => clearInterval(id);
}
