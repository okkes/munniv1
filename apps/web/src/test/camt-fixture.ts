/** Minimal two-entry CAMT.053 statement shared by parser and import tests. */
export const CAMT_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
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
