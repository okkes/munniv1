import { useEffect, useRef, useState } from 'react';
import { attachScrollMemory } from '@/lib/scrollMemory';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@/db/useQuery';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useEventOps, useEvents } from '@/application/events';
import { useSpaceTransactions } from '@/application/transactions';
import { eventSpentCents } from '@/domain/events';
import type { EventRow } from '@/db/types';
import { downscaleImage } from '@/lib/image';
import { isNativeApp, pickPhotoNative } from '@/lib/platform';
import { parseCents } from '@/lib/money';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { HelpButton } from '@/features/help/HelpButton';
import { IntroCard } from '@/features/help/IntroCard';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { ProgressBar } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { WebcamCaptureSheet, useWebcamDoor } from '@/ui/WebcamCaptureSheet';

/** bundled, offline-ready defaults (public/events/*.jpg, Unsplash license) */
export const EVENT_PICTURES = [
  '/events/beach.jpg',
  '/events/city.jpg',
  '/events/wedding.jpg',
  '/events/party.jpg',
  '/events/racing.jpg',
  '/events/winter.jpg',
  '/events/nature.jpg',
  '/events/baby.jpg',
  '/events/dinner.jpg',
  '/events/concert.jpg',
] as const;

/** cover for a card/hero: picked or uploaded picture, first bundle as fallback */
export const eventPicture = (event: Pick<EventRow, 'picture'>): string => event.picture || EVENT_PICTURES[0];

/** create/edit: the picture carries the character; icons retired */
export function EventFormSheet({
  initial,
  onClose,
  onSaved,
}: Readonly<{
  initial: EventRow | 'new' | null;
  onClose: () => void;
  /** create-and-return hosts (review, tx detail) get the saved row's id
   *  HERE — sniffing the live-query list after close is a lost race */
  onSaved?: (id: string) => void;
}>) {
  const { t } = useLang();
  const ops = useEventOps();
  const editing = initial !== 'new' && initial !== null ? initial : null;
  const [name, setName] = useState('');
  const [picture, setPicture] = useState<string>(EVENT_PICTURES[0]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [estimate, setEstimate] = useState('');
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  // #195: tappable — an invalid tap names the blocker
  const [attempted, setAttempted] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  // #160: desktop-only webcam tile beside the upload tile
  const webcamDoor = useWebcamDoor();
  const [webcamOpen, setWebcamOpen] = useState(false);

  // seed keyed on the record's ID, never object identity (the iOS
  // reseed class: re-emitted rows must not wipe mid-typing edits)
  const seedKey = initial === null ? null : (editing?.id ?? 'new');
  useEffect(() => {
    setName(editing?.name ?? '');
    setPicture(editing?.picture ?? EVENT_PICTURES[0]);
    setFrom(editing?.from ?? '');
    setTo(editing?.to ?? '');
    setEstimate(editing?.budgetCents ? (editing.budgetCents / 100).toFixed(2) : '');
    setNote(editing?.note ?? '');
    setConfirmDelete(false);
    setAttempted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

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

  const save = async () => {
    if (!name.trim()) return;
    const budgetCents = parseCents(estimate);
    const savedId = await ops.save(editing?.id ?? null, {
      name: name.trim(),
      picture,
      from: from || undefined,
      to: to || undefined,
      budgetCents: budgetCents && budgetCents > 0 ? budgetCents : undefined,
      note: note.trim() || undefined,
      archived: editing?.archived ?? 0,
    });
    onSaved?.(savedId);
    onClose();
  };

  const removeEvent = async () => {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await ops.remove(editing.id);
    onClose();
  };

  // dirty vs the seeded values (user request 2026-08-01) — the picture
  // stays out: picking a bundled one is reversible and uploads are rare
  const dirty =
    initial !== null &&
    (name !== (editing?.name ?? '') ||
      from !== (editing?.from ?? '') ||
      to !== (editing?.to ?? '') ||
      estimate !== (editing?.budgetCents ? (editing.budgetCents / 100).toFixed(2) : '') ||
      note !== (editing?.note ?? ''));

  return (
    <>
    <Sheet open={initial !== null} onOpenChange={(open) => !open && onClose()} title={editing ? t('events.edit') : t('events.new')} size="tall" dirty={dirty}>
      <div className="flex flex-col gap-3 pt-1">
        {/* the picture defines the event — pick a bundled one or upload */}
        <div className="flex gap-2 overflow-x-auto pb-1" data-testid="eventform-pictures">
          <button
            data-testid="eventform-upload"
            onClick={pickPhoto}
            className="m-tap flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-surface text-[10px] text-ink-3"
          >
            <Icon name="image-plus" size={18} />
            {t('events.uploadPicture')}
          </button>
          {/* #160: desktop webcam snapshot — mirrors the upload tile */}
          {webcamDoor && (
            <button
              data-testid="eventform-webcam"
              onClick={() => setWebcamOpen(true)}
              className="m-tap flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-surface text-[10px] text-ink-3"
            >
              <Icon name="camera-outline" size={18} />
              {t('webcam.use')}
            </button>
          )}
          {EVENT_PICTURES.map((candidate) => (
            <button
              key={candidate}
              data-testid={`eventform-pic-${candidate.split('/').pop()?.replace('.jpg', '')}`}
              onClick={() => setPicture(candidate)}
              className={`m-tap h-16 w-24 shrink-0 overflow-hidden rounded-xl border-2 p-0 ${
                picture === candidate ? 'border-accent' : 'border-transparent'
              }`}
            >
              <img src={candidate} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
        {picture.startsWith('data:') && (
          <div className="flex items-center gap-2 overflow-hidden rounded-xl border-2 border-accent" data-testid="eventform-uploaded">
            <img src={picture} alt="" className="h-16 w-full object-cover" />
          </div>
        )}
        <input ref={uploadRef} type="file" accept="image/*" className="hidden" data-testid="eventform-upload-input" onChange={(e) => void onUpload(e.target.files?.[0])} />

        <input
          data-testid="eventform-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('events.namePlaceholder')}
          aria-invalid={attempted && !name.trim()}
          className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && !name.trim())}`}
        />
        {/* #195 r2 (user): the blocker sits AT the field */}
        <FormBlockerNote show={attempted && !name.trim()} text={t('form.needName')} testId="eventform-save-blocker" />
        <div className="flex items-end gap-2">
          <label className="relative min-w-0 flex-1 text-[12px] text-ink-3">
            {t('events.from')}
            <input
              data-testid="eventform-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 h-12 w-full appearance-none rounded-input border border-line bg-surface px-3 pr-8 text-[14px] text-ink outline-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-date-and-time-value]:text-left"
            />
          </label>
          <label className="relative min-w-0 flex-1 text-[12px] text-ink-3">
            {t('events.to')}
            <input
              data-testid="eventform-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 h-12 w-full appearance-none rounded-input border border-line bg-surface px-3 pr-8 text-[14px] text-ink outline-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-date-and-time-value]:text-left"
            />
          </label>
        </div>
        <label className="text-[12px] text-ink-3">
          {t('events.estimate')}
          <input
            data-testid="eventform-budget"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="0.00"
            className="mt-1 h-11 w-full rounded-input border border-line bg-surface px-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
        </label>
        <label className="text-[12px] text-ink-3">
          {t('events.note')}
          <input
            data-testid="eventform-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('events.notePlaceholder')}
            className="mt-1 h-11 w-full rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
        </label>
        {editing && (
          <button
            data-testid="eventform-archive"
            onClick={() => void ops.save(editing.id, { archived: editing.archived === 1 ? 0 : 1 }).then(onClose)}
            className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left text-[14px] text-ink"
          >
            <Icon name={editing.archived === 1 ? 'archive-arrow-up-outline' : 'archive-outline'} size={18} />
            {t(editing.archived === 1 ? 'events.unarchive' : 'events.archive')}
          </button>
        )}
        <Button
          data-testid="eventform-save"
          onClick={() => {
            if (!name.trim()) {
              setAttempted(true);
              return;
            }
            void save();
          }}
        >
          {editing ? t('action.save') : t('action.create')}
        </Button>
        {editing && (
          <Button variant="danger" data-testid="eventform-delete" onClick={() => void removeEvent()}>
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

/** All events with live totals; archived keep their story below. */
export function EventsScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const events = useEvents();
  const txs = useSpaceTransactions();
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const currency = space?.currency ?? 'EUR';
  const { fmt } = useDisplayMoney();
  const [formInitial, setFormInitial] = useState<EventRow | 'new' | null>(null);

  const fmtRange = (event: EventRow) => {
    if (!event.from) return null;
    const f = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });
    return event.to ? `${f(event.from)} – ${f(event.to)}` : f(event.from);
  };

  const renderCard = (event: EventRow) => {
    const spent = eventSpentCents(txs ?? [], event.id);
    const overBudget = !!event.budgetCents && spent > event.budgetCents;
    return (
      <button
        key={event.id}
        data-testid={`event-card-${event.id}`}
        onClick={() => void navigate({ to: '/events/$eventId', params: { eventId: event.id } })}
        className={`m-tap w-full overflow-hidden rounded-card border border-line bg-surface p-0 text-left ${event.archived === 1 ? 'opacity-60' : ''}`}
      >
        <div className="relative h-24 w-full">
          <img src={eventPicture(event)} alt="" loading="lazy" className="h-full w-full object-cover" />
          <span className="absolute right-3 bottom-2 rounded-lg bg-black/45 px-2 py-0.5 backdrop-blur-sm">
            <span className="m-num text-[14px] font-semibold text-white" data-testid={`event-total-${event.id}`}>
              {fmt(spent, currency)}
            </span>
          </span>
        </div>
        <div className="px-4 py-3">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold text-ink">{event.name}</span>
            {event.budgetCents ? (
              <span className="shrink-0 text-[11px] text-ink-4">{t('budgets.of', { amount: fmt(event.budgetCents, currency) })}</span>
            ) : null}
          </span>
          <span className="block text-[11px] text-ink-4">{fmtRange(event) ?? t('events.undated')}</span>
          {!!event.budgetCents && (
            <ProgressBar className="mt-2" value={spent / event.budgetCents} tone={overBudget ? 'negative' : 'accent'} />
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-events">
      <AppBar
        title={t('events.title')}
        leading={
          <IconButton label={t('action.back')} testId="events-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <>
            <HelpButton tourId="events" />
            <IconButton label={t('events.new')} testId="events-add" onClick={() => setFormInitial('new')}>
              <Icon name="plus" size={22} />
            </IconButton>
          </>
        }
      />
      <div ref={(el) => attachScrollMemory(el, 'events')} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <IntroCard tourId="events" />
        <div className="flex flex-col gap-2.5 pt-1">{(events ?? []).map(renderCard)}</div>
        {events?.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center" data-testid="events-empty">
            <Icon name="party-popper" size={34} color="var(--m-ink-4)" />
            <p className="text-[14px] font-medium text-ink-2">{t('events.emptyTitle')}</p>
            <p className="text-[12px] text-ink-4">{t('events.emptyBody')}</p>
          </div>
        )}
      </div>
      <EventFormSheet initial={formInitial} onClose={() => setFormInitial(null)} />
    </div>
  );
}
