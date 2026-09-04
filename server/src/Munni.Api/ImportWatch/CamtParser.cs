using System.Globalization;
using System.Xml.Linq;

namespace Munni.Api.ImportWatch;

/// <summary>One statement entry — the C# twin of apps/web/src/lib/camt053/parse.ts.</summary>
public sealed record CamtEntry(
    int AmountCents, // signed; DBIT = negative
    string Currency,
    string Date, // yyyy-mm-dd booking date
    string? CounterpartyName,
    string? CounterpartyIban,
    string Description,
    string Ref);

public sealed record CamtStatement(
    string Iban,
    string Currency,
    int? ClosingBalanceCents,
    string? BalanceAsOf,
    IReadOnlyList<CamtEntry> Entries);

/// <summary>
/// CAMT.053 parser for the watch-folder importer. Field mapping and —
/// critically — the entry REF derivation mirror the client parser
/// exactly, so a file dropped in the folder and the same file imported
/// on a device produce identical transaction ids (dedupe by
/// construction, like GoCardless ⇄ CAMT already does).
/// </summary>
public static class CamtParser
{
    public static IReadOnlyList<CamtStatement> Parse(string xml)
    {
        var doc = XDocument.Parse(xml);
        var root = doc.Root ?? throw new FormatException("empty document");
        if (root.Name.LocalName != "Document") throw new FormatException("not a CAMT.053 document");
        var bkToCstmr = Child(root, "BkToCstmrStmt") ?? throw new FormatException("not a CAMT.053 document");

        return Children(bkToCstmr, "Stmt").Select(ParseStatement).ToList();
    }

    private static CamtStatement ParseStatement(XElement stmt)
    {
        var iban = Text(stmt, "Acct", "Id", "IBAN") ?? "";
        var currency = Text(stmt, "Acct", "Ccy") ?? "EUR";
        var entries = Children(stmt, "Ntry")
            .Select(ntry => ParseEntry(ntry, currency))
            .Where(entry => entry is not null)
            .Select(entry => entry!)
            .ToList();
        var closing = ParseClosingBalance(stmt);
        return new CamtStatement(iban, currency, closing?.Cents, closing?.Date, entries);
    }

    private sealed record Closing(int Cents, string? Date);

    private static Closing? ParseClosingBalance(XElement stmt)
    {
        Closing? closing = null;
        foreach (var bal in Children(stmt, "Bal"))
        {
            if (Text(bal, "Tp", "CdOrPrtry", "Cd") != "CLBD") continue;
            var cents = ToCents(Text(bal, "Amt"));
            if (cents is null) continue;
            var date = Text(bal, "Dt", "Dt") ?? Text(bal, "Dt", "DtTm")?[..10];
            closing = new Closing(Text(bal, "CdtDbtInd") == "DBIT" ? -cents.Value : cents.Value, date);
        }
        return closing;
    }

    private static CamtEntry? ParseEntry(XElement ntry, string statementCurrency)
    {
        var amtEl = Children(ntry, "Amt").FirstOrDefault();
        var cents = ToCents(amtEl?.Value.Trim());
        if (cents is null) return null;
        var debit = Text(ntry, "CdtDbtInd") == "DBIT";
        var date = Text(ntry, "BookgDt", "Dt") ?? Text(ntry, "ValDt", "Dt") ?? "";

        var txDtls = Children(ntry, "NtryDtls").SelectMany(d => Children(d, "TxDtls")).FirstOrDefault();
        var relatedParty = debit ? "Cdtr" : "Dbtr";
        var counterpartyName = Text(txDtls, "RltdPties", relatedParty, "Nm");
        var counterpartyIban = Text(txDtls, "RltdPties", $"{relatedParty}Acct", "Id", "IBAN");

        var remittance = txDtls is null
            ? ""
            : string.Join(' ', Children(txDtls, "RmtInf")
                .SelectMany(r => Children(r, "Ustrd"))
                .Select(u => u.Value.Trim())
                .Where(v => v.Length > 0));
        var addtlInfo = Text(ntry, "AddtlNtryInf") ?? "";
        // human-written remittance beats the bank's machine summary line
        var description = (remittance.Length > 0 ? remittance : addtlInfo).Trim();

        // POS/card entries carry no party block — the merchant sits in
        // AddtlNtryInf before the '>' column ("Albert Heijn 1842 >CITY …")
        if (string.IsNullOrEmpty(counterpartyName) && addtlInfo.Contains('>'))
        {
            var merchant = addtlInfo.Split('>')[0].Trim();
            counterpartyName = merchant.Length > 0 ? merchant : null;
        }

        // MUST match the client's fallback chain — ids depend on it
        var reference =
            Text(ntry, "AcctSvcrRef") ??
            Text(txDtls, "Refs", "AcctSvcrRef") ??
            Text(txDtls, "Refs", "EndToEndId") ??
            Text(ntry, "NtryRef") ??
            Text(txDtls, "Refs", "TxId") ??
            $"{date}:{cents}:{counterpartyName ?? ""}:{Truncate(description, 40)}";

        return new CamtEntry(
            debit ? -cents.Value : cents.Value,
            amtEl?.Attribute("Ccy")?.Value ?? statementCurrency,
            date,
            counterpartyName,
            counterpartyIban,
            description,
            reference);
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    private static int? ToCents(string? amount)
    {
        if (string.IsNullOrEmpty(amount)) return null;
        return decimal.TryParse(amount, NumberStyles.Number, CultureInfo.InvariantCulture, out var value)
            ? (int)Math.Round(value * 100)
            : null;
    }

    private static XElement? Child(XElement parent, string localName) =>
        parent.Elements().FirstOrDefault(e => e.Name.LocalName == localName);

    private static IEnumerable<XElement> Children(XElement parent, string localName) =>
        parent.Elements().Where(e => e.Name.LocalName == localName);

    private static string? Text(XElement? parent, params string[] path)
    {
        var el = parent;
        foreach (var name in path)
        {
            if (el is null) return null;
            el = Child(el, name);
        }
        var value = el?.Value.Trim();
        return string.IsNullOrEmpty(value) ? null : value;
    }
}
