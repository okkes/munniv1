import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { mirrorLangForSw } from '@/lib/swBridge';
import { en } from './en';
import type { TranslationKey } from './en';
import { nl } from './nl';
import { tr } from './tr';

export type Lang = 'en' | 'nl' | 'tr';
export type { TranslationKey };

/** BCP 47 locale per UI language, for Intl formatting */
export const LOCALES: Record<Lang, string> = { en: 'en-GB', nl: 'nl-NL', tr: 'tr-TR' };

export const LANGS: Lang[] = ['en', 'nl', 'tr'];
/** native names — a language picker must be readable in the language it offers */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', nl: 'Nederlands', tr: 'Türkçe' };

const DICTS: Record<Lang, Partial<Record<TranslationKey, string>>> = { en, nl, tr };
const LS_KEY = 'munni_lang';

export type TFunc = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** true when the user pinned a language; false = following the device */
  langOverridden: boolean;
  /** drop the pinned language and track the device again (native-benefits §3) */
  followDeviceLang: () => void;
  t: TFunc;
}

const LangContext = createContext<LangContextValue | null>(null);

function deviceLang(): Lang {
  // scan the WHOLE system preference list, not just the primary (user
  // request: match the device language at the login screen) — a Dutch
  // system with English first still surfaces nl further down. No match →
  // English. (IP-country guessing deliberately skipped: it would need an
  // external lookup before login, against the zero-telemetry posture.)
  for (const candidate of navigator.languages?.length ? navigator.languages : [navigator.language || '']) {
    const code = candidate.slice(0, 2).toLowerCase();
    if (code === 'nl' || code === 'tr' || code === 'en') return code as Lang;
  }
  return 'en';
}

function readStoredLang(): Lang {
  // headless callers (node-environment tests, workers) have no DOM
  // storage — the device/default language answers there
  if (typeof localStorage === 'undefined') return typeof navigator === 'undefined' ? 'en' : deviceLang();
  const stored = localStorage.getItem(LS_KEY);
  if (stored === 'en' || stored === 'nl' || stored === 'tr') return stored;
  // first launch: follow the device language when it maps to one we speak
  // (native-benefits §3). A deliberate pick in Settings wins forever.
  return deviceLang();
}

/** the active language for non-React code (catalog names) — kept in
 *  sync by LangProvider; falls back to the stored/device pick */
let currentLang: Lang | null = null;
export function getCurrentLang(): Lang {
  return currentLang ?? readStoredLang();
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);
  currentLang = lang;
  const [langOverridden, setLangOverridden] = useState<boolean>(() => localStorage.getItem(LS_KEY) !== null);

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(LS_KEY, next);
    setLangOverridden(true);
    setLangState(next);
  }, []);

  const followDeviceLang = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    setLangOverridden(false);
    setLangState(deviceLang());
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    // push notifications (service worker) must speak the app's language
    mirrorLangForSw(lang);
  }, [lang]);

  const t = useCallback<TFunc>(
    (key, vars) => interpolate(DICTS[lang][key] ?? en[key] ?? key, vars),
    [lang],
  );

  const value = useMemo(
    () => ({ lang, setLang, langOverridden, followDeviceLang, t }),
    [lang, setLang, langOverridden, followDeviceLang, t],
  );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within LangProvider');
  return ctx;
}
