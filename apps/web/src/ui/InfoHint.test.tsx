// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/harness';
import { InfoHint } from './InfoHint';

describe('InfoHint (#283)', () => {
  it('starts collapsed; tapping the icon unfolds the text, tapping again folds it away', () => {
    localStorage.setItem('munni_lang', 'en');
    renderWithProviders(<InfoHint text="The full story." testId="demo-hint" />);

    const toggle = screen.getByTestId('demo-hint-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('More info');
    expect(screen.queryByTestId('demo-hint')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('demo-hint').textContent).toBe('The full story.');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('demo-hint')).toBeNull();
  });

  it('wraps its expansion onto a full-width line so flex-wrap hosts keep their caption row', () => {
    localStorage.setItem('munni_lang', 'en');
    renderWithProviders(
      <div className="flex flex-wrap items-center gap-1.5">
        <span>Caption</span>
        <InfoHint text="Below the row." testId="wrap-hint" />
      </div>,
    );
    fireEvent.click(screen.getByTestId('wrap-hint-toggle'));
    expect(screen.getByTestId('wrap-hint').className).toContain('basis-full');
  });
});
