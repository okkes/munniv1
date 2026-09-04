/**
 * Minimal theme-aware SVG bar chart (trends design) — no library, the
 * bundle stays local-first-small. Bars are focusable for screen readers.
 */
export function Bars({
  values,
  labels,
  ariaLabels,
  color = 'var(--m-accent)',
  hollowLast = false,
  height = 140,
  average,
  negativeValues,
  negativeColor = 'var(--m-negative)',
  testId,
}: Readonly<{
  values: number[];
  /** short x labels, same length as values (sparse: empty strings ok) */
  labels?: string[];
  /** per-bar accessible label */
  ariaLabels?: string[];
  color?: string;
  /** the running (incomplete) period renders outlined */
  hollowLast?: boolean;
  height?: number;
  /** dashed reference line */
  average?: number;
  /** paired series drawn downward (cash-flow view) */
  negativeValues?: number[];
  negativeColor?: string;
  testId?: string;
}>) {
  const n = values.length;
  if (n === 0) return null;
  const width = 320; // viewBox units; the svg itself is fluid
  const labelZone = labels ? 16 : 0;
  const gap = 6;
  const barW = (width - gap * (n + 1)) / n;
  const maxUp = Math.max(...values, average ?? 0, 1);
  const maxDown = Math.max(...(negativeValues ?? [0]), 0);
  const zeroY = negativeValues ? (height * maxUp) / (maxUp + maxDown || 1) : height;
  const upScale = (maxUp > 0 ? zeroY / maxUp : 0) * 0.96;
  const downScale = maxDown > 0 ? (height - zeroY) / maxDown : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height + labelZone}`}
      className="w-full"
      data-testid={testId}
      style={{ overflow: 'visible' }}
    >
      {values.map((value, i) => {
        const x = gap + i * (barW + gap);
        const h = Math.max(value > 0 ? 2 : 0, value * upScale);
        const hollow = hollowLast && i === n - 1;
        return (
          <g key={x} tabIndex={0} aria-label={ariaLabels?.[i]}>
            <rect
              x={x}
              y={zeroY - h}
              width={barW}
              height={h}
              rx={3}
              fill={hollow ? 'transparent' : color}
              stroke={hollow ? color : 'none'}
              strokeWidth={hollow ? 1.5 : 0}
            />
            {negativeValues && (
              <rect
                x={x}
                y={zeroY + 1}
                width={barW}
                height={Math.max(negativeValues[i] > 0 ? 2 : 0, negativeValues[i] * downScale)}
                rx={3}
                fill={negativeColor}
                opacity={0.85}
              />
            )}
            {labels?.[i] && (
              <text
                x={x + barW / 2}
                y={height + labelZone - 4}
                textAnchor="middle"
                fontSize={8.5}
                fill="var(--m-ink-4)"
              >
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
      {average !== undefined && average > 0 && (
        <line
          x1={0}
          x2={width}
          y1={zeroY - average * upScale}
          y2={zeroY - average * upScale}
          stroke="var(--m-ink-4)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}
