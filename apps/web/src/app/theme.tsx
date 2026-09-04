import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { syncNativeStatusBar } from '@/lib/platform';

export type Theme = 'light' | 'dark';
/** 'system' follows the device live (native-benefits §3) */
export type ThemeMode = Theme | 'system';
const LS_KEY = 'munni_theme';

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const deviceTheme = (): Theme => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(LS_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'system'; // first launch and "follow device" both live here
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode); // NOSONAR(S6754) public setMode wraps this setter to persist the choice
  const [device, setDevice] = useState<Theme>(deviceTheme);
  const theme: Theme = mode === 'system' ? device : mode;

  // system mode tracks the OS live (the user may toggle dark mode mid-session)
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDevice(deviceTheme());
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]') ?? (() => {
      const el = document.createElement('meta');
      el.setAttribute('name', 'theme-color');
      document.head.appendChild(el);
      return el;
    })();
    meta.setAttribute('content', theme === 'dark' ? '#191714' : '#F7F4EE');
    syncNativeStatusBar(theme); // native shells: icon color must follow the theme
  }, [theme]);

  const setMode = useCallback((next: ThemeMode) => {
    if (next === 'system') localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, next);
    setModeState(next);
  }, []);

  // the quick toggle keeps its two-state simplicity: it always pins an
  // explicit theme (leaving "system" is a deliberate act, like entering it)
  const toggle = useCallback(() => {
    setModeState((prev) => {
      const current = prev === 'system' ? deviceTheme() : prev;
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem(LS_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, mode, setMode, toggle }), [theme, mode, setMode, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
