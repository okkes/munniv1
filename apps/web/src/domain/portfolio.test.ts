import { describe, expect, it } from 'vitest';
import { holdingView, portfolioTotals, positionOf, quoteKey } from './portfolio';
import { parseDegiroPortfolio, parseDegiroTransactions, parseDegiroNumber } from './degiro';
import type { HoldingRow, LotRow, QuoteCacheRow } from '@/db/types';

const lot = (partial: Partial<LotRow>): LotRow =>
  ({ id: Math.random().toString(36).slice(2), spaceId: 's1', holdingId: 'h1', kind: 'buy', date: '2026-01-05', totalCents: 0, deleted: 0, ...partial }) as LotRow;

const holding = (partial: Partial<HoldingRow>): HoldingRow =>
  ({ id: 'h1', spaceId: 's1', name: 'ASML', assetClass: 'stock', currency: 'EUR', deleted: 0, ...partial }) as HoldingRow;

describe('position math (average cost)', () => {
  it('sells release cost proportionally and realize the difference', () => {
    const position = positionOf([
      lot({ kind: 'buy', quantity: 10, totalCents: 100_000, date: '2026-01-01' }), // 10 @ €100
      lot({ kind: 'buy', quantity: 10, totalCents: 140_000, date: '2026-02-01' }), // 10 @ €140 → avg €120
      lot({ kind: 'sell', quantity: 5, totalCents: 75_000, date: '2026-03-01' }), // 5 @ €150
      lot({ kind: 'dividend', totalCents: 1_200, date: '2026-03-15' }),
      lot({ kind: 'fee', totalCents: 400, date: '2026-03-15' }),
    ]);
    expect(position.qty).toBe(15);
    expect(position.costCents).toBe(180_000); // 15 × avg €120
    expect(position.realizedCents).toBe(15_000); // (150−120) × 5
    expect(position.dividendCents).toBe(1_200);
    expect(position.feeCents).toBe(400);
  });

  it('view + totals: quotes in the space currency, USD via the rate, manual as fallback', () => {
    const quotes = new Map<string, QuoteCacheRow>([
      ['yahoo:ASML.AS', { key: 'yahoo:ASML.AS', price: 650, currency: 'EUR', dayChangePct: 2, at: 'now' }],
      ['yahoo:AAPL', { key: 'yahoo:AAPL', price: 200, currency: 'USD', dayChangePct: -1, at: 'now' }],
    ]);
    const asml = holdingView(
      holding({ id: 'h1', priceSource: 'yahoo', priceKey: 'ASML.AS' }),
      [lot({ holdingId: 'h1', quantity: 2, totalCents: 120_000 })],
      quotes,
      'EUR',
      0.9,
    );
    expect(asml.valueCents).toBe(130_000);
    expect(asml.gainCents).toBe(10_000);
    // day change backs out of the +2% move
    expect(asml.dayChangeCents).toBe(130_000 - Math.round(130_000 / 1.02));

    const apple = holdingView(
      holding({ id: 'h2', name: 'Apple', priceSource: 'yahoo', priceKey: 'AAPL' }),
      [lot({ holdingId: 'h2', quantity: 1, totalCents: 15_000 })],
      quotes,
      'EUR',
      0.9,
    );
    expect(apple.valueCents).toBe(18_000); // 200 USD × 0.9 × 100

    const manual = holdingView(
      holding({ id: 'h3', name: 'Garage fund', manualPriceCents: 5_000 }),
      [lot({ holdingId: 'h3', quantity: 3, totalCents: 12_000 })],
      quotes,
      'EUR',
    );
    expect(manual.valueCents).toBe(15_000);

    const unpriced = holdingView(holding({ id: 'h4', name: 'Mystery' }), [lot({ holdingId: 'h4', quantity: 1, totalCents: 1_000 })], quotes, 'EUR');
    expect(unpriced.valueCents).toBeNull();

    const totals = portfolioTotals([asml, apple, manual, unpriced]);
    expect(totals.totalCents).toBe(163_000);
    expect(totals.unpricedCount).toBe(1);
    expect(totals.concentrated).toBe('ASML'); // 130k of 163k
    expect(totals.allocation[0].assetClass).toBe('stock');
  });

  it('quoteKey only exists for live sources', () => {
    expect(quoteKey({ priceSource: 'yahoo', priceKey: 'ASML.AS' })).toBe('yahoo:ASML.AS');
    expect(quoteKey({ priceSource: 'manual', priceKey: 'x' })).toBeNull();
    expect(quoteKey({})).toBeNull();
  });
});

describe('DEGIRO parsing', () => {
  it('numbers arrive in NL or EN notation', () => {
    expect(parseDegiroNumber('1.234,56'.replace('.', ''))).toBe(1234.56);
    expect(parseDegiroNumber('12,5')).toBe(12.5);
    expect(parseDegiroNumber('1,234.56')).toBe(1234.56);
    expect(parseDegiroNumber('')).toBeNull();
  });

  it('Portfolio.csv becomes holdings; cash rows stay out', () => {
    const csv = [
      'Product,Symbool/ISIN,Aantal,Slotkoers,Lokale waarde,Waarde in EUR',
      'VANGUARD FTSE AW,IE00B3RBWM25,12,105.2,1262.4,1262.40',
      '"ASML HOLDING",NL0010273215,3,650,1950,1950.00',
      'CASH & CASH FUND & FTX CASH (EUR),,,,,"123.45"',
    ].join('\n');
    const holdings = parseDegiroPortfolio(csv);
    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toMatchObject({ key: 'hold:IE00B3RBWM25', assetClass: 'etf', quantity: 12 });
    expect(holdings[1]).toMatchObject({ key: 'hold:NL0010273215', name: 'ASML HOLDING', assetClass: 'stock' });
  });

  it('Transactions.csv becomes buy/sell lots with fee lots; re-parse is stable', () => {
    const csv = [
      'Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde,,Wisselkoers,Transactiekosten en/of,,Totaal,Order ID',
      '02-06-2026,09:15,ASML HOLDING,NL0010273215,EAM,,2,640,,-1280,,-1280.00,,,-2.00,,-1282.00,abc-123',
      '15-06-2026,14:30,ASML HOLDING,NL0010273215,EAM,,-1,660,,660,,660.00,,,,,660.00,def-456',
    ].join('\n');
    const first = parseDegiroTransactions(csv);
    expect(first.holdings).toHaveLength(1);
    expect(first.lots).toHaveLength(3); // buy + its fee + sell
    expect(first.lots[0]).toMatchObject({ key: 'deg:abc-123', kind: 'buy', date: '2026-06-02', quantity: 2, totalCents: -128_000 });
    expect(first.lots[1]).toMatchObject({ key: 'deg:abc-123:fee', kind: 'fee', totalCents: -200 });
    expect(first.lots[2]).toMatchObject({ key: 'deg:def-456', kind: 'sell', quantity: 1, totalCents: 66_000 });
    // deterministic keys → the import layer can no-op on re-import
    expect(parseDegiroTransactions(csv).lots.map((l) => l.key)).toEqual(first.lots.map((l) => l.key));
  });
});
