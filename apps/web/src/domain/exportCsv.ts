import type { AccountRow, RecurringRow, TransactionRow } from '@/db/types';
import type { Cat, Catalog } from './catalog';
import { cleanBankText } from '@/lib/text';
import { givenCents, netAmountCents, netCreditCents } from './reimbursement';

/**
 * CSV export (csv-export design): munni can read your banks, so it
 * must also let you leave. Pure functions — the screen only handles
 * pickers and the Blob download. Splits expand to one row per part so
 * spreadsheet pivots work naturally.
 */

export interface ExportContext {
  accounts: readonly AccountRow[];
  catalog: Catalog;
  catName: (cat: Cat) => string;
  typeName: (txType: TransactionRow['txType']) => string;
  recurrings?: readonly RecurringRow[];
  events?: readonly { id: string; name: string }[];
  /** adds tx/account ids for power users */
  technical?: boolean;
  /** set when exporting several spaces into one file — becomes a leading column */
  spaceName?: string;
}

export const CSV_COLUMNS = [
  'date', 'time', 'account', 'merchant', 'description', 'amount', 'currency', 'net_amount',
  'category', 'main_category', 'type', 'status', 'split', 'notes', 'counterparty_iban',
  'recurring', 'event',
] as const;

const TECHNICAL_COLUMNS = ['tx_id', 'account_id'] as const;

const cents = (value: number): string => (value / 100).toFixed(2);

const statusOf = (tx: TransactionRow): string => {
  if (tx.pending === 1) return 'pending';
  return tx.needsReview === 1 ? 'unreviewed' : 'reviewed';
};

/** one export row per transaction; split parts fan out beneath it */
export function toCsvRows(txs: readonly TransactionRow[], ctx: ExportContext): string[][] {
  const accountById = new Map(ctx.accounts.map((a) => [a.id, a]));
  const recurringById = new Map((ctx.recurrings ?? []).map((r) => [r.id, r.name]));
  const eventById = new Map((ctx.events ?? []).map((e) => [e.id, e.name]));
  const spaceColumn = ctx.spaceName === undefined ? [] : ['space'];
  const header = [...spaceColumn, ...CSV_COLUMNS, ...(ctx.technical ? TECHNICAL_COLUMNS : [])];
  const rows: string[][] = [header];

  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
  for (const tx of sorted) {
    const cat = ctx.catalog.byId(tx.catId);
    const main = cat.parentId ? ctx.catalog.byId(cat.parentId) : cat;
    const net = tx.amountCents > 0 ? netCreditCents(tx, givenCents(txs, tx.id)) : netAmountCents(tx);
    const base = (split: string, catOf: Cat, mainOf: Cat, amount: number): string[] => [
      ...(ctx.spaceName === undefined ? [] : [ctx.spaceName]),
      tx.date,
      tx.time ?? '',
      accountById.get(tx.accountId)?.name ?? '',
      cleanBankText(tx.merchant),
      cleanBankText(tx.description),
      cents(amount),
      tx.currency,
      cents(net),
      ctx.catName(catOf),
      ctx.catName(mainOf),
      ctx.typeName(tx.txType),
      statusOf(tx),
      split,
      tx.notes ?? '',
      tx.counterIban ?? '',
      tx.recurringId ? (recurringById.get(tx.recurringId) ?? '') : '',
      tx.eventId ? (eventById.get(tx.eventId) ?? '') : '',
      ...(ctx.technical ? [tx.id, tx.accountId] : []),
    ];
    rows.push(base('', cat, main, tx.amountCents));
    for (const part of tx.splits ?? []) {
      const partCat = ctx.catalog.byId(part.catId);
      const partMain = partCat.parentId ? ctx.catalog.byId(partCat.parentId) : partCat;
      // split parts carry the expense sign of their parent
      rows.push(base('part', partCat, partMain, Math.sign(tx.amountCents) * Math.abs(part.amountCents)));
    }
  }
  return rows;
}

/** RFC 4180 quoting; BOM so Excel reads UTF-8 (€, ş, ğ) correctly */
export function serializeCsv(rows: readonly string[][], delimiter: ',' | ';'): string {
  const quote = (field: string): string =>
    /[",;\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
  return `﻿${rows.map((row) => row.map(quote).join(delimiter)).join('\r\n')}\r\n`;
}

/** NL/TR Excel expects semicolons; EN expects commas */
export const delimiterForLang = (lang: string): ',' | ';' => (lang === 'en' ? ',' : ';');
