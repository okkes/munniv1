import { useEffect, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useSession } from '@/app/session';
import { SpaceInvitesBanner } from './SpaceSharing';
import { SpacePhotoStrip, applySpacePhoto } from './SpaceSettingsScreen';
import { SharedSpaceBadge } from './SpaceSwitcher';
import { takeSpacesCreateIntent } from './spacesHandoff';
import { useAttentionMap } from '@/application/spaceAttention';
import { DEFAULT_HISTORY_MONTHS, SPACE_COLORS, SPACE_ICONS, isoMonthsAgo } from './spaceDefaults';
import { PERIOD_KEYS, PeriodControls } from './PeriodSettingsScreen';
import { CURRENCIES } from '@/domain/countries';
import type { SpacePeriodType } from '@/db/types';
import { HelpButton } from '@/features/help/HelpButton';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { ColorPicker } from '@/ui/ColorPicker';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { SearchField } from '@/ui/SearchField';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { WebcamCaptureSheet, useWebcamDoor } from '@/ui/WebcamCaptureSheet';
import { MDI_NAMES } from '@/generated/mdiNames';
import { minaSuggestedSpaceName } from '@/features/mina/steps';

/**
 * Spaces: separate bookkeeping areas, shared with other people or not.
 * The palette (#178) opens the space's settings SCREEN (/spaces/$spaceId);
 * only space creation stays a sheet (one decision).
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
  // #195: Create stays enabled — an invalid click says why instead
  const [attempted, setAttempted] = useState(false);
  // the full create form (arc 4): identity + the three defaults, each
  // editable through the SAME controls their settings screens use —
  // everything except the name has a default, "type a name, press
  // Create" still works (Mina's act step stays valid)
  const [icon, setIcon] = useState(SPACE_ICONS[0]);
  // #285 (user): search widens the curated set to the whole icon font
  const [iconQuery, setIconQuery] = useState('');
  const [color, setColor] = useState(SPACE_COLORS[0]);
  // #301: an own picture from birth — the settings strip, re-used
  const [picture, setPicture] = useState('');
  const webcamDoor = useWebcamDoor();
  const [webcamOpen, setWebcamOpen] = useState(false);
  const [periodType, setPeriodType] = useState<SpacePeriodType>('month');
  const [periodDay, setPeriodDay] = useState(1);
  const [currency, setCurrency] = useState('EUR');
  const [historyStart, setHistoryStart] = useState(isoMonthsAgo(DEFAULT_HISTORY_MONTHS));
  // #147 (user): private mode is a creation-time CHOICE — checked by
  // default, so "type a name, press Create" still births a locked space
  const [inviteLock, setInviteLock] = useState(true);
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
    if (!name.trim()) {
      setAttempted(true);
      return;
    }
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
        // #147 (user): the create form decides the lock — still private
        // unless the checkbox was explicitly unticked
        inviteLock: inviteLock ? 1 : 0,
        // #301: the picked picture is born with the space
        ...(picture ? { picture } : {}),
        ...(profile?.name ? { createdByName: profile.name } : {}),
      })
      .then(async () => {
        // #221: the six defaults exist from birth — a movement category
        // always has a valid counterparty to point at
        const { ensureSpaceDefaultAccounts } = await import('@/application/defaultAccounts');
        await ensureSpaceDefaultAccounts(store, repo, id);
        setActiveSpace(id);
      });
    setCreateOpen(false);
    setName('');
  };

  const openCreate = () => {
    // Mina suggests the first names ("Private", "Family") — the user
    // still edits and presses Create themselves
    setName(minaSuggestedSpaceName() ?? '');
    setNameError(false);
    setAttempted(false);
    setIcon(SPACE_ICONS[0]);
    setIconQuery('');
    setColor(SPACE_COLORS[0]);
    setPicture(''); // #301: no picture carried over from the last form

    setPeriodType('month');
    setPeriodDay(1);
    setCurrency('EUR');
    setHistoryStart(isoMonthsAgo(DEFAULT_HISTORY_MONTHS));
    setInviteLock(true); // #147: every new form starts private again
    setCreateOpen(true);
  };

  // #180: arriving from a create handoff (home FAB) opens the sheet the
  // moment the screen mounts — read-once, like the accounts handoff
  const [pendingCreate] = useState(() => takeSpacesCreateIntent());
  useEffect(() => {
    if (pendingCreate) openCreate();
    // mount-only: the intent must fire exactly once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-[15px] font-medium text-ink">{space.name}</span>
                        {/* #277: shared spaces wear the people pill */}
                        {space.kind === 'shared' && <SharedSpaceBadge testId={`space-shared-badge-${space.id}`} />}
                      </span>
                      <span className="block truncate text-xs text-ink-4">
                        {t(space.kind === 'shared' ? 'space.kindShared' : 'space.kindPersonal')}
                        {/* #277: shared rows ALWAYS name their creator
                            (the old name-collision gate hid it) */}
                        {space.kind === 'shared' && space.createdByName && (
                          <> · {t('space.createdBy', { name: space.createdByName })}</>
                        )}
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
                    {/* #178 (user): the screen edits the space's LOOK
                        (name/symbol/color/picture) — a palette says that,
                        a cog promised machinery it doesn't have */}
                    <Icon name="palette-outline" size={19} />
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
            aria-invalid={attempted && !name.trim()}
            className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && !name.trim())}`}
          />
          {/* #195 r2 (user): the blocker sits AT the field */}
          <FormBlockerNote show={attempted && !name.trim()} text={t('form.needName')} testId="space-create-blocker" />
          {nameError && (
            <p className="text-[12px] text-negative" data-testid="space-create-name-taken">
              {t('space.nameTaken')}
            </p>
          )}
          {/* #301: own picture from birth — the settings strip, shared
              (upload/clear + the desktop webcam door) */}
          <div className="m-cap px-1">{t('space.icon')}</div>
          <SpacePhotoStrip
            picture={picture}
            onPicture={setPicture}
            onWebcam={webcamDoor ? () => setWebcamOpen(true) : null}
            testIdPrefix="space-create-photo"
          />
          {/* #285 (user): search opens the WHOLE self-hosted font (the
              categories pattern); glyphs render in the picked color so a
              swatch tap previews its real impact live */}
          <SearchField
            testId="space-create-icon-search"
            value={iconQuery}
            onChange={setIconQuery}
            placeholder={t('space.iconSearch')}
            height="h-10"
            textSize="text-[13px]"
          />
          <div className="grid max-h-56 grid-cols-6 gap-2 overflow-y-auto">
            {(iconQuery.trim()
              ? MDI_NAMES.filter((n) => n.includes(iconQuery.trim().toLowerCase())).slice(0, 60)
              : SPACE_ICONS
            ).map((candidate) => (
              <button
                key={candidate}
                data-testid={`space-create-icon-${candidate}`}
                title={candidate}
                // #146 (user): a picture wins over symbol+color everywhere —
                // while one is set, picking them would change nothing visible
                disabled={picture !== ''}
                onClick={() => setIcon(candidate)}
                className={`m-tap flex h-11 items-center justify-center rounded-xl border ${
                  icon === candidate && picture === '' ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
                }`}
              >
                <Icon name={candidate} size={19} color={color} />
              </button>
            ))}
            {iconQuery.trim() && MDI_NAMES.every((n) => !n.includes(iconQuery.trim().toLowerCase())) && (
              <p className="col-span-6 py-2 text-center text-[12px] text-ink-4" data-testid="space-create-icon-none">
                {t('space.iconNone')}
              </p>
            )}
          </div>
          {/* #146: say WHY the pickers sleep, not just gray them out */}
          {picture !== '' && (
            <p className="px-1 text-[11px] leading-snug text-ink-4" data-testid="space-create-icon-picture-note">
              {t('space.picStompsIcon')}
            </p>
          )}
          <ColorPicker colors={SPACE_COLORS} value={color} onChange={setColor} disabled={picture !== ''} testIdPrefix="space-create-color" customLabel={t('color.custom')} />

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

          {/* #147 (user): the private lock is decided here, not decreed —
              same control (and copy) the space's settings keep afterwards */}
          <div className="rounded-input border border-line bg-surface px-4 py-3">
            <label className="flex items-center gap-3 text-[14px] font-medium text-ink">
              <input
                type="checkbox"
                data-testid="space-create-lock"
                checked={inviteLock}
                onChange={(e) => setInviteLock(e.target.checked)}
                className="h-4 w-4 accent-[var(--m-accent)]"
              />
              {t('space.inviteLockLabel')}
            </label>
            <p className="mt-1 pl-7 text-[12px] leading-snug text-ink-3">{t('space.inviteLockSub')}</p>
          </div>
          <Button data-testid="space-create-save" onClick={() => void createSpace()}>
            {t('space.create')}
          </Button>
        </div>
      </Sheet>

      {/* stacked: the three default editors, mirroring their settings twins */}
      <Sheet open={periodOpen} onOpenChange={setPeriodOpen} title={t('space.periodTitle')} size="form">
        <div className="flex flex-col gap-3 pt-1">
          {/* #137 (user): bare controls read as a riddle — the sheet
              explains itself with the settings screen's exact words */}
          <p className="rounded-card bg-bg-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2" data-testid="space-create-period-explain">
            {t('period.explain')}
          </p>
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
      {/* #301: snapshot feeds the same downscale path as the file input
          (a SIBLING sheet, like its settings twin) */}
      <WebcamCaptureSheet open={webcamOpen} onOpenChange={setWebcamOpen} onCapture={(file) => applySpacePhoto(file, setPicture)} />
    </div>
  );
}
