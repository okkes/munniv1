import { useEffect, useRef, useState } from 'react';
import { useLogto } from '@logto/react';
import { useNavigate } from '@tanstack/react-router';
import { logtoConfigured } from '@/app/config';
import { destroyIdentityData, useData } from '@/app/data';
import { Row } from '@/ui/primitives';
import { useSession } from '@/app/session';
import { deleteOfflineProfile, getOfflineProfile, updateOfflineProfile } from '@/features/auth/offlineProfiles';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';
import { useLang } from '@/i18n';
import { apiFetch } from '@/lib/api';
import { downscaleImage, isDataImage } from '@/lib/image';
import { isNativeApp, pickPhotoNative } from '@/lib/platform';
import { COUNTRIES, CURRENCIES } from '@/domain/countries';
import { setPredictionCountry } from '@/domain/predictCategory';
import { MANUAL_RATES_META_KEY, readManualRates } from '@/lib/rates';
import { useQuery } from '@/db/useQuery';
import { AppBar, IconButton } from '@/ui/AppBar';
import { useDiscardGuard } from '@/ui/DiscardGuard';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { Flag } from '@/ui/Flag';
import { Sheet } from '@/ui/Sheet';
import { WebcamCaptureSheet, useWebcamDoor } from '@/ui/WebcamCaptureSheet';

/** avatar presets: "icon|color" */
export const AVATARS = [
  'account-outline|#08372B', 'emoticon-happy-outline|#3498DB', 'cat|#E67E22', 'dog|#795548',
  'rocket-launch-outline|#9B59B6', 'flower-outline|#E91E63', 'coffee-outline|#A8782B', 'bike|#27AE60',
  'gamepad-variant-outline|#E74C3C', 'music|#1ABC9C', 'book-open-outline|#2980B9', 'leaf|#16A085',
];

export function Avatar({ picture, size = 40 }: { picture?: string | null; size?: number }) {
  if (isDataImage(picture)) {
    return (
      <img
        src={picture!}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        data-testid="profile-avatar"
      />
    );
  }
  const [icon, color] = (picture ?? AVATARS[0]).split('|');
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `${color}22`, color }}
      data-testid="profile-avatar"
    >
      <Icon name={icon} size={size * 0.55} />
    </span>
  );
}

const PROFILE_META_KEY = 'profile';

/** the Settings-header copy of a /me payload; null when there is nothing worth storing */
function profileMetaCopy(me: {
  displayName: string | null;
  picture: string | null;
  country?: string | null;
  displayCurrency?: string | null;
}): LocalProfile | null {
  if (!me.displayName && !me.picture) return null;
  return {
    name: me.displayName ?? '',
    picture: me.picture ?? undefined,
    // country and display currency ride along — the refresh used to
    // overwrite the meta copy WITHOUT them, silently dropping both
    country: me.country ?? undefined,
    displayCurrency: me.displayCurrency ?? undefined,
  };
}

/** /me → screen state, refreshing the local Settings-header copy on the way */
async function fetchUserProfile(
  store: ReturnType<typeof useData>['store'],
): Promise<{ name: string; picture: string | null; userId: string; country: string | null; displayCurrency: string | null } | null> {
  const res = await apiFetch('/me').catch(() => null);
  if (!res?.ok) return null;
  const me = (await res.json()) as {
    userId: string;
    displayName: string | null;
    picture: string | null;
    country: string | null;
    displayCurrency: string | null;
  };
  // keep the local copy in step with the server — an avatar changed on
  // another device or a reinstall lands here
  const copy = profileMetaCopy(me);
  if (copy) await store.metaPut(PROFILE_META_KEY, copy);
  return {
    name: me.displayName ?? '',
    picture: me.picture,
    userId: me.userId,
    country: me.country ?? null,
    displayCurrency: me.displayCurrency ?? null,
  };
}

interface LocalProfile {
  name?: string;
  picture?: string;
  /** ISO country of use — tunes category prediction */
  country?: string;
  /** ISO 4217 display currency (currency plan CD3); absent = as recorded */
  displayCurrency?: string;
}

interface LoadedProfileState {
  name: string;
  picture: string | null;
  userId: string | null;
  country: string | null;
  displayCurrency: string | null;
}

/** the screen's initial values per identity kind: server truth for
 *  signed-in users, the device copy for offline/demo */
async function loadProfileState(
  identity: { kind: string; profileId?: string } | null,
  store: ReturnType<typeof useData>['store'],
): Promise<LoadedProfileState> {
  if (identity?.kind === 'user') {
    const loaded = await fetchUserProfile(store);
    // the refresh already synced the meta copy — country rides on it
    const localCopy = (await store.metaGet(PROFILE_META_KEY))?.value as LocalProfile | undefined;
    return {
      name: loaded?.name ?? '',
      picture: loaded?.picture ?? null,
      userId: loaded?.userId ?? null,
      country: loaded?.country ?? localCopy?.country ?? null,
      displayCurrency: loaded?.displayCurrency ?? null,
    };
  }
  const localCopy = (await store.metaGet(PROFILE_META_KEY))?.value as LocalProfile | undefined;
  const offline = identity?.kind === 'offline' && identity.profileId ? getOfflineProfile(identity.profileId) : undefined;
  return {
    name: offline ? (offline.name ?? '') : (localCopy?.name ?? 'Demo'),
    picture: offline?.picture ?? localCopy?.picture ?? null,
    userId: null,
    country: localCopy?.country ?? null,
    displayCurrency: localCopy?.displayCurrency ?? null,
  };
}

/**
 * Who you are: display name + avatar (shared with friends/space members
 * for signed-in users), your user id and login email. Demo and offline
 * identities keep everything on the device.
 */
export function ProfileScreen() {
  const { t, lang } = useLang();
  const { store } = useData();
  const identity = useSession((s) => s.identity);
  const [name, setName] = useState('');
  const [picture, setPicture] = useState(AVATARS[0]);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [country, setCountry] = useState('NL');
  const [countryOpen, setCountryOpen] = useState(false);
  // null = "as recorded" (the default: no conversion anywhere)
  const [displayCurrency, setDisplayCurrency] = useState<string | null>(null);
  const [displayCurrencyOpen, setDisplayCurrencyOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  // #195: tappable — an invalid tap names the blocker
  const [attempted, setAttempted] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  // #307: which stage of the deletion runs (server erase → device wipe)
  const [deletePhase, setDeletePhase] = useState<'server' | 'local' | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [deleteProfileOpen, setDeleteProfileOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // #160: desktop-only webcam door beside the upload button
  const webcamDoor = useWebcamDoor();
  const [webcamOpen, setWebcamOpen] = useState(false);
  const navigate = useNavigate();
  const logout = useSession((s) => s.logout);

  // full account deletion (account-deletion design; Apple 5.1.1(v)):
  // the server erases everything, then the device forgets the identity.
  // #307 (user): the wait is narrated per stage — the server erase is
  // the slow one — and the sheet refuses dismissal while it runs
  const deleteAccount = async () => {
    const current = identity;
    if (current?.kind !== 'user') return;
    setDeleteBusy(true);
    setDeleteError(false);
    setDeletePhase('server');
    const res = await apiFetch('/me', { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setDeleteBusy(false);
      setDeletePhase(null);
      setDeleteError(true);
      return;
    }
    setDeletePhase('local');
    logout();
    await destroyIdentityData(current);
    await navigate({ to: '/login' });
  };

  // offline mirror of deleteAccount (user ruling 2026-07-29: the delete
  // lives HERE, consistent with the online account — not on the chooser):
  // sign out first so the DataProvider closes the store, then the
  // profile helper erases the database, lock config and registry row
  const deleteOfflineData = async () => {
    const current = identity;
    if (current?.kind !== 'offline') return;
    logout();
    await deleteOfflineProfile(current.profileId);
    await navigate({ to: '/login' });
  };

  const onPhotoPicked = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPicture(await downscaleImage(file, 256));
    } catch {
      // unreadable file — keep the current avatar
    }
  };

  const pickPhoto = () => {
    // #166: the Android shell's file input is gallery-only — the Camera
    // plugin's chooser answers there; null from it = the user cancelled,
    // never a reason to open the web input on top
    if (isNativeApp()) {
      void pickPhotoNative().then((file) => void onPhotoPicked(file ?? undefined));
      return;
    }
    fileRef.current?.click();
  };

  // load current values per identity kind
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadProfileState(identity, store);
      if (cancelled) return;
      setName(loaded.name);
      if (loaded.picture) setPicture(loaded.picture);
      if (loaded.userId) setUserId(loaded.userId);
      if (loaded.country) setCountry(loaded.country);
      setDisplayCurrency(loaded.displayCurrency);
      // #164: the loaded snapshot is the discard-guard baseline
      baselineRef.current = JSON.stringify([
        loaded.name,
        loaded.picture ?? null,
        loaded.country ?? null,
        loaded.displayCurrency ?? null,
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [identity, store]);
  const baselineRef = useRef<string | null>(null);
  const draftPrint = JSON.stringify([name, picture ?? null, country ?? null, displayCurrency ?? null]);
  const profileDirty = baselineRef.current !== null && draftPrint !== baselineRef.current;
  const { guardedBack, sheet: discardSheet } = useDiscardGuard(profileDirty, () => window.history.back());

  const save = async () => {
    if (!name.trim()) return;
    if (identity?.kind === 'user') {
      // displayCurrency '' = the server's explicit "clear back to as recorded"
      await apiFetch('/me', {
        method: 'PUT',
        body: JSON.stringify({ displayName: name.trim(), picture, country, displayCurrency: displayCurrency ?? '' }),
      }).catch(
        () => undefined, // offline is fine — retried on next profile save
      );
    } else if (identity?.kind === 'offline') {
      updateOfflineProfile(identity.profileId, { name: name.trim(), picture });
    }
    // local copy for instant display everywhere (all identity kinds)
    await store.metaPut(PROFILE_META_KEY, {
      name: name.trim(),
      picture,
      country,
      displayCurrency: displayCurrency ?? undefined,
    } satisfies LocalProfile);
    setPredictionCountry(country);
    // #164: a save makes the draft the new baseline — leaving is clean
    baselineRef.current = JSON.stringify([name, picture ?? null, country ?? null, displayCurrency ?? null]);
    setAttempted(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const copyId = () => {
    if (!userId) return;
    void navigator.clipboard?.writeText(userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-profile">
      <AppBar
        title={t('profile.title')}
        leading={
          <IconButton label={t('action.back')} testId="profile-back" onClick={guardedBack}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      {discardSheet}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex flex-col items-center gap-1.5 py-5">
          <Avatar picture={picture} size={72} />
          {/* the name under the preview gives the selection context */}
          {name.trim() && (
            <span className="text-[14px] font-medium text-ink" data-testid="profile-preview-name">
              {name.trim()}
            </span>
          )}
        </div>

        <div className="m-cap mb-1 px-1">{t('profile.avatar')}</div>
        <div className="grid grid-cols-6 gap-2">
          {AVATARS.map((preset) => (
            <button
              key={preset}
              data-testid={`profile-avatar-${preset.split('|')[0]}`}
              onClick={() => setPicture(preset)}
              className={`m-tap flex h-11 items-center justify-center rounded-xl border ${
                picture === preset ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
              }`}
            >
              <Avatar picture={preset} size={28} />
            </button>
          ))}
        </div>
        {/* own photo: downscaled on-device, synced as a tiny data URL */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          data-testid="profile-photo-input"
          onChange={(e) => void onPhotoPicked(e.target.files?.[0])}
        />
        <div className="mt-2 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            data-testid="profile-photo-upload"
            onClick={pickPhoto}
          >
            {/* #146 r2: upload wears the upload glyph — webcam keeps the camera */}
            <Icon name="upload-outline" size={16} />
            {isDataImage(picture) ? t('profile.photoReplace') : t('profile.photoUpload')}
          </Button>
          {/* #160: desktop webcam snapshot beside the upload */}
          {webcamDoor && (
            <Button variant="outline" size="sm" data-testid="profile-photo-webcam" onClick={() => setWebcamOpen(true)}>
              <Icon name="camera-outline" size={16} />
              {t('webcam.use')}
            </Button>
          )}
        </div>

        <div className="m-cap mt-5 mb-1 px-1">{t('profile.displayName')}</div>
        <input
          data-testid="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('profile.displayName')}
          aria-invalid={attempted && !name.trim()}
          className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && !name.trim())}`}
        />
        {/* #195 r2 (user): the blocker sits AT the field */}
        <FormBlockerNote show={attempted && !name.trim()} text={t('form.needName')} testId="profile-save-blocker" className="mt-1 px-1" />

        {/* country of use — changeable later (user request); tunes the
            category predictor, explained by the info line */}
        <div className="m-cap mt-5 mb-1 px-1">{t('onboarding.countryLabel')}</div>
        <button
          data-testid="profile-country"
          onClick={() => setCountryOpen(true)}
          className="m-tap flex h-12 w-full items-center gap-3 rounded-input border border-line bg-surface px-4 text-left text-[15px] text-ink"
        >
          <Flag code={country} size={20} />
          <span className="flex-1">{COUNTRIES.find((c) => c.code === country)?.[lang] ?? country}</span>
          <Icon name="chevron-down" size={18} color="var(--m-ink-4)" />
        </button>
        <p className="mt-1 px-1 text-[12px] leading-snug text-ink-4">{t('profile.countryInfo')}</p>

        <Sheet open={countryOpen} onOpenChange={setCountryOpen} title={t('onboarding.countryLabel')} size="tall" dragHandle>
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              data-testid={`profile-country-${c.code}`}
              onClick={() => {
                setCountry(c.code);
                setCountryOpen(false);
              }}
              className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-1 py-2.5 text-left text-[14px] text-ink"
            >
              <Flag code={c.code} size={20} />
              <span className="flex-1">{c[lang]}</span>
              {country === c.code && <Icon name="check" size={15} color="var(--m-accent)" />}
            </button>
          ))}
        </Sheet>

        {/* display currency (currency plan CD3): a personal rendering
            lens — every conversion shows ≈, the data never changes */}
        <div className="m-cap mt-5 mb-1 px-1">{t('profile.displayCurrency')}</div>
        <button
          data-testid="profile-display-currency"
          onClick={() => setDisplayCurrencyOpen(true)}
          className="m-tap flex h-12 w-full items-center gap-3 rounded-input border border-line bg-surface px-4 text-left text-[15px] text-ink"
        >
          <Icon name="cash-multiple" size={20} color="var(--m-ink-3)" />
          <span className="flex-1">{displayCurrency ?? t('profile.displayCurrencyAsRecorded')}</span>
          <Icon name="chevron-down" size={18} color="var(--m-ink-4)" />
        </button>
        <p className="mt-1 px-1 text-[12px] leading-snug text-ink-4">{t('profile.displayCurrencyInfo')}</p>
        {identity?.kind !== 'user' && displayCurrency && <ManualRatesEditor display={displayCurrency} />}

        <Sheet open={displayCurrencyOpen} onOpenChange={setDisplayCurrencyOpen} title={t('profile.displayCurrency')} size="form" dragHandle>
          <div className="flex flex-col pt-1">
            <button
              data-testid="display-currency-off"
              onClick={() => {
                setDisplayCurrency(null);
                setDisplayCurrencyOpen(false);
              }}
              className="m-tap flex items-center gap-3 border-b border-line-2 border-none bg-transparent px-1 py-3 text-left text-[14px] text-ink"
            >
              <span className="flex-1">{t('profile.displayCurrencyAsRecorded')}</span>
              {!displayCurrency && <Icon name="check" size={15} color="var(--m-accent)" />}
            </button>
            {CURRENCIES.map((c) => (
              <button
                key={c}
                data-testid={`display-currency-${c}`}
                onClick={() => {
                  setDisplayCurrency(c);
                  setDisplayCurrencyOpen(false);
                }}
                className="m-tap flex items-center gap-3 border-none bg-transparent px-1 py-3 text-left text-[14px] text-ink"
              >
                <span className="flex-1 font-mono">{c}</span>
                {displayCurrency === c && <Icon name="check" size={15} color="var(--m-accent)" />}
              </button>
            ))}
          </div>
        </Sheet>

        <Button
          className="mt-4 w-full"
          data-testid="profile-save"
          onClick={() => {
            if (!name.trim()) {
              setAttempted(true);
              return;
            }
            void save();
          }}
        >
          {saved ? t('profile.saved') : t('action.save')}
        </Button>

        {identity?.kind === 'user' && (
          <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface">
            <button
              data-testid="profile-copy-id"
              onClick={copyId}
              className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="m-cap block">{t('profile.userId')}</span>
                <span className="block truncate font-mono text-[12px] text-ink-2">{userId ?? '…'}</span>
              </span>
              <Icon name={copied ? 'check' : 'content-copy'} size={16} color={copied ? 'var(--m-accent)' : 'var(--m-ink-4)'} />
            </button>
            <div className="mx-4 h-px bg-line-2" />
            <div className="px-4 py-3">
              <span className="m-cap block">{t('profile.email')}</span>
              <span className="block truncate text-[13px] text-ink-2" data-testid="profile-email">
                {email ?? '—'}
              </span>
            </div>
          </div>
        )}
        {identity?.kind === 'user' && <EmailLoader onEmail={setEmail} sub={identity.sub} />}

        {/* identity-level danger zone (user request: these belong to the
            PROFILE, not app settings) — always last on the screen */}
        {/* logged-in devices moved to Global settings (#159): they are an
            app-wide concern, not an identity act */}
        {identity?.kind === 'user' && (
          <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface">
            <Row
              testId="settings-go-offline"
              icon="wifi-off"
              title={t('goOffline.title')}
              sub={t('goOffline.rowSub')}
              onClick={() => void navigate({ to: '/settings/go-offline' })}
            />
            <button
              data-testid="settings-delete-account"
              onClick={() => {
                setDeleteTyped('');
                setDeleteError(false);
                setDeleteOpen(true);
              }}
              className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left text-[15px] text-negative"
            >
              <Icon name="account-remove-outline" size={20} />
              <span className="min-w-0 flex-1">
                <span className="block">{t('settings.deleteAccount')}</span>
                <span className="block text-[11px] text-ink-4">{t('settings.deleteAccountSub')}</span>
              </span>
            </button>
          </div>
        )}
        {identity?.kind === 'offline' && (
          <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface">
            <button
              data-testid="settings-delete-profile"
              onClick={() => setDeleteProfileOpen(true)}
              className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left text-[15px] text-negative"
            >
              <Icon name="account-remove-outline" size={20} />
              <span className="min-w-0 flex-1">
                <span className="block">{t('offline.deleteRow')}</span>
                <span className="block text-[11px] text-ink-4">{t('offline.deleteRowSub')}</span>
              </span>
            </button>
          </div>
        )}
      </div>

      {/* #160: snapshot feeds the same downscale path as the file input */}
      <WebcamCaptureSheet open={webcamOpen} onOpenChange={setWebcamOpen} onCapture={(file) => void onPhotoPicked(file)} />

      <DangerConfirmSheet
        open={deleteProfileOpen}
        onOpenChange={setDeleteProfileOpen}
        title={t('offline.deleteTitle')}
        body={t('offline.deleteBody', { name })}
        onConfirm={() => void deleteOfflineData()}
        testId="offline-delete"
      />

      {/* the point of no return: everything the design promises, spelled
          out, then a typed confirmation — no accidental taps. #307: while
          the deletion runs the sheet locks (busyNote) and narrates the
          stage instead of leaving the user staring at a dimmed button */}
      <Sheet
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('settings.deleteAccountTitle')}
        size="form"
        busyNote={deleteBusy ? t('settings.deleteBusyNote') : null}
      >
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-[13px] text-ink-2">{t('settings.deleteAccountBody')}</p>
          <p className="text-[12px] text-ink-3">{t('settings.deleteTypePrompt', { word: t('settings.deleteTypeWord') })}</p>
          <input
            data-testid="delete-account-input"
            value={deleteTyped}
            onChange={(e) => setDeleteTyped(e.target.value)}
            placeholder={t('settings.deleteTypeWord')}
            autoCapitalize="characters"
            disabled={deleteBusy}
            className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none disabled:opacity-40"
          />
          {deleteError && (
            <p className="text-[12px] text-negative" data-testid="delete-account-error">
              {t('settings.deleteFailed')}
            </p>
          )}
          {deleteBusy && (
            <p className="flex items-center gap-2 text-[12px] text-ink-2" data-testid="delete-account-progress">
              <span className="inline-flex animate-spin">
                <Icon name="loading" size={14} />
              </span>
              {deletePhase === 'local' ? t('settings.deleteBusyLocal') : t('settings.deleteBusyServer')}
            </p>
          )}
          <button
            data-testid="delete-account-confirm"
            disabled={deleteBusy || deleteTyped.trim().toUpperCase() !== t('settings.deleteTypeWord')}
            onClick={() => void deleteAccount()}
            className="m-tap h-12 rounded-input border-none bg-negative font-semibold text-white disabled:opacity-40"
          >
            {deleteBusy ? '…' : t('settings.deleteAccountConfirm')}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

/**
 * Offline profiles have no rate feed (zero network by design) — they
 * pin a manual rate per currency pair instead (currency plan CD2). One
 * input per currency this device actually holds accounts in.
 */
function ManualRatesEditor({ display }: Readonly<{ display: string }>) {
  const { t } = useLang();
  const { store } = useData();
  const accounts = useQuery(store, async () => (await store.allRows('account')).filter((a) => a.deleted === 0), []);
  const manual = useQuery(store, async () => readManualRates(store), []);
  const froms = [...new Set((accounts ?? []).map((a) => a.currency))].filter((c) => c && c !== display).sort((a, b) => a.localeCompare(b));
  if (froms.length === 0 || !manual) return null;

  const saveRate = async (from: string, raw: string) => {
    const next = { ...manual };
    const value = Number(raw.trim().replace(',', '.'));
    if (raw.trim() && Number.isFinite(value) && value > 0) next[`${from}>${display}`] = value;
    else delete next[`${from}>${display}`];
    await store.metaPut(MANUAL_RATES_META_KEY, next);
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="m-cap px-1">{t('profile.manualRates')}</div>
      <p className="-mt-1 px-1 text-[12px] leading-snug text-ink-4">{t('profile.manualRatesInfo', { currency: display })}</p>
      {froms.map((from) => (
        <label key={from} className="flex items-center gap-3 text-[13px] text-ink-2">
          <span className="w-24 font-mono">1 {from} =</span>
          <input
            data-testid={`manual-rate-${from}`}
            type="text"
            inputMode="decimal"
            defaultValue={manual[`${from}>${display}`] ?? ''}
            onBlur={(e) => void saveRate(from, e.target.value)}
            placeholder="0,00"
            className="h-10 w-28 rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
          <span className="font-mono text-ink-3">{display}</span>
        </label>
      ))}
    </div>
  );
}

/** resolves the login email from the OIDC id token (or the test subject) */
function EmailLoader({ onEmail, sub }: { onEmail: (email: string) => void; sub: string }) {
  useEffect(() => {
    if (!logtoConfigured) onEmail(sub);
  }, [onEmail, sub]);
  if (!logtoConfigured) return null;
  return <LogtoEmailLoader onEmail={onEmail} />;
}

function LogtoEmailLoader({ onEmail }: { onEmail: (email: string) => void }) {
  const { getIdTokenClaims } = useLogto();
  useEffect(() => {
    void getIdTokenClaims().then((claims) => {
      const value = claims?.email ?? claims?.username ?? claims?.sub;
      if (value) onEmail(value);
    });
  }, [getIdTokenClaims, onEmail]);
  return null;
}
