/**
 * CAMT.053 (ISO 20022 bank-to-customer statement) parser. Runs entirely
 * in the browser via DOMParser — bank files never leave the device and
 * import works in offline mode. Field mapping follows apollousa's
 * CAMT053Model.cs (camt.053.001.02, as exported by ING/ABN/…).
 */

export interface CamtEntry {
  /** signed integer cents; DBIT = negative */
  amountCents: number;
  currency: string;
  /** yyyy-mm-dd booking date */
  date: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  /** unstructured remittance info + extra references, for categorization */
  description: string;
  /** bank-side reference for idempotent import (AcctSvcrRef / EndToEndId) */
  ref: string;
}

export interface CamtStatement {
  iban: string;
  currency: string;
  /** closing booked balance (CLBD) in cents, if present */
  closingBalanceCents: number | null;
  /** date the closing balance was true (yyyy-mm-dd) — decides whether it may overwrite a newer manual balance */
  balanceAsOf?: string | null;
  entries: CamtEntry[];
}

const text = (parent: Element | null, ...path: string[]): string | undefined => {
  let el: Element | null = parent;
  for (const name of path) {
    if (!el) return undefined;
    el = Array.from(el.children).find((c) => c.localName === name) ?? null;
  }
  return el?.textContent?.trim() || undefined;
};

const children = (parent: Element, name: string): Element[] =>
  Array.from(parent.children).filter((c) => c.localName === name);

const toCents = (amount: string | undefined): number | null => {
  if (!amount) return null;
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
};

function parseClosingBalance(stmt: Element): { cents: number; date: string | null } | null {
  let closing: { cents: number; date: string | null } | null = null;
  for (const bal of children(stmt, 'Bal')) {
    if (text(bal, 'Tp', 'CdOrPrtry', 'Cd') !== 'CLBD') continue;
    const cents = toCents(text(bal, 'Amt'));
    if (cents === null) continue;
    closing = {
      cents: text(bal, 'CdtDbtInd') === 'DBIT' ? -cents : cents,
      date: text(bal, 'Dt', 'Dt') ?? text(bal, 'Dt', 'DtTm')?.slice(0, 10) ?? null,
    };
  }
  return closing;
}

function parseEntry(ntry: Element, statementCurrency: string): CamtEntry | null {
  const amtEl = children(ntry, 'Amt')[0];
  const cents = toCents(amtEl?.textContent?.trim());
  if (cents === null) return null;
  const debit = text(ntry, 'CdtDbtInd') === 'DBIT';
  const date = text(ntry, 'BookgDt', 'Dt') ?? text(ntry, 'ValDt', 'Dt') ?? '';

  const txDtls = children(ntry, 'NtryDtls').flatMap((d) => children(d, 'TxDtls'))[0] ?? null;
  const relatedParty = debit ? 'Cdtr' : 'Dbtr';
  let counterpartyName = text(txDtls, 'RltdPties', relatedParty, 'Nm');
  const counterpartyIban = text(txDtls, `RltdPties`, `${relatedParty}Acct`, 'Id', 'IBAN');

  const remittance = txDtls
    ? children(txDtls, 'RmtInf')
        .flatMap((r) => children(r, 'Ustrd'))
        .map((u) => u.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
    : '';
  const addtlInfo = text(ntry, 'AddtlNtryInf') ?? '';
  // human-written remittance beats the bank's machine summary line
  const description = (remittance || addtlInfo).trim();

  // POS/card entries (ASN, SNS…) carry no party block — the merchant
  // sits in AddtlNtryInf before the '>' column ("Albert Heijn 1842 >CITY …")
  if (!counterpartyName && addtlInfo.includes('>')) {
    counterpartyName = addtlInfo.split('>')[0].trim() || undefined;
  }

  // ING exports carry AcctSvcrRef/EndToEndId (order preserved so ids of
  // past imports never change); ASN only numbers entries via NtryRef/TxId
  const ref =
    text(ntry, 'AcctSvcrRef') ??
    text(txDtls, 'Refs', 'AcctSvcrRef') ??
    text(txDtls, 'Refs', 'EndToEndId') ??
    text(ntry, 'NtryRef') ??
    text(txDtls, 'Refs', 'TxId') ??
    `${date}:${cents}:${counterpartyName ?? ''}:${description.slice(0, 40)}`;

  return {
    amountCents: debit ? -cents : cents,
    currency: amtEl?.getAttribute('Ccy') ?? statementCurrency,
    date,
    counterpartyName,
    counterpartyIban,
    description,
    ref,
  };
}

export function parseCamt053(xml: string): CamtStatement[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML');
  const root = doc.documentElement;
  if (root.localName !== 'Document') throw new Error('Not a CAMT.053 document');
  const bkToCstmr = children(root, 'BkToCstmrStmt')[0];
  if (!bkToCstmr) throw new Error('Not a CAMT.053 document');

  return children(bkToCstmr, 'Stmt').map((stmt) => {
    const iban = text(stmt, 'Acct', 'Id', 'IBAN') ?? '';
    const currency = text(stmt, 'Acct', 'Ccy') ?? 'EUR';
    const entries = children(stmt, 'Ntry')
      .map((ntry) => parseEntry(ntry, currency))
      .filter((entry): entry is CamtEntry => entry !== null);
    const closing = parseClosingBalance(stmt);
    return { iban, currency, closingBalanceCents: closing?.cents ?? null, balanceAsOf: closing?.date ?? null, entries };
  });
}
