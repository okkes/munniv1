import type { Lang } from '@/i18n';

const LOCALE: Record<Lang, string> = { en: 'en-IE', nl: 'nl-NL', tr: 'tr-TR' };

/** Parse a user-entered amount ('1.234,56' / '1234.56') to cents. */
export function parseCents(input: string): number | null {
  let s = input.trim();
  if (!s) return null; // empty input is not a valid €0.00
  if (s.includes(',')) s = s.replaceAll('.', '').replace(',', '.'); // EU format
  const value = Number(s);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/**
 * Little arithmetic for amount fields (user request 2026-08-01: "let me
 * do some math when creating a loan" — 3*250+100 instead of a phone
 * calculator detour). + − * / and parentheses over plain numbers; a
 * recursive-descent parser, never eval. EU commas work: with a comma
 * present, dots are thousand separators (parseCents' rule). Returns
 * cents, or null when the text isn't an expression (or divides by 0).
 */
export function evalAmountCents(input: string): number | null {
  let s = input.trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replaceAll('.', '').replace(',', '.');
  if (!/^[\d.+\-*/() ]+$/.test(s)) return null;
  let pos = 0;
  const peek = () => s[pos];
  const eat = () => s[pos++];
  const skip = () => {
    while (s[pos] === ' ') pos++;
  };
  // eslint-disable-next-line sonarjs/cognitive-complexity
  const parsePrimary = (): number => {
    skip();
    if (peek() === '(') {
      eat();
      const inner = parseSum();
      skip();
      if (peek() !== ')') throw new Error('unbalanced');
      eat();
      return inner;
    }
    if (peek() === '-') {
      eat();
      return -parsePrimary();
    }
    const start = pos;
    while (/[\d.]/.test(s[pos] ?? '')) pos++;
    if (pos === start) throw new Error('number expected');
    const value = Number(s.slice(start, pos));
    if (!Number.isFinite(value)) throw new Error('bad number');
    return value;
  };
  const parseProduct = (): number => {
    let value = parsePrimary();
    for (;;) {
      skip();
      const op = peek();
      if (op !== '*' && op !== '/') return value;
      eat();
      const rhs = parsePrimary();
      if (op === '/' && rhs === 0) throw new Error('division by zero');
      value = op === '*' ? value * rhs : value / rhs;
    }
  };
  const parseSum = (): number => {
    let value = parseProduct();
    for (;;) {
      skip();
      const op = peek();
      if (op !== '+' && op !== '-') return value;
      eat();
      const rhs = parseProduct();
      value = op === '+' ? value + rhs : value - rhs;
    }
  };
  try {
    const result = parseSum();
    skip();
    if (pos !== s.length) return null; // trailing garbage
    return Number.isFinite(result) ? Math.round(result * 100) : null;
  } catch {
    return null;
  }
}

/** Format integer minor units as a localized currency string.
 *  #254: 'XXX' is ISO-4217's "no currency" — wallets (PayPal) without a
 *  bound currency carried it into the UI as a literal "XXX 12.34".
 *  Render the bare amount instead: the number is real, the unit unknown. */
export function fmtCents(cents: number, currency: string, lang: Lang, opts?: { sign?: boolean }): string {
  const noCurrency = !currency || currency === 'XXX';
  const formatted = new Intl.NumberFormat(
    LOCALE[lang],
    noCurrency
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : // #150 (user): bare symbol — the default spelled USD as "US$1.00"
        // under en-IE; the disambiguation prefix reads as noise in-app
        { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 },
  ).format(cents / 100);
  if (opts?.sign && cents > 0) return `+${formatted}`;
  return formatted;
}

/** The one signed-percent format (redesign §2J): '+2.4%' / '-0.8%' / '0.0%'. */
export function fmtSignedPct(pct: number, decimals = 1): string {
  const v = pct.toFixed(decimals);
  return pct > 0 ? `+${v}%` : `${v}%`;
}
