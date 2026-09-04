import type { AssetClass, HoldingRow, LotRow, QuoteCacheRow } from '@/db/types';

/**
 * Portfolio math (approved investments design) — all pure. Average-cost
 * method: sells release cost proportionally; dividends and fees ride
 * alongside without touching the cost basis.
 */

export interface Position {
  qty: number;
  /** cost still tied up in the remaining units */
  costCents: number;
  /** realized result of sells against average cost */
  realizedCents: number;
  dividendCents: number;
  feeCents: number;
}

export function positionOf(lots: readonly LotRow[]): Position {
  const ordered = [...lots].filter((l) => l.deleted === 0).sort((a, b) => a.date.localeCompare(b.date));
  let qty = 0;
  let cost = 0;
  let realized = 0;
  let dividends = 0;
  let fees = 0;
  for (const lot of ordered) {
    switch (lot.kind) {
      case 'buy': {
        qty += lot.quantity ?? 0;
        cost += Math.abs(lot.totalCents);
        break;
      }
      case 'sell': {
        const sold = Math.min(lot.quantity ?? 0, qty);
        const avg = qty > 0 ? cost / qty : 0;
        const released = avg * sold;
        realized += Math.abs(lot.totalCents) - released;
        qty -= sold;
        cost -= released;
        break;
      }
      case 'dividend':
        dividends += Math.abs(lot.totalCents);
        break;
      case 'fee':
        fees += Math.abs(lot.totalCents);
        break;
    }
  }
  return {
    qty: round6(qty),
    costCents: Math.round(cost),
    realizedCents: Math.round(realized),
    dividendCents: dividends,
    feeCents: fees,
  };
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export const quoteKey = (holding: Pick<HoldingRow, 'priceSource' | 'priceKey'>): string | null =>
  holding.priceSource && holding.priceSource !== 'manual' && holding.priceKey
    ? `${holding.priceSource}:${holding.priceKey}`
    : null;

/**
 * Per-unit price in cents for a holding, in the space currency — quote
 * cache first (currency must match; v1 converts only via the provided
 * usdRate), manual price as the always-available fallback.
 */
export function holdingPriceCents(
  holding: HoldingRow,
  quotes: ReadonlyMap<string, QuoteCacheRow>,
  spaceCurrency: string,
  usdToSpaceRate?: number,
): { priceCents: number; dayChangePct?: number } | null {
  const key = quoteKey(holding);
  const quote = key ? quotes.get(key) : undefined;
  if (quote) {
    if (quote.currency === spaceCurrency) {
      return { priceCents: Math.round(quote.price * 100), dayChangePct: quote.dayChangePct };
    }
    if (quote.currency === 'USD' && usdToSpaceRate) {
      return { priceCents: Math.round(quote.price * usdToSpaceRate * 100), dayChangePct: quote.dayChangePct };
    }
  }
  if (holding.manualPriceCents !== undefined) return { priceCents: holding.manualPriceCents };
  return null;
}

export interface HoldingView {
  holding: HoldingRow;
  position: Position;
  /** null while no price is known (excluded from totals, flagged in UI) */
  valueCents: number | null;
  dayChangeCents: number | null;
  gainCents: number | null;
  gainPct: number | null;
}

export function holdingView(
  holding: HoldingRow,
  lots: readonly LotRow[],
  quotes: ReadonlyMap<string, QuoteCacheRow>,
  spaceCurrency: string,
  usdToSpaceRate?: number,
): HoldingView {
  const position = positionOf(lots);
  const price = holdingPriceCents(holding, quotes, spaceCurrency, usdToSpaceRate);
  if (!price || position.qty === 0) {
    return { holding, position, valueCents: price && position.qty === 0 ? 0 : null, dayChangeCents: null, gainCents: null, gainPct: null };
  }
  const valueCents = Math.round(position.qty * price.priceCents);
  const dayChangeCents =
    price.dayChangePct === undefined ? null : Math.round(valueCents - valueCents / (1 + price.dayChangePct / 100));
  const gainCents = valueCents - position.costCents;
  const gainPct = position.costCents > 0 ? (gainCents / position.costCents) * 100 : null;
  return { holding, position, valueCents, dayChangeCents, gainCents, gainPct };
}

export interface PortfolioTotals {
  totalCents: number;
  dayChangeCents: number | null;
  gainCents: number;
  /** value share per asset class, descending */
  allocation: { assetClass: AssetClass; valueCents: number; share: number }[];
  /** a single holding above 40% of the pot */
  concentrated?: string;
  /** holdings without a usable price (excluded from the totals) */
  unpricedCount: number;
}

export function portfolioTotals(views: readonly HoldingView[]): PortfolioTotals {
  const priced = views.filter((v) => v.valueCents !== null && v.holding.archived !== 1);
  const totalCents = priced.reduce((sum, v) => sum + v.valueCents!, 0);
  const dayKnown = priced.filter((v) => v.dayChangeCents !== null);
  const byClass = new Map<AssetClass, number>();
  for (const view of priced) {
    byClass.set(view.holding.assetClass, (byClass.get(view.holding.assetClass) ?? 0) + view.valueCents!);
  }
  const allocation = [...byClass.entries()]
    .map(([assetClass, valueCents]) => ({ assetClass, valueCents, share: totalCents > 0 ? valueCents / totalCents : 0 }))
    .sort((a, b) => b.valueCents - a.valueCents);
  const concentrated = priced.find((v) => totalCents > 0 && v.valueCents! / totalCents > 0.4)?.holding.name;
  return {
    totalCents,
    dayChangeCents: dayKnown.length > 0 ? dayKnown.reduce((sum, v) => sum + v.dayChangeCents!, 0) : null,
    gainCents: priced.reduce((sum, v) => sum + (v.gainCents ?? 0), 0),
    allocation,
    concentrated,
    unpricedCount: views.filter((v) => v.valueCents === null && v.holding.archived !== 1).length,
  };
}
