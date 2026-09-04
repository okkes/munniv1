import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from '@tanstack/react-router';
import { useLogto } from '@logto/react';
import { LANG_NAMES, LANGS, useLang } from '@/i18n';
import { localCaUrl, logtoConfigured } from '@/app/config';
import { useSession } from '@/app/session';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { Flag, langFlagCode } from '@/ui/Flag';
import { Logo } from '@/ui/Logo';
import { Sheet } from '@/ui/Sheet';
import { callbackUri } from './logto';
import { addOfflineProfile, listOfflineProfiles } from './offlineProfiles';
import { MINA_EXPR } from '@/features/mina/assets';

/**
 * Mina's fullscreen heads-up before a SECOND offline profile (arc 8, the
 * DebtHandoffInterstitial layout): profiles are fully separate worlds —
 * spaces INSIDE one profile are how family/business/private split.
 * Browser back = "go back" (standing rule).
 */
function ProfilesInterstitial({ onContinue, onBack }: Readonly<{ onContinue: () => void; onBack: () => void }>) {
  const { t } = useLang();
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    window.history.pushState({ minaProfiles: true }, '');
    const onPop = () => backRef.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex flex-col items-center justify-center overflow-y-auto bg-bg px-6"
      style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}
      data-testid="mina-profiles-ask"
    >
      <div className="flex w-full max-w-[420px] flex-col items-center text-center">
        <img src={MINA_EXPR.thinking} alt="Mina" className="max-h-[38dvh] w-auto max-w-[240px] rounded-2xl object-contain" />
        <p className="mt-5 text-[19px] font-semibold text-ink">{t('mina.profiles.t')}</p>
        <p className="mt-2 max-w-[360px] text-[14px] leading-relaxed text-ink-2">{t('mina.profiles.b')}</p>
        <div className="mt-6 flex w-full max-w-[360px] flex-col gap-2">
          <Button data-testid="mina-profiles-continue" onClick={onContinue}>
            {t('mina.profiles.continue')}
          </Button>
          <Button variant="outline" data-testid="mina-profiles-back" onClick={onBack}>
            {t('mina.profiles.back')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
import leafUrl from '@/assets/leaf.png';
import loginBgUrl from '@/assets/login-bg.png';
// re-encoded from the provided PNG (2.2MB) — the login screen is precached
import desktopBgUrl from '@/assets/desktop-login-bg.jpg';

/** live navigator.onLine with event updates */
function useOnLine(): boolean {
  const [onLine, setOnLine] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnLine(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return onLine;
}

/** real OIDC sign-in — only rendered when Logto is configured. Disabled
 *  without connectivity, with a line saying why (the silent dead button
 *  cost real head-scratching). */
function LogtoSignInButton({ onLine }: Readonly<{ onLine: boolean }>) {
  const { t } = useLang();
  const { signIn } = useLogto();
  return (
    <>
      <Button
        variant="primary"
        data-testid="login-signin-btn"
        disabled={!onLine}
        onClick={() => void signIn(callbackUri())}
      >
        {t('login.signIn')}
      </Button>
      {!onLine && (
        <p className="flex items-center justify-center gap-1.5 text-center text-[12px] text-ink-3" data-testid="login-offline-note">
          <Icon name="wifi-off" size={13} color="var(--m-warning)" />
          {t('login.offlineNote')}
        </p>
      )}
    </>
  );
}

/** compact top-right language pill (legacy parity); code badges, no flag
 *  emoji. The picker itself is the standard bottom Sheet now (user ss
 *  2026-08-01: this was the app's one remaining popover-style modal). */
function LangPill() {
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        data-testid="login-lang-trigger"
        onClick={() => setOpen(true)}
        className="m-tap flex items-center gap-1.5 rounded-full border border-line bg-surface py-1.5 pr-2.5 pl-3 text-[12px] font-semibold text-ink-2 shadow-[0_2px_12px_rgba(0,0,0,0.10)]"
      >
        <Flag code={langFlagCode(lang)} size={18} />
        {LANG_NAMES[lang]}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color="var(--m-ink-3)" />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={t('login.language')} size="compact">
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {LANGS.map((code) => (
            <button
              key={code}
              data-testid={`login-lang-${code}`}
              onClick={() => {
                setLang(code);
                setOpen(false);
              }}
              className="m-tap flex w-full items-center gap-2.5 border-b border-line-2 bg-transparent px-4 py-3 text-left text-[14px] text-ink last:border-0"
            >
              <Flag code={langFlagCode(code)} size={18} />
              <span className="flex-1">{LANG_NAMES[code]}</span>
              {lang === code && <Icon name="check" size={15} color="var(--m-accent)" />}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

/**
 * Login gate. With Logto configured there is exactly one real sign-in
 * button; without it, unavailable providers are hidden entirely (a grey
 * disabled wall reads as broken) and demo/offline lead.
 */
export function LoginScreen() {
  const { t } = useLang();
  const { login } = useSession();
  const navigate = useNavigate();
  const onLine = useOnLine();
  const caUrl = localCaUrl();
  // offline mode is two full sub-SCREENS now (user ruling: info first,
  // then profile on its own screen); login modes must honor the browser
  // back button — manual pushState + popstate, since /login is one route
  const [offlineView, setOfflineView] = useState<'intro' | 'profiles' | null>(null);
  const [profileName, setProfileName] = useState('');
  // #195: tappable — an invalid tap names the blocker
  const [attempted, setAttempted] = useState(false);
  // Mina's heads-up before minting a SECOND world (arc 8)
  const [profilesAsk, setProfilesAsk] = useState(false);
  const profiles = listOfflineProfiles();

  useEffect(() => {
    if (!offlineView) return;
    const onPop = () => setOfflineView((v) => (v === 'profiles' ? 'intro' : null));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [offlineView]);

  const openOffline = () => {
    window.history.pushState({ munniLogin: 'offline' }, '');
    setOfflineView('intro');
  };

  const openProfiles = () => {
    window.history.pushState({ munniLogin: 'offline-profiles' }, '');
    setAttempted(false);
    setOfflineView('profiles');
  };

  const enterDemo = () => {
    login({ kind: 'demo' });
    void navigate({ to: '/home' });
  };

  const enterOffline = (profileId: string) => {
    login({ kind: 'offline', profileId });
    void navigate({ to: '/home' });
  };

  const createOffline = () => {
    if (!profileName.trim()) return;
    // the 2nd+ profile gets Mina's fullscreen heads-up first (arc 8):
    // profiles are separate worlds — spaces split WITHIN one
    if (profiles.length > 0) {
      setProfilesAsk(true);
      return;
    }
    enterOffline(addOfflineProfile(profileName).id);
  };

  const confirmSecondProfile = () => {
    setProfilesAsk(false);
    enterOffline(addOfflineProfile(profileName).id);
  };

  if (offlineView === 'intro') {
    return (
      <div className="m-fade flex h-full flex-col overflow-y-auto bg-bg" data-testid="screen-offline-intro">
        <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col px-6 pb-[max(24px,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-1 pt-[max(12px,env(safe-area-inset-top))]">
            <button
              aria-label={t('action.back')}
              data-testid="offline-intro-back"
              onClick={() => window.history.back()}
              className="m-tap -ml-2 flex h-10 w-10 items-center justify-center border-none bg-transparent text-ink"
            >
              <Icon name="chevron-left" size={24} />
            </button>
          </div>
          <div className="flex flex-col items-center gap-2 pt-2 pb-5 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
              <Icon name="lock-outline" size={26} color="var(--m-accent-deep)" />
            </span>
            <h1 className="m-h2 text-ink">{t('offline.infoTitle')}</h1>
            <p className="max-w-[300px] text-sm text-ink-3">{t('offline.infoSubtitle')}</p>
          </div>

          <p className="pb-2 text-[12px] font-semibold tracking-wide text-ink-2 uppercase">{t('offline.keepTitle')}</p>
          <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface" data-testid="offline-keep-card">
            {(
              [
                ['shield-lock-outline', 'offline.keep1'],
                ['wallet-outline', 'offline.keep2'],
                ['fingerprint', 'offline.keep3'],
              ] as const
            ).map(([icon, key]) => (
              <div key={key} className="flex items-start gap-3 border-b border-line-2 px-4 py-3 last:border-0">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft">
                  <Icon name={icon} size={17} color="var(--m-accent-deep)" />
                </span>
                <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">{t(key)}</span>
              </div>
            ))}
          </div>

          <p className="pb-2 text-[12px] font-semibold tracking-wide text-ink-2 uppercase">{t('offline.loseTitle')}</p>
          <div className="mb-5 overflow-hidden rounded-card border border-line bg-surface" data-testid="offline-lose-card">
            {(
              [
                ['bank-off-outline', 'offline.lose1'],
                ['cloud-off-outline', 'offline.lose2'],
                ['account-group-outline', 'offline.lose3'],
              ] as const
            ).map(([icon, key]) => (
              <div key={key} className="flex items-start gap-3 border-b border-line-2 px-4 py-3 last:border-0">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-2">
                  <Icon name={icon} size={17} color="var(--m-ink-4)" />
                </span>
                <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-3">{t(key)}</span>
              </div>
            ))}
          </div>

          {/* right below the trade-off cards — mt-auto floated it to the
              bottom of tall desktop viewports (user ss 2026-08-01) */}
          <Button className="w-full" data-testid="offline-continue" onClick={openProfiles}>
            {t('offline.continueBtn')}
          </Button>
        </div>
      </div>
    );
  }

  if (offlineView === 'profiles') {
    return (
      <div className="m-fade flex h-full flex-col overflow-y-auto bg-bg" data-testid="screen-offline-profiles">
        <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col px-6 pb-[max(24px,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-1 pt-[max(12px,env(safe-area-inset-top))]">
            <button
              aria-label={t('action.back')}
              data-testid="offline-profiles-back"
              onClick={() => window.history.back()}
              className="m-tap -ml-2 flex h-10 w-10 items-center justify-center border-none bg-transparent text-ink"
            >
              <Icon name="chevron-left" size={24} />
            </button>
          </div>
          <div className="flex flex-col items-center gap-2 pt-2 pb-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
              <Icon name="account-lock-outline" size={26} color="var(--m-accent-deep)" />
            </span>
            {/* the headline follows reality (user ss): with no profile
                yet there is nothing to "choose" */}
            <h1 className="m-h2 text-ink">{t(profiles.length ? 'offline.chooseProfile' : 'offline.createProfileTitle')}</h1>
            {/* multiple worlds are allowed now (arc 8) — the hint says
                what a profile IS instead of forbidding a second one */}
            <p className="max-w-[300px] text-sm text-ink-3">{t(profiles.length ? 'offline.profilesHint' : 'offline.profileSub')}</p>
          </div>
          {profiles.length > 0 && (
            <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface" data-testid="offline-profiles">
              {/* deleting a profile moved to Settings → Profile (user
                  ruling 2026-07-29: consistent with the online account) */}
              {profiles.map((p) => (
                <button
                  key={p.id}
                  data-testid={`offline-profile-${p.id}`}
                  onClick={() => enterOffline(p.id)}
                  className="m-tap flex w-full min-w-0 items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left text-[15px] text-ink"
                >
                  <Icon name="account-lock-outline" size={19} color="var(--m-ink-3)" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
                </button>
              ))}
            </div>
          )}
          {/* the add row stays available — "Add another profile" (arc 8) */}
          <FormBlockerNote show={attempted && !profileName.trim()} text={t('form.needName')} testId="offline-create-blocker" className="pb-2" />
          <div className="flex gap-2">
            <input
              data-testid="offline-name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder={t('login.namePlaceholder')}
              aria-invalid={attempted && !profileName.trim()}
              className={`h-11 min-w-0 flex-1 rounded-input border border-line bg-surface px-4 text-[14px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && !profileName.trim())}`}
            />
            <Button
              size="sm"
              className="h-11"
              data-testid="offline-create"
              onClick={() => {
                if (!profileName.trim()) {
                  setAttempted(true);
                  return;
                }
                createOffline();
              }}
            >
              {t(profiles.length ? 'offline.addAnother' : 'offline.addProfile')}
            </Button>
          </div>
        </div>
        {profilesAsk && <ProfilesInterstitial onContinue={confirmSecondProfile} onBack={() => setProfilesAsk(false)} />}
      </div>
    );
  }

  return (
    <div className="m-fade relative flex h-full flex-col overflow-y-auto bg-bg md:flex-row md:overflow-hidden" data-testid="screen-login">
      {/* #122: in dark mode the OS status icons and the wordmark float
          over LIGHT hero art and drown — a top scrim buys them contrast.
          Light mode needs none: dark icons read on light art. */}
      <div
        aria-hidden="true"
        data-testid="login-top-scrim"
        className="pointer-events-none absolute inset-x-0 top-0 z-[5] hidden h-28 bg-gradient-to-b from-black/55 via-black/25 to-transparent dark:block"
      />
      {/* logo + language: overlays the hero on mobile, spans both panes on desktop */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pt-[max(12px,env(safe-area-inset-top))] md:px-8 md:pt-6">
        <div className="flex items-center gap-2.5">
          <img src={leafUrl} alt="" className="h-9 w-9 object-contain" />
          <Logo size={24} />
        </div>
        <LangPill />
      </div>

      {/* hero art: top band on mobile only — desktop gets the full-bleed backdrop */}
      <div className="relative flex max-h-[min(400px,44vh)] shrink-0 items-end overflow-hidden md:hidden">
        <img src={loginBgUrl} alt="" aria-hidden="true" className="block h-auto w-full" />
        {/* blend the art's edge into the paper background */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-bg" />
      </div>

      {/* desktop backdrop: the flat-lay is busy on the left and calm on the
          right, so the form card floats over the calm side */}
      <img
        src={desktopBgUrl}
        alt=""
        aria-hidden="true"
        data-testid="login-desktop-bg"
        className="pointer-events-none absolute inset-0 hidden h-full w-full object-cover object-left md:block"
      />

      {/* form pane */}
      <div className="relative flex flex-1 flex-col md:h-full md:items-end md:justify-center md:pr-[7vw]">
        <div className="flex flex-1 flex-col md:w-[440px] md:flex-none md:gap-2 md:rounded-3xl md:border md:border-line md:bg-surface/90 md:p-8 md:shadow-[0_16px_56px_rgba(0,0,0,0.14)] md:backdrop-blur-sm">
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center md:flex-none md:pb-6">
            <h1 className="m-h2 text-ink md:text-[32px]">{t('login.welcomeFirst')}</h1>
            <p className="max-w-[280px] text-sm text-ink-3">{t('login.subtitle')}</p>
          </div>

          <div className="flex flex-col gap-3 px-6 pb-4 md:w-[360px] md:px-0">
            {logtoConfigured && <LogtoSignInButton onLine={onLine} />}
            {logtoConfigured && (
              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-line" />
                <span className="text-xs text-ink-4">{t('login.or')}</span>
                <div className="h-px flex-1 bg-line" />
              </div>
            )}
            <Button variant={logtoConfigured ? 'outline' : 'primary'} onClick={enterDemo} data-testid="login-demo-btn">
              <Icon name="account-eye-outline" size={18} />
              {t('login.demoUser')}
            </Button>
            <Button variant="ghost" onClick={openOffline} data-testid="login-offline-btn">
              <Icon name="lock-outline" size={16} />
              {t('offline.loginBtn')}
            </Button>
            {/* LOCAL builds only: sign-in opens the system browser, which
                does not inherit the app's bundled trust anchor — one tap
                fetches the family root instead of a remembered url */}
            {caUrl && (
              <div className="pt-1 text-center">
                <button
                  data-testid="login-trust-ca"
                  onClick={() => window.open(caUrl, '_blank', 'noopener')}
                  className="m-tap inline-flex items-center gap-1.5 border-none bg-transparent text-[12px] font-medium text-ink-3 underline"
                >
                  <Icon name="certificate-outline" size={14} />
                  {t('login.trustCa')}
                </button>
                <p className="mt-1 text-[11px] leading-snug text-ink-4" data-testid="login-trust-ca-hint">
                  {t('login.trustCaHint')}
                </p>
              </div>
            )}
          </div>
        </div>

        <p className="px-6 pb-[max(24px,env(safe-area-inset-bottom))] text-center text-[11px] text-ink-4 md:w-[440px] md:px-0 md:pt-3 md:pb-0">
          {t('login.terms')}
        </p>
      </div>
    </div>
  );
}
