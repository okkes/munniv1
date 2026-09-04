import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { downscaleImage } from '@/lib/image';
import { isNativeApp, pickPhotoNative } from '@/lib/platform';
import { apiFetch } from '@/lib/api';
import { useData } from '@/app/data';
import { logActivity } from '@/application/activity';
import { useSession } from '@/app/session';
import { leaveSpace, useMyRole } from './SpaceSharing';
import { AppBar, IconButton } from '@/ui/AppBar';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';
import { useDiscardGuard } from '@/ui/DiscardGuard';
import { Button } from '@/ui/Button';
import { ColorPicker } from '@/ui/ColorPicker';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { SearchField } from '@/ui/SearchField';
import { WebcamCaptureSheet, useWebcamDoor } from '@/ui/WebcamCaptureSheet';
import { MDI_NAMES } from '@/generated/mdiNames';

import { SPACE_COLORS, SPACE_ICONS } from './spaceDefaults';

/** one downscale path for all three photo doors (input, native, webcam) */
export const applySpacePhoto = (file: File, onPicture: (dataUrl: string) => void): void => {
  void downscaleImage(file, 128).then(onPicture).catch(() => undefined);
};

/**
 * #301: the space-image tiles (upload/clear + optional webcam door),
 * shared by the settings form AND the create form — the strip owns the
 * hidden file input and the native chooser; the WEBCAM SHEET stays with
 * the host (sheets are siblings, never nested).
 */
export function SpacePhotoStrip({
  picture,
  onPicture,
  disabled = false,
  onWebcam,
  testIdPrefix,
}: Readonly<{
  picture: string;
  /** '' clears a previously set image */
  onPicture: (dataUrl: string) => void;
  disabled?: boolean;
  /** null hides the webcam tile (no capable camera / native shell) */
  onWebcam: (() => void) | null;
  testIdPrefix: string;
}>) {
  const { t } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);

  const pickPhoto = () => {
    // #166: the Android shell's file input is gallery-only — the Camera
    // plugin's chooser answers there; null from it = the user cancelled,
    // never a reason to open the web input on top
    if (isNativeApp()) {
      void pickPhotoNative().then((file) => {
        if (file) applySpacePhoto(file, onPicture);
      });
      return;
    }
    fileRef.current?.click();
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        data-testid={`${testIdPrefix}-input`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) applySpacePhoto(file, onPicture);
        }}
      />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {/* own image: shown first, wins over the icon everywhere */}
        {picture ? (
          <button
            data-testid={`${testIdPrefix}-clear`}
            disabled={disabled}
            onClick={() => onPicture('')}
            title={t('action.delete')}
            className="m-tap relative h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-accent"
          >
            <img src={picture} alt="" className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
              <Icon name="close" size={14} />
            </span>
          </button>
        ) : (
          <button
            data-testid={`${testIdPrefix}-upload`}
            disabled={disabled}
            onClick={pickPhoto}
            title={t('profile.photoUpload')}
            className="m-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-line bg-surface text-ink-3"
          >
            {/* #146 r2: upload ≠ webcam — two camera icons read as one */}
            <Icon name="upload-outline" size={17} />
          </button>
        )}
        {/* #160: desktop webcam snapshot — mirrors the upload tile */}
        {onWebcam && (
          <button
            data-testid={`${testIdPrefix}-webcam`}
            disabled={disabled}
            onClick={onWebcam}
            title={t('webcam.use')}
            className="m-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-line bg-surface text-ink-3"
          >
            <Icon name="camera-outline" size={17} />
          </button>
        )}
      </div>
    </>
  );
}

/**
 * A space's settings, slimmed to its IDENTITY: name, image/icon, color —
 * plus leaving/deleting the space (user request: the screen tried to do
 * everything). Period, currency and history start are separate settings
 * on the Settings tab; members and financial accounts have their own
 * screens. Browser back = route back.
 */
export function SpaceSettingsScreen() {
  const { t } = useLang();
  const { store, repo, engine, setActiveSpace, spaceId: activeSpaceId } = useData();
  const navigate = useNavigate();
  const identity = useSession((s) => s.identity);
  const syncing = identity?.kind === 'user';
  const { spaceId } = useParams({ strict: false }) as { spaceId: string };
  // router-aware back: window.history only drives the real hash history,
  // not the memory history used by tests
  const router = useRouter();
  const goBack = () => router.history.back();

  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState(SPACE_ICONS[0]);
  // #285 (user): the curated set opens into the whole self-hosted font
  // through a search — the same door the category form has
  const [iconQuery, setIconQuery] = useState('');
  const [color, setColor] = useState(SPACE_COLORS[0]);
  const [picture, setPicture] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // leaving needs someone to stay behind — mirror the members screen rule
  const [memberCount, setMemberCount] = useState(0);
  // #160: desktop-only webcam door beside the upload tile
  const webcamDoor = useWebcamDoor();
  const [webcamOpen, setWebcamOpen] = useState(false);
  // role in this space; local-only identities are always owner
  const myRole = useMyRole(spaceId, syncing);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // #195: the save button stays enabled — an invalid click says why
  const [attempted, setAttempted] = useState(false);

  // initialize the form once per space DURING render (not an effect): the
  // inputs must never be interactable before initialization, or a fast
  // keystroke would be clobbered — and live-query refreshes must not
  // overwrite what the user is typing afterwards
  if (space && loadedFor !== space.id) {
    setLoadedFor(space.id);
    setName(space.name);
    setIcon(space.icon ?? SPACE_ICONS[0]);
    setIconQuery('');
    setColor(space.color ?? SPACE_COLORS[0]);
    setPicture(space.picture ?? '');
  }

  const readOnly = myRole === 'reader';

  // #164: dirty vs a freshly derived seed (EditAccountSheet pattern) —
  // tapping back with edits pending asks instead of dropping them
  const seedNow = space
    ? { name: space.name, icon: space.icon ?? SPACE_ICONS[0], color: space.color ?? SPACE_COLORS[0], picture: space.picture ?? '' }
    : null;
  const dirty =
    seedNow !== null &&
    (name !== seedNow.name || icon !== seedNow.icon || color !== seedNow.color || picture !== seedNow.picture);
  const { guardedBack, sheet: discardSheet } = useDiscardGuard(dirty, goBack);

  const save = async () => {
    if (!space || readOnly) return;
    if (!name.trim()) {
      setAttempted(true);
      return;
    }
    // private names stay unique (user rule) — renaming counts too
    if (space.kind !== 'shared') {
      const clash = (await store.allRows('space')).some(
        (s) => s.deleted === 0 && s.id !== space.id && s.kind !== 'shared' && s.name.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      if (clash) {
        setDeleteError(t('space.nameTaken'));
        return;
      }
    }
    setAttempted(false);
    void repo.upsert('space', space.id, space.id, {
      name: name.trim(),
      icon,
      color,
      picture, // '' clears a previously set image
    });
    void logActivity(store, repo, space.id, 'spaceEdit', name.trim());
    goBack();
  };

  useEffect(() => {
    if (!syncing) return;
    void apiFetch(`/spaces/${spaceId}/members`)
      .then(async (res) => (res.ok ? ((await res.json()) as unknown[]).length : 0))
      .then(setMemberCount)
      .catch(() => setMemberCount(0));
  }, [spaceId, syncing]);

  // #304 (user): leaving confirms like removing a member — the standard
  // countdown danger sheet, on this surface too
  const leave = async () => {
    if (await leaveSpace({ store, engine, setActiveSpace, activeSpaceId }, spaceId)) {
      void navigate({ to: '/spaces' });
    }
  };

  const openDeleteConfirm = async () => {
    if (!space) return;
    if (space.id === activeSpaceId) {
      setDeleteError(t('space.cannotDeleteActive'));
      return;
    }
    // counted on demand — a liveQuery would read undefined (= "only
    // space") for a tap that lands before its first emission
    const count = (await store.allRows('space')).filter((s) => s.deleted === 0).length;
    if (count <= 1) {
      setDeleteError(t('space.cannotDeleteOnly'));
      return;
    }
    setConfirmDelete(true); // the shared danger sheet takes it from here
  };

  const deleteSpace = async () => {
    if (!space) return;
    await repo.remove('space', space.id, space.id);
    goBack();
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-space-settings" data-space-id={spaceId}>
      <AppBar
        title={space?.name ?? t('space.settings')}
        leading={
          <IconButton label={t('action.back')} testId="spacesettings-back" onClick={() => guardedBack()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      {/* overflow-x-hidden: wide chip rows must swipe inside their own
          containers, never pan the whole screen sideways */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-8">
        {space && (
          <div className="flex flex-col gap-3 pt-1 pb-4">
            {readOnly && (
              <p className="rounded-card bg-bg-2 px-4 py-2.5 text-[13px] text-ink-3" data-testid="space-reader-note">
                {t('space.readerNote')}
              </p>
            )}
            <input
              data-testid="space-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              aria-invalid={attempted && !name.trim()}
              className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none disabled:opacity-60${blockerRing(attempted && !name.trim())}`}
            />
            {/* #195 r2 (user): the blocker sits AT the field */}
            <FormBlockerNote show={attempted && !name.trim()} text={t('form.needName')} testId="space-edit-blocker" />

            <div className="m-cap px-1">{t('space.icon')}</div>
            {/* #301: the strip is shared with the create form now */}
            <SpacePhotoStrip
              picture={picture}
              onPicture={setPicture}
              disabled={readOnly}
              onWebcam={webcamDoor ? () => setWebcamOpen(true) : null}
              testIdPrefix="space-photo"
            />
            {/* #285 (user): search opens the WHOLE self-hosted font (the
                categories pattern), and every glyph below renders in the
                picked color so a swatch tap previews its real impact */}
            <SearchField
              testId="space-icon-search"
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
              ).map((name_) => (
                <button
                  key={name_}
                  data-testid={`space-icon-${name_}`}
                  title={name_}
                  // #146 (user): a picture wins over symbol+color everywhere —
                  // while one is set, picking them would change nothing visible
                  disabled={readOnly || picture !== ''}
                  onClick={() => setIcon(name_)}
                  // #146 r2: with a picture set nothing is "selected" —
                  // the stale accent ring on the old symbol read as active
                  className={`m-tap flex h-10 items-center justify-center rounded-xl border ${
                    icon === name_ && picture === '' ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
                  }`}
                >
                  <Icon name={name_} size={19} color={color} />
                </button>
              ))}
              {iconQuery.trim() && MDI_NAMES.every((n) => !n.includes(iconQuery.trim().toLowerCase())) && (
                <p className="col-span-6 py-2 text-center text-[12px] text-ink-4" data-testid="space-icon-none">
                  {t('space.iconNone')}
                </p>
              )}
            </div>
            {/* #146: say WHY the pickers sleep, not just gray them out */}
            {picture !== '' && (
              <p className="px-1 text-[11px] leading-snug text-ink-4" data-testid="space-icon-picture-note">
                {t('space.picStompsIcon')}
              </p>
            )}

            <div className="m-cap px-1">{t('space.color')}</div>
            <ColorPicker
              colors={SPACE_COLORS}
              value={color}
              onChange={setColor}
              disabled={readOnly || picture !== ''}
              testIdPrefix="space-color"
              customLabel={t('color.custom')}
            />

            {!readOnly && (
              <Button data-testid="space-edit-save" onClick={() => void save()}>
                {t('action.save')}
              </Button>
            )}

            {/* the private lock moved to the Settings tab (#162) — this
                screen keeps only the space's identity */}

            {/* danger zone last: deleting is the one action that must never sit
                between things people actually come here for */}
            {syncing && memberCount > 1 && (
              <div className="mt-4 flex flex-col gap-2">
                <Button variant="outline" data-testid="space-edit-leave" onClick={() => setConfirmLeave(true)}>
                  {t('space.leave')}
                </Button>
              </div>
            )}
            {myRole === 'owner' && (
              <div className="mt-4 flex flex-col gap-2">
                <Button variant="danger" data-testid="space-edit-delete" onClick={() => void openDeleteConfirm()}>
                  {t('space.delete')}
                </Button>
              </div>
            )}
            {deleteError && (
              <p className="text-center text-[13px] text-negative" data-testid="space-delete-error">
                {deleteError}
              </p>
            )}
          </div>
        )}
      </div>
      {/* #164: the back button's "discard changes?" ask */}
      {discardSheet}
      {/* #160: snapshot feeds the same downscale path as the file input */}
      <WebcamCaptureSheet open={webcamOpen} onOpenChange={setWebcamOpen} onCapture={(file) => applySpacePhoto(file, setPicture)} />
      {/* aligned destructive confirm (user request): sheet + cooldown,
          same shape as account/store/user deletion */}
      {/* #304: the leave confirm — countdown-armed like every other
          destructive door */}
      <DangerConfirmSheet
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={t('space.leaveConfirmTitle')}
        body={t('space.leaveConfirm')}
        confirmLabel={t('space.leave')}
        onConfirm={() => void leave()}
        testId="space-edit-leave-sheet"
      />
      <DangerConfirmSheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('space.deleteConfirmTitle')}
        body={t('space.deleteConfirmNote')}
        onConfirm={() => void deleteSpace()}
        testId="space-delete"
      />
    </div>
  );
}
