import { apiFetch } from '@/lib/api';
import { fmtCents } from '@/lib/money';
import type { Lang } from '@/i18n';

/**
 * Display-currency conversion (currency plan CD2). Raw amounts are
 * NEVER converted in storage — conversion is a rendering aid, applied
 * at format time and marked ≈. Rates are the ECB daily reference via
 * our /rates endpoint; every day this device has seen is cached in
 * meta, so offline renders the last known rate. Offline profiles have
 * no rate source at all — they pin manual rates per currency pair.
 */

export interface DayRates {
  /** the ECB fixing day actually used (≤ the requested day) */
  date: string;
  /** EUR-based: units of currency per 1 EUR, EUR itself included at 1 */
  rates: Record<string, number>;
}

interface RatesCache {
  /** keyed by request: 'latest' or the requested yyyy-mm-dd */
  days: Record<string, DayRates>;
  /** when 'latest' was last fetched (epoch ms) — refresh cadence */
  latestAt?: number;
}

export const RATES_META_KEY = 'fxRates';
/** manual pairs for offline profiles: 'USD>TRY' → units of TRY per 1 USD */
export const MANUAL_RATES_META_KEY = 'fxManualRates';

const LATEST_STALE_MS = 12 * 60 * 60 * 1000;
const MAX_CACHED_DAYS = 180;

/** the slice of the store this module needs (avoids an import cycle) */
interface MetaStore {
  metaGet(key: string): Promise<{ key: string; value: unknown } | undefined>;
  metaPut(key: string, value: unknown): Promise<void>;
}

export async function readRatesCache(store: MetaStore): Promise<RatesCache> {
  const raw = (await store.metaGet(RATES_META_KEY))?.value as RatesCache | undefined;
  return raw && typeof raw === 'object' && raw.days ? raw : { days: {} };
}

export async function readManualRates(store: MetaStore): Promise<Record<string, number>> {
  const raw = (await store.metaGet(MANUAL_RATES_META_KEY))?.value as Record<string, number> | undefined;
  return raw && typeof raw === 'object' ? raw : {};
}

/**
 * Fetch any missing days into the cache. `dates` entries are yyyy-mm-dd
 * or the sentinel 'latest' (refreshes on a 12h cadence — historical
 * days never change, so they cache forever). Signed-in identities only:
 * callers guard, offline never calls out.
 */
export async function ensureRates(store: MetaStore, dates: readonly string[]): Promise<void> {
  const cache = await readRatesCache(store);
  const now = Date.now();
  const wanted = [...new Set(dates)].filter((d) =>
    d === 'latest' ? !cache.days.latest || now - (cache.latestAt ?? 0) > LATEST_STALE_MS : !cache.days[d],
  );
  if (wanted.length === 0) return;

  let changed = false;
  for (const d of wanted) {
    const res = await apiFetch(d === 'latest' ? '/rates' : `/rates?date=${d}`).catch(() => null);
    if (!res?.ok) continue; // offline/unavailable — the cache keeps serving
    const day = (await res.json()) as DayRates;
    if (!day?.rates) continue;
    cache.days[d] = day;
    // the actual fixing day doubles as a key: a weekend request for the
    // 18th and a request for the 17th share one entry's data
    cache.days[day.date] = day;
    if (d === 'latest') cache.latestAt = now;
    changed = true;
  }
  if (!changed) return;

  // prune: 'latest' plus the newest dated keys — the cache must not
  // grow unbounded on a long-lived device
  const dated = Object.keys(cache.days).filter((k) => k !== 'latest');
  if (dated.length > MAX_CACHED_DAYS) {
    dated.sort((a, b) => b.localeCompare(a));
    for (const stale of dated.slice(MAX_CACHED_DAYS)) delete cache.days[stale];
  }
  await store.metaPut(RATES_META_KEY, cache);
}

/**
 * Convert integer cents between currencies via an EUR-based day, with
 * manual pairs as the fallback (offline profiles). Returns null when no
 * rate is known — callers then render the original amount unconverted.
 */
export function convertCents(
  cents: number,
  from: string,
  to: string,
  day: DayRates | undefined,
  manual?: Record<string, number>,
): number | null {
  if (from === to) return cents;
  const rFrom = day?.rates[from];
  const rTo = day?.rates[to];
  if (rFrom && rTo) return Math.round((cents * rTo) / rFrom);
  const direct = manual?.[`${from}>${to}`];
  if (direct && direct > 0) return Math.round(cents * direct);
  const inverse = manual?.[`${to}>${from}`];
  if (inverse && inverse > 0) return Math.round(cents / inverse);
  return null;
}

/**
 * Convert-then-sum for cross-currency totals (the balance band used to
 * add cents of differing currencies numerically). Unknown rates fall
 * back to the raw amount — same as before, but now the total says ≈
 * whenever any real conversion happened.
 */
export function sumCents(
  items: readonly { cents: number; currency: string }[],
  target: string,
  day: DayRates | undefined,
  manual?: Record<string, number>,
): { cents: number; approximate: boolean } {
  let total = 0;
  let approximate = false;
  for (const item of items) {
    const converted = convertCents(item.cents, item.currency, target, day, manual);
    if (converted === null) {
      total += item.cents;
    } else {
      total += converted;
      approximate = approximate || item.currency !== target;
    }
  }
  return { cents: total, approximate };
}

export interface DisplayContext {
  /** null = "as recorded": no conversion anywhere */
  currency: string | null;
  cache: RatesCache;
  manual: Record<string, number>;
}

/**
 * The one display formatter (plan: every converted value marked ≈, no
 * banner). `date` picks that day's cached fixing for historically
 * honest lists; totals and balances omit it and use the latest rate.
 * Unknown rate → the true amount in its own currency, unmarked.
 */
export function fmtDisplay(
  cents: number,
  currency: string,
  lang: Lang,
  display: DisplayContext | null | undefined,
  opts?: { sign?: boolean; date?: string },
): string {
  const target = display?.currency;
  if (!display || !target || target === currency) return fmtCents(cents, currency, lang, opts);
  const day = (opts?.date ? display.cache.days[opts.date] : undefined) ?? display.cache.days.latest;
  const converted = convertCents(cents, currency, target, day, display.manual);
  if (converted === null) return fmtCents(cents, currency, lang, opts);
  return `≈ ${fmtCents(converted, target, lang, opts)}`;
}
