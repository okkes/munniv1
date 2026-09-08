import { describe, expect, it } from 'vitest';
import { focusEntryMode, nextAmountEntry } from './amountRegister';
import type { AmountEntry } from './amountRegister';

/** run a key sequence the way the input reports it: each key appends */
function typeKeys(keys: string): AmountEntry {
  let entry: AmountEntry = { mode: 'register', text: '' };
  for (const key of keys) {
    entry = nextAmountEntry(entry.mode, entry.text, entry.text + key);
  }
  return entry;
}

describe('nextAmountEntry — register style (user spec 2026-08-06)', () => {
  it('digits fill cents from the right: 5 → 0,05 → 0,55 → 5,50', () => {
    expect(typeKeys('5').text).toBe('0,05');
    expect(typeKeys('55').text).toBe('0,55');
    expect(typeKeys('550').text).toBe('5,50');
  });

  it('the spelled-out comma path still works: 0 , 0 5 → 0,05', () => {
    expect(typeKeys('0').text).toBe('0,00');
    expect(typeKeys('0,05')).toEqual({ mode: 'free', text: '0,05' });
  });

  it('a comma promotes typed digits to euros: 1 2 , 5 0 → 12,50', () => {
    expect(typeKeys('12').text).toBe('0,12');
    expect(typeKeys('12,').text).toBe('12,');
    expect(typeKeys('12,50').text).toBe('12,50');
  });

  it('a dot promotes the same way (either notation typed)', () => {
    expect(typeKeys('7.').text).toBe('7,');
  });

  it('backspace shifts right until the field empties', () => {
    let entry = typeKeys('550'); // 5,50
    entry = nextAmountEntry(entry.mode, entry.text, entry.text.slice(0, -1));
    expect(entry.text).toBe('0,55');
    entry = nextAmountEntry(entry.mode, entry.text, entry.text.slice(0, -1));
    expect(entry.text).toBe('0,05');
    entry = nextAmountEntry(entry.mode, entry.text, entry.text.slice(0, -1));
    expect(entry).toEqual({ mode: 'register', text: '' });
  });

  it('arithmetic survives: 8 7 , 4 0 - 2 5 stays a free expression', () => {
    const entry = typeKeys('87,40-25');
    expect(entry).toEqual({ mode: 'free', text: '87,40-25' });
  });

  it('an operator right after register digits frees the field as shown', () => {
    expect(typeKeys('87-').text).toBe('0,87-');
  });

  it('paste and mid-caret edits fall back to free typing untouched', () => {
    expect(nextAmountEntry('register', '0,05', '12,34')).toEqual({ mode: 'free', text: '12,34' });
    expect(nextAmountEntry('register', '0,55', '0,5')).toEqual({ mode: 'register', text: '0,05' });
    expect(nextAmountEntry('register', '0,55', 'x0,55')).toEqual({ mode: 'free', text: 'x0,55' });
  });

  it('clearing re-arms the register even from free mode', () => {
    expect(nextAmountEntry('free', '12,50', '')).toEqual({ mode: 'register', text: '' });
  });

  it('ignores digits past any sane price', () => {
    expect(typeKeys('1234567890').text).toBe('1234567,89');
  });

  it('free mode never reinterprets keys', () => {
    expect(nextAmountEntry('free', '12,5', '12,50')).toEqual({ mode: 'free', text: '12,50' });
  });
});

describe('focusEntryMode', () => {
  it('empty and register-shaped values re-enter register style', () => {
    expect(focusEntryMode('')).toBe('register');
    expect(focusEntryMode('12,50')).toBe('register');
  });

  it('mid-edit text stays free', () => {
    expect(focusEntryMode('12,5')).toBe('free');
    expect(focusEntryMode('87,40-25')).toBe('free');
  });
});
