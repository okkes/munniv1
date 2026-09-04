import { useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useSession } from '@/app/session';
import { SpaceInvitesBanner } from './SpaceSharing';
import { useAttentionMap } from '@/application/spaceAttention';
import { DEFAULT_HISTORY_MONTHS, SPACE_COLORS, SPACE_ICONS, isoMonthsAgo } from './spaceDefaults';
import { PERIOD_KEYS, PeriodControls } from './PeriodSettingsScreen';
import { CURRENCIES } from '@/domain/countries';
import type { SpacePeriodType } from '@/db/types';
import { HelpButton } from '@/features/help/HelpButton';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { ColorPicker } from '@/ui/ColorPicker';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { minaSuggestedSpaceName } from '@/features/mina/steps';

/**
 * Spaces: separate bookkeeping areas, shared with other people or not.
 * The cog opens the space's settings SCREEN (/spaces/$spaceId); only
 * space creation stays a sheet (one decision).
 */
export function SpacesScreen() {
  const { t, lang } = useLang();
  const { store, repo, spaceId, setActiveSpace } = useData();
  const identity = useSession((s) => s.identity);
  const navigate = useNavigate();
  const syncing = identity?.kind === 'user';
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);
  // the full create form (arc 4): identity + the three defaults, each
  // editable through the SAME controls their settings screens use —
  // everything except the name has a default, "type a name, press
  // Create" still works (Mina's act step stays valid)
  const [icon, setIcon] = useState(SPACE_ICONS[0]);
  const [color, setColor] = useState(SPACE_COLORS[0]);
  const [periodType, setPeriodType] = useState<SpacePeriodType>('month');
  const [periodDay, setPeriodDay] = useState(1);
  const [currency, setCurrency] = useState('EUR');
  const [historyStart, setHistoryStart] = useState(isoMonthsAgo(DEFAULT_HISTORY_MONTHS));
  const [periodOpen, setPeriodOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const spaces = useQuery(store, async () => (await store.allRows('space')).filter((s) => s.deleted === 0), []);
  // attention pills (arc 7): counted once when the screen mounts
  const attention = useAttentionMap(true);

  // duplicate PRIVATE names are a footgun (user rule: private unique;
  // shared may collide — they get a creator line to tell them apart)
  const privateNameTaken = (candidate: string) =>
    (spaces ?? []).some((s) => s.kind !== 'shared' && s.name.trim().toLowerCase() === candidate.trim().toLowerCase());

  const createSpace = async () => {
    if (!name.trim()) return;
    if (privateNameTaken(name)) {
      setNameError(true);
      return;
    }
    const id = repo.newId();
    // shared duplicates render "created by X" — capture the creator now
    const profile = (await store.metaGet('profile'))?.value as { name?: string } | undefined;
    void repo
      .upsert('space', id, id, {
        name: name.trim(),
        kind: 'personal',
        icon,
        color,
        currency,
        periodType,
        periodDay,
        // persisted, not just displayed — attaching an account must see
        // the same default the settings screen shows (user bug report)
        historyStartDate: historyStart,
        // private by birth (arc 4): invites stay disabled until the
        // owner explicitly unlocks in space settings
        inviteLock: 1,
        ...(profile?.name ? { createdByName: profile.name } : {}),
      })
      .then(() => setActiveSpace(id));
    setCreateOpen(false);
    setName('');
  };

  const openCreate = () => {
    // Mina suggests the first names ("Private", "Family") — the user
    // still edits and presses Create themselves
    setName(minaSuggestedSpaceName() ?? '');
    setNameError(false);
    setIcon(SPACE_ICONS[0]);
    setColor(SPACE_COLORS[0]);
    setPeriodType('month');
    setPeriodDay(1);
    setCurrency('EUR');
    setHistoryStart(isoMonthsAgo(DEFAULT_HISTORY_MONTHS));
    setCreateOpen(true);
  };

  /** "Monthly · day 1" / "Weekly · Mon" — the period row's face */
  const periodSummary = () => {
    const label = t(PERIOD_KEYS[periodType]);
    if (periodType === 'month') return `${label} · ${periodDay}`;
    const weekday = new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'short' }).format(new Date(2020, 0, 5 + Math.min(Math.max(periodDay, 1), 7)));
    return `${label} · ${weekday}`;
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-spaces">
      <AppBar
        title={t('screen.spaces')}
        leading={
          <IconButton label={t('action.back')} testId="spaces-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <>
            <HelpButton tourId="spaces" />
            <IconButton label={t('space.new')} testId="spaces-add" onClick={openCreate}>
              <Icon name="plus" size={22} />
            </IconButton>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {syncing && <SpaceInvitesBanner />}
        <p className="m-cap mt-1 mb-1 px-1">{t('space.listCaption')}</p>
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {(spaces ?? []).map((space, i) => {
            const active = space.id === spaceId;
            return (
              <div key={space.id}>
                {i > 0 && <div className="mx-4 h-px bg-line-2" />}
                <div className={`flex items-center ${active ? 'bg-accent-soft/30' : ''}`}>
                  <button
                    data-testid={`space-row-${space.id}`}
                    onClick={() => void setActiveSpace(space.id)}
                    className="m-tap flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left"
                  >
                    {space.picture ? (
                      <img src={space.picture} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                        style={{
                          background: `color-mix(in srgb, ${space.color ?? 'var(--m-accent)'} 16%, transparent)`,
                          color: space.color ?? (active ? 'var(--m-accent-deep)' : 'var(--m-ink-3)'),
                        }}
                      >
                        <Icon name={space.icon ?? (space.kind === 'shared' ? 'account-group-outline' : 'leaf')} size={20} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-ink">{space.name}</span>
                      <span className="block truncate text-xs text-ink-4">
                        {t(space.kind === 'shared' ? 'space.kindShared' : 'space.kindPersonal')}
                        {/* shared spaces may share a name — the creator
                            line tells the twins apart (user rule) */}
                        {space.createdByName &&
                          (spaces ?? []).some(
                            (other) => other.id !== space.id && other.name.trim().toLowerCase() === space.name.trim().toLowerCase(),
                          ) && <> · {t('space.createdBy', { name: space.createdByName })}</>}
                        {active && (
                          <>
                            {' · '}
                            <span className="text-accent-deep">{t('space.active')}</span>
                          </>
                        )}
                      </span>
                    </span>
                    {/* what this space would ask of you (arc 7) */}
                    {(attention?.get(space.id)?.reviewCount ?? 0) > 0 && (
                      <span
                        data-testid={`space-attn-${space.id}`}
                        className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-deep"
                      >
                        {t('space.toReview', { n: attention!.get(space.id)!.reviewCount })}
                      </span>
                    )}
                    {attention?.get(space.id)?.budgetOver && (
                      <span data-testid={`space-attn-budget-${space.id}`} className="h-2 w-2 shrink-0 rounded-full bg-negative" />
                    )}
                    {active && <Icon name="check-circle" size={19} color="var(--m-accent)" />}
                  </button>
                  <button
                    aria-label={t('space.settings')}
                    data-testid={`space-edit-${space.id}`}
                    onClick={() => void navigate({ to: '/spaces/$spaceId', params: { spaceId: space.id } })}
                    className="m-tap flex h-11 w-11 shrink-0 items-center justify-center border-none bg-transparent text-ink-4"
                  >
                    <Icon name="cog-outline" size={19} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-[11px] leading-snug text-ink-4">{t('space.listHint')}</p>
      </div>

      {/* Create space — the full form (arc 4): identity + the three
          defaults, each behind a row that opens the same editor its
          settings screen uses. Only the name is required. */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen} title={t('space.new')} size="tall" dirty={name.trim() !== ''}>
        <div className="flex flex-col gap-3 pt-1">
          <input
            data-testid="space-create-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(false);
            }}
            placeholder={t('space.nameThisSpace')}
            className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4"
          />
          {nameError && (
            <p className="text-[12px] text-negative" data-testid="space-create-name-taken">
              {t('space.nameTaken')}
            </p>
          )}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {SPACE_ICONS.map((candidate) => (
              <button
                key={candidate}
                data-testid={`space-create-icon-${candidate}`}
                onClick={() => setIcon(candidate)}
                className={`m-tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                  icon === candidate ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line bg-surface text-ink-2'
                }`}
              >
                <Icon name={candidate} size={19} />
              </button>
            ))}
          </div>
          <ColorPicker colors={SPACE_COLORS} value={color} onChange={setColor} testIdPrefix="space-create-color" customLabel={t('color.custom')} />

          {(
            [
              { testId: 'space-create-period', icon: 'calendar-month-outline', label: t('space.periodTitle'), value: periodSummary(), open: () => setPeriodOpen(true) },
              { testId: 'space-create-currency', icon: 'cash-100', label: t('space.ledgerCurrency'), value: currency, open: () => setCurrencyOpen(true) },
              {
                testId: 'space-create-history',
                icon: 'history',
                label: t('space.historyStart'),
                value: new Date(historyStart).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' }),
                open: () => setHistoryOpen(true),
              },
            ] as const
          ).map((row) => (
            <button
              key={row.testId}
              data-testid={row.testId}
              onClick={row.open}
              className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-4 py-3 text-left text-[14px] text-ink"
            >
              <Icon name={row.icon} size={18} color="var(--m-ink-3)" />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="text-[13px] text-ink-3">{row.value}</span>
              <Icon name="chevron-right" size={17} color="var(--m-ink-4)" />
            </button>
          ))}

          {/* private by birth: the lock lifts in space settings, not here */}
          <p className="flex items-center gap-1.5 px-1 text-[11px] leading-snug text-ink-4" data-testid="space-create-lock-note">
            <Icon name="lock-outline" size={13} /> {t('space.createLockNote')}
          </p>
          <Button data-testid="space-create-save" onClick={() => void createSpace()} disabled={!name.trim()}>
            {t('space.create')}
          </Button>
        </div>
      </Sheet>

      {/* stacked: the three default editors, mirroring their settings twins */}
      <Sheet open={periodOpen} onOpenChange={setPeriodOpen} title={t('space.periodTitle')} size="form">
        <div className="flex flex-col gap-3 pt-1">
          <PeriodControls
            periodType={periodType}
            periodDay={periodDay}
            onChange={(changes) => {
              if (changes.periodType) {
                setPeriodType(changes.periodType);
                setPeriodDay(1); // month-day and weekday share the field — reset on switch
              }
              if (changes.periodDay !== undefined) setPeriodDay(changes.periodDay);
            }}
          />
        </div>
      </Sheet>
      <Sheet open={currencyOpen} onOpenChange={setCurrencyOpen} title={t('space.ledgerCurrency')} size="form" dragHandle>
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-[12px] text-ink-3">{t('space.ledgerCurrencyInfo')}</p>
          <div className="flex flex-wrap gap-2">
            {CURRENCIES.map((c) => (
              <Chip
                key={c}
                className="font-mono"
                testId={`space-create-currency-${c}`}
                selected={currency === c}
                onClick={() => {
                  setCurrency(c);
                  setCurrencyOpen(false);
                }}
              >
                {c}
              </Chip>
            ))}
          </div>
        </div>
      </Sheet>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen} title={t('space.historyStart')} size="form">
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-[12px] text-ink-3">{t('space.historyStartSub')}</p>
          {/* start small (arc 5): review stays manageable */}
          <p className="text-[12px] text-ink-3" data-testid="space-create-history-hint">{t('space.historyStartHint')}</p>
          <input
            data-testid="space-create-history-date"
            type="date"
            value={historyStart}
            onChange={(e) => {
              if (e.target.value) setHistoryStart(e.target.value);
            }}
            className="h-12 w-full appearance-none rounded-input border border-line bg-surface px-4 text-left text-[15px] text-ink outline-none"
          />
        </div>
      </Sheet>
    </div>
  );
}
