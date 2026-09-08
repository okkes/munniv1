import { euAmountToCents, parseCsv } from './csv';
import type { CamtEntry } from '@/lib/camt053/parse';
import type { ParsedStatement } from './ing';

/**
 * PayPal activity exports (Reports → Activity download, CSV). Verified
 * against the user's real 2026 export: comma-separated, quoted headers,
 * EU decimal commas, DD/MM/YYYY dates, and a BOM up front.
 *
 * A PayPal export mixes real payments with PayPal's own bookkeeping:
 * every purchase is followed by a "Bank Deposit to PP Account" funding
 * leg (the bank tops the balance back to zero), card authorizations
 * appear as Memo rows, and cross-currency charges add a pair of
 * "General Currency Conversion" legs. Only the real payments import:
 *
 * - Status must be Completed and Balance Impact Debit/Credit (Memo rows
 *   are authorizations/holds, never money moving).
 * - Internal types (funding legs, conversions, holds) are skipped.
 * - A payment in a foreign currency imports at the amount of its
 *   same-day Completed conversion leg in the account's main currency —
 *   that is what the purchase actually cost; the original amount stays
 *   in the description.
 *
 * PayPal accounts have no IBAN: a stable synthetic id derived from the
 * owner's email keeps re-imports and multi-file imports on one account.
 * The "Transaction ID" column is a true bank-side ref — dedupe is exact.
 */

const INTERNAL_TYPES = new Set([
  'Bank Deposit to PP Account',
  'General Currency Conversion',
  'General Authorization',
  'General Card Deposit',
  'General Account Hold',
  'Reversal of General Account Hold',
]);

/** detected by header names that sit INSIDE the 500-char sniff window
 *  ("Balance Impact" ends the ~600-char header and falls outside it) */
export const looksLikePaypalCsv = (head: string): boolean =>
  head.includes('"TimeZone"') && head.includes('"Gross"') && head.includes('"Fee"');

/** "06/01/2026" → "2026-01-06" (PayPal exports are DD/MM/YYYY) */
const paypalDate = (raw: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

interface PaypalRow {
  date: string;
  type: string;
  status: string;
  currency: string;
  netCents: number;
  balanceCents: number | null;
  impact: string;
  name: string;
  fromEmail: string;
  toEmail: string;
  txId: string;
  subject: string;
  note: string;
  itemTitle: string;
}

function readRows(content: string): PaypalRow[] {
  const rows = parseCsv(content.replace(/^﻿/, ''), ',');
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iDate = col('Date');
  const iType = col('Type');
  const iStatus = col('Status');
  const iCurrency = col('Currency');
  const iNet = col('Net');
  const iBalance = col('Balance');
  const iImpact = col('Balance Impact');
  const iName = col('Name');
  const iFrom = col('From Email Address');
  const iTo = col('To Email Address');
  const iTx = col('Transaction ID');
  const iSubject = col('Subject');
  const iNote = col('Note');
  const iItem = col('Item Title');

  const out: PaypalRow[] = [];
  for (const raw of rows.slice(1)) {
    const date = paypalDate(raw[iDate] ?? '');
    const netCents = euAmountToCents(raw[iNet] ?? '');
    if (!date || netCents === null) continue;
    out.push({
      date,
      type: (raw[iType] ?? '').trim(),
      status: (raw[iStatus] ?? '').trim(),
      currency: (raw[iCurrency] ?? '').trim() || 'EUR',
      netCents,
      balanceCents: euAmountToCents(raw[iBalance] ?? ''),
      impact: (raw[iImpact] ?? '').trim(),
      name: (raw[iName] ?? '').trim(),
      fromEmail: (raw[iFrom] ?? '').trim(),
      toEmail: (raw[iTo] ?? '').trim(),
      txId: (raw[iTx] ?? '').trim(),
      subject: (raw[iSubject] ?? '').trim(),
      note: (raw[iNote] ?? '').trim(),
      itemTitle: (raw[iItem] ?? '').trim(),
    });
  }
  return out;
}

/** the account owner appears on every row — payer on debits, payee on credits */
function ownerEmail(rows: PaypalRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const own = row.netCents < 0 ? row.fromEmail : row.toEmail;
    if (own) counts.set(own, (counts.get(own) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [email, count] of counts) {
    if (count > bestCount) {
      best = email;
      bestCount = count;
    }
  }
  return best;
}

/** most frequent currency across the whole file = the account's currency */
function mainCurrency(rows: PaypalRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.currency, (counts.get(row.currency) ?? 0) + 1);
  let best = 'EUR';
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
}

export function parsePaypalCsv(content: string): ParsedStatement[] {
  const rows = readRows(content);
  const currency = mainCurrency(rows);
  const owner = ownerEmail(rows);
  // no IBAN exists: a deterministic id keeps every export of this
  // PayPal account converging on ONE app account (feeds dedupe by iban)
  const iban = `PAYPAL${owner.toUpperCase().replaceAll(/[^A-Z0-9]/g, '')}`;

  const payments = rows.filter(
    (row) => row.status === 'Completed' && row.impact !== 'Memo' && !INTERNAL_TYPES.has(row.type),
  );
  // Completed conversion legs in the main currency, claimable once each:
  // a foreign-currency charge imports at what it actually cost
  const conversions = rows.filter(
    (row) => row.status === 'Completed' && row.type === 'General Currency Conversion' && row.currency === currency,
  );

  const entries: CamtEntry[] = [];
  for (const row of payments) {
    let amountCents = row.netCents;
    let converted = '';
    if (row.currency !== currency) {
      const legIndex = conversions.findIndex(
        (leg) => leg.date === row.date && Math.sign(leg.netCents) === Math.sign(row.netCents),
      );
      if (legIndex < 0) continue; // no settlement leg — not money from this account
      amountCents = conversions[legIndex].netCents;
      conversions.splice(legIndex, 1);
      converted = ` (${(Math.abs(row.netCents) / 100).toFixed(2)} ${row.currency})`;
    }
    const counterEmail = row.netCents < 0 ? row.toEmail : row.fromEmail;
    const description = [row.type, row.itemTitle, row.subject, row.note, counterEmail]
      .filter(Boolean)
      .join(' · ')
      .concat(converted);
    entries.push({
      amountCents,
      currency,
      date: row.date,
      counterpartyName: row.name || counterEmail || undefined,
      description,
      ref: `paypal:${row.txId}`,
    });
  }

  // the newest running balance in the main currency is the closing one
  // (PayPal auto-funding usually parks it back at zero)
  const newestFirst = [...rows].reverse();
  const closing = newestFirst.find((row) => row.currency === currency && row.balanceCents !== null);

  return [
    {
      iban,
      currency,
      closingBalanceCents: closing?.balanceCents ?? null,
      balanceAsOf: closing?.date ?? null,
      entries,
      accountType: 'checking',
      accountName: owner ? `PayPal ${owner}` : 'PayPal',
    },
  ];
}
