import { downscaleImage } from '@/lib/image';
import { isNativeApp, pickPhotoNative } from '@/lib/platform';
import { attachScrollMemory } from '@/lib/scrollMemory';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@/db/useQuery';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useGoalOps, useGoals } from '@/application/goals';
import { useSpaceAccounts } from '@/application/transactions';
import { localToday } from '@/application/recurring';
import { goalOverview, goalProgress, paceCentsPerMonth } from '@/domain/goals';
import type { GoalRow } from '@/db/types';
import { parseCents } from '@/lib/money';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { HelpButton } from '@/features/help/HelpButton';
import { IntroCard } from '@/features/help/IntroCard';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { ProgressBar, Tile } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { WebcamCaptureSheet, useWebcamDoor } from '@/ui/WebcamCaptureSheet';

export const GOAL_ICONS = ['home-outline', 'car-outline', 'airplane', 'shield-check-outline', 'laptop', 'ring', 'sail-boat', 'school-outline'] as const;

/** bundled, offline-ready goal covers (public/goals/*.jpg, Unsplash license) — saving-for themes, not event scenes */
export const GOAL_PICTURES = [
  '/goals/house.jpg',
  '/goals/car.jpg',
  '/goals/travel.jpg',
  '/goals/savings.jpg',
  '/goals/education.jpg',
  '/goals/wedding-fund.jpg',
  '/goals/gadget.jpg',
  '/goals/retirement.jpg',
  '/goals/renovation.jpg',
  '/goals/bike.jpg',
] as const;

/** create/edit sheet */
export function GoalFormSheet({ initial, onClose }: Readonly<{ initial: GoalRow | 'new' | null; onClose: () => void }>) {
  const { t } = useLang();
  const ops = useGoalOps();
  const editing = initial !== 'new' && initial !== null ? initial : null;
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(GOAL_ICONS[0]);
  const [picture, setPicture] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  // #195: tappable — an invalid tap names the blocker
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    setName(editing?.name ?? '');
    setIcon(editing?.icon ?? GOAL_ICONS[0]);
    setPicture(editing?.picture ?? null);
    setTarget(editing?.targetCents ? (editing.targetCents / 100).toFixed(2) : '');
    setTargetDate(editing?.targetDate ?? '');
    setConfirmDelete(false);
    setAttempted(false);
  }, [initial, editing]);

  const uploadRef = useRef<HTMLInputElement>(null);
  // #160: desktop-only webcam tile beside the upload tile
  const webcamDoor = useWebcamDoor();
  const [webcamOpen, setWebcamOpen] = useState(false);
  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    // wide enough for the hero, small enough to sync as a field
    setPicture(await downscaleImage(file, 1080, 0.72));
  };

  const pickPhoto = () => {
    // #166: the Android shell's file input is gallery-only — the Camera
    // plugin's chooser answers there; null from it = the user cancelled,
    // never a reason to open the web input on top
    if (isNativeApp()) {
      void pickPhotoNative().then((file) => void onUpload(file ?? undefined));
      return;
    }
    uploadRef.current?.click();
  };

  const targetCents = parseCents(target);
  const nameMissing = name.trim().length === 0;
  const amountMissing = targetCents === null || targetCents <= 0;
  const valid = !nameMissing && !amountMissing;

  const save = async () => {
    if (!valid || targetCents === null) return;
    await ops.save(editing?.id ?? null, {
      name: name.trim(),
      icon,
      picture: picture ?? undefined,
      targetCents,
      targetDate: targetDate || undefined,
      allocatedCents: editing?.allocatedCents ?? 0,
      archived: editing?.archived ?? 0,
    });
    onClose();
  };

  const removeGoal = async () => {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await ops.remove(editing.id);
    onClose();
  };

  // dirty vs the seeded values (user request 2026-08-01)
  const dirty =
    initial !== null &&
    (name !== (editing?.name ?? '') ||
      target !== (editing?.targetCents ? (editing.targetCents / 100).toFixed(2) : '') ||
      targetDate !== (editing?.targetDate ?? ''));

  return (
    <>
    <Sheet open={initial !== null} onOpenChange={(open) => !open && onClose()} title={editing ? t('goals.edit') : t('goals.new')} size="tall" dirty={dirty}>
      <div className="flex flex-col gap-3 pt-1">
        {/* optional cover, same mechanics as events (user request) */}
        <div className="flex gap-2 overflow-x-auto pb-1" data-testid="goalform-pictures">
          <button
            data-testid="goalform-pic-none"
            onClick={() => setPicture(null)}
            className={`m-tap flex h-14 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border text-[10px] ${
              picture === null ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line bg-surface text-ink-3'
            }`}
          >
            <Icon name="image-off-outline" size={16} />
            {t('goals.noPicture')}
          </button>
          <button
            data-testid="goalform-upload"
            onClick={pickPhoto}
            className="m-tap flex h-14 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-surface text-[10px] text-ink-3"
          >
            <Icon name="image-plus" size={16} />
            {t('events.uploadPicture')}
          </button>
          {/* #160: desktop webcam snapshot — mirrors the upload tile */}
          {webcamDoor && (
            <button
              data-testid="goalform-webcam"
              onClick={() => setWebcamOpen(true)}
              className="m-tap flex h-14 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-surface text-[10px] text-ink-3"
            >
              <Icon name="camera-outline" size={16} />
              {t('webcam.use')}
            </button>
          )}
          {GOAL_PICTURES.map((candidate) => (
            <button
              key={candidate}
              data-testid={`goalform-pic-${candidate.split('/').pop()?.replace('.jpg', '')}`}
              onClick={() => setPicture(candidate)}
              className={`m-tap h-14 w-20 shrink-0 overflow-hidden rounded-xl border-2 p-0 ${
                picture === candidate ? 'border-accent' : 'border-transparent'
              }`}
            >
              <img src={candidate} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
        {picture?.startsWith('data:') && (
          <div className="overflow-hidden rounded-xl border-2 border-accent" data-testid="goalform-uploaded">
            <img src={picture} alt="" className="h-16 w-full object-cover" />
          </div>
        )}
        <input ref={uploadRef} type="file" accept="image/*" className="hidden" data-testid="goalform-upload-input" onChange={(e) => void onUpload(e.target.files?.[0])} />

        <div className="flex gap-2 overflow-x-auto pb-1">
          {GOAL_ICONS.map((candidate) => (
            <button
              key={candidate}
              data-testid={`goalform-icon-${candidate}`}
              onClick={() => setIcon(candidate)}
              className={`m-tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                icon === candidate ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line bg-surface text-ink-2'
              }`}
            >
              <Icon name={candidate} size={19} />
            </button>
          ))}
        </div>
        <input
          data-testid="goalform-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('goals.namePlaceholder')}
          aria-invalid={attempted && nameMissing}
          className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && nameMissing)}`}
        />
        {/* #195 r2 (user): the blocker sits AT the field */}
        <FormBlockerNote show={attempted && nameMissing} text={t('form.needName')} testId="goalform-save-blocker" />
        <div className="m-cap px-1">{t('goals.target')}</div>
        <input
          data-testid="goalform-target"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="0.00"
          aria-invalid={attempted && amountMissing}
          className={`h-12 w-full rounded-input border border-line bg-surface px-4 font-mono text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && amountMissing)}`}
        />
        <FormBlockerNote show={attempted && !nameMissing && amountMissing} text={t('form.needAmount')} testId="goalform-save-blocker" />
        <label className="flex items-center gap-3 text-[13px] text-ink-2">
          {t('goals.targetDate')}
          <input
            data-testid="goalform-date"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="h-10 min-w-0 flex-1 appearance-none rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none"
          />
        </label>
        <Button
          data-testid="goalform-save"
          onClick={() => {
            if (!valid) {
              setAttempted(true);
              return;
            }
            void save();
          }}
        >
          {editing ? t('action.save') : t('action.create')}
        </Button>
        {editing && (
          <Button variant="danger" data-testid="goalform-delete" onClick={() => void removeGoal()}>
            {confirmDelete ? t('action.confirm') : t('action.delete')}
          </Button>
        )}
      </div>
    </Sheet>
    {/* #160: snapshot feeds the same downscale path as the file input */}
    <WebcamCaptureSheet open={webcamOpen} onOpenChange={setWebcamOpen} onCapture={(file) => void onUpload(file)} />
    </>
  );
}

/** All goals + the honesty header: saved vs allocated vs unallocated. */
export function GoalsScreen() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const goals = useGoals();
  const accounts = useSpaceAccounts();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const currency = space?.currency ?? 'EUR';
  const [formInitial, setFormInitial] = useState<GoalRow | 'new' | null>(null);

  const { fmt } = useDisplayMoney();
  const money = (cents: number) => fmt(cents, currency);
  const overview = goalOverview(goals ?? [], accounts ?? []);
  const negative = overview.unallocatedCents < 0;
  const today = localToday();

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-goals">
      <AppBar
        title={t('goals.title')}
        leading={
          <IconButton label={t('action.back')} testId="goals-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <>
            <HelpButton tourId="goals" />
            <IconButton label={t('goals.new')} testId="goals-add" onClick={() => setFormInitial('new')}>
              <Icon name="plus" size={22} />
            </IconButton>
          </>
        }
      />
      <div ref={(el) => attachScrollMemory(el, 'goals')} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <IntroCard tourId="goals" />
        {/* the honesty header — negative unallocated is the rebalance signal.
            Held back until both sides loaded so it never flashes €0 savings. */}
        {goals && accounts && (
          <div className="rounded-card border border-line bg-surface p-4" data-testid="goals-overview">
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  ['goals.saved', overview.savedCents, 'var(--m-ink)'],
                  ['goals.allocated', overview.allocatedCents, 'var(--m-accent-deep)'],
                  ['goals.unallocated', overview.unallocatedCents, negative ? 'var(--m-negative)' : 'var(--m-ink)'],
                ] as const
              ).map(([key, cents, color]) => (
                <div key={key}>
                  <div className="text-[10px] font-semibold tracking-wide text-ink-4 uppercase">{t(key)}</div>
                  <div className="mt-0.5 font-mono text-[15px] font-semibold" style={{ color }}>
                    {money(cents)}
                  </div>
                </div>
              ))}
            </div>
            {negative && (
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-negative" data-testid="goals-negative-note">
                <Icon name="alert-circle-outline" size={14} />
                {t('goals.negativeNote', { amount: money(-overview.unallocatedCents) })}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2.5 pt-3">
          {(goals ?? []).map((goal) => {
            const progress = goalProgress(goal);
            const pace = paceCentsPerMonth(goal, today);
            const reached = goal.allocatedCents >= goal.targetCents;
            let subtitle = t('goals.toGo', { amount: money(goal.targetCents - goal.allocatedCents) });
            if (reached) subtitle = t('goals.reached');
            else if (pace !== null) subtitle = t('goals.pace', { amount: money(pace) });
            return (
              <button
                key={goal.id}
                data-testid={`goal-card-${goal.id}`}
                onClick={() => void navigate({ to: '/goals/$goalId', params: { goalId: goal.id } })}
                className={`m-tap w-full rounded-card border border-line bg-surface p-4 text-left ${goal.archived === 1 ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-3">
                  {goal.picture ? (
                    <img src={goal.picture} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <Tile icon={goal.icon ?? 'flag-outline'} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15px] font-semibold text-ink">{goal.name}</span>
                      <span className="m-num shrink-0 text-[13px] font-semibold text-ink">
                        {money(goal.allocatedCents)} / {money(goal.targetCents)}
                      </span>
                    </span>
                    <span className="block text-[11px] text-ink-4">{subtitle}</span>
                  </span>
                </div>
                <ProgressBar
                  className="mt-3"
                  value={progress}
                  color={reached ? 'var(--m-accent)' : 'var(--m-accent-deep)'}
                />
              </button>
            );
          })}
        </div>
        {goals?.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center" data-testid="goals-empty">
            <Icon name="flag-outline" size={34} color="var(--m-ink-4)" />
            <p className="text-[14px] font-medium text-ink-2">{t('goals.emptyTitle')}</p>
            <p className="text-[12px] text-ink-4">{t('goals.emptyBody')}</p>
          </div>
        )}
      </div>
      <GoalFormSheet initial={formInitial} onClose={() => setFormInitial(null)} />
    </div>
  );
}
