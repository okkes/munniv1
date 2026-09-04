/**
 * Cash-register amount entry (user request 2026-08-06): on a price field
 * that starts at 0,00, plain digits fill CENTS from the right — 5 shows
 * 0,05, 55 shows 0,55, 550 shows 5,50 — while a typed comma keeps the
 * familiar style: it promotes the digits typed so far to whole euros
 * ("12" + "," → "12," → "12,50") and hands the field back to free
 * typing. Operators (arithmetic fields: 87,40-25) and any paste or
 * mid-caret edit also fall back to free typing untouched.
 *
 * EU notation throughout: comma decimals, same as parseCents/toText.
 */

export type AmountEntryMode = 'register' | 'free';

export interface AmountEntry {
  mode: AmountEntryMode;
  text: string;
}

/** more digits than any sane price — further register keys are ignored */
const MAX_DIGITS = 9;

/** the register's digit buffer behind a displayed text: significant
 *  digits only ("0,05" → "5", "0,00" → "", "5,50" → "550") */
const bufferOf = (text: string): string => text.replaceAll(/\D/gu, '').replace(/^0+/u, '');

/** the register face of a buffer: last two digits are the cents */
const registerText = (buffer: string): string => {
  if (buffer.length === 0) return '';
  const padded = buffer.padStart(3, '0');
  return `${padded.slice(0, -2)},${padded.slice(-2)}`;
};

/** how a freshly focused field enters: empty and register-shaped values
 *  take register keys; anything else (mid-edit text) stays free */
export const focusEntryMode = (text: string): AmountEntryMode =>
  text === '' || /^\d+,\d{2}$/u.test(text) ? 'register' : 'free';

/**
 * One input event: `prevText` is what the field showed, `raw` is what the
 * browser now reports. Returns the text to render and the mode to keep.
 */
export function nextAmountEntry(mode: AmountEntryMode, prevText: string, raw: string): AmountEntry {
  // clearing the field always re-arms the register
  if (raw === '') return { mode: 'register', text: '' };
  if (mode === 'free') return { mode: 'free', text: raw };
  const appended = raw.length === prevText.length + 1 && raw.startsWith(prevText);
  if (appended) {
    const key = raw.slice(-1);
    if (/\d/u.test(key)) {
      // a leading 0 stays insignificant ("0" shows 0,00; then "5" shows
      // 0,05 — exactly the user's spelled-out sequence)
      const buffer = bufferOf(prevText) + key;
      if (buffer.length > MAX_DIGITS) return { mode: 'register', text: prevText };
      return { mode: 'register', text: registerText(buffer.replace(/^0+/u, '') || '0') };
    }
    if (key === ',' || key === '.') {
      // the comma declares "those were euros": 12 → "12," and free
      // typing finishes the decimals — the classic entry style intact
      return { mode: 'free', text: `${bufferOf(prevText) || '0'},` };
    }
    // operators and anything else: free typing (arithmetic fields)
    return { mode: 'free', text: raw };
  }
  const shortened = prevText.length === raw.length + 1 && prevText.startsWith(raw);
  if (shortened) {
    // backspace shifts the register right: 5,50 → 0,55 → 0,05 → empty
    return { mode: 'register', text: registerText(bufferOf(prevText).slice(0, -1)) };
  }
  // paste or a mid-caret edit: the register can't follow — free typing
  return { mode: 'free', text: raw };
}
