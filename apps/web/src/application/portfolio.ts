import { useEffect, useMemo, useRef } from 'react';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { readSessionIdentity } from '@/app/session';
import { holdingView, portfolioTotals, quoteKey } from '@/domain/portfolio';
import type { HoldingView, PortfolioTotals } from '@/domain/portfolio';
import { parseDegiroPortfolio, parseDegiroTransactions } from '@/domain/degiro';
import { logActivity, logRowActivity } from './activity';
import type { HoldingRow, LotRow } from '@/db/types';
import { apiFetch } from '@/lib/api';

const QUOTE_STALE_MS = 15 * 60 * 1000;
const USD_BRIDGE = 'yahoo:EURUSD=X';

/** live quotes are a signed-in convenience: demo/offline stay silent */
export const quotesAvailable = (): boolean => readSessionIdentity()?.kind === 'user';

export interface PortfolioModel {
  views: HoldingView[];
  totals: PortfolioTotals;
}

export function usePortfolio(): PortfolioModel | undefined {
  const { store, spaceId } = useData();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const holdings = useQuery(
    store,
    async () => {
      const rows = (await store.bySpace('holding', spaceId)).filter((h) => h.deleted === 0);
      rows.sort((a, b) => (a.archived ?? 0) - (b.archived ?? 0) || a.name.localeCompare(b.name));
      return rows;
    },
    [spaceId],
  );
  const lots = useQuery(
    store,
    async () => (await store.bySpace('lot', spaceId)).filter((l) => l.deleted === 0),
    [spaceId],
  );
  const quotes = useQuery(store, async () => store.quoteCacheAll(), []);

  return useMemo(() => {
    if (!holdings || !lots || !quotes) return undefined;
    const quoteMap = new Map(quotes.map((q) => [q.key, q]));
    const currency = space?.currency ?? 'EUR';
    // EURUSD=X quotes USD per EUR — flip it to convert USD values back
    const bridge = quoteMap.get(USD_BRIDGE);
    const usdRate = currency === 'EUR' && bridge && bridge.price > 0 ? 1 / bridge.price : undefined;
    const byHolding = new Map<string, LotRow[]>();
    for (const lot of lots) {
      const list = byHolding.get(lot.holdingId) ?? [];
      list.push(lot);
      byHolding.set(lot.holdingId, list);
    }
    const views = holdings.map((h) => holdingView(h, byHolding.get(h.id) ?? [], quoteMap, currency, usdRate));
    return { views, totals: portfolioTotals(views) };
  }, [holdings, lots, quotes, space?.currency]);
}

interface QuotePayload {
  quotes: { key: string; price: number; currency: string; dayChangePct?: number }[];
}

/** once per screen open: refresh stale quotes for the live-priced holdings */
export function useQuoteRefresh(): void {
  const { store, spaceId } = useData();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !quotesAvailable() || !navigator.onLine) return;
    ran.current = true;
    void (async () => {
      const holdings = (await store.bySpace('holding', spaceId)).filter((h) => h.deleted === 0);
      const keys = new Set(holdings.map(quoteKey).filter((k): k is string => k !== null));
      if (keys.size === 0) return;
      const anyUsdCandidate = [...keys].some((k) => k.startsWith('yahoo:'));
      if (anyUsdCandidate) keys.add(USD_BRIDGE);

      const now = Date.now();
      const cached = new Map((await store.quoteCacheAll()).map((q) => [q.key, q]));
      const stale = [...keys].filter((key) => {
        const hit = cached.get(key);
        return !hit || now - Date.parse(hit.at) > QUOTE_STALE_MS;
      });
      if (stale.length === 0) return;

      const symbols = stale.filter((k) => k.startsWith('yahoo:')).map((k) => k.slice('yahoo:'.length));
      const coins = stale.filter((k) => k.startsWith('coingecko:')).map((k) => k.slice('coingecko:'.length));
      const params = new URLSearchParams();
      if (symbols.length > 0) params.set('symbols', symbols.join(','));
      if (coins.length > 0) params.set('coins', coins.join(','));
      const response = await apiFetch(`/quotes?${params.toString()}`);
      if (!response.ok) return;
      const payload = (await response.json()) as QuotePayload;
      const at = new Date().toISOString();
      await store.quoteCachePutAll(payload.quotes.map((q) => ({ key: q.key, price: q.price, currency: q.currency, dayChangePct: q.dayChangePct, at })));
    })().catch(() => undefined); // quotes are decoration; failures stay silent
  }, [store, spaceId]);
}

export interface DegiroImportResult {
  holdings: number;
  lots: number;
}

export interface PortfolioOps {
  saveHolding: (id: string | null, fields: Partial<HoldingRow>) => Promise<string>;
  removeHolding: (id: string) => Promise<void>;
  addLot: (holdingId: string, fields: Partial<LotRow>) => Promise<void>;
  removeLot: (id: string) => Promise<void>;
  /** DEGIRO exports: Portfolio.csv and/or Transactions.csv, idempotent */
  importDegiro: (files: readonly { name: string; text: string }[]) => Promise<DegiroImportResult>;
}

export function usePortfolioOps(): PortfolioOps {
  const { store, repo, spaceId } = useData();

  const upsertHolding = async (parsed: { key: string; name: string; isin?: string; assetClass: HoldingRow['assetClass'] }): Promise<number> => {
    if (await store.get('holding', parsed.key)) return 0;
    await repo.upsert('holding', spaceId, parsed.key, {
      name: parsed.name,
      isin: parsed.isin,
      assetClass: parsed.assetClass,
      currency: 'EUR',
      priceSource: 'manual',
    });
    return 1;
  };

  const importTransactionsFile = async (text: string): Promise<DegiroImportResult> => {
    const { holdings, lots } = parseDegiroTransactions(text);
    let holdingCount = 0;
    let lotCount = 0;
    for (const parsed of holdings) holdingCount += await upsertHolding(parsed);
    for (const parsed of lots) {
      if (await store.get('lot', parsed.key)) continue;
      await repo.upsert('lot', spaceId, parsed.key, {
        holdingId: parsed.holdingKey,
        kind: parsed.kind,
        date: parsed.date,
        quantity: parsed.quantity,
        totalCents: parsed.totalCents,
      });
      lotCount += 1;
    }
    return { holdings: holdingCount, lots: lotCount };
  };

  const importPortfolioFile = async (text: string): Promise<DegiroImportResult> => {
    let holdingCount = 0;
    let lotCount = 0;
    for (const parsed of parseDegiroPortfolio(text)) {
      holdingCount += await upsertHolding(parsed);
      // a position without transaction history opens at unknown cost
      const openKey = `deg:open:${parsed.key}`;
      const hasLots = (await store.bySpace('lot', spaceId)).some(
        (l) => l.holdingId === parsed.key && l.deleted === 0,
      );
      if (parsed.quantity && !hasLots && !(await store.get('lot', openKey))) {
        await repo.upsert('lot', spaceId, openKey, {
          holdingId: parsed.key,
          kind: 'buy',
          date: new Date().toISOString().slice(0, 10),
          quantity: parsed.quantity,
          totalCents: 0,
        });
        lotCount += 1;
      }
    }
    return { holdings: holdingCount, lots: lotCount };
  };

  const importDegiro = async (files: readonly { name: string; text: string }[]): Promise<DegiroImportResult> => {
    const total: DegiroImportResult = { holdings: 0, lots: 0 };
    for (const file of files) {
      const isTransactions = /datum,tijd|date,time/i.test(file.text.slice(0, 200)) || /transaction/i.test(file.name);
      const result = isTransactions ? await importTransactionsFile(file.text) : await importPortfolioFile(file.text);
      total.holdings += result.holdings;
      total.lots += result.lots;
    }
    return total;
  };

  return {
    saveHolding: async (id, fields) => {
      const rowId = id ?? repo.newId();
      await repo.upsert('holding', spaceId, rowId, fields);
      void logRowActivity(store, repo, spaceId, 'holding', rowId, id ? 'holdingEdit' : 'holdingAdd', fields.name);
      return rowId;
    },
    removeHolding: async (id) => {
      await logRowActivity(store, repo, spaceId, 'holding', id, 'holdingRemove');
      await repo.remove('holding', spaceId, id);
      const lots = (await store.bySpace('lot', spaceId)).filter((l) => l.holdingId === id && l.deleted === 0);
      for (const lot of lots) await repo.remove('lot', spaceId, lot.id);
    },
    addLot: async (holdingId, fields) => {
      await repo.upsert('lot', spaceId, repo.newId(), { holdingId, ...fields });
      void logRowActivity(store, repo, spaceId, 'holding', holdingId, 'holdingEdit');
    },
    removeLot: async (id) => {
      const lot = await store.get('lot', id);
      await repo.remove('lot', spaceId, id);
      if (lot) void logRowActivity(store, repo, spaceId, 'holding', lot.holdingId, 'holdingEdit');
    },
    importDegiro: async (files) => {
      const total = await importDegiro(files);
      if (total.holdings + total.lots > 0) void logActivity(store, repo, spaceId, 'importRun');
      return total;
    },
  };
}
