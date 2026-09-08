/**
 * Tiny dependency-free chart primitives for the overview screens
 * (ported look from the legacy BarChart/StackedBar).
 */

interface BarChartProps {
  values: number[];
  labels: string[];
  selected: number;
  onSelect: (index: number) => void;
  height?: number;
  accent?: string;
  /** formatted amount shown on top of each non-empty bar (user request) */
  valueLabels?: string[];
}

/** selectable period bars, each carrying its amount on top */
export function BarChart({ values, labels, selected, onSelect, height = 90, accent = 'var(--m-accent)', valueLabels }: BarChartProps) {
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);
  const reserve = valueLabels ? 46 : 34; // label row above the bar needs its share
  return (
    <div className="flex items-end gap-1.5" style={{ height }} data-testid="overview-barchart">
      {values.map((value, i) => {
        const active = i === selected;
        const barHeight = Math.max((Math.abs(value) / max) * (height - reserve), 3);
        return (
          <button
            key={labels[i]}
            data-testid={`overview-bar-${i}`}
            onClick={() => onSelect(i)}
            className="m-tap flex min-w-0 flex-1 flex-col items-center justify-end gap-1 border-none bg-transparent p-0"
            style={{ height: '100%' }}
          >
            {valueLabels?.[i] && value !== 0 && (
              <span className={`m-num max-w-full truncate text-[8px] leading-none ${active ? 'font-semibold text-ink' : 'text-ink-4'}`}>
                {valueLabels[i]}
              </span>
            )}
            <div
              className="m-bar-in w-full origin-bottom rounded-t-[4px]"
              style={{
                height: barHeight,
                background: active ? accent : 'var(--m-line)',
                opacity: active ? 1 : 0.9,
                animationDelay: `${i * 45}ms`,
              }}
            />
            <span className={`max-w-full truncate text-[9px] ${active ? 'font-semibold text-ink' : 'text-ink-4'}`}>
              {labels[i]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface StackedBarProps {
  segments: { value: number; color: string; id?: string }[];
  height?: number;
}

/** proportional composition bar (only positive contributions are drawn);
 *  segments keyed by id keep their identity across period switches, so
 *  the widths GLIDE to the new proportions instead of snapping */
export function StackedBar({ segments, height = 10 }: StackedBarProps) {
  const positive = segments.filter((s) => s.value > 0);
  const total = positive.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <div className="w-full rounded-full bg-bg-2" style={{ height }} data-testid="overview-stackedbar" />;
  return (
    <div className="m-grow-x flex w-full origin-left overflow-hidden rounded-full" style={{ height }} data-testid="overview-stackedbar">
      {positive.map((s, i) => (
        // eslint-disable-next-line react/no-array-index-key -- index fallback is purely visual, order-stable
        <div
          key={s.id ?? `${s.color}-${i}`}
          className="transition-[width] duration-500 ease-out"
          style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
        />
      ))}
    </div>
  );
}
