import { useState } from 'react';
import { useLang } from '@/i18n';
import type { RecurringEvery } from '@/db/types';
import { Chip } from '@/ui/primitives';

export interface LoanCadence {
  every: RecurringEvery;
  everyN: number;
}

/** true when a stored plan needs the custom row to represent itself */
export const isCustomCadence = (every: RecurringEvery | undefined, everyN: number | undefined): boolean =>
  every === 'week' || (everyN ?? 1) > 1;

/**
 * The loan payment's rhythm — same mechanics as the recurring form
 * (user request 2026-08-01): Monthly / Yearly presets plus a Custom
 * row for "every N weeks/months/years". No anchor date: the payoff
 * projection only needs payments-per-year.
 */
export function LoanCadenceControl({
  value,
  custom,
  onChange,
  testIdPrefix,
}: Readonly<{
  value: LoanCadence;
  custom: boolean;
  onChange: (next: LoanCadence, custom: boolean) => void;
  testIdPrefix: string;
}>) {
  const { t } = useLang();
  const [nText, setNText] = useState(String(value.everyN));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip
          testId={`${testIdPrefix}-every-month`}
          selected={!custom && value.every === 'month'}
          onClick={() => onChange({ every: 'month', everyN: 1 }, false)}
        >
          {t('recurring.everyMonth')}
        </Chip>
        <Chip
          testId={`${testIdPrefix}-every-year`}
          selected={!custom && value.every === 'year'}
          onClick={() => onChange({ every: 'year', everyN: 1 }, false)}
        >
          {t('recurring.everyYear')}
        </Chip>
        <Chip testId={`${testIdPrefix}-every-custom`} selected={custom} onClick={() => onChange(value, true)}>
          {t('recurring.everyCustom')}
        </Chip>
      </div>
      {custom && (
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          {t('recurring.everyLabel')}
          <input
            data-testid={`${testIdPrefix}-everyn`}
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={nText}
            onChange={(e) => setNText(e.target.value)}
            onBlur={() => {
              const clamped = Math.min(99, Math.max(1, Math.round(Number(nText)) || 1));
              setNText(String(clamped));
              onChange({ ...value, everyN: clamped }, true);
            }}
            className="h-10 w-16 rounded-input border border-line bg-surface px-3 text-center text-[14px] text-ink outline-none"
          />
          <select
            data-testid={`${testIdPrefix}-every-unit`}
            value={value.every}
            onChange={(e) => onChange({ ...value, every: e.target.value as RecurringEvery }, true)}
            className="h-10 rounded-input border border-line bg-surface px-2 text-[13px] text-ink"
          >
            <option value="week">{t('recurring.unitWeeks')}</option>
            <option value="month">{t('recurring.unitMonths')}</option>
            <option value="year">{t('recurring.unitYears')}</option>
          </select>
        </label>
      )}
    </div>
  );
}
