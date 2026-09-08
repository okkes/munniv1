// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MANUAL_RATES_META_KEY, RATES_META_KEY, convertCents, ensureRates, fmtDisplay, readManualRates } from './rates';
import type { DayRates, DisplayContext } from './rates';

/** minimal in-memory meta store */
function memStore() {
  const meta = new Map<string, unknown>();
  return {
    meta,
    metaGet: async (key: string) => (meta.has(key) ? { key, value: meta.get(key) } : undefined),
    metaPut: async (key: string, value: unknown) => void meta.set(key, value),
  };
}

const DAY: DayRates = { date: '2026-07-22', rates: { EUR: 1, USD: 1.085, TRY: 37.5 } };

describe('convertCents', () => {
  it('is identity for the same currency and EUR-based across pairs', () => {
    expect(convertCents(1000, 'EUR', 'EUR', DAY)).toBe(1000);
    expect(convertCents(1000, 'EUR', 'USD', DAY)).toBe(1085);
    // USD → TRY crosses through EUR: 10 USD ≈ 345.62 TRY
    expect(convertCents(1000, 'USD', 'TRY', DAY)).toBe(Math.round((1000 * 37.5) / 1.085));
  });

  it('falls back to manual pairs (direct, then inverse) and null when unknown', () => {
    expect(convertCents(1000, 'USD', 'TRY', undefined, { 'USD>TRY': 36 })).toBe(36_000);
    expect(convertCents(36_000, 'TRY', 'USD', undefined, { 'USD>TRY': 36 })).toBe(1000);
    expect(convertCents(1000, 'USD', 'TRY', undefined, {})).toBeNull();
    expect(convertCents(1000, 'USD', 'CHE', DAY)).toBeNull(); // currency the day lacks
  });
});

describe('fmtDisplay', () => {
  const display: DisplayContext = {
    currency: 'TRY',
    cache: { days: { latest: DAY, '2026-01-05': { date: '2026-01-05', rates: { EUR: 1, TRY: 34 } } } },
    manual: {},
  };

  it('renders as recorded without a display currency, converted-with-≈ with one', () => {
    expect(fmtDisplay(1234, 'EUR', 'en', null)).toBe(fmtDisplay(1234, 'EUR', 'en', { ...display, currency: null }));
    expect(fmtDisplay(1234, 'EUR', 'en', null)).toContain('12.34');
    const converted = fmtDisplay(1000, 'EUR', 'en', display);
    expect(converted.startsWith('≈ ')).toBe(true);
    expect(converted).toContain('375.00'); // 10 EUR × 37.5
  });

  it('same-currency amounts never get the marker', () => {
    expect(fmtDisplay(1000, 'TRY', 'en', display).includes('≈')).toBe(false);
  });

  it('a dated amount converts at that day, not at the latest fixing', () => {
    const dated = fmtDisplay(1000, 'EUR', 'en', display, { date: '2026-01-05' });
    expect(dated).toContain('340.00'); // 10 EUR × 34 (January's rate)
  });

  it('an unknown rate renders the true amount unconverted and unmarked', () => {
    const out = fmtDisplay(1000, 'CHF', 'en', display);
    expect(out.includes('≈')).toBe(false);
    expect(out).toContain('10.00');
  });
});

describe('ensureRates', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem(
      'munni_session',
      JSON.stringify({ kind: 'user', sub: 'rates-test', name: 'R', testAuth: true }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

  it('fetches missing days once, aliases the actual fixing day, and skips cached ones', async () => {
    const store = memStore();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('date=2026-07-18')) return ok({ date: '2026-07-17', rates: { EUR: 1, USD: 1.08 } });
      return ok(DAY);
    });

    await ensureRates(store, ['latest', '2026-07-18']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const cache = store.meta.get(RATES_META_KEY) as { days: Record<string, DayRates> };
    expect(cache.days.latest.date).toBe('2026-07-22');
    // Saturday's answer is filed under the request AND the real fixing day
    expect(cache.days['2026-07-18'].date).toBe('2026-07-17');
    expect(cache.days['2026-07-17'].date).toBe('2026-07-17');

    // second call: everything cached — no network
    await ensureRates(store, ['latest', '2026-07-18', '2026-07-17']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a failed fetch keeps the existing cache intact', async () => {
    const store = memStore();
    store.meta.set(RATES_META_KEY, { days: { latest: DAY }, latestAt: 1 }); // stale latest
    fetchMock.mockImplementation(() => Promise.resolve(new Response('down', { status: 503 })));
    await ensureRates(store, ['latest']);
    const cache = store.meta.get(RATES_META_KEY) as { days: Record<string, DayRates> };
    expect(cache.days.latest.date).toBe('2026-07-22'); // old data survives
  });

  it('readManualRates tolerates a missing key', async () => {
    const store = memStore();
    expect(await readManualRates(store)).toEqual({});
    store.meta.set(MANUAL_RATES_META_KEY, { 'USD>TRY': 36 });
    expect(await readManualRates(store)).toEqual({ 'USD>TRY': 36 });
  });
});
