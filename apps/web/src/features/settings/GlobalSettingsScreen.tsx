import { useEffect, useState } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { apiFetch, getApiCapabilities } from '@/lib/api';
import { LOCALES, useLang } from '@/i18n';
import type { Lang } from '@/i18n';
import { useTheme } from '@/app/theme';
import type { ThemeMode } from '@/app/theme';
import { useData } from '@/app/data';
import { useSession } from '@/app/session';
import { TIPS_DISABLED_KEY, useTipsDisabled } from '@/features/help/tipsPref';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { Flag, langFlagCode } from '@/ui/Flag';
import { Pill, Row } from '@/ui/primitives';
import { useQuery } from '@/db/useQuery';
import { Avatar } from '@/features/profile/ProfileScreen';
import { Sheet } from '@/ui/Sheet';
import { disablePush, enablePush, pushEnabled, pushSupported } from '@/lib/push';
import { ExportSheet } from './ExportSheet';
import {
  biometricAvailable,
  hashPin,
  randomSalt,
  readLockConfig,
  registerBiometric,
  validPin,
  verifyBiometric,
  writeLockConfig,
} from '@/features/lock/lock';

const LANGS: { code: Lang; labelKey: 'lang.en' | 'lang.nl' | 'lang.tr'; badge: string }[] = [
  { code: 'en', labelKey: 'lang.en', badge: 'EN' },
  { code: 'nl', labelKey: 'lang.nl', badge: 'NL' },
  { code: 'tr', labelKey: 'lang.tr', badge: 'TR' },
];

/** who you are, everywhere — moved here from the Settings tab (user
 *  request: the profile is global, the Settings tab header is the space) */
function ProfileHeaderRow({ onClick }: Readonly<{ onClick: () => void }>) {
  const { t } = useLang();
  const { store } = useData();
  const profile = useQuery(
    store,
    async () => (await store.metaGet('profile'))?.value as { name?: string; picture?: string } | undefined,
    [],
  );
  return (
    <button
      data-testid="settings-profile-row"
      onClick={onClick}
      className="m-tap mb-4 flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5 text-left"
    >
      <Avatar picture={profile?.picture} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink">{profile?.name ?? t('profile.title')}</span>
        {/* no name yet → the title already says "Profile"; repeating it read
            as a bug ("Profiel / Profiel") — invite instead (§2L) */}
        <span className="block text-[12px] text-ink-3">{profile?.name ? t('profile.title') : t('profile.setupHint')}</span>
      </span>
      <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
    </button>
  );
}

/** #157: the appearance row taps through this cycle — a fixed order so
 *  repeated taps visit every mode and land back where they started */
export const NEXT_THEME_MODE: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };

/** three-state appearance control: light / dark / follow device */
function ThemeModeSwitch() {
  const { t } = useLang();
  const { mode, setMode } = useTheme();
  // #157: the row AROUND this switch cycles on tap (trailing renders
  // inside the row's button) — a precise segment pick must not bubble
  // up and ALSO advance the cycle
  const pick = (next: ThemeMode) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setMode(next);
  };
  const segCls = (active: boolean) =>
    `m-tap flex items-center justify-center px-2.5 py-1 ${
      active ? 'bg-accent-soft text-accent-deep' : 'text-ink-3'
    }`;
  return (
    // no group role (S6819): each segment is a labelled aria-pressed
    // button — the span is purely a visual frame
    // #327 r3 (user): the end segments own the frame's corners so the
    // inset focus ring follows the visible rounding
    <span className="flex shrink-0 overflow-hidden rounded-lg border border-line-2">
      <button
        type="button"
        data-testid="settings-theme-light"
        aria-label={t('settings.themeLight')}
        aria-pressed={mode === 'light'}
        onClick={pick('light')}
        className={`${segCls(mode === 'light')} rounded-l-lg`}
      >
        <Icon name="weather-sunny" size={15} />
      </button>
      <button
        type="button"
        data-testid="settings-theme-dark"
        aria-label={t('settings.themeDark')}
        aria-pressed={mode === 'dark'}
        onClick={pick('dark')}
        className={`${segCls(mode === 'dark')} border-x border-line-2`}
      >
        <Icon name="weather-night" size={15} />
      </button>
      <button
        type="button"
        data-testid="settings-theme-auto"
        aria-label={t('settings.followDevice')}
        aria-pressed={mode === 'system'}
        onClick={pick('system')}
        className={`${segCls(mode === 'system')} rounded-r-lg font-mono text-[11px] font-semibold`}
      >
        AUTO
      </button>
    </span>
  );
}

/**
 * Everything that is NOT scoped to a space lives here, behind a single
 * "Global settings" door on the Settings tab (user feedback: mixing
 * space-scoped and app-wide rows in one list was confusing).
 */

export function GlobalSettingsScreen() {
  const { t, lang, setLang, langOverridden, followDeviceLang } = useLang();
  const { theme, mode: themeMode, setMode: setThemeMode } = useTheme();
  const { store } = useData();
  const tipsOff = useTipsDisabled();
  const [langSheetOpen, setLangSheetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const identity = useSession((s) => s.identity);
  const navigate = useNavigate();
  const router = useRouter();
  const [gcAvailable, setGcAvailable] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [connections, setConnections] = useState<
    { gcAccountId: string; iban: string; lastFetchAt: string | null }[] | null
  >(null);
  const [vapidKey, setVapidKey] = useState('');
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [lockOn, setLockOn] = useState(() => readLockConfig() !== null);
  const [lockSheetOpen, setLockSheetOpen] = useState(false);
  const [lockPin, setLockPin] = useState('');
  const [lockPin2, setLockPin2] = useState('');
  const [lockTimeout, setLockTimeout] = useState(60);
  const [lockBioAvailable, setLockBioAvailable] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  // #195: tappable — an invalid tap names the blocker
  const [lockAttempted, setLockAttempted] = useState(false);
  useEffect(() => {
    if (identity?.kind !== 'user') return;
    void getApiCapabilities().then((caps) => {
      setGcAvailable(caps.gocardless);
      if (caps.push && caps.vapidPublicKey && pushSupported()) setVapidKey(caps.vapidPublicKey);
    });
    void pushEnabled().then(setPushOn);
  }, [identity?.kind]);

  // #282 (user): turning the lock OFF is a guarded act — the current
  // PIN (or the registered biometric) must answer first
  const [disarmOpen, setDisarmOpen] = useState(false);
  const [disarmPin, setDisarmPin] = useState('');
  const [disarmError, setDisarmError] = useState(false);
  const disarm = () => {
    writeLockConfig(null);
    setLockOn(false);
    setDisarmOpen(false);
  };
  const tryDisarmBiometric = async () => {
    const config = readLockConfig();
    if (config && (await verifyBiometric(config, t('lock.disarmTitle')))) disarm();
  };
  const onDisarmDigit = async (next: string) => {
    setDisarmPin(next);
    setDisarmError(false);
    const config = readLockConfig();
    if (!config || next.length < 4) return;
    if ((await hashPin(next, config.pinSalt)) === config.pinHash) {
      disarm();
    } else if (next.length >= 8) {
      setDisarmError(true);
    }
  };

  const toggleLock = async () => {
    if (lockOn) {
      setDisarmPin('');
      setDisarmError(false);
      setDisarmOpen(true);
      const config = readLockConfig();
      // the registered biometric answers hands-free where it exists
      if (config?.credentialId) void tryDisarmBiometric();
      return;
    }
    setLockPin('');
    setLockPin2('');
    setLockTimeout(60);
    setLockError(null);
    setLockAttempted(false);
    setLockBioAvailable(await biometricAvailable());
    setLockSheetOpen(true);
  };

  const saveLock = async () => {
    if (!validPin(lockPin)) return;
    if (lockPin !== lockPin2) {
      setLockError(t('lock.pinMismatch'));
      return;
    }
    // biometrics are best-effort: cancelled/unsupported leaves PIN-only
    const biometric = lockBioAvailable ? await registerBiometric() : null;
    const pinSalt = randomSalt();
    writeLockConfig({
      enabled: true,
      credentialId: biometric?.credentialId,
      biometricKind: biometric?.kind,
      pinSalt,
      pinHash: await hashPin(lockPin, pinSalt),
      timeoutSec: lockTimeout,
    });
    setLockOn(true);
    setLockSheetOpen(false);
  };

  const togglePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
      } else {
        setPushOn(await enablePush(vapidKey));
      }
    } finally {
      setPushBusy(false);
    }
  };

  const openConnections = () => {
    setConnectionsOpen(true);
    void apiFetch('/gocardless/connections')
      .then(async (res) => (res.ok ? setConnections(await res.json()) : setConnections([])))
      .catch(() => setConnections([]));
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-settings-global">
      <AppBar
        title={t('settings.global')}
        leading={
          <IconButton label={t('action.back')} testId="settingsglobal-back" onClick={() => router.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <ProfileHeaderRow onClick={() => void navigate({ to: '/profile' })} />
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {/* spaces moved here from the tab bar — day-to-day switching
              happens via the Home avatar, management is a settings task */}
          <Row testId="settings-spaces-row" icon="account-group-outline" title={t('screen.spaces')} onClick={() => void navigate({ to: '/spaces' })} />
          <Row testId="settings-accounts-row" icon="bank-outline" title={t('acct.financialAccounts')} onClick={() => void navigate({ to: '/accounts' })} />
          {identity?.kind === 'user' && (
            <Row testId="settings-friends-row" icon="account-multiple-outline" title={t('settings.friends')} onClick={() => void navigate({ to: '/friends' })} />
          )}
          {gcAvailable && (
            <Row testId="settings-connections-row" icon="bank-transfer" title={t('gc.connections')} onClick={openConnections} />
          )}
          {/* #159 (user): devices are an app-wide concern — moved here from
              the profile, which keeps only identity-level acts */}
          {identity?.kind === 'user' && (
            <Row
              testId="settings-devices-row"
              icon="devices"
              title={t('devices.title')}
              sub={t('devices.rowSub')}
              onClick={() => void navigate({ to: '/devices' })}
            />
          )}
          <Row
            testId="settings-language-row"
            icon="translate"
            title={t('settings.language')}
            trailing={
              <span className="rounded-md bg-bg-2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-3">
                {lang.toUpperCase()}
              </span>
            }
            onClick={() => setLangSheetOpen(true)}
          />
          {/* receipts moved to the space section (v3: they are a space
              view); the global door keeps the store CONNECTIONS */}
          <Row testId="settings-shopping-row" icon="storefront-outline" title={t('shop.title')} onClick={() => void navigate({ to: '/shopping' })} />
          {/* trust feature: munni reads your banks, so it also lets you leave */}
          <Row testId="settings-export-row" icon="download-outline" title={t('settings.exportData')} onClick={() => setExportOpen(true)} />
          <Row testId="settings-help-row" icon="school-outline" title={t('help.title')} onClick={() => void navigate({ to: '/help' })} />
          {vapidKey && (
            <Row
              testId="settings-push-toggle"
              icon={pushOn ? 'bell-ring-outline' : 'bell-outline'}
              title={t('settings.notifications')}
              sub={
                typeof Notification !== 'undefined' && Notification.permission === 'denied'
                  ? t('push.denied')
                  : t('push.sub')
              }
              chevron={false}
              disabled={pushBusy}
              trailing={
                <Pill tone={pushOn ? 'accent' : 'neutral'} testId="settings-push-state">
                  {pushOn ? 'ON' : 'OFF'}
                </Pill>
              }
              onClick={() => void togglePush()}
            />
          )}
          <Row
            testId="settings-lock-toggle"
            icon={lockOn ? 'lock' : 'lock-open-variant-outline'}
            title={t('lock.title')}
            sub={t('lock.sub')}
            chevron={false}
            trailing={
              <Pill tone={lockOn ? 'accent' : 'neutral'} testId="settings-lock-state">
                {lockOn ? 'ON' : 'OFF'}
              </Pill>
            }
            onClick={() => void toggleLock()}
          />
          <Row
            testId="settings-theme-toggle"
            icon={theme === 'dark' ? 'weather-night' : 'weather-sunny'}
            title={t('settings.appearance')}
            sub={themeMode === 'system' ? t('settings.followDevice') : undefined}
            chevron={false}
            trailing={<ThemeModeSwitch />}
            // #157 (user): the row itself is the quick cycle — the
            // segments stay the precise control (their clicks don't bubble)
            onClick={() => setThemeMode(NEXT_THEME_MODE[themeMode])}
          />
          <Row
            testId="settings-tips-toggle"
            icon={tipsOff ? 'help-circle' : 'help-circle-outline'}
            title={t('settings.hideTips')}
            sub={t('settings.hideTipsSub')}
            chevron={false}
            trailing={
              <Pill tone={tipsOff ? 'accent' : 'neutral'} testId="settings-tips-state">
                {tipsOff ? 'ON' : 'OFF'}
              </Pill>
            }
            onClick={() => void store.metaPut(TIPS_DISABLED_KEY, !tipsOff)}
          />
        </div>

        {/* go-offline + account deletion moved to the PROFILE screen
            (user request): they are about the identity, not app settings */}
      </div>

      {/* Bank connections status */}
      <Sheet open={connectionsOpen} onOpenChange={setConnectionsOpen} title={t('gc.connections')} size="form">
        <p className="pb-2 text-[12px] text-ink-3">{t('gc.connectSub')}</p>
        {connections === null && <div className="py-6 text-center text-sm text-ink-3">…</div>}
        {connections?.map((c) => (
          <div key={c.gcAccountId} className="flex items-center gap-3 border-b border-line-2 px-1 py-3 last:border-0">
            <Icon name="bank-check" size={22} color="var(--m-accent)" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[13px] text-ink">{c.iban}</span>
              <span className="block text-[12px] text-ink-3">
                {t('gc.lastSync')}:{' '}
                {c.lastFetchAt
                  ? new Date(c.lastFetchAt).toLocaleString(LOCALES[lang], {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : t('gc.never')}
              </span>
            </span>
          </div>
        ))}
      </Sheet>

      {/* App lock setup: backup PIN + re-lock timeout (+ biometrics when available) */}
      {/* #282: the disarm challenge — current PIN (auto-verifying like
          the lock screen) or the registered biometric */}
      <Sheet open={disarmOpen} onOpenChange={setDisarmOpen} title={t('lock.disarmTitle')} size="compact">
        <div className="flex flex-col gap-3 pt-1" data-testid="lock-disarm-sheet">
          <p className="text-[13px] leading-relaxed text-ink-2">{t('lock.disarmBody')}</p>
          <input
            data-testid="lock-disarm-pin"
            value={disarmPin}
            onChange={(e) => void onDisarmDigit(e.target.value.replaceAll(/\D/g, '').slice(0, 8))}
            inputMode="numeric"
            type="password"
            autoComplete="off"
            placeholder={t('lock.pinPlaceholder')}
            className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-center font-mono text-[18px] tracking-[0.4em] text-ink outline-none${disarmError ? ' ring-1 ring-negative' : ''}`}
          />
          {disarmError && (
            <p className="text-center text-[12px] text-negative" data-testid="lock-disarm-error">
              {t('lock.wrongPin')}
            </p>
          )}
          {readLockConfig()?.credentialId && (
            <Button variant="outline" data-testid="lock-disarm-bio" onClick={() => void tryDisarmBiometric()}>
              {t('lock.disarmBiometric')}
            </Button>
          )}
        </div>
      </Sheet>
      <Sheet open={lockSheetOpen} onOpenChange={setLockSheetOpen} title={t('lock.setup')} size="form">
        <div className="flex flex-col gap-3 pt-1">
          {!lockBioAvailable && <p className="text-[12px] text-ink-3">{t('lock.notSupported')}</p>}
          <input
            data-testid="lock-setup-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={lockPin}
            onChange={(e) => setLockPin(e.target.value.replaceAll(/\D/g, ''))}
            placeholder={t('lock.pinLabel')}
            aria-invalid={lockAttempted && !validPin(lockPin)}
            className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(lockAttempted && !validPin(lockPin))}`}
          />
          {/* #195 r2 (user): the blocker sits AT the field */}
          <FormBlockerNote show={lockAttempted && !validPin(lockPin)} text={t('form.needFields')} testId="lock-setup-save-blocker" />
          <input
            data-testid="lock-setup-pin2"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={lockPin2}
            onChange={(e) => setLockPin2(e.target.value.replaceAll(/\D/g, ''))}
            placeholder={t('lock.pinConfirm')}
            className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4"
          />
          <div className="m-cap px-1">{t('lock.timeout')}</div>
          <div className="flex gap-2">
            {[0, 60, 300, 900].map((seconds) => (
              <button
                key={seconds}
                data-testid={`lock-timeout-${seconds}`}
                onClick={() => setLockTimeout(seconds)}
                className={`m-tap flex-1 rounded-full border px-2 py-1.5 text-[11px] ${
                  lockTimeout === seconds
                    ? 'border-accent bg-accent-soft font-medium text-accent-deep'
                    : 'border-line bg-surface text-ink-2'
                }`}
              >
                {t(`lock.timeout.${seconds}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
          {lockError && (
            <p className="text-center text-[13px] text-negative" data-testid="lock-setup-error">
              {lockError}
            </p>
          )}
          <Button
            data-testid="lock-setup-save"
            onClick={() => {
              if (!validPin(lockPin)) {
                setLockAttempted(true);
                return;
              }
              void saveLock();
            }}
          >
            {t('action.save')}
          </Button>
        </div>
      </Sheet>

      <Sheet open={langSheetOpen} onOpenChange={setLangSheetOpen} title={t('lang.title')}>
        <div className="flex flex-col pt-1">
          {/* native-benefits §3: no pinned language = track the device */}
          <button
            data-testid="lang-option-device"
            onClick={() => {
              followDeviceLang();
              setLangSheetOpen(false);
            }}
            className="m-tap flex items-center gap-3 border-b border-line-2 border-none bg-transparent px-1 py-3.5 text-left text-[15px] text-ink"
          >
            <Icon name="cellphone-cog" size={18} color="var(--m-ink-3)" />
            <span className="flex-1">{t('settings.followDevice')}</span>
            {!langOverridden && <Icon name="check" size={18} color="var(--m-accent)" />}
          </button>
          {LANGS.map((entry) => (
            <button
              key={entry.code}
              data-testid={`lang-option-${entry.code}`}
              onClick={() => {
                setLang(entry.code);
                setLangSheetOpen(false);
              }}
              className="m-tap flex items-center gap-3 border-none bg-transparent px-1 py-3.5 text-left text-[15px] text-ink"
            >
              <Flag code={langFlagCode(entry.code)} size={20} />
              <span className="flex-1">{t(entry.labelKey)}</span>
              {langOverridden && lang === entry.code && <Icon name="check" size={18} color="var(--m-accent)" />}
            </button>
          ))}
        </div>
      </Sheet>

      <ExportSheet open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}
