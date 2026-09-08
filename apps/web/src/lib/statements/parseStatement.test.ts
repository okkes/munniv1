// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { euAmountToCents, normalizeDate, parseCsv } from './csv';
import { parseStatement } from './parseStatement';

// sanitized single-row samples of the three real ING export shapes
const ING_CURRENT = `"Datum","Naam / Omschrijving","Rekening","Tegenrekening","Code","Af Bij","Bedrag (EUR)","Mutatiesoort","Mededelingen"
"20260701","Mw A Voorbeeld","NL74INGB0001029507","NL17INGB0109277198","GT","Af","1,85","Online bankieren","Naam: Mw A Voorbeeld Omschrijving: Flowers IBAN: NL17INGB0109277198"
"20260701","Rente ING Rood Staan","NL74INGB0001029507","","DV","Af","8,09","Diversen","Periode 01-06-2026"
"20260630","Werkgever BV","NL74INGB0001029507","NL00WERK0000000001","GT","Bij","2.200,00","Online bankieren","SALARIS JUNI"
"20260630","Albert Heijn","NL74INGB0001029507","","BA","Af","12,50","Betaalautomaat","AH 1350"
"20260630","Albert Heijn","NL74INGB0001029507","","BA","Af","12,50","Betaalautomaat","AH 1350"`;

const ING_SAVINGS = `"Datum";"Omschrijving";"Rekening";"Rekening naam";"Tegenrekening";"Af Bij";"Bedrag";"Valuta";"Mutatiesoort";"Mededelingen";"Saldo na mutatie"
"2026-01-01";"Rente";"V 286-81505";"Oranje Spaarrekening";"";"Bij";"9,20";"EUR";"Rente";"";"1509,20"
"2025-06-11";"Overboeking naar betaalrekening NL74INGB0001029507";"V 286-81505";"Oranje Spaarrekening";"NL74INGB0001029507";"Af";"1500,00";"EUR";"Opname";"";"0,00"`;

const ING_CREDIT = `"Datum";"Naam / Omschrijving";"Mutatiesoort";"Af Bij";"Bedrag (EUR)";"Mededelingen";"Kaartnummer"
"2026-07-06";"IKEA s Gravenhage";"Betaling";"Af";"249,18";"Transactiedatum: 05-07-2026";"5248 **** **** 7201"
"2026-07-04";"AFLOSSING";"Incasso";"Bij";"1.878,52";"";""`;

describe('csv primitives', () => {
  it('handles quoted fields, doubled quotes and both delimiters', () => {
    expect(parseCsv('"a";"b;c";"say ""hi"""\n"1";"2";"3"', ';')).toEqual([
      ['a', 'b;c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('parses EU amounts and both date shapes', () => {
    expect(euAmountToCents('1.878,52')).toBe(187852);
    expect(euAmountToCents('36,00')).toBe(3600);
    expect(euAmountToCents('')).toBeNull();
    expect(normalizeDate('20260701')).toBe('2026-07-01');
    expect(normalizeDate('2026-07-01')).toBe('2026-07-01');
    expect(normalizeDate('01-07-2026')).toBeNull();
  });
});

describe('parseStatement — ING current account', () => {
  it('detects the format and maps signs, ibans and descriptions', () => {
    const [stmt] = parseStatement(ING_CURRENT);
    expect(stmt.iban).toBe('NL74INGB0001029507');
    expect(stmt.accountType).toBe('checking');
    expect(stmt.entries).toHaveLength(5);

    const salary = stmt.entries.find((e) => e.counterpartyName === 'Werkgever BV')!;
    expect(salary.amountCents).toBe(220_000); // "Bij" = credit
    expect(salary.date).toBe('2026-06-30');
    expect(salary.counterpartyIban).toBe('NL00WERK0000000001');

    const flowers = stmt.entries.find((e) => e.counterpartyName === 'Mw A Voorbeeld')!;
    expect(flowers.amountCents).toBe(-185); // "Af" = debit
    expect(flowers.description).toContain('Online bankieren');
  });

  it('identical same-day rows get distinct, deterministic refs', () => {
    const [a] = parseStatement(ING_CURRENT);
    const [b] = parseStatement(ING_CURRENT);
    const dupes = a.entries.filter((e) => e.counterpartyName === 'Albert Heijn');
    expect(dupes).toHaveLength(2);
    expect(dupes[0].ref).not.toBe(dupes[1].ref); // ordinal disambiguates
    expect(a.entries.map((e) => e.ref)).toEqual(b.entries.map((e) => e.ref)); // stable across parses
  });
});

describe('parseStatement — ING savings', () => {
  it('takes the newest running balance (with its date) and the account name', () => {
    const [stmt] = parseStatement(ING_SAVINGS);
    expect(stmt.accountType).toBe('savings');
    expect(stmt.accountName).toBe('Oranje Spaarrekening');
    expect(stmt.iban).toBe('V 286-81505');
    expect(stmt.closingBalanceCents).toBe(150_920); // newest row's saldo
    expect(stmt.balanceAsOf).toBe('2026-01-01'); // …and the day it was true
    const withdrawal = stmt.entries.find((e) => e.amountCents < 0)!;
    expect(withdrawal.amountCents).toBe(-150_000);
    expect(withdrawal.counterpartyIban).toBe('NL74INGB0001029507');
  });
});

describe('parseStatement — ING current account with balance column', () => {
  // newer ING exports append "Saldo na mutatie" (and "Tag") to the current-account CSV
  const WITH_BALANCE = `"Datum","Naam / Omschrijving","Rekening","Tegenrekening","Code","Af Bij","Bedrag (EUR)","Mutatiesoort","Mededelingen","Saldo na mutatie","Tag"
"20260702","Bakker","NL74INGB0001029507","","BA","Af","3,50","Betaalautomaat","BROOD","996,50",""
"20260701","Werkgever BV","NL74INGB0001029507","NL00WERK0000000001","GT","Bij","1.000,00","Online bankieren","SALARIS","1.000,00",""`;

  it('still routes to the current-account parser and picks the newest balance', () => {
    const [stmt] = parseStatement(WITH_BALANCE);
    expect(stmt.accountType).toBe('checking'); // NOT mis-detected as savings
    expect(stmt.iban).toBe('NL74INGB0001029507');
    expect(stmt.closingBalanceCents).toBe(99_650);
    expect(stmt.balanceAsOf).toBe('2026-07-02');
  });

  it('exports without the balance column yield no balance', () => {
    const [stmt] = parseStatement(ING_CURRENT);
    expect(stmt.closingBalanceCents).toBeNull();
    expect(stmt.balanceAsOf).toBeNull();
  });
});

describe('parseStatement — ING credit card', () => {
  it('keys the account on the masked card number; charges negative', () => {
    const [stmt] = parseStatement(ING_CREDIT, 'Creditcard_210034322508_x.csv');
    expect(stmt.accountType).toBe('credit');
    expect(stmt.iban).toBe('52487201'); // normalized masked card
    const charge = stmt.entries.find((e) => e.counterpartyName === 'IKEA s Gravenhage')!;
    expect(charge.amountCents).toBe(-24_918);
    const repayment = stmt.entries.find((e) => e.counterpartyName === 'AFLOSSING')!;
    expect(repayment.amountCents).toBe(187_852);
  });

  it('falls back to the file name when no row carries the card number', () => {
    const noCard = ING_CREDIT.split('\n').slice(0, 2).join('\n').replace('"5248 **** **** 7201"', '""');
    const [stmt] = parseStatement(noCard, 'Creditcard_210034322508_01-05-2025.csv');
    expect(stmt.iban).toBe('210034322508');
  });
});

describe('parseStatement — detection', () => {
  it('XML routes to CAMT.053, unknown content throws', () => {
    expect(() => parseStatement('name,amount\nfoo,12')).toThrow('Unsupported statement format');
    expect(() => parseStatement('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"></Document>')).toThrow(); // camt validates deeper
  });
});

describe('parseStatement — English variants + balance files (real 2026 exports)', () => {
  const enCurrent = [
    '"Date";"Name / Description";"Account";"Counterparty";"Code";"Debit/credit";"Amount (EUR)";"Transaction type";"Notifications";"Resulting balance";"Tag"',
    '"20260722";"123 3D B.V.";"NL74INGB0001029507";"NL70RABO0115600000";"IW";"Debit";"9,75";"iDEAL | Wero";"Name: 123 3D B.V.";"-1922,25";""',
    '"20260720";"OHRA";"NL74INGB0001029507";"NL98INGB0002712510";"VZ";"Credit";"3,40";"Batch payment";"Name: OHRA";"-1912,50";""',
  ].join(String.fromCharCode(10));

  it('parses the ENGLISH current-account export identically to the Dutch one', () => {
    const [stmt] = parseStatement(enCurrent);
    expect(stmt.accountType).toBe('checking');
    expect(stmt.iban).toBe('NL74INGB0001029507');
    expect(stmt.entries).toHaveLength(2);
    expect(stmt.entries.find((e) => e.counterpartyName === '123 3D B.V.')!.amountCents).toBe(-975);
    expect(stmt.entries.find((e) => e.counterpartyName === 'OHRA')!.amountCents).toBe(340);
    expect(stmt.closingBalanceCents).toBe(-192225);
    expect(stmt.balanceAsOf).toBe('2026-07-22');
  });

  it('NL and EN twins of the same rows produce IDENTICAL dedupe refs', () => {
    // same facts, different header language — re-importing the other
    // language must skip everything
    const nl = [
      '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen";"Saldo na mutatie";"Tag"',
      '"20260722";"123 3D B.V.";"NL74INGB0001029507";"NL70RABO0115600000";"IW";"Af";"9,75";"iDEAL | Wero";"Name: 123 3D B.V.";"-1922,25";""',
    ].join(String.fromCharCode(10));
    const en = [
      '"Date";"Name / Description";"Account";"Counterparty";"Code";"Debit/credit";"Amount (EUR)";"Transaction type";"Notifications";"Resulting balance";"Tag"',
      '"20260722";"123 3D B.V.";"NL74INGB0001029507";"NL70RABO0115600000";"IW";"Debit";"9,75";"iDEAL | Wero";"Name: 123 3D B.V.";"-1922,25";""',
    ].join(String.fromCharCode(10));
    expect(parseStatement(nl)[0].entries[0].ref).toBe(parseStatement(en)[0].entries[0].ref);
  });

  it('parses the ENGLISH credit card (DOT decimals) and the Dutch twin the same', () => {
    const en = [
      '"Date";"Name / Description";"Transaction type";"Debit/credit";"Amount (EUR)";"Notifications";"Card number"',
      '"2026-07-22";"Albert Heijn 1842";"Debit";"Debit";"26.44";"Transaction date: 21/07/2026";"5248 **** **** 7201"',
    ].join(String.fromCharCode(10));
    const [stmt] = parseStatement(en, 'CreditCard_210034322508_x.csv');
    expect(stmt.accountType).toBe('credit');
    expect(stmt.iban).toBe('52487201');
    expect(stmt.entries[0].amountCents).toBe(-2644);
  });

  it('balance-history exports (both kinds) import as zero-entry balance updates', () => {
    const current = [
      '"Date";"Account";"Currency";"Book balance";"Value balance"',
      '"2026-07-22";"NL74INGB0001029507";"EUR";"-1922,25";"-1922,25"',
      '"2026-07-21";"NL74INGB0001029507";"EUR";"-1912,50";"-1912,50"',
    ].join(String.fromCharCode(10));
    const [cur] = parseStatement(current);
    expect(cur.entries).toHaveLength(0);
    expect(cur.accountType).toBe('checking');
    expect(cur.closingBalanceCents).toBe(-192225);
    expect(cur.balanceAsOf).toBe('2026-07-22');

    const savings = [
      '"Datum";"Rekening";"Rekening naam";"Valuta";"Boeksaldo"',
      '"2026-07-22";"V28681505";"Oranje Spaarrekening";"EUR";"9,20"',
    ].join(String.fromCharCode(10));
    const [sav] = parseStatement(savings);
    expect(sav.accountType).toBe('savings');
    expect(sav.accountName).toBe('Oranje Spaarrekening');
    expect(sav.closingBalanceCents).toBe(920);
  });

  it('a header-only export parses to an importable-nothing statement', () => {
    const empty = '"Date";"Description";"Account";"Account name";"Counterparty";"Debit/credit";"Amount";"Currency";"Transaction type";"Notifications";"Resulting balance"';
    const [stmt] = parseStatement(empty);
    expect(stmt.entries).toHaveLength(0);
    expect(stmt.closingBalanceCents).toBeNull();
    expect(stmt.iban).toBe('');
  });
});

describe('parseStatement — PayPal activity export', () => {
  const HDR =
    '"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","To Email Address","Transaction ID","Shipping Address","Address Status","Item Title","Item ID","Shipping and Handling Amount","Insurance Amount","Sales Tax","Option 1 Name","Option 1 Value","Option 2 Name","Option 2 Value","Reference Txn ID","Invoice Number","Custom Number","Quantity","Receipt ID","Balance","Address Line 1","Address Line 2/District/Neighborhood","Town/City","State/Province/Region/County/Territory/Prefecture/Republic","Zip/Postal Code","Country","Contact Phone Number","Subject","Note","Country Code","Balance Impact"';
  const row = (
    date: string,
    name: string,
    type: string,
    status: string,
    currency: string,
    net: string,
    from: string,
    to: string,
    tx: string,
    balance: string,
    impact: string,
    item = '',
  ) =>
    `"${date}","12:00:00","CET","${name}","${type}","${status}","${currency}","${net}","0,00","${net}","${from}","${to}","${tx}","","","${item}","","","","","","","","","","","","","","${balance}","","","","","","","","","","","${impact}"`;

  const ME = 'me@example.com';
  const PAYPAL = [
    HDR,
    row('06/01/2026', 'Acme Music', 'PreApproved Payment Bill User Payment', 'Completed', 'EUR', '-23,00', ME, 'billing@acme.example', 'TX1', '-23,00', 'Debit', 'Music Plus'),
    // the funding leg that tops the balance back up — never a transaction
    row('06/01/2026', '', 'Bank Deposit to PP Account ', 'Pending', 'EUR', '23,00', '', '', 'TX2', '0,00', 'Credit'),
    // an authorization hold: Memo rows are not money moving
    row('16/02/2026', 'Card Corp', 'General Authorization', 'Pending', 'EUR', '-34,99', ME, 'pay@card.example', 'TX3', '0,00', 'Memo'),
    // a USD charge settles through a same-day EUR conversion leg
    row('19/06/2026', 'Octo Devtools', 'PreApproved Payment Bill User Payment', 'Completed', 'USD', '-48,00', ME, 'billing@octo.example', 'TX4', '-48,00', 'Debit'),
    row('19/06/2026', '', 'Bank Deposit to PP Account ', 'Pending', 'EUR', '43,67', '', '', 'TX5', '43,67', 'Credit'),
    row('19/06/2026', '', 'General Currency Conversion', 'Completed', 'EUR', '-43,67', '', '', 'TX6', '0,00', 'Debit'),
    row('19/06/2026', '', 'General Currency Conversion', 'Completed', 'USD', '48,00', '', '', 'TX7', '0,00', 'Credit'),
    // money received stays positive and keeps its sender
    row('24/06/2026', 'A Friend', 'General Payment', 'Completed', 'EUR', '12,50', 'friend@example.com', ME, 'TX8', '12,50', 'Credit'),
  ].join('\n');

  it('imports only real payments, converts foreign charges, keys one synthetic account', () => {
    const [stmt] = parseStatement(PAYPAL);
    // one stable IBAN-less account per PayPal login
    expect(stmt.iban).toBe('PAYPALMEEXAMPLECOM');
    expect(stmt.accountName).toBe(`PayPal ${ME}`);
    expect(stmt.currency).toBe('EUR');

    expect(stmt.entries.map((e) => e.ref)).toEqual(['paypal:TX1', 'paypal:TX4', 'paypal:TX8']);
    const [music, octo, friend] = stmt.entries;
    expect(music.amountCents).toBe(-2300);
    expect(music.counterpartyName).toBe('Acme Music');
    expect(music.description).toContain('Music Plus');
    // the USD charge imports at its EUR settlement cost, original noted
    expect(octo.amountCents).toBe(-4367);
    expect(octo.currency).toBe('EUR');
    expect(octo.description).toContain('48.00 USD');
    expect(friend.amountCents).toBe(1250);
    expect(friend.counterpartyName).toBe('A Friend');

    // newest EUR running balance becomes the closing balance
    expect(stmt.closingBalanceCents).toBe(1250);
    expect(stmt.balanceAsOf).toBe('2026-06-24');
  });
});
