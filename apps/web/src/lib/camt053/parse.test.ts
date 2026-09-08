// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseCamt053 } from './parse';
import { predictCategory } from '@/domain/predictCategory';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>MSG001</MsgId><CreDtTm>2026-07-01T00:30:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>STMT-1</Id>
      <Acct><Id><IBAN>NL69INGB0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">1234.56</Amt><CdtDbtInd>CRDT</CdtDbtInd>
      </Bal>
      <Ntry>
        <Amt Ccy="EUR">42.10</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-06-28</Dt></BookgDt>
        <AcctSvcrRef>REF-001</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <RltdPties>
            <Cdtr><Nm>Albert Heijn 1350</Nm></Cdtr>
            <CdtrAcct><Id><IBAN>NL00AHOL0000000001</IBAN></Id></CdtrAcct>
          </RltdPties>
          <RmtInf><Ustrd>AH 1350 AMSTERDAM Betaalautomaat</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">2200.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-06-25</Dt></BookgDt>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>E2E-777</EndToEndId></Refs>
          <RltdPties><Dbtr><Nm>Werkgever BV</Nm></Dbtr></RltdPties>
          <RmtInf><Ustrd>SALARIS JUNI 2026</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe('parseCamt053', () => {
  it('parses account, closing balance and entries', () => {
    const [stmt] = parseCamt053(FIXTURE);
    expect(stmt.iban).toBe('NL69INGB0123456789');
    expect(stmt.currency).toBe('EUR');
    expect(stmt.closingBalanceCents).toBe(123456); // CLBD, not OPBD
    expect(stmt.entries).toHaveLength(2);
  });

  it('maps debit entry with counterparty and reference', () => {
    const [stmt] = parseCamt053(FIXTURE);
    const debit = stmt.entries[0];
    expect(debit).toMatchObject({
      amountCents: -4210,
      currency: 'EUR',
      date: '2026-06-28',
      counterpartyName: 'Albert Heijn 1350',
      counterpartyIban: 'NL00AHOL0000000001',
      ref: 'REF-001',
    });
    expect(debit.description).toContain('AH 1350');
  });

  it('maps credit entry, falling back to EndToEndId for ref', () => {
    const [stmt] = parseCamt053(FIXTURE);
    const credit = stmt.entries[1];
    expect(credit).toMatchObject({
      amountCents: 220000,
      counterpartyName: 'Werkgever BV',
      ref: 'E2E-777',
    });
  });

  it('rejects non-CAMT xml', () => {
    expect(() => parseCamt053('<foo/>')).toThrow();
  });
});

// ASN-style export: multiple statements, POS entries with an empty
// <TxDtls/> whose merchant lives in AddtlNtryInf, NtryRef as only ref,
// and a DBIT (negative) closing balance.
const ASN_FIXTURE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>CAMT053ASN1</MsgId><CreDtTm>2026-07-07T15:33:03+02:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>S1</Id>
      <Acct><Id><IBAN>NL00ASNB0000000001</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">627.63</Amt><CdtDbtInd>DBIT</CdtDbtInd>
      </Bal>
      <Ntry>
        <NtryRef>20260402-3613500</NtryRef>
        <Amt Ccy="EUR">34.36</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-04-02</Dt></BookgDt>
        <NtryDtls><TxDtls/></NtryDtls>
        <AddtlNtryInf>Albert Heijn 1842     &gt;S-GRAVENH 2.04.2026 21U15 KV007 MCC:5411 Apple Pay betaling   NLNEDERLAND</AddtlNtryInf>
      </Ntry>
      <Ntry>
        <NtryRef>20260430-9999001</NtryRef>
        <Amt Ccy="EUR">4.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-04-30</Dt></BookgDt>
        <AddtlNtryInf>Kosten gebruik betaalrekening</AddtlNtryInf>
      </Ntry>
    </Stmt>
    <Stmt>
      <Id>S2</Id>
      <Acct><Id><IBAN>NL00ASNB0000000002</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry>
        <NtryRef>20260401-1602412</NtryRef>
        <Amt Ccy="EUR">200.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-04-01</Dt></BookgDt>
        <NtryDtls><TxDtls>
          <Refs><InstrId>INNDNL2U1</InstrId><TxId>CPU3Y3KC1</TxId></Refs>
          <RltdPties><Dbtr><Nm>Mw E Voorbeeld</Nm></Dbtr></RltdPties>
          <RmtInf><Ustrd>Grocery money</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
        <AddtlNtryInf>NL00INGB0000000009-Mw E Voorbeeld-Grocery money</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe('parseCamt053 — ASN-style exports', () => {
  it('parses multiple statements and a negative (DBIT) closing balance', () => {
    const stmts = parseCamt053(ASN_FIXTURE);
    expect(stmts).toHaveLength(2);
    expect(stmts[0].closingBalanceCents).toBe(-62763);
    expect(stmts[1].iban).toBe('NL00ASNB0000000002');
  });

  it('POS entries take the merchant from AddtlNtryInf before the ">" column', () => {
    const [s1] = parseCamt053(ASN_FIXTURE);
    const pos = s1.entries[0];
    expect(pos.counterpartyName).toBe('Albert Heijn 1842');
    expect(pos.amountCents).toBe(-3436);
    expect(pos.ref).toBe('20260402-3613500');
  });

  it('fee entries without any party keep the description; NtryRef is the ref', () => {
    const [s1] = parseCamt053(ASN_FIXTURE);
    const fee = s1.entries[1];
    expect(fee.counterpartyName).toBeUndefined();
    expect(fee.description).toBe('Kosten gebruik betaalrekening');
    expect(fee.ref).toBe('20260430-9999001');
  });

  it('SEPA entries prefer human remittance over the machine summary line', () => {
    const [, s2] = parseCamt053(ASN_FIXTURE);
    const sepa = s2.entries[0];
    expect(sepa.counterpartyName).toBe('Mw E Voorbeeld');
    expect(sepa.description).toBe('Grocery money');
    // no AcctSvcrRef/EndToEndId: NtryRef wins over TxId
    expect(sepa.ref).toBe('20260401-1602412');
  });
});

describe('predictCategory on parsed entries', () => {
  it('categorizes a Dutch grocery debit', () => {
    const [stmt] = parseCamt053(FIXTURE);
    const debit = stmt.entries[0];
    const catId = predictCategory(`${debit.counterpartyName} ${debit.description}`, 'debit');
    expect(catId).toBe('groceries');
  });

  it('categorizes a Dutch salary credit', () => {
    const [stmt] = parseCamt053(FIXTURE);
    const credit = stmt.entries[1];
    const catId = predictCategory(`${credit.counterpartyName} ${credit.description}`, 'credit');
    expect(catId).toBe('salary');
  });

  it('income keywords never fire on debits', () => {
    expect(predictCategory('SALARIS JUNI', 'debit')).not.toBe('salary');
  });

  it('returns null when nothing matches', () => {
    expect(predictCategory('xyzzy qwerty', 'debit')).toBeNull();
  });
});
