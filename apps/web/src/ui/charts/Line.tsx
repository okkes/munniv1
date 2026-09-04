/** Minimal theme-aware SVG line chart (net worth). Fluid width. */
export function Line({
  values,
  labels,
  color = 'var(--m-accent)',
  height = 140,
  testId,
}: Readonly<{
  values: number[];
  /** sparse x labels aligned with values (empty strings skip) */
  labels?: string[];
  color?: string;
  height?: number;
  testId?: string;
}>) {
  const n = values.length;
  if (n === 0) return null;
  const width = 320;
  const labelZone = labels ? 16 : 0;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
  const y = (value: number) => height - ((value - min) / span) * (height - 8) - 4;
  const path = values.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const zeroInRange = min < 0 && max > 0;

  return (
    // decorative: the surrounding card states the current value in text
    <svg viewBox={`0 0 ${width} ${height + labelZone}`} className="w-full" aria-hidden data-testid={testId}>
      {zeroInRange && (
        <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="var(--m-ink-4)" strokeWidth={1} strokeDasharray="4 3" />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r={3.5} fill={color} />
      {labels?.map((label, i) => {
        if (!label) return null;
        // edge labels anchor inward so they never clip the viewBox
        let anchor: 'start' | 'middle' | 'end' = 'middle';
        if (i === 0) anchor = 'start';
        else if (i === n - 1) anchor = 'end';
        return (
          <text key={x(i)} x={x(i)} y={height + labelZone - 4} textAnchor={anchor} fontSize={8.5} fill="var(--m-ink-4)">
            {label}
          </text>
        );
      })}
    </svg>
  );
}
