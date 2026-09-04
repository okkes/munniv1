import type { CamtEntry, CamtStatement } from '@/lib/camt053/parse';
import { euAmountToCents, normalizeDate, parseCsv } from './csv';

/**
 * ING CSV exports (ING offers no CAMT.053 to consumers). Verified
 * against the user's REAL 2026 exports (manual-exports-ing-example/):
 * every shape ships in BOTH Dutch and English, all semicolon-separated
 * (older current-account exports were comma-separated — still
 * accepted), and the English credit-card file uses DOT decimals while
 * everything else uses commas. Five shapes per language:
 *
 * - current-account transactions (yyyymmdd dates, running balance)
 * - current-account BALANCE history (Boeksaldo / Book balance)
 * - savings transactions (account ref like "V28681505" + display name)
 * - savings BALANCE history
 * - credit card (masked card number, no balance file)
 *
 * Balance-only files import as zero-entry statements that update the
 * account's stored balance. None of the files carry a bank transaction
 * id, so the dedupe ref is synthesized deterministically: identical
 * rows on the same day get a stable ordinal, files are normalized
 * oldest-first before numbering — overlapping exports of the same
 * account produce identical refs and re-imports skip cleanly.
 */

export interface ParsedStatement extends CamtStatement {
  /** checking | savings | credit — drives the created account's type */
  accountType?: 'checking' | 'savings' | 'credit';
  accountName?: string;
}

/** NL: Af/Bij · EN: Debit/Credit */
const sign = (marker: string): 1 | -1 => {
  const m = marker.trim().toLowerCase();
  return m === 'bij' || m === 'credit' ? 1 : -1;
};

/** simple stable string hash for the synthetic ref */
function tinyHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0; // NOSONAR(S3776) djb2
  return h.toString(36);
}

interface RawEntry {
  date: string;
  amountCents: number;
  counterpartyName?: string;
  counterpartyIban?: string;
  description: string;
}

/** assigns deterministic refs (date + content hash + per-day ordinal) */
function toEntries(raws: RawEntry[]): CamtEntry[] {
  const sorted = [...raws].sort((a, b) => a.date.localeCompare(b.date));
  const ordinals = new Map<string, number>();
  return sorted.map((raw) => {
    const content = `${raw.counterpartyName ?? ''}|${raw.description}`;
    const key = `${raw.date}:${raw.amountCents}:${tinyHash(content)}`;
    const ordinal = (ordinals.get(key) ?? 0) + 1;
    ordinals.set(key, ordinal);
    return {
      amountCents: raw.amountCents,
      currency: 'EUR',
      date: raw.date,
      counterpartyName: raw.counterpartyName,
      counterpartyIban: raw.counterpartyIban,
      description: raw.description,
      ref: `ing:${key}:${ordinal}`,
    };
  });
}

/** first matching header name (each shape ships in NL and EN) */
const headerIndex = (header: string[], names: readonly string[]): number =>
  header.findIndex((h) => names.includes(h.trim()));

/** ING files are semicolon today, comma in older current-account exports */
function sniffRows(content: string): string[][] {
  const nl = content.indexOf('\n');
  const firstLine = content.slice(0, nl === -1 ? content.length : nl);
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  return parseCsv(content, delimiter);
}

/** shared: newest date wins as the closing balance */
function newestBalance(rows: string[][], dateCol: number, balanceCol: number): { date: string; cents: number } | null {
  let closing: { date: string; cents: number } | null = null;
  for (const row of rows.slice(1)) {
    const date = normalizeDate(row[dateCol] ?? '');
    const cents = euAmountToCents(row[balanceCol] ?? '');
    if (date && cents !== null && (!closing || date > closing.date)) closing = { date, cents };
  }
  return closing;
}

/** ING current account transactions (NL/EN, yyyymmdd dates) */
export function parseIngCurrentCsv(content: string): ParsedStatement[] {
  const rows = sniffRows(content);
  const header = rows[0];
  const col = {
    date: headerIndex(header, ['Datum', 'Date']),
    name: headerIndex(header, ['Naam / Omschrijving', 'Name / Description']),
    account: headerIndex(header, ['Rekening', 'Account']),
    counter: headerIndex(header, ['Tegenrekening', 'Counterparty']),
    afBij: headerIndex(header, ['Af Bij', 'Debit/credit']),
    amount: headerIndex(header, ['Bedrag (EUR)', 'Amount (EUR)']),
    kind: headerIndex(header, ['Mutatiesoort', 'Transaction type']),
    memo: headerIndex(header, ['Mededelingen', 'Notifications']),
    // newer ING exports include the running balance; older ones don't
    balance: headerIndex(header, ['Saldo na mutatie', 'Resulting balance']),
  };
  const iban = rows[1]?.[col.account]?.trim() ?? '';
  const raws: RawEntry[] = [];
  let closing: { date: string; cents: number } | null = null;
  for (const row of rows.slice(1)) {
    const date = normalizeDate(row[col.date] ?? '');
    const cents = euAmountToCents(row[col.amount] ?? '');
    if (!date || cents === null) continue;
    if (col.balance >= 0) {
      const balanceCents = euAmountToCents(row[col.balance] ?? '');
      // exports are newest-first: the first row of the newest day is the latest state
      if (balanceCents !== null && (!closing || date > closing.date)) closing = { date, cents: balanceCents };
    }
    raws.push({
      date,
      amountCents: sign(row[col.afBij] ?? '') * cents,
      counterpartyName: row[col.name]?.trim() || undefined,
      counterpartyIban: row[col.counter]?.trim() || undefined,
      description: [row[col.kind]?.trim(), row[col.memo]?.trim()].filter(Boolean).join(' · '),
    });
  }
  return [
    {
      iban,
      currency: 'EUR',
      closingBalanceCents: closing?.cents ?? null,
      balanceAsOf: closing?.date ?? null,
      entries: toEntries(raws),
      accountType: 'checking',
    },
  ];
}

/** ING savings transactions (NL/EN, running balance, "V…" account ref) */
export function parseIngSavingsCsv(content: string): ParsedStatement[] {
  const rows = sniffRows(content);
  const header = rows[0];
  const col = {
    date: headerIndex(header, ['Datum', 'Date']),
    description: headerIndex(header, ['Omschrijving', 'Description']),
    account: headerIndex(header, ['Rekening', 'Account']),
    accountName: headerIndex(header, ['Rekening naam', 'Account name']),
    counter: headerIndex(header, ['Tegenrekening', 'Counterparty']),
    afBij: headerIndex(header, ['Af Bij', 'Debit/credit']),
    amount: headerIndex(header, ['Bedrag', 'Amount']),
    currency: headerIndex(header, ['Valuta', 'Currency']),
    memo: headerIndex(header, ['Mededelingen', 'Notifications']),
    balance: headerIndex(header, ['Saldo na mutatie', 'Resulting balance']),
  };
  const accountRef = rows[1]?.[col.account]?.trim() ?? '';
  const accountName = rows[1]?.[col.accountName]?.trim() || undefined;
  const raws: RawEntry[] = [];
  let closing: { date: string; cents: number } | null = null;
  for (const row of rows.slice(1)) {
    const date = normalizeDate(row[col.date] ?? '');
    const cents = euAmountToCents(row[col.amount] ?? '');
    if (!date || cents === null) continue;
    const balanceCents = euAmountToCents(row[col.balance] ?? '');
    if (balanceCents !== null && (!closing || date > closing.date)) closing = { date, cents: balanceCents };
    raws.push({
      date,
      amountCents: sign(row[col.afBij] ?? '') * cents,
      counterpartyIban: row[col.counter]?.trim() || undefined,
      description: [row[col.description]?.trim(), row[col.memo]?.trim()].filter(Boolean).join(' · '),
      counterpartyName: row[col.description]?.trim() || undefined,
    });
  }
  return [
    {
      iban: accountRef, // not an IBAN, but the stable account reference
      currency: rows[1]?.[col.currency]?.trim() || 'EUR',
      closingBalanceCents: closing?.cents ?? null,
      balanceAsOf: closing?.date ?? null,
      entries: toEntries(raws),
      accountType: 'savings',
      accountName,
    },
  ];
}

/** ING credit card (NL/EN; the EN file uses DOT decimals — handled) */
export function parseIngCreditcardCsv(content: string, fileName?: string): ParsedStatement[] {
  const rows = sniffRows(content);
  const header = rows[0];
  const col = {
    date: headerIndex(header, ['Datum', 'Date']),
    name: headerIndex(header, ['Naam / Omschrijving', 'Name / Description']),
    kind: headerIndex(header, ['Mutatiesoort', 'Transaction type']),
    afBij: headerIndex(header, ['Af Bij', 'Debit/credit']),
    amount: headerIndex(header, ['Bedrag (EUR)', 'Amount (EUR)']),
    memo: headerIndex(header, ['Mededelingen', 'Notifications']),
    card: headerIndex(header, ['Kaartnummer', 'Card number']),
  };
  // card number appears on charges only; fall back to the export's file name
  const card =
    rows.slice(1).find((row) => row[col.card]?.trim())?.[col.card]?.trim() ??
    /creditcard_(\d+)/i.exec(fileName ?? '')?.[1] ??
    'ING-CREDITCARD';
  const raws: RawEntry[] = [];
  for (const row of rows.slice(1)) {
    const date = normalizeDate(row[col.date] ?? '');
    const cents = euAmountToCents(row[col.amount] ?? '');
    if (!date || cents === null) continue;
    raws.push({
      date,
      amountCents: sign(row[col.afBij] ?? '') * cents,
      counterpartyName: row[col.name]?.trim() || undefined,
      description: [row[col.kind]?.trim(), row[col.memo]?.trim()].filter(Boolean).join(' · '),
    });
  }
  return [
    {
      iban: card.replaceAll(/[^0-9A-Za-z]/g, ''), // stable normalized card ref
      currency: 'EUR',
      closingBalanceCents: null,
      entries: toEntries(raws),
      accountType: 'credit',
      accountName: 'ING Creditcard',
    },
  ];
}

/**
 * ING balance-history exports (current + savings, NL/EN): no
 * transactions, just day-by-day book balances — imported as a
 * zero-entry statement that refreshes the account's stored balance.
 */
export function parseIngBalanceCsv(content: string): ParsedStatement[] {
  const rows = sniffRows(content);
  const header = rows[0];
  const col = {
    date: headerIndex(header, ['Datum', 'Date']),
    account: headerIndex(header, ['Rekening', 'Account']),
    accountName: headerIndex(header, ['Rekening naam', 'Account name']),
    currency: headerIndex(header, ['Valuta', 'Currency']),
    balance: headerIndex(header, ['Boeksaldo', 'Book balance']),
  };
  const accountRef = rows[1]?.[col.account]?.trim() ?? '';
  const accountName = col.accountName >= 0 ? rows[1]?.[col.accountName]?.trim() || undefined : undefined;
  const closing = newestBalance(rows, col.date, col.balance);
  return [
    {
      iban: accountRef,
      currency: (col.currency >= 0 && rows[1]?.[col.currency]?.trim()) || 'EUR',
      closingBalanceCents: closing?.cents ?? null,
      balanceAsOf: closing?.date ?? null,
      entries: [],
      // the savings balance file carries the account name; the current
      // account's does not — its ref is a real IBAN
      accountType: col.accountName >= 0 ? 'savings' : 'checking',
      accountName,
    },
  ];
}
