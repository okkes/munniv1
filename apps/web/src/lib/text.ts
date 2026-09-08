import { LOCALES } from '@/i18n';
import type { Lang } from '@/i18n';

/** "5 minutes ago" / "2 days ago" — localized, coarse on purpose */
export function fmtTimeAgo(iso: string, lang: Lang, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const rtf = new Intl.RelativeTimeFormat(LOCALES[lang], { numeric: 'auto' });
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return rtf.format(-Math.max(minutes, 0), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 31) return rtf.format(-days, 'day');
  return rtf.format(-Math.round(days / 30), 'month');
}

/** #300: the duration half of "about {time} left" on long imports —
 *  seconds under a minute, whole minutes above, localized through Intl
 *  ("45 sec" / "2 min" / "2 dk") so no unit tables are needed */
export function fmtEtaShort(seconds: number, lang: Lang): string {
  const unit = seconds < 60 ? 'second' : 'minute';
  const value = unit === 'second' ? Math.max(1, Math.round(seconds)) : Math.round(seconds / 60);
  return new Intl.NumberFormat(LOCALES[lang], { style: 'unit', unit, unitDisplay: 'short' }).format(value);
}

/**
 * Bank data hygiene: ING (and others) embed literal "<br>" separators in
 * remittance text. Strip markup-ish noise for display — covers rows that
 * were imported before server-side sanitation existed.
 */
export function cleanBankText(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** the display title everywhere: the user's rename wins over the bank's */
export function txTitle(tx: { merchant: string; titleOverride?: string }): string {
  return tx.titleOverride?.trim() || cleanBankText(tx.merchant);
}

/** a stored label only counts when it says something — whitespace-only
 *  values (legacy writes, #126 r8) fall back to the derived default */
export function orDefaultLabel(label: string | undefined, fallback: string): string {
  return label?.trim() ? label : fallback;
}

/**
 * Bank feeds carry structured keys like "invoice_number: 123" — humanize
 * the snake_case labels ("Invoice number: 123") without touching the
 * values or free-form text around them.
 */
export function humanizeBankKeys(text: string): string {
  return text.replace(/(^|·\s*)([a-z][a-z0-9]*(?:_[a-z0-9]+)+):/g, (_m, prefix: string, key: string) => {
    const label = key.replaceAll('_', ' ');
    return `${prefix}${label.charAt(0).toUpperCase()}${label.slice(1)}:`;
  });
}
