import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { downscaleImage } from '@/lib/image';
import { apiFetch } from '@/lib/api';
import { useData } from '@/app/data';
import { logActivity } from '@/application/activity';
import { useSession } from '@/app/session';
import { leaveSpace, useMyRole } from './SpaceSharing';
import { AppBar, IconButton } from '@/ui/AppBar';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';
import { Button } from '@/ui/Button';
import { ColorPicker } from '@/ui/ColorPicker';
import { Icon } from '@/ui/Icon';

import { SPACE_COLORS, SPACE_ICONS } from './spaceDefaults';

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
  const [color, setColor] = useState(SPACE_COLORS[0]);
  const [picture, setPicture] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // leaving needs someone to stay behind — mirror the members screen rule
  const [memberCount, setMemberCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  // role in this space; local-only identities are always owner
  const myRole = useMyRole(spaceId, syncing);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // initialize the form once per space DURING render (not an effect): the
  // inputs must never be interactable before initialization, or a fast
  // keystroke would be clobbered — and live-query refreshes must not
  // overwrite what the user is typing afterwards
  if (space && loadedFor !== space.id) {
    setLoadedFor(space.id);
    setName(space.name);
    setIcon(space.icon ?? SPACE_ICONS[0]);
    setColor(space.color ?? SPACE_COLORS[0]);
    setPicture(space.picture ?? '');
  }

  const readOnly = myRole === 'reader';

  const save = async () => {
    if (!space || !name.trim() || readOnly) return;
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

  const leave = async () => {
    if (!confirmLeave) {
      setConfirmLeave(true); // destructive: second tap confirms
      return;
    }
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
          <IconButton label={t('action.back')} testId="spacesettings-back" onClick={() => goBack()}>
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
              className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none disabled:opacity-60"
            />

            <div className="m-cap px-1">{t('space.icon')}</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              data-testid="space-photo-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void downscaleImage(file, 128).then(setPicture).catch(() => undefined);
              }}
            />
            <div className="flex gap-2 overflow-x-auto pb-1">
              {/* own image: shown first, wins over the icon everywhere */}
              {picture ? (
                <button
                  data-testid="space-photo-clear"
                  disabled={readOnly}
                  onClick={() => setPicture('')}
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
                  data-testid="space-photo-upload"
                  disabled={readOnly}
                  onClick={() => fileRef.current?.click()}
                  title={t('profile.photoUpload')}
                  className="m-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-line bg-surface text-ink-3"
                >
                  <Icon name="camera-outline" size={17} />
                </button>
              )}
              {SPACE_ICONS.map((name_) => (
                <button
                  key={name_}
                  data-testid={`space-icon-${name_}`}
                  disabled={readOnly}
                  onClick={() => setIcon(name_)}
                  className={`m-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                    icon === name_ ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line bg-surface text-ink-2'
                  }`}
                >
                  <Icon name={name_} size={19} />
                </button>
              ))}
            </div>

            <div className="m-cap px-1">{t('space.color')}</div>
            <ColorPicker
              colors={SPACE_COLORS}
              value={color}
              onChange={setColor}
              disabled={readOnly}
              testIdPrefix="space-color"
              customLabel={t('color.custom')}
            />

            {!readOnly && (
              <Button data-testid="space-edit-save" onClick={() => void save()} disabled={!name.trim()}>
                {t('action.save')}
              </Button>
            )}

            {/* the private lock (arc 4): spaces are born locked; lifting
                it is this explicit owner act — applies immediately (LWW),
                nothing else batches with it */}
            {myRole === 'owner' && (
              <>
                <div className="m-cap mt-4 px-1">{t('space.sharingTitle')}</div>
                <div className="rounded-card border border-line bg-surface px-4 py-3">
                  <label className="flex items-center gap-3 text-[14px] font-medium text-ink">
                    <input
                      type="checkbox"
                      data-testid="space-invite-lock"
                      checked={space.inviteLock === 1}
                      onChange={(e) => {
                        void repo.upsert('space', space.id, space.id, { inviteLock: e.target.checked ? 1 : 0 });
                        void logActivity(store, repo, space.id, 'spaceEdit', space.name);
                      }}
                      className="h-4 w-4 accent-[var(--m-accent)]"
                    />
                    {t('space.inviteLockLabel')}
                  </label>
                  <p className="mt-1 pl-7 text-[12px] leading-snug text-ink-3">{t('space.inviteLockSub')}</p>
                </div>
              </>
            )}

            {/* danger zone last: deleting is the one action that must never sit
                between things people actually come here for */}
            {syncing && memberCount > 1 && (
              <div className="mt-4 flex flex-col gap-2">
                {confirmLeave && (
                  <p className="px-1 text-[13px] text-ink-3" data-testid="space-leave-confirm-note">
                    {t('space.leaveConfirm')}
                  </p>
                )}
                <Button variant="outline" data-testid="space-edit-leave" onClick={() => void leave()}>
                  {confirmLeave ? t('action.confirm') : t('space.leave')}
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
      {/* aligned destructive confirm (user request): sheet + cooldown,
          same shape as account/store/user deletion */}
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
