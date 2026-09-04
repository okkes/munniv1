import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * The row/tile/badge vocabulary (redesign §2B–G). Every screen builds
 * lists, tiles, chips and progress from these so the anatomy can't
 * drift again: nav rows 15px/py-3.5, data rows 13px/py-2.5, tiles at
 * exactly 48/36, tone soft-bg + deep-fg pairs, tokens only.
 */

export type Tone = 'accent' | 'warning' | 'negative' | 'info' | 'special' | 'neutral';

/** soft background per tone (dark mode shifts via the tokens) */
const TONE_BG: Record<Tone, string> = {
  accent: 'bg-accent-soft',
  warning: 'bg-warning-soft',
  negative: 'bg-negative-soft',
  info: 'bg-info-soft',
  special: 'bg-special-soft',
  neutral: 'bg-bg-2',
};

/** readable foreground on the soft background */
const TONE_FG: Record<Tone, string> = {
  accent: 'var(--m-accent-deep)',
  warning: 'var(--m-warning)',
  negative: 'var(--m-negative)',
  info: 'var(--m-info)',
  special: 'var(--m-special)',
  neutral: 'var(--m-ink-3)',
};

const TONE_TEXT: Record<Tone, string> = {
  accent: 'text-accent-deep',
  warning: 'text-warning',
  negative: 'text-negative',
  info: 'text-info',
  special: 'text-special',
  neutral: 'text-ink-3',
};

export const toneColor = (tone: Tone): string => TONE_FG[tone];

/** icon-in-a-soft-square: 48 for heroes, 36 for rows and blocks (§2C) */
export function Tile({
  icon,
  tone = 'accent',
  size = 36,
  color,
  bg,
  children,
}: Readonly<{
  icon?: string;
  tone?: Tone;
  size?: 48 | 36;
  /** icon color override (defaults to the tone's foreground) */
  color?: string;
  /** dynamic background (category color-mix, budget urgency) — replaces the tone */
  bg?: string;
  /** richer content than an icon (brand logo, picture) */
  children?: ReactNode;
}>) {
  const box = size === 48 ? 'h-12 w-12 rounded-2xl' : 'h-9 w-9 rounded-xl';
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center ${box} ${bg ? '' : TONE_BG[tone]}`}
      style={bg ? { background: bg, color: color ?? undefined } : undefined}
    >
      {children ?? (icon && <Icon name={icon} size={size === 48 ? 22 : 17} color={color ?? (bg ? 'currentColor' : TONE_FG[tone])} />)}
    </span>
  );
}

interface RowProps {
  /** nav rows go somewhere (15px, py-3.5); data rows show a record (13px, py-2.5) */
  kind?: 'nav' | 'data';
  title: ReactNode;
  sub?: ReactNode;
  /** bare leading icon (nav style — settings rows stay untiled by design) */
  icon?: string;
  iconColor?: string;
  /** richer leading visual (a <Tile>, an <img>…) — wins over `icon` */
  leading?: ReactNode;
  /** right-aligned content; nav rows append a chevron unless disabled */
  trailing?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  className?: string;
}

/** one list-row anatomy for the whole app (§2B) */
export function Row({
  kind = 'nav',
  title,
  sub,
  icon,
  iconColor,
  leading,
  trailing,
  chevron,
  onClick,
  disabled,
  testId,
  className = '',
}: Readonly<RowProps>) {
  const nav = kind === 'nav';
  const pad = nav ? 'gap-3 px-4 py-3.5' : 'gap-3 px-4 py-2.5';
  const titleCls = nav ? 'text-[15px] text-ink' : 'text-[13px] font-medium text-ink';
  const subCls = nav ? 'text-[12px] text-ink-3' : 'text-[11px] text-ink-4';
  const showChevron = chevron ?? (nav && !!onClick);
  const body = (
    <>
      {leading ?? (icon && <Icon name={icon} size={nav ? 20 : 17} color={iconColor ?? 'var(--m-ink-3)'} />)}
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${titleCls}`}>{title}</span>
        {sub != null && <span className={`block truncate ${subCls}`}>{sub}</span>}
      </span>
      {trailing}
      {showChevron && <Icon name="chevron-right" size={nav ? 18 : 14} color="var(--m-ink-4)" />}
    </>
  );
  const rowCls = `flex w-full items-center border-b border-line-2 text-left last:border-0 ${pad} ${className}`;
  if (!onClick) {
    return (
      <div data-testid={testId} className={rowCls}>
        {body}
      </div>
    );
  }
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`m-tap disabled:pointer-events-none disabled:opacity-60 ${rowCls}`}
    >
      {body}
    </button>
  );
}

/** static micro label: tone-soft bg, tone fg (§2F) */
export function Pill({
  tone = 'neutral',
  caps = false,
  children,
  testId,
  className = '',
}: Readonly<{ tone?: Tone; caps?: boolean; children: ReactNode; testId?: string; className?: string }>) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        caps ? 'tracking-wide uppercase' : ''
      } ${TONE_BG[tone]} ${TONE_TEXT[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** selected-state look per tone — accent for picking, warning for attention filters */
const CHIP_ON: Partial<Record<Tone, string>> = {
  accent: 'border-accent bg-accent-soft font-medium text-accent-deep',
  warning: 'border-warning bg-warning-soft font-medium text-warning',
};

/** interactive filter/select chip — full round, tone-soft when on (§2F) */
export function Chip({
  selected,
  onClick,
  children,
  tone = 'accent',
  disabled,
  testId,
  className = '',
}: Readonly<{
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: 'accent' | 'warning';
  disabled?: boolean;
  testId?: string;
  className?: string;
}>) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`m-tap flex shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] disabled:pointer-events-none disabled:opacity-40 ${
        selected ? CHIP_ON[tone] : 'border-line bg-surface text-ink-2'
      } ${className}`}
    >
      {children}
    </button>
  );
}

const BAR_H = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' } as const;

/** fills read best in the tone's base color (deep is for icons/text) */
const BAR_FILL: Record<Tone, string> = { ...TONE_FG, accent: 'var(--m-accent)' };

/** the one progress bar (§2E): value 0..1, tone or explicit css color */
export function ProgressBar({
  value,
  tone = 'accent',
  color,
  size = 'md',
  overlay,
  className = '',
  testId,
  animateKey,
}: Readonly<{
  value: number;
  tone?: Tone;
  color?: string;
  size?: keyof typeof BAR_H;
  /** absolutely-positioned decoration inside the track (e.g. over-budget stripes) */
  overlay?: ReactNode;
  className?: string;
  testId?: string;
  /** remounts the fill so the grow animation replays (period switches) */
  animateKey?: string | number;
}>) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div data-testid={testId} className={`relative ${BAR_H[size]} overflow-hidden rounded-full bg-bg-2 ${className}`}>
      <div
        key={animateKey}
        className="m-grow-x h-full origin-left rounded-full transition-[width]"
        style={{ width: `${pct}%`, background: color ?? BAR_FILL[tone] }}
      />
      {overlay}
    </div>
  );
}

/** labeled form field (§2G): label 12px ink-3 above, never m-cap */
export function Field({
  label,
  htmlFor,
  children,
  className = '',
}: Readonly<{ label: ReactNode; htmlFor?: string; children: ReactNode; className?: string }>) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block px-1 text-[12px] text-ink-3">
        {label}
      </label>
      {children}
    </div>
  );
}

interface HeroCardProps {
  /** leading visual — typically a 48 <Tile> */
  tile: ReactNode;
  /** name-led heroes (recurring, holding) put the title here; number-led
   *  heroes (goal, debt, budget) omit it and lead with the figure */
  title?: ReactNode;
  /** small pill/badge beside the title */
  titleBadge?: ReactNode;
  sub?: ReactNode;
  /** the big m-num figure (title scale: 24) */
  number: ReactNode;
  /** right-aligned slot on the header row */
  right?: ReactNode;
  progress?: ReactNode;
  /** meta chips/lines under the progress, joined with gap-x-4 */
  meta?: ReactNode;
  testId?: string;
  className?: string;
}

/** the detail-screen hero (§2D): tile + number + progress + meta, one anatomy */
export function HeroCard({ tile, title, titleBadge, sub, number, right, progress, meta, testId, className = '' }: Readonly<HeroCardProps>) {
  return (
    <div className={`rounded-card border border-line bg-surface p-4 ${className}`} data-testid={testId}>
      <div className="flex items-center gap-3">
        {tile}
        <span className="min-w-0 flex-1">
          {title == null ? (
            <span className="m-num block text-[24px] font-semibold text-ink">{number}</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[16px] font-semibold text-ink">{title}</span>
              {titleBadge}
            </span>
          )}
          {sub != null && <span className="block truncate text-[12px] text-ink-3">{sub}</span>}
        </span>
        {title != null && <span className="m-num shrink-0 text-[24px] font-semibold text-ink">{number}</span>}
        {right}
      </div>
      {progress != null && <div className="mt-3">{progress}</div>}
      {meta != null && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">{meta}</div>}
    </div>
  );
}
