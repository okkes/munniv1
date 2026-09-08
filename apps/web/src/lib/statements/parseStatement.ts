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
export function parseStatement(content: string, fileName?: string): ParsedStatement[] {
  const head = content.slice(0, 500);
  const has = (...names: string[]) => names.some((n) => head.includes(`"${n}"`));

  if (head.trimStart().startsWith('<')) {
    return parseCamt053(content); // CAMT.053 XML (ASN, SNS, Rabo, ING business…)
  }
  if (looksLikePaypalCsv(head)) {
    return parsePaypalCsv(content); // PayPal activity export
  }
  // every ING shape ships in Dutch AND English (verified against real
  // 2026 exports) — detection checks both header sets
  if (has('Kaartnummer', 'Card number')) {
    return parseIngCreditcardCsv(content, fileName);
  }
  // balance-history exports: no transactions, just Boeksaldo/Book balance
  if (has('Boeksaldo', 'Book balance')) {
    return parseIngBalanceCsv(content);
  }
  // current account BEFORE savings: newer current-account exports also
  // carry the running balance and must not hit the savings parser
  if (has('Naam / Omschrijving', 'Name / Description') && has('Tegenrekening', 'Counterparty')) {
    return parseIngCurrentCsv(content);
  }
  if (has('Saldo na mutatie', 'Resulting balance')) {
    return parseIngSavingsCsv(content);
  }
  throw new Error('Unsupported statement format');
}
