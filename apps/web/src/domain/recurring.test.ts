import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeRange,
  cycleKeyOf,
  cycleMonths,
  effectiveAmountCents,
  isDueWithin,
  nextDueDate,
  occurrencesBetween,
  summarize,
} from './recurring';
import { detectRecurring } from './detectRecurring';
import type { RecurringRow } from '@/db/types';

const rec = (over: Partial<RecurringRow>): RecurringRow =>
  ({
    id: 'r1',
    spaceId: 's1',
    name: 'Netflix',
    kind: 'subscription',
    amountCents: 1399,
    every: 'month',
    dueDay: 7,
    active: 1,
    deleted: 0,
    fieldVersions: {},
    ...over,
  }) as RecurringRow;

describe('recurring occurrences', () => {
  it('monthly occurrences clamp the due day to shorter months', () => {
    expect(occurrencesBetween(rec({ dueDay: 31 }), '2026-01-01', '2026-03-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('yearly costs occur once, in their due month', () => {
    const yearly = rec({ every: 'year', dueMonth: 3, dueDay: 15 });
    expect(occurrencesBetween(yearly, '2026-01-01', '2026-12-31')).toEqual(['2026-03-15']);
    expect(occurrencesBetween(yearly, '2026-04-01', '2026-12-31')).toEqual([]);
  });

  it('since/until bound the lifetime', () => {
    const bounded = rec({ since: '2026-02-01', until: '2026-03-31' });
    expect(occurrencesBetween(bounded, '2026-01-01', '2026-12-31')).toEqual(['2026-02-07', '2026-03-07']);
  });

  it('nextDueDate finds the next occurrence and respects active/until', () => {
    expect(nextDueDate(rec({}), '2026-07-08')).toBe('2026-08-07');
    expect(nextDueDate(rec({}), '2026-07-07')).toBe('2026-07-07'); // due today counts
    expect(nextDueDate(rec({ active: 0 }), '2026-07-01')).toBeNull();
    expect(nextDueDate(rec({ until: '2026-07-31' }), '2026-07-10')).toBeNull();
  });

  it('isDueWithin covers the home "upcoming week" block', () => {
    expect(isDueWithin(rec({ dueDay: 12 }), '2026-07-08', 7)).toBe(true);
    expect(isDueWithin(rec({ dueDay: 20 }), '2026-07-08', 7)).toBe(false);
    expect(addDays('2026-07-28', 7)).toBe('2026-08-04'); // month rollover
  });
});

describe('every-N and weekly cadences', () => {
  it('every 3 months anchors its cycle on `since`', () => {
    const quarterly = rec({ everyN: 3, since: '2026-02-10', dueDay: 10 });
    expect(occurrencesBetween(quarterly, '2026-01-01', '2026-12-31')).toEqual([
      '2026-02-10',
      '2026-05-10',
      '2026-08-10',
      '2026-11-10',
    ]);
    expect(nextDueDate(quarterly, '2026-07-09')).toBe('2026-08-10');
  });

  it('every 2 years skips the odd years', () => {
    const biennial = rec({ every: 'year', everyN: 2, since: '2024-06-01', dueMonth: 6, dueDay: 1 });
    expect(occurrencesBetween(biennial, '2024-01-01', '2028-12-31')).toEqual(['2024-06-01', '2026-06-01', '2028-06-01']);
    expect(occurrencesBetween(biennial, '2025-01-01', '2025-12-31')).toEqual([]);
    // next cycle can be years out — the scan horizon must reach it
    expect(nextDueDate(rec({ every: 'year', everyN: 5, since: '2024-03-01', dueMonth: 3, dueDay: 1 }), '2026-07-09')).toBe(
      '2029-03-01',
    );
  });

  it('weekly cadences step in 7×N-day strides from the anchor', () => {
    const biweekly = rec({ every: 'week', everyN: 2, since: '2026-07-03' });
    expect(occurrencesBetween(biweekly, '2026-07-01', '2026-08-31')).toEqual([
      '2026-07-03',
      '2026-07-17',
      '2026-07-31',
      '2026-08-14',
      '2026-08-28',
    ]);
    expect(nextDueDate(biweekly, '2026-07-09')).toBe('2026-07-17');
    expect(nextDueDate(biweekly, '2026-07-17')).toBe('2026-07-17'); // due today counts
    // an anchorless weekly cadence has no occurrences at all
    expect(occurrencesBetween(rec({ every: 'week' }), '2026-07-01', '2026-08-31')).toEqual([]);
    // until ends the stride
    expect(
      occurrencesBetween(rec({ every: 'week', since: '2026-07-03', until: '2026-07-15' }), '2026-07-01', '2026-08-31'),
    ).toEqual(['2026-07-03', '2026-07-10']);
  });

  it('cycleKeyOf buckets payments into one slot per billing cycle', () => {
    const quarterly = rec({ everyN: 3, since: '2026-02-10' });
    expect(cycleKeyOf(quarterly, '2026-02-12')).toBe(cycleKeyOf(quarterly, '2026-04-30'));
    expect(cycleKeyOf(quarterly, '2026-05-01')).not.toBe(cycleKeyOf(quarterly, '2026-04-30'));

    const biweekly = rec({ every: 'week', everyN: 2, since: '2026-07-03' });
    expect(cycleKeyOf(biweekly, '2026-07-04')).toBe(cycleKeyOf(biweekly, '2026-07-16'));
    expect(cycleKeyOf(biweekly, '2026-07-17')).not.toBe(cycleKeyOf(biweekly, '2026-07-16'));

    // plain cadences keep calendar buckets (existing linking behavior)
    expect(cycleKeyOf(rec({}), '2026-07-15')).toBe('2026-07');
    expect(cycleKeyOf(rec({ every: 'year' }), '2026-07-15')).toBe('2026');
  });

  it('cycleMonths monthlyizes any cadence for insights', () => {
    expect(cycleMonths(rec({}))).toBe(1);
    expect(cycleMonths(rec({ everyN: 3 }))).toBe(3);
    expect(cycleMonths(rec({ every: 'year' }))).toBe(12);
    expect(cycleMonths(rec({ every: 'week' }))).toBeCloseTo(0.23, 1);
  });
});

describe('recurring amounts and summaries', () => {
  it('the amount is the USER value — linked actuals never rewrite it (2026-07-24 ruling)', () => {
    // drift is surfaced via detectPriceChange + a one-tap update instead
    expect(effectiveAmountCents(rec({ amountCents: 1000 }))).toBe(1000);
    expect(effectiveAmountCents(rec({ amountCents: -1000 }))).toBe(1000);
  });

  it('computeRange + summarize produce period totals, paid and remaining', () => {
    const rent = rec({ id: 'rent', name: 'Rent', kind: 'fixed', amountCents: 74000, dueDay: 1 });
    const netflix = rec({ id: 'nfx', luxury: 1 });
    const linked = new Map([['rent', [{ date: '2026-07-01', amountCents: -74000 }]]]);

    const computed = computeRange([rent, netflix], linked, '2026-07-01', '2026-07-31', '2026-07-08');
    const rentRow = computed.find((c) => c.rec.id === 'rent')!;
    expect(rentRow).toMatchObject({ expectedCents: 74000, paidCents: 74000, paid: true });
    const nfxRow = computed.find((c) => c.rec.id === 'nfx')!;
    expect(nfxRow).toMatchObject({ expectedCents: 1399, paidCents: 0, paid: false });

    expect(summarize(computed)).toEqual({
      totalCents: 75399,
      paidCents: 74000,
      remainingCents: 1399,
      luxuryCents: 1399,
    });
  });

  it('a whole year multiplies monthly costs by twelve', () => {
    const computed = computeRange([rec({})], new Map(), '2026-01-01', '2026-12-31', '2026-07-08');
    expect(computed[0].expectedCents).toBe(12 * 1399);
  });
});

describe('detectRecurring', () => {
  const monthly = (dates: string[], amountCents = -1399, merchant = 'NETFLIX.COM') =>
    dates.map((date) => ({ merchant, date, amountCents, txType: 'expense' as const }));

  it('detects a stable monthly pattern with confidence', () => {
    const [s] = detectRecurring(monthly(['2026-04-07', '2026-05-07', '2026-06-07', '2026-07-07']), {
      today: '2026-07-08',
    });
    expect(s).toMatchObject({ every: 'month', dueDay: 7, count: 4, amountCents: 1399 });
    expect(s.confidence).toBeGreaterThanOrEqual(85);
  });

  it('ignores irregular spending, dead subscriptions and excluded keys', () => {
    // same merchant, but random gaps — no cadence
    expect(detectRecurring(monthly(['2026-05-01', '2026-05-04', '2026-07-02']), { today: '2026-07-08' })).toEqual([]);
    // last charge two cycles ago — the subscription looks cancelled
    expect(detectRecurring(monthly(['2026-01-07', '2026-02-07', '2026-03-07']), { today: '2026-07-08' })).toEqual([]);
    // dismissed/already-tracked merchants never resurface
    expect(
      detectRecurring(monthly(['2026-04-07', '2026-05-07', '2026-06-07', '2026-07-07']), {
        today: '2026-07-08',
        excludeKeys: new Set(['netflix com']),
      }),
    ).toEqual([]);
  });

  it('ignores income and already-linked transactions', () => {
    const linked = monthly(['2026-04-07', '2026-05-07', '2026-06-07', '2026-07-07']).map((t) => ({
      ...t,
      recurringId: 'r1',
    }));
    expect(detectRecurring(linked, { today: '2026-07-08' })).toEqual([]);
  });
});
