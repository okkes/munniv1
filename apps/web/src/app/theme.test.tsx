// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/test/harness';
import type { Theme, ThemeMode } from './theme';
import { ThemeProvider, useTheme } from './theme';

let api: { theme: Theme; mode: ThemeMode; setMode: (m: ThemeMode) => void; toggle: () => void };

function Probe() {
  api = useTheme();
  return <span data-testid="theme">{api.theme}</span>;
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('defaults to the light system preference and applies the data attribute', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#F7F4EE');
  });

  it('honors a stored theme over the system preference', () => {
    localStorage.setItem('munni_theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('toggle flips and persists; setMode pins or returns to system', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(api.mode).toBe('system'); // nothing stored = follow the device
    act(() => api.toggle());
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(api.mode).toBe('dark'); // the quick toggle pins an explicit theme
    expect(localStorage.getItem('munni_theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#191714');
    act(() => api.setMode('light'));
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(localStorage.getItem('munni_theme')).toBe('light');
    // "follow device" clears the pin (native-benefits §3)
    act(() => api.setMode('system'));
    expect(api.mode).toBe('system');
    expect(localStorage.getItem('munni_theme')).toBeNull();
    expect(screen.getByTestId('theme').textContent).toBe('light'); // happy-dom device = light
  });

  it('useTheme outside the provider throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/within ThemeProvider/);
  });
});
