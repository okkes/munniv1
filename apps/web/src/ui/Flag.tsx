import type { Lang } from '@/i18n';

// bundled offline (scripts/gen-flags.mjs): 4x3 SVGs for every country in
// COUNTRIES + the language flags — never emoji (broken on Windows), never
// a CDN (offline-first)
const FLAG_URLS = import.meta.glob('../assets/flags/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const urlFor = (code: string): string | undefined => FLAG_URLS[`../assets/flags/${code.toLowerCase()}.svg`];

/** app language → representative flag */
const LANG_FLAG: Record<Lang, string> = { en: 'gb', nl: 'nl', tr: 'tr' };
export const langFlagCode = (lang: Lang): string => LANG_FLAG[lang];

/**
 * Country flag icon (user request: flags for every language + country
 * field). Falls back to the familiar code badge when a flag is missing.
 */
export function Flag({ code, size = 18, className = '' }: Readonly<{ code: string; size?: number; className?: string }>) {
  const url = urlFor(code);
  if (!url) {
    return (
      <span className={`rounded-[4px] bg-bg-2 px-1 font-mono text-[10px] font-bold text-ink-3 ${className}`}>
        {code.toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      data-testid={`flag-${code.toLowerCase()}`}
      className={`inline-block shrink-0 rounded-[3px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.08)] ${className}`}
      style={{ width: size, height: Math.round(size * 0.75) }}
    />
  );
}
