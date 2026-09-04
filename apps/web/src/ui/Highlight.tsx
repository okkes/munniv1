import { Fragment } from 'react';

export interface HighlightPart {
  text: string;
  hit: boolean;
}

/** case-insensitive split of `text` around every occurrence of `query` */
export function splitHighlight(text: string, query: string): HighlightPart[] {
  const q = query.trim().toLowerCase();
  if (!q || !text) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const parts: HighlightPart[] = [];
  let pos = 0;
  for (let at = lower.indexOf(q, pos); at !== -1; at = lower.indexOf(q, pos)) {
    if (at > pos) parts.push({ text: text.slice(pos, at), hit: false });
    parts.push({ text: text.slice(at, at + q.length), hit: true });
    pos = at + q.length;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}

/**
 * #267: the query variant that actually hits a formatted AMOUNT — the
 * user types "7,77" while the locale renders "€7.77" (or the reverse),
 * so the decimal separator swaps before giving up. '' = no hit.
 */
export function amountQueryFor(amountText: string, query: string | undefined): string {
  const raw = (query ?? '').trim();
  if (!raw) return '';
  // #267 r2 (user): a leading +/- narrows the SIGN (the filter's job) —
  // the visible hit is the number itself
  const q = /^[+-]/.test(raw) ? raw.slice(1).trim() : raw;
  if (!q) return '';
  const lower = amountText.toLowerCase();
  if (lower.includes(q.toLowerCase())) return q;
  const swapped = q.replace(/[.,]/g, (c) => (c === ',' ? '.' : ','));
  return swapped !== q && lower.includes(swapped.toLowerCase()) ? swapped : '';
}

/**
 * Marks where a search query matched inside result text — every list the
 * app searches renders its match through this, so "why is this a hit?"
 * is always visible.
 */
export function Highlight({ text, query }: Readonly<{ text: string; query: string }>) {
  const parts = splitHighlight(text, query);
  if (!parts.some((part) => part.hit)) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <mark key={`${i}-${part.text}`} className="rounded-[3px] bg-accent-soft text-accent-deep">
            {part.text}
          </mark>
        ) : (
          <Fragment key={`${i}-${part.text}`}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
