// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MultiLine } from './MultiLine';
import { monotonePath, monotoneTangents } from './monotone';
import type { ChartPt } from './monotone';
// harness registers RTL cleanup between tests
import '@/test/harness';

/** every cubic segment of an SVG path as { from, c1, c2, to } */
function parseCubics(d: string): { from: ChartPt; c1: ChartPt; c2: ChartPt; to: ChartPt }[] {
  const [move, ...curves] = d.split(' C');
  const pt = (pair: string): ChartPt => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  };
  let from = pt(move.slice(1));
  return curves.map((seg) => {
    const [c1, c2, to] = seg.split(' ').map(pt);
    const cubic = { from, c1, c2, to };
    from = to;
    return cubic;
  });
}

describe('monotone interpolation (#168 r3)', () => {
  it('equal neighbours draw dead flat — zero tangents, control points on the endpoints', () => {
    const pts = [
      { x: 0, y: 40 },
      { x: 10, y: 40 },
      { x: 20, y: 40 },
    ];
    expect(monotoneTangents(pts)).toEqual([0, 0, 0]);
    for (const seg of parseCubics(monotonePath(pts))) {
      expect(seg.c1.y).toBe(40);
      expect(seg.c2.y).toBe(40);
    }
  });

  it('a drop into a flat stretch never dips past the flat level (the r2 overshoot)', () => {
    // SVG y grows downward: a high value then two zero months — the
    // Catmull-Rom curve used to swing BELOW the zero line here
    const pts = [
      { x: 0, y: 20 },
      { x: 10, y: 112 },
      { x: 20, y: 112 },
      { x: 30, y: 112 },
    ];
    const m = monotoneTangents(pts);
    expect(m[1]).toBe(0);
    expect(m[2]).toBe(0);
    expect(m[3]).toBe(0);
    // control points inside each segment's y range ⇒ the whole bezier is
    // (convex hull) — no value beyond 112, no value above 20
    for (const seg of parseCubics(monotonePath(pts))) {
      const lo = Math.min(seg.from.y, seg.to.y);
      const hi = Math.max(seg.from.y, seg.to.y);
      expect(seg.c1.y).toBeGreaterThanOrEqual(lo);
      expect(seg.c1.y).toBeLessThanOrEqual(hi);
      expect(seg.c2.y).toBeGreaterThanOrEqual(lo);
      expect(seg.c2.y).toBeLessThanOrEqual(hi);
    }
  });

  it('a peak flattens its tangent (sign change) and monotone runs stay clamped in range', () => {
    const peak = [
      { x: 0, y: 100 },
      { x: 10, y: 20 },
      { x: 20, y: 100 },
    ];
    expect(monotoneTangents(peak)[1]).toBe(0);
    // a steep monotone descent: every control point stays inside its
    // segment's range — the curve can never overshoot the data
    const steep = [
      { x: 0, y: 10 },
      { x: 10, y: 90 },
      { x: 20, y: 98 },
      { x: 30, y: 100 },
    ];
    for (const seg of parseCubics(monotonePath(steep))) {
      const lo = Math.min(seg.from.y, seg.to.y);
      const hi = Math.max(seg.from.y, seg.to.y);
      expect(seg.c1.y).toBeGreaterThanOrEqual(lo);
      expect(seg.c1.y).toBeLessThanOrEqual(hi);
      expect(seg.c2.y).toBeGreaterThanOrEqual(lo);
      expect(seg.c2.y).toBeLessThanOrEqual(hi);
    }
  });
});

describe('MultiLine (#168 r3)', () => {
  it('keeps 8px vertical padding — the peak dot no longer clips the frame', () => {
    render(
      <MultiLine
        series={[{ values: [0, 50, 100], color: 'red' }]}
        height={120}
        testId="ml"
        onPointClick={() => undefined}
      />,
    );
    const cys = [...screen.getByTestId('ml').querySelectorAll('circle')].map((c) => Number(c.getAttribute('cy')));
    expect(Math.min(...cys)).toBe(8);
    expect(Math.max(...cys)).toBe(112);
  });

  it('#168 r4: markerIndex draws the start marker under the -start testid', () => {
    render(
      <MultiLine
        series={[{ values: [0, 50, 100], color: 'red' }]}
        height={120}
        testId="ml3"
        markerIndex={1}
        onPointClick={() => undefined}
      />,
    );
    const marker = screen.getByTestId('ml3-start');
    expect(marker.getAttribute('x1')).toBe('160');
    expect(marker.getAttribute('x2')).toBe('160');
    // the old current-period name is gone for good
    expect(screen.queryByTestId('ml3-now')).toBeNull();
  });

  it('skipDotAt suppresses exactly that series-point dot; the path still passes through it', () => {
    render(
      <MultiLine
        series={[
          { values: [null, 20, 30, 40], color: 'grey', skipDotAt: 1 },
          { values: [10, 20, null, null], color: 'green' },
        ]}
        height={120}
        testId="ml2"
        onPointClick={() => undefined}
      />,
    );
    expect(screen.queryByTestId('ml2-dot-0-1')).toBeNull();
    expect(screen.getByTestId('ml2-dot-1-1')).toBeTruthy();
    expect(screen.getByTestId('ml2-dot-0-2')).toBeTruthy();
    const paths = [...screen.getByTestId('ml2').querySelectorAll('path')];
    expect(paths).toHaveLength(2);
    // both lines meet at the shared point: series 0 departs where series 1 ends
    const start0 = paths[0].getAttribute('d')!.split(' ')[0];
    expect(start0).toBe('M106.7,60.0');
    expect(paths[1].getAttribute('d')!.endsWith('106.7,60.0')).toBe(true);
  });
});
