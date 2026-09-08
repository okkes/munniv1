import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { LANGS, LANG_NAMES, useLang } from '@/i18n';
import type { Lang } from '@/i18n';
import { useData } from '@/app/data';
import { useSession } from '@/app/session';
import { apiFetch } from '@/lib/api';
import { downscaleImage } from '@/lib/image';
import { isNativeApp, pickPhotoNative } from '@/lib/platform';
import { COUNTRIES } from '@/domain/countries';
import { setPredictionCountry } from '@/domain/predictCategory';
import { AVATARS, Avatar } from '@/features/profile/ProfileScreen';
import { offlineProfileName, updateOfflineProfile } from './offlineProfiles';
import { biometricAvailable, hashPin, randomSalt, registerBiometric, validPin, writeLockConfig } from '@/features/lock/lock';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Chip } from '@/ui/primitives';
import { Highlight } from '@/ui/Highlight';
import { Icon } from '@/ui/Icon';
import { Flag, langFlagCode } from '@/ui/Flag';
import { Logo } from '@/ui/Logo';
import { Sheet } from '@/ui/Sheet';
import { SearchField } from '@/ui/SearchField';
import { WebcamCaptureSheet, useWebcamDoor } from '@/ui/WebcamCaptureSheet';

const countryLabel = (code: string, lang: Lang) => {
  const c = COUNTRIES.find((x) => x.code === code);
  return c ? c[lang] : code;
};

/**
 * First-run setup for new identities — online AND offline (user ruling):
 * display name (with the why), avatar (upload or preset), app language
 * (kept from the login pick, still changeable), country of use (feeds
 * category prediction — NOT nationality), then the app lock offer.
 * NOT skippable (user ruling) and shown without navigation chrome; the
 * bank/account step is gone — the guided tutorial owns that now.
 */
export function OnboardingScreen() {
  const { t, lang, setLang } = useLang();
  const { store, repo, spaceId } = useData();
  const identity = useSession((s) => s.identity);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [picture, setPicture] = useState<string>(AVATARS[0]);
  const [country, setCountry] = useState('NL');
  const countryTouched = useRef(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // #160: desktop-only webcam door beside the avatar upload
  const webcamDoor = useWebcamDoor();
  const [webcamOpen, setWebcamOpen] = useState(false);
  // step 1 = profile, step 2 = app lock; bank step retired (user ruling)
  const [step, setStep] = useState<1 | 2>(1);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [lockPin, setLockPin] = useState('');
  const [lockPin2, setLockPin2] = useState('');
  const [lockError, setLockError] = useState<string | null>(null);
  // #195: tappable — an invalid tap names the blocker (one flag per step)
  const [attempted, setAttempted] = useState(false);
  const [lockAttempted, setLockAttempted] = useState(false);

  useEffect(() => {
    void biometricAvailable().then(setBioAvailable);
  }, []);

  // signed-in users get an IP-based country DEFAULT (user ruling: only
  // here, never on the login screen — zero telemetry before consent);
  // an explicit pick always wins
  useEffect(() => {
    if (identity?.kind !== 'user') return;
    void apiFetch('/geo')
      .then(async (res) => (res.ok ? ((await res.json()) as { country?: string | null }) : null))
      .then((geo) => {
        if (geo?.country && !countryTouched.current && COUNTRIES.some((c) => c.code === geo.country)) {
          setCountry(geo.country);
        }
      })
      .catch(() => undefined);
  }, [identity]);

  // offline profiles already told us their name at creation — prefill,
  // don't re-ask from scratch
  useEffect(() => {
    if (identity?.kind === 'offline') {
      const existing = offlineProfileName(identity.profileId);
      if (existing) setName((v) => v || existing);
    }
  }, [identity]);

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setPicture(await downscaleImage(file));
  };

  const pickPhoto = () => {
    // #166: the Android shell's file input is gallery-only — the Camera
    // plugin's chooser answers there; null from it = the user cancelled,
    // never a reason to open the web input on top
    if (isNativeApp()) {
      void pickPhotoNative().then((file) => void onUpload(file ?? undefined));
      return;
    }
    fileRef.current?.click();
  };

  /** same shape as the settings flow: PIN is the fallback, biometrics
   *  best-effort — a cancelled prompt still yields a PIN-locked app */
  const enableLock = async () => {
    if (!validPin(lockPin)) {
      setLockError(t('lock.pinHint'));
      return;
    }
    if (lockPin !== lockPin2) {
      setLockError(t('lock.pinMismatch'));
      return;
    }
    const biometric = bioAvailable ? await registerBiometric() : null;
    const pinSalt = randomSalt();
    writeLockConfig({
      enabled: true,
      credentialId: biometric?.credentialId,
      biometricKind: biometric?.kind,
      pinSalt,
      pinHash: await hashPin(lockPin, pinSalt),
      timeoutSec: 60,
    });
    await finish();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COUNTRIES.filter((c) => !q || c[lang].toLowerCase().includes(q) || c.native.toLowerCase().includes(q));
  }, [query, lang]);

  /** step 1 done: persist the profile everywhere it matters */
  const applyProfile = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await store.metaPut('profile', { name: trimmed, picture, country });
    if (identity?.kind === 'user') {
      // best-effort: offline is fine, the app never blocks on the API
      void apiFetch('/me', { method: 'PUT', body: JSON.stringify({ displayName: trimmed, picture, country }) }).catch(
        () => undefined,
      );
    }
    if (identity?.kind === 'offline') updateOfflineProfile(identity.profileId, { name: trimmed, picture });
    // the personal space was auto-named before the user could type —
    // an offline rename here follows into it
    const space = await store.get('space', spaceId);
    if (space && identity?.kind === 'offline' && space.kind === 'personal') {
      await repo.upsert('space', spaceId, spaceId, { name: trimmed });
    }
    setPredictionCountry(country);
    // cleared here: leaving the app mid-flow must not loop onboarding
    await store.metaDelete('needsOnboarding');
    setAttempted(false);
    setStep(2);
  };

  const finish = async () => {
    // Mina takes over IMMEDIATELY after the form (user ruling: no
    // opt-in card, no Home in between) — once per identity
    const pending = (await store.metaGet('minaTutorialPending'))?.value;
    const done = (await store.metaGet('minaTutorialDone'))?.value;
    if (pending && !done) {
      await store.metaDelete('minaTutorialPending');
      await store.metaPut('minaTutorialState', { active: true, step: 0, ledger: [] });
      window.dispatchEvent(new Event('mina:start'));
    }
    await navigate({ to: '/home' });
  };

  return (
    <div className="m-fade flex h-full flex-col items-center overflow-y-auto px-6" data-testid="screen-onboarding">
      <div className="flex w-full max-w-[420px] flex-col pb-8">
        {/* desktop: hug the top instead of floating mid-window (user ss) */}
        <div className="flex flex-col items-center pt-10 pb-6 text-center lg:pt-4">
          <Logo size={32} />
          <h1 className="m-h2 mt-4 text-ink">{t('onboarding.title')}</h1>
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-3">
            {/* avatar: upload or preset (user request) */}
            <div className="flex flex-col items-center gap-2 pb-1">
              <Avatar picture={picture} size={72} />
              <div className="flex flex-wrap items-center justify-center gap-1.5" data-testid="onboarding-avatars">
                {AVATARS.slice(0, 6).map((preset, i) => (
                  <button
                    key={preset}
                    data-testid={`onboarding-avatar-${i}`}
                    aria-label={t('onboarding.avatarTitle')}
                    onClick={() => setPicture(preset)}
                    className={`m-tap rounded-full border-2 bg-transparent p-0.5 ${picture === preset ? 'border-accent' : 'border-transparent'}`}
                  >
                    <Avatar picture={preset} size={34} />
                  </button>
                ))}
                <button
                  data-testid="onboarding-avatar-upload"
                  onClick={pickPhoto}
                  className="m-tap flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-line bg-surface"
                >
                  <Icon name="camera-plus-outline" size={17} color="var(--m-ink-3)" />
                </button>
                {/* #160: desktop webcam snapshot — mirrors the upload dot */}
                {webcamDoor && (
                  <button
                    data-testid="onboarding-avatar-webcam"
                    aria-label={t('webcam.use')}
                    title={t('webcam.use')}
                    onClick={() => setWebcamOpen(true)}
                    className="m-tap flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-line bg-surface"
                  >
                    <Icon name="camera-outline" size={17} color="var(--m-ink-3)" />
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" hidden data-testid="onboarding-avatar-file" onChange={(e) => void onUpload(e.target.files?.[0])} />
              </div>
            </div>

            <div className="m-cap px-1">{t('profile.displayName')}</div>
            <input
              data-testid="onboarding-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('profile.displayName')}
              aria-invalid={attempted && !name.trim()}
              className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && !name.trim())}`}
            />
            {/* #195 r2 (user): the blocker sits AT the field */}
            <FormBlockerNote show={attempted && !name.trim()} text={t('form.needName')} testId="onboarding-save-blocker" />
            {/* the WHY, kept short (user request): offline nobody else
                ever sees the name; online it's the face others see */}
            <p className="px-1 text-[12px] leading-snug text-ink-4">
              {t(identity?.kind === 'offline' ? 'onboarding.nameInfoOffline' : 'onboarding.nameInfoOnline')}
            </p>

            <div className="m-cap px-1 pt-1">{t('onboarding.langTitle')}</div>
            <div className="flex gap-2" data-testid="onboarding-langs">
              {LANGS.map((code) => (
                <Chip key={code} testId={`onboarding-lang-${code}`} selected={lang === code} onClick={() => setLang(code)}>
                  <Flag code={langFlagCode(code)} size={16} className="mr-1" />
                  {LANG_NAMES[code]}
                </Chip>
              ))}
            </div>

            <div className="m-cap px-1 pt-1">{t('onboarding.countryLabel')}</div>
            <button
              data-testid="onboarding-country"
              onClick={() => setCountryOpen(true)}
              className="m-tap flex h-12 w-full items-center gap-3 rounded-input border border-line bg-surface px-4 text-left text-[15px] text-ink"
            >
              <Flag code={country} size={20} />
              <span className="flex-1">{countryLabel(country, lang)}</span>
              <Icon name="chevron-down" size={18} color="var(--m-ink-4)" />
            </button>
            {/* NOT nationality — it tunes the category predictor */}
            <p className="px-1 text-[12px] leading-snug text-ink-4" data-testid="onboarding-country-info">
              {t('onboarding.countryInfo')}
            </p>

            <Button
              data-testid="onboarding-save"
              onClick={() => {
                if (!name.trim()) {
                  setAttempted(true);
                  return;
                }
                void applyProfile();
              }}
            >
              {t('login.continue')}
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3" data-testid="onboarding-lock-step">
            <div className="flex flex-col items-center gap-2 pb-2 text-center">
              <Icon name="shield-lock-outline" size={36} color="var(--m-accent)" />
              <h2 className="m-h3 text-ink">{t('onboarding.lockTitle')}</h2>
              <p className="max-w-[300px] text-[13px] text-ink-3">
                {t(bioAvailable ? 'onboarding.lockSub' : 'onboarding.lockSubPinOnly')}
              </p>
            </div>
            <input
              data-testid="onboarding-lock-pin"
              type="password"
              inputMode="numeric"
              value={lockPin}
              onChange={(e) => {
                setLockPin(e.target.value);
                setLockError(null);
              }}
              placeholder={t('lock.pinLabel')}
              aria-invalid={lockAttempted && !lockPin}
              className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(lockAttempted && !lockPin)}`}
            />
            <FormBlockerNote show={lockAttempted && !lockPin} text={t('form.needFields')} testId="onboarding-lock-enable-blocker" />
            <input
              data-testid="onboarding-lock-pin2"
              type="password"
              inputMode="numeric"
              value={lockPin2}
              onChange={(e) => {
                setLockPin2(e.target.value);
                setLockError(null);
              }}
              placeholder={t('lock.pinConfirm')}
              aria-invalid={lockAttempted && !lockPin2}
              className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(lockAttempted && !lockPin2)}`}
            />
            <FormBlockerNote
              show={lockAttempted && !!lockPin && !lockPin2}
              text={t('form.needFields')}
              testId="onboarding-lock-enable-blocker"
            />
            {lockError && (
              <p className="text-[12px] text-negative" data-testid="onboarding-lock-error">
                {lockError}
              </p>
            )}
            <Button
              data-testid="onboarding-lock-enable"
              onClick={() => {
                if (!lockPin || !lockPin2) {
                  setLockAttempted(true);
                  return;
                }
                void enableLock();
              }}
            >
              <Icon name={bioAvailable ? 'fingerprint' : 'lock-outline'} size={18} />
              {t('lock.setup')}
            </Button>
            {/* skippable — and the note says WHERE it lives later */}
            <Button variant="ghost" data-testid="onboarding-lock-later" onClick={() => void finish()}>
              {t('onboarding.lockLater')}
            </Button>
          </div>
        )}
      </div>

      {/* #160: snapshot feeds the same downscale path as the file input */}
      <WebcamCaptureSheet open={webcamOpen} onOpenChange={setWebcamOpen} onCapture={(file) => void onUpload(file)} />

      <Sheet open={countryOpen} onOpenChange={setCountryOpen} title={t('onboarding.countryLabel')} size="tall" dragHandle>
        <SearchField
          testId="onboarding-country-search"
          value={query}
          onChange={setQuery}
          placeholder={t('onboarding.countrySearch')}
          className="mb-2"
        />
        {filtered.map((c) => (
          <button
            key={c.code}
            data-testid={`onboarding-country-${c.code}`}
            onClick={() => {
              countryTouched.current = true;
              setCountry(c.code);
              setCountryOpen(false);
              setQuery('');
            }}
            className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-1 py-2.5 text-left text-[14px] text-ink"
          >
            <Flag code={c.code} size={20} />
            <span className="flex-1">
              <Highlight text={c[lang]} query={query} />
            </span>
          </button>
        ))}
      </Sheet>
    </div>
  );
}
