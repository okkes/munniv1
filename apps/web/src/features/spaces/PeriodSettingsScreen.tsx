import { useState } from 'react';
import { useParams, useRouter } from '@tanstack/react-router';
import { useQuery } from '@/db/useQuery';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { logActivity } from '@/application/activity';
import { useSession } from '@/app/session';
import { useMyRole } from './SpaceSharing';
import type { SpacePeriodType } from '@/db/types';
import { AppBar, IconButton } from '@/ui/AppBar';
import { HelpButton } from '@/features/help/HelpButton';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';

export const PERIODS: SpacePeriodType[] = ['month', 'week', 'biweekly'];
export const PERIOD_KEYS = {
  month: 'space.periodMonthly',
  week: 'space.periodWeekly',
  biweekly: 'space.periodBiweekly',
  custom: 'space.periodMonthly',
} as const;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]; // ISO: Monday … Sunday
const clampWeekday = (day: number) => Math.min(Math.max(day || 1, 1), 7);
/** localized short weekday name — 5 Jan 2020 + n lands on ISO weekday n */
const weekdayName = (weekday: number, lang: keyof typeof LOCALES) =>
  new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'short' }).format(new Date(2020, 0, 5 + weekday));

/**
 * The period picker's controls — type chips + the day-of-month input or
 * weekday strip. Extracted (arc 4) so space CREATION offers the exact
 * same editor against local draft state, while this screen writes
 * through to the space row.
 */
export function PeriodControls({
  periodType,
  periodDay,
  readOnly,
  onChange,
}: Readonly<{
  periodType: SpacePeriodType;
  periodDay: number;
  readOnly?: boolean;
  onChange: (changes: { periodType?: SpacePeriodType; periodDay?: number }) => void;
}>) {
  const { t, lang } = useLang();
  // free-typed draft so the '1' can be deleted while editing; clamped +
  // committed on blur (the chips commit on tap — no save button)
  const [dayDraft, setDayDraft] = useState<string | null>(null);
  return (
    <>
      {/* wrap: NL/TR labels (Tweewekelijks…) must never widen the page */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Chip
            key={p}
            className="min-w-[30%] flex-1"
            testId={`space-period-${p}`}
            disabled={readOnly}
            selected={periodType === p}
            onClick={() => onChange({ periodType: p })}
          >
            {t(PERIOD_KEYS[p])}
          </Chip>
        ))}
      </div>

      {periodType === 'month' ? (
        <label className="flex items-center gap-3 text-[13px] text-ink-2">
          {t('space.periodDayLabel')}
          <input
            data-testid="space-period-day"
            type="number"
            min={1}
            max={28}
            value={dayDraft ?? String(periodDay)}
            disabled={readOnly}
            onChange={(e) => setDayDraft(e.target.value)}
            onBlur={() => {
              const clamped = Math.min(28, Math.max(1, Number(dayDraft ?? periodDay) || 1));
              setDayDraft(null);
              onChange({ periodDay: clamped });
            }}
            className="h-10 w-20 rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none"
          />
        </label>
      ) : (
        // weekly/bi-weekly periods start on a chosen weekday (legacy parity)
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((weekday) => (
            <button
              key={weekday}
              data-testid={`space-weekday-${weekday}`}
              disabled={readOnly}
              onClick={() => onChange({ periodDay: weekday })}
              className={`m-tap rounded-full border px-2.5 py-1.5 text-[12px] ${
                clampWeekday(periodDay) === weekday
                  ? 'border-accent bg-accent-soft font-medium text-accent-deep'
                  : 'border-line bg-surface text-ink-2'
              }`}
            >
              {weekdayName(weekday, lang)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The space's budget period as its own settings screen (extracted from
 * space settings — user request: that screen tried to do everything).
 * Changes apply immediately: there is nothing else here a save button
 * would batch with, and LWW makes every tap safe.
 */
export function PeriodSettingsScreen() {
  const { t } = useLang();
  const { store, repo } = useData();
  const identity = useSession((s) => s.identity);
  const { spaceId } = useParams({ strict: false }) as { spaceId: string };
  const router = useRouter();

  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const myRole = useMyRole(spaceId, identity?.kind === 'user');
  const readOnly = myRole === 'reader';

  const periodType: SpacePeriodType = space?.periodType === 'custom' ? 'month' : (space?.periodType ?? 'month');
  const periodDay = space?.periodDay || 1;

  const apply = async (changes: { periodType?: SpacePeriodType; periodDay?: number }) => {
    if (!space || readOnly) return;
    await repo.upsert('space', space.id, space.id, changes);
    void logActivity(store, repo, space.id, 'spaceEdit', space.name);
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-period-settings">
      <AppBar
        title={t('space.periodTitle')}
        leading={
          <IconButton label={t('action.back')} testId="period-back" onClick={() => router.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
        trailing={<HelpButton tourId="period" />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        {/* nothing interactable before the space loads — a fast tap must
            never apply against an unloaded row (silent no-op) */}
        {space && (
        <div className="flex flex-col gap-3 pt-1">
          <p className="rounded-card bg-bg-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2" data-testid="period-explain">
            {t('period.explain')}
          </p>
          {readOnly && (
            <p className="px-1 text-[12px] text-ink-3" data-testid="period-reader-note">
              {t('space.readerNote')}
            </p>
          )}

          <div className="m-cap px-1">{t('space.periodTitle')}</div>
          <PeriodControls periodType={periodType} periodDay={periodDay} readOnly={readOnly} onChange={(c) => void apply(c)} />

          <p className="px-1 text-[11px] text-ink-4" data-testid="period-instant-note">
            {t('period.instantNote')}
          </p>
        </div>
        )}
      </div>
    </div>
  );
}
