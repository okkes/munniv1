import { parseCamt053 } from '@/lib/camt053/parse';
import { parseIngBalanceCsv, parseIngCreditcardCsv, parseIngCurrentCsv, parseIngSavingsCsv } from './ing';
import { looksLikePaypalCsv, parsePaypalCsv } from './paypal';
import type { ParsedStatement } from './ing';

export type { ParsedStatement };

/**
 * One entry point for every statement format the app understands.
 * Transactions arrive from all over in different shapes — this module
 * normalizes them into the same ParsedStatement, so the importer,
 * dedupe ids and screens never care where a file came from.
 *
 * Detection is content-based (header sniffing), not extension-based:
 * banks are creative with file names.
 */

/** the format families the sniffer can name — #226 r2: the import flow
 *  compares this against the picked bank before parsing */
export type StatementKind = 'paypal' | 'ing' | 'camt' | 'unknown';

/** every ING sub-shape told apart ONCE — parseStatement routes on these
 *  and detectStatementKind folds them to a family, so the two can't drift */
type SniffedFormat = 'camt' | 'paypal' | 'ingCredit' | 'ingBalance' | 'ingCurrent' | 'ingSavings' | 'unknown';

function sniffFormat(content: string): SniffedFormat {
  const head = content.slice(0, 500);
  const has = (...names: string[]) => names.some((n) => head.includes(`"${n}"`));

  if (head.trimStart().startsWith('<')) {
    return 'camt'; // CAMT.053 XML (ASN, SNS, Rabo, ING business…)
  }
  if (looksLikePaypalCsv(head)) {
    return 'paypal'; // PayPal activity export
  }
  // every ING shape ships in Dutch AND English (verified against real
  // 2026 exports) — detection checks both header sets
  if (has('Kaartnummer', 'Card number')) {
    return 'ingCredit';
  }
  // balance-history exports: no transactions, just Boeksaldo/Book balance
  if (has('Boeksaldo', 'Book balance')) {
    return 'ingBalance';
  }
  // current account BEFORE savings: newer current-account exports also
  // carry the running balance and must not hit the savings parser
  if (has('Naam / Omschrijving', 'Name / Description') && has('Tegenrekening', 'Counterparty')) {
    return 'ingCurrent';
  }
  if (has('Saldo na mutatie', 'Resulting balance')) {
    return 'ingSavings';
  }
  return 'unknown';
}

/** #226 r2: name a file's format family WITHOUT parsing it — the import
 *  flow warns when the picked bank promised a different one */
export function detectStatementKind(content: string, _fileName?: string): StatementKind {
  const format = sniffFormat(content);
  if (format === 'camt' || format === 'paypal' || format === 'unknown') return format;
  return 'ing';
}

export function parseStatement(content: string, fileName?: string): ParsedStatement[] {
  switch (sniffFormat(content)) {
    case 'camt':
      return parseCamt053(content);
    case 'paypal':
      return parsePaypalCsv(content);
    case 'ingCredit':
      return parseIngCreditcardCsv(content, fileName);
    case 'ingBalance':
      return parseIngBalanceCsv(content);
    case 'ingCurrent':
      return parseIngCurrentCsv(content);
    case 'ingSavings':
      return parseIngSavingsCsv(content);
    default:
      throw new Error('Unsupported statement format');
  }
}
