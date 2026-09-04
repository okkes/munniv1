// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LangProvider } from '@/i18n';
// harness registers RTL cleanup between tests
import '@/test/harness';
import { Sheet, sheetLibAvoidsKeyboard } from './Sheet';

/** lg viewport: the Sheet renders its centered desktop dialog */
const stubDesktop = () => {
  const original = window.matchMedia;
  window.matchMedia = (() => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
};

const dialogFor = (ui: React.ReactElement): HTMLDialogElement => {
  render(<LangProvider>{ui}</LangProvider>);
  const dialog = document.querySelector('dialog');
  expect(dialog).toBeTruthy();
  return dialog!;
};

describe('desktop dialog sizing (#276)', () => {
  it('grows with content: auto height, a viewport ceiling and a size-derived floor', () => {
    localStorage.setItem('munni_lang', 'en');
    const restore = stubDesktop();
    try {
      const dialog = dialogFor(
        <Sheet open onOpenChange={() => undefined} title="t" size="form">
          <div data-testid="dlg-content" />
        </Sheet>,
      );
      expect(screen.getByTestId('dlg-content')).toBeTruthy();
      expect(dialog.style.height).toBe('auto');
      // form = 440px on the phone; the dialog keeps 60% as its floor
      expect(dialog.style.minHeight).toBe('264px');
      expect(dialog.style.maxHeight).toBe('min(85dvh, 900px)');
    } finally {
      restore();
    }
  });

  it('a size-less sheet stays fully content-sized (no floor)', () => {
    localStorage.setItem('munni_lang', 'en');
    const restore = stubDesktop();
    try {
      const dialog = dialogFor(
        <Sheet open onOpenChange={() => undefined} title="t">
          <div />
        </Sheet>,
      );
      expect(dialog.style.height).toBe('auto');
      expect(dialog.style.minHeight).toBe('');
    } finally {
      restore();
    }
  });

  it('#290: the dialog opts out of the app-level focus reveal; native reveals get air', () => {
    localStorage.setItem('munni_lang', 'en');
    const restore = stubDesktop();
    try {
      const dialog = dialogFor(
        <Sheet open onOpenChange={() => undefined} title="t" size="form">
          <div />
        </Sheet>,
      );
      // AppLayout's keyboard reveal CENTERS a focused field in the
      // nearest scroller — with no on-screen keyboard that yanked
      // mid-size dialogs "way up" on click. The guard in AppLayout
      // stands down inside this class wherever SHEET_OWNS_KEYBOARD,
      // so the dialog must wear it.
      expect(dialog.className).toContain('react-modal-sheet-container');
      // the browser's own minimal focus scroll stays (hidden fields
      // still surface) — scroll-padding keeps them off the clip edge
      const scroller = dialog.querySelector('.overflow-y-auto')!;
      expect(scroller.className).toContain('[scroll-padding-block:16px]');
    } finally {
      restore();
    }
  });

  it('the content area is the scroller, so a taller-than-ceiling body scrolls inside', () => {
    localStorage.setItem('munni_lang', 'en');
    const restore = stubDesktop();
    try {
      const dialog = dialogFor(
        <Sheet open onOpenChange={() => undefined} title="t" size="tall">
          <div data-testid="tall-content" style={{ height: 2000 }} />
        </Sheet>,
      );
      const scroller = dialog.querySelector('.overflow-y-auto');
      expect(scroller).toBeTruthy();
      expect(scroller!.contains(screen.getByTestId('tall-content'))).toBe(true);
    } finally {
      restore();
    }
  });
});

/** #290 r2 (user): at sub-lg widths the MOBILE sheet hosts the same
 *  forms — and the sheet library's avoidKeyboard machinery misfires on
 *  desktop Chromium (navigator.virtualKeyboard exists keyboard-less;
 *  the lib flips overlaysContent itself and takes any focused field
 *  for "keyboard open" at height 0), smooth-scrolling the field flush
 *  under the sheet header. The library must engage by POINTER, not by
 *  platform: fine pointer = no on-screen keyboard = stand down.
 *  happy-dom has no layout AND framer-motion drops the lib's var()
 *  padding there, so the DOM carries no honest signal — the smoke
 *  specs the exported DECISION the Sheet feeds the library instead
 *  (the scroll behavior itself was verified in a real Chromium). */
describe('#290 r2: mobile-sheet keyboard avoidance engages by pointer', () => {
  const stubPointer = (coarse: boolean) => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      // '(pointer: coarse)' answers per stub; every other query
      // (the lg breakpoint) stays false
      matches: coarse && query.includes('pointer: coarse'),
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    return () => {
      window.matchMedia = original;
    };
  };

  it('fine pointer (plain desktop): the library stands down — nothing scrolls a focused field', () => {
    const restore = stubPointer(false);
    try {
      expect(sheetLibAvoidsKeyboard()).toBe(false);
    } finally {
      restore();
    }
  });

  it('coarse pointer (touch tablets): the avoidance stays — the real-keyboard path is untouched', () => {
    const restore = stubPointer(true);
    try {
      expect(sheetLibAvoidsKeyboard()).toBe(true);
    } finally {
      restore();
    }
  });
});
