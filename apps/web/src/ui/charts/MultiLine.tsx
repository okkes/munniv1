/** Two-or-more series on one shared scale (#168: recurring year chart).
 *  Same fluid-width conventions as Line. #168 r2 (user): values may be
 *  null (a gap — segments span only consecutive non-null runs),
 *  `markerIndex` pins a vertical marker on one x index (#168 r4: the
 *  tracking START — data left of it is unknown), and with
 *  `onPointClick` every point wears a tappable dot. Without
 *  `onPointClick` the chart stays decorative: aria-hidden, one end-dot
 *  per series. #168 r3 (user): smoothing is monotone cubic (no
 *  overshoot dips) and the plot keeps dot-sized vertical padding. */
import { monotonePath } from './monotone';

/** #168 r3 (user): room for the r=4.5 selected dot + 2px stroke — the
 *  peak's dot clipped the viewBox edge */
const PAD = 8;

interface Run {
  start: number;
  points: number[];
}

/** consecutive non-null stretches; a run of one renders as a lone dot */
function nonNullRuns(values: readonly (number | null)[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null) continue;
    const prev = runs.at(-1);
    if (prev && prev.start + prev.points.length === i) prev.points.push(value);
    else runs.push({ start: i, points: [value] });
  }
  return runs;
}

/** one tappable point (S2004: the handlers live outside the render
 *  nesting) */
function ChartDot({
  si,
  i,
  cx,
  cy,
  color,
  isSelected,
  onPick,
  testId,
}: Readonly<{
  si: number;
  i: number;
  cx: number;
  cy: number;
  color: string;
  isSelected: boolean;
  onPick: (seriesIndex: number, pointIndex: number) => void;
  testId?: string;
}>) {
  const activate = () => onPick(si, i);
  return (
    <g
      role="button"
      tabIndex={0}
      className="cursor-pointer outline-none"
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
    >
      <circle cx={cx} cy={cy} r={isSelected ? 4.5 : 3} fill={color} />
      {/* transparent hit target — a 3px dot is untappable */}
      <circle cx={cx} cy={cy} r={8} fill="transparent" data-testid={testId} />
    </g>
  );
}

export function MultiLine({
  series,
  labels,
  height = 140,
  testId,
  markerIndex,
  onPointClick,
  selected,
}: Readonly<{
  series: readonly {
    values: readonly (number | null)[];
    color: string;
    dashed?: boolean;
    /** #168 r3 (user): suppress this index's dot — the shared now-point
     *  renders ONE dot (the paid line owns it); the path still passes */
    skipDotAt?: number;
  }[];
  /** sparse x labels aligned with the longest series (empty strings skip) */
  labels?: string[];
  height?: number;
  testId?: string;
  /** vertical marker at this x index (#168 r4: the space's start month
   *  — anything left of it is untracked; testid `<testId>-start`) */
  markerIndex?: number;
  /** interactive mode: every non-null point becomes a tappable dot */
  onPointClick?: (seriesIndex: number, pointIndex: number) => void;
  selected?: { seriesIndex: number; pointIndex: number } | null;
}>) {
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (n === 0 || all.length === 0) return null;
  const width = 320;
  const labelZone = labels ? 16 : 0;
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 0);
  const span = max - min || 1;
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
  const y = (value: number) => height - PAD - ((value - min) / span) * (height - 2 * PAD);

  const handlePick = (si: number, i: number) => onPointClick?.(si, i);
  const interactiveDots = (si: number, color: string, runs: readonly Run[], skipDotAt?: number) =>
    runs.flatMap((run) =>
      run.points.flatMap((value, k) => {
        const i = run.start + k;
        if (i === skipDotAt) return [];
        return [
          <ChartDot
            key={i}
            si={si}
            i={i}
            cx={x(i)}
            cy={y(value)}
            color={color}
            isSelected={selected?.seriesIndex === si && selected?.pointIndex === i}
            onPick={handlePick}
            testId={testId ? `${testId}-dot-${si}-${i}` : undefined}
          />,
        ];
      }),
    );

  const endDot = (color: string, runs: readonly Run[]) => {
    const last = runs.at(-1);
    if (!last) return null;
    return <circle cx={x(last.start + last.points.length - 1)} cy={y(last.points.at(-1)!)} r={3} fill={color} />;
  };

  return (
    // without interaction the surrounding card carries the numbers in text
    <svg
      viewBox={`0 0 ${width} ${height + labelZone}`}
      className="w-full"
      aria-hidden={onPointClick ? undefined : true}
      data-testid={testId}
    >
      {markerIndex !== undefined && (
        <line
          x1={x(markerIndex)}
          y1={0}
          x2={x(markerIndex)}
          y2={height}
          stroke="var(--m-line)"
          strokeWidth={1}
          strokeDasharray="2 3"
          data-testid={testId ? `${testId}-start` : undefined}
        />
      )}
      {series.map((s, si) => {
        const runs = nonNullRuns(s.values);
        return (
          <g key={`s${s.color}-${si}`}>
            {runs.map(
              (run) =>
                run.points.length > 1 && (
                  <path
                    key={run.start}
                    d={monotonePath(run.points.map((value, k) => ({ x: x(run.start + k), y: y(value) })))}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={s.dashed ? '5 4' : undefined}
                  />
                ),
            )}
            {onPointClick ? interactiveDots(si, s.color, runs, s.skipDotAt) : endDot(s.color, runs)}
          </g>
        );
      })}
      {labels?.map((label, i) => {
        if (!label) return null;
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
