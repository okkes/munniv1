/**
 * Minimal RFC-4180-ish CSV reader for bank exports: quoted fields,
 * doubled quotes, comma or semicolon delimiters, CRLF tolerant.
 * Dependency-free on purpose — bank files never leave the device.
 */
export function parseCsv(content: string, delimiter: ',' | ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    // skip completely empty lines
    if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) rows.push(row);
    row = [];
  };

  // returns how many extra chars were consumed (1 for an escaped quote)
  const readQuoted = (ch: string, next: string | undefined): number => {
    if (ch !== '"') {
      field += ch;
      return 0;
    }
    if (next === '"') {
      field += '"';
      return 1;
    }
    inQuotes = false;
    return 0;
  };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      i += readQuoted(ch, content[i + 1]);
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\n') {
      pushField();
      pushRow();
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}

/** "1.878,52" / "36,00" / "1234.56" → integer cents */
export function euAmountToCents(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replaceAll('.', '').replace(',', '.');
  const value = Number(s);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** "20260701" or "2026-07-01" → "2026-07-01" */
export function normalizeDate(raw: string): string | null {
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim());
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  return null;
}
