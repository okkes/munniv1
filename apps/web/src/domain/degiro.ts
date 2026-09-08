import type { AssetClass } from '@/db/types';

/**
 * DEGIRO export parsing (approved investments design I3) — the OFFICIAL
 * stable route into the portfolio: Portfolio.csv (positions) and
 * Transactions.csv (buys/sells with fees). Parsed entirely on-device,
 * deterministic ids so a re-import is a no-op. Other Dutch brokers
 * become sibling parsers behind the same import door.
 */

export interface ParsedHolding {
  /** deterministic: hold:{isin || name-slug} scoped by the caller */
  key: string;
  name: string;
  isin?: string;
  assetClass: AssetClass;
  quantity?: number;
}

export interface ParsedLot {
  /** deterministic: DEGIRO order id, else a content hash */
  key: string;
  holdingKey: string;
  kind: 'buy' | 'sell' | 'fee';
  date: string;
  quantity?: number;
  totalCents: number;
}

/** minimal RFC-ish CSV: quoted fields, comma separator, CRLF tolerant */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const holdingKeyOf = (isin: string | undefined, name: string): string => `hold:${isin || slug(name)}`;

/** dd-mm-yyyy → yyyy-mm-dd */
const toIsoDate = (dmy: string): string | null => {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dmy.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
};

/** DEGIRO numbers arrive in NL or EN notation depending on account language */
export const parseDegiroNumber = (raw: string): number | null => {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const normalized = cleaned.includes(',') && !cleaned.includes('.')
    ? cleaned.replace(',', '.')
    : cleaned.replace(/,(?=\d{3}\b)/g, '');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
};

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** ETF heuristics good enough for classing an import; editable after */
const looksLikeEtf = (name: string): boolean => /\b(etf|ucits|ishares|vanguard|vaneck|amundi|xtrackers|spdr)\b/i.test(name);

/** case-insensitive header lookup across DEGIRO's NL/EN exports */
function headerIndex(header: readonly string[], ...names: string[]): number {
  return header.findIndex((h) => names.includes(h.trim().toLowerCase()));
}

/**
 * Portfolio.csv: one row per position — Product, Symbool/ISIN, Aantal,
 * … , Waarde in EUR. Cash rows (EUR, CASH & CASH FUND…) are skipped;
 * they belong to the brokerage account balance, not to holdings.
 */
export function parseDegiroPortfolio(text: string): ParsedHolding[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const product = headerIndex(header, 'product');
  const symbol = headerIndex(header, 'symbool/isin', 'symbol/isin', 'symbool', 'symbol');
  const amount = headerIndex(header, 'aantal', 'amount', 'quantity');
  if (product === -1) return [];

  const holdings: ParsedHolding[] = [];
  for (const row of rows.slice(1)) {
    const name = row[product]?.trim();
    if (!name || /cash/i.test(name)) continue;
    const rawSymbol = symbol >= 0 ? row[symbol]?.trim() : '';
    const isin = ISIN.test(rawSymbol) ? rawSymbol : undefined;
    const quantity = amount >= 0 ? (parseDegiroNumber(row[amount] ?? '') ?? undefined) : undefined;
    holdings.push({
      key: holdingKeyOf(isin, name),
      name,
      isin,
      assetClass: looksLikeEtf(name) ? 'etf' : 'stock',
      quantity,
    });
  }
  return holdings;
}

/**
 * Transactions.csv: Datum, Tijd, Product, ISIN, …, Aantal, …, Waarde,
 * …, Transactiekosten…, Order ID. Positive Aantal = buy, negative =
 * sell; the fee column becomes its own lot so costs stay honest.
 */
interface TxColumns {
  date: number;
  product: number;
  isin: number;
  amount: number;
  value: number;
  fee: number;
  orderId: number;
}

function parseTransactionRow(row: readonly string[], index: number, cols: TxColumns): { holding: ParsedHolding; lots: ParsedLot[] } | null {
  const iso = toIsoDate(row[cols.date] ?? '');
  const name = row[cols.product]?.trim();
  const qty = parseDegiroNumber(row[cols.amount] ?? '');
  const total = parseDegiroNumber(row[cols.value] ?? '');
  if (!iso || !name || qty === null || total === null || qty === 0) return null;

  const isin = cols.isin >= 0 && ISIN.test(row[cols.isin]?.trim() ?? '') ? row[cols.isin].trim() : undefined;
  const holdingKey = holdingKeyOf(isin, name);
  const order = cols.orderId >= 0 ? row[cols.orderId]?.trim() : '';
  const lotKey = order || `${iso}:${holdingKey}:${qty}:${total}:${index}`;

  const lots: ParsedLot[] = [
    {
      key: `deg:${lotKey}`,
      holdingKey,
      kind: qty > 0 ? 'buy' : 'sell',
      date: iso,
      quantity: Math.abs(qty),
      totalCents: Math.round(total * 100),
    },
  ];
  const feeValue = cols.fee >= 0 ? parseDegiroNumber(row[cols.fee] ?? '') : null;
  if (feeValue) {
    lots.push({ key: `deg:${lotKey}:fee`, holdingKey, kind: 'fee', date: iso, totalCents: Math.round(feeValue * 100) });
  }
  return { holding: { key: holdingKey, name, isin, assetClass: looksLikeEtf(name) ? 'etf' : 'stock' }, lots };
}

export function parseDegiroTransactions(text: string): { holdings: ParsedHolding[]; lots: ParsedLot[] } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { holdings: [], lots: [] };
  const header = rows[0].map((h) => h.toLowerCase());
  const cols: TxColumns = {
    date: headerIndex(header, 'datum', 'date'),
    product: headerIndex(header, 'product'),
    isin: headerIndex(header, 'isin'),
    amount: headerIndex(header, 'aantal', 'quantity', 'number'),
    value: headerIndex(header, 'waarde', 'value'),
    fee: header.findIndex((h) => h.includes('transactiekosten') || h.includes('transaction and/or') || h.includes('transaction costs')),
    orderId: headerIndex(header, 'order id', 'order-id'),
  };
  if (cols.date === -1 || cols.product === -1 || cols.amount === -1 || cols.value === -1) return { holdings: [], lots: [] };

  const holdings = new Map<string, ParsedHolding>();
  const lots: ParsedLot[] = [];
  for (const [index, row] of rows.slice(1).entries()) {
    const parsed = parseTransactionRow(row, index, cols);
    if (!parsed) continue;
    if (!holdings.has(parsed.holding.key)) holdings.set(parsed.holding.key, parsed.holding);
    lots.push(...parsed.lots);
  }
  return { holdings: [...holdings.values()], lots };
}
