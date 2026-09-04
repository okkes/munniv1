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
