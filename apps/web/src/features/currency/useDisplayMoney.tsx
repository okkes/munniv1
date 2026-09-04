import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@/db/useQuery';
import { useData } from '@/app/data';
import { useSession } from '@/app/session';
import { useLang } from '@/i18n';
import { fmtCents } from '@/lib/money';
import { ensureRates, fmtDisplay, readManualRates, readRatesCache } from '@/lib/rates';
import type { DisplayContext } from '@/lib/rates';

export interface DisplayMoney {
  displayCurrency: string | null;
  display: DisplayContext | null;
  fmt: (cents: number, currency: string, opts?: { sign?: boolean; date?: string }) => string;
  ensureDates: (dates: readonly string[]) => void;
}

/**
 * The display-currency lens (currency plan CD3): reads the user-level
 * preference from the profile, keeps the latest ECB rates warm (signed-in
 * only — offline identities never call out, they use pinned manual
 * pairs), and hands surfaces one `fmt` that renders any amount in the
 * chosen currency, marked ≈. With no preference set it is exactly
 * fmtCents — "as recorded" costs nothing.
 *
 * Subscriptions live ONCE in the provider (AppLayout): the first
 * version ran this hook per TxRow, which meant hundreds of store
 * subscriptions all re-reading the rates cache on EVERY write emission
 * — a real slowdown during sync pulls (it melted the multi-user e2e
 * specs on cold CI runners before it would have melted real devices).
 */
function useDisplayMoneyStandalone(): DisplayMoney {
  const { lang } = useLang();
  const { store } = useData();
  const identity = useSession((s) => s.identity);
  const profile = useQuery(
    store,
    async () => (await store.metaGet('profile'))?.value as { displayCurrency?: string } | undefined,
    [],
  );
  const displayCurrency = profile?.displayCurrency ?? null;
  const cache = useQuery(store, async () => readRatesCache(store), []);
  const manual = useQuery(store, async () => readManualRates(store), []);
  const online = identity?.kind === 'user';

  useEffect(() => {
    if (!displayCurrency || !online) return;
    void ensureRates(store, ['latest']).catch(() => undefined);
  }, [displayCurrency, online, store]);

  const display: DisplayContext | null = useMemo(
    () => (displayCurrency && cache ? { currency: displayCurrency, cache, manual: manual ?? {} } : null),
    [displayCurrency, cache, manual],
  );

  const fmt = useCallback(
    (cents: number, currency: string, opts?: { sign?: boolean; date?: string }) =>
      fmtDisplay(cents, currency, lang, display, opts),
    [display, lang],
  );

  /** transaction lists call this with their visible dates so rows can
   *  convert at their OWN day's fixing (historically honest lists) */
  const ensureDates = useCallback(
    (dates: readonly string[]) => {
      if (!displayCurrency || !online || dates.length === 0) return;
      void ensureRates(store, dates).catch(() => undefined);
    },
    [displayCurrency, online, store],
  );

  return { displayCurrency, display, fmt, ensureDates };
}

const DisplayMoneyContext = createContext<DisplayMoney | null>(null);

/** mounted once inside the authed layout — all screens and rows share it */
export function DisplayMoneyProvider({ children }: Readonly<{ children: ReactNode }>) {
  const value = useDisplayMoneyStandalone();
  return <DisplayMoneyContext.Provider value={value}>{children}</DisplayMoneyContext.Provider>;
}

export function useDisplayMoney(): DisplayMoney {
  const ctx = useContext(DisplayMoneyContext);
  const { lang } = useLang();
  // outside the provider (odd mounts, isolated tests): plain fmtCents,
  // zero store subscriptions — never silently recreate the heavy path
  const fallback = useMemo<DisplayMoney>(
    () => ({
      displayCurrency: null,
      display: null,
      fmt: (cents, currency, opts) => fmtCents(cents, currency, lang, opts),
      ensureDates: () => undefined,
    }),
    [lang],
  );
  return ctx ?? fallback;
}
