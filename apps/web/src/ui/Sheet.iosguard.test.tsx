// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LangProvider } from '@/i18n';
// harness registers RTL cleanup between tests
import '@/test/harness';

// #134: the guard is iOS-gated at module load — Sheet must believe it
// is on an iPhone BEFORE it is imported
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  isIOS: () => true,
}));
const { Sheet } = await import('./Sheet');

describe('iOS scroll-jail guard (#134)', () => {
  it('zeroes shoved offsets on non-scrollers after an editable focus; real scrollers keep theirs', async () => {
    localStorage.setItem('munni_lang', 'en');
    render(
      <LangProvider>
        <Sheet open onOpenChange={() => undefined} title="t" size="compact">
          <div data-testid="chrome" style={{ overflow: 'hidden' }}>
            <div data-testid="scroller" style={{ overflowY: 'auto' }}>
              <input data-testid="field" />
            </div>
          </div>
        </Sheet>
      </LangProvider>,
    );
    const chrome = screen.getByTestId('chrome');
    const scroller = screen.getByTestId('scroller');
    // WebKit's shove: scroll offsets appear on elements that can't scroll
    chrome.scrollTop = 7;
    scroller.scrollTop = 5;
    fireEvent.focusIn(screen.getByTestId('field'));
    await waitFor(() => expect(chrome.scrollTop).toBe(0));
    expect(scroller.scrollTop).toBe(5); // the legit scroller is untouched
  });

  it('ignores focus that lands outside editables', async () => {
    localStorage.setItem('munni_lang', 'en');
    render(
      <LangProvider>
        <Sheet open onOpenChange={() => undefined} title="t" size="compact">
          <div data-testid="chrome2" style={{ overflow: 'hidden' }}>
            <button data-testid="btn" type="button">
              x
            </button>
          </div>
        </Sheet>
      </LangProvider>,
    );
    const chrome = screen.getByTestId('chrome2');
    chrome.scrollTop = 9;
    fireEvent.focusIn(screen.getByTestId('btn'));
    // give the rAF path a beat — a button focus must not trigger the sweep
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(chrome.scrollTop).toBe(9);
  });
});
