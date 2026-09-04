/**
 * Platform adapter seam (native-apps design N2): the ONE place web code
 * asks "am I inside the Capacitor shell?". Detection rides the injected
 * `window.Capacitor` global — the web bundle never imports
 * @capacitor/core, so web/PWA builds carry zero native code.
 */

import { publicOrigin } from '@/app/config';

interface CapacitorPluginListener {
  addListener?: (event: string, cb: (data: never) => void) => unknown;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    App?: CapacitorPluginListener & {
      getInfo?: () => Promise<{ build?: string; version?: string }>;
    };
    PushNotifications?: CapacitorPluginListener & {
      requestPermissions?: () => Promise<{ receive: string }>;
      register?: () => Promise<void>;
    };
    StatusBar?: {
      setStyle?: (options: { style: 'LIGHT' | 'DARK' }) => Promise<void>;
    };
    Camera?: {
      getPhoto?: (options: {
        resultType: string;
        source: string;
        quality: number;
        correctOrientation?: boolean;
      }) => Promise<{ base64String?: string; format?: string }>;
    };
    NativeBiometric?: {
      isAvailable?: () => Promise<{ isAvailable?: boolean }>;
      verifyIdentity?: (options: { reason?: string; title?: string }) => Promise<void>;
    };
    Haptics?: {
      notification?: (options: { type: 'SUCCESS' | 'WARNING' | 'ERROR' }) => Promise<void>;
    };
    Share?: {
      share?: (options: { title?: string; files?: string[] }) => Promise<unknown>;
    };
    Filesystem?: {
      writeFile?: (options: {
        path: string;
        data: string;
        directory: string;
        encoding?: string;
      }) => Promise<{ uri: string }>;
    };
  };
}

const capacitor = (): CapacitorGlobal | undefined =>
  (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;

export const isNativeApp = (): boolean => capacitor()?.isNativePlatform?.() === true;

/** iOS/iPadOS WebKit on ANY surface — Safari tab, installed PWA, the
 *  native shell. Mirrors react-modal-sheet's own platform test (#134)
 *  so opt-outs fire exactly where its iOS-only behaviors would. */
export const isIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /^iP(hone|ad|od)/i.test(platform) || (/^Mac/i.test(platform) && navigator.maxTouchPoints > 1);
};

/**
 * Web/PWA: ask the browser not to evict IndexedDB. Native: a no-op —
 * WebView storage is app-scoped application data, never evicted.
 */
export async function ensurePersistentStorage(): Promise<void> {
  if (isNativeApp()) return;
  await navigator.storage?.persist?.().catch(() => undefined);
}

/** munni://gc-callback?ref=… → /gc-callback?ref=… (null for foreign urls).
 *  Accepts channel-suffixed schemes too (munni-dev:// in the staging app). */
/** the https paths a verified App Link / universal link may hand us —
 *  a tight allowlist so nothing else ever routes into the shell */
const UNIVERSAL_LINK_PATHS = ['/gc-callback', '/splits/join/', '/native-auth', '/native-signed-out'];

export function deepLinkToPath(url: string): string | null {
  const match = /^munni(?:-\w+)?:\/\/([\w./-]*)(\?[^#]*)?/.exec(url);
  if (match) {
    const path = match[1].replace(/^\/+/, '');
    return `/${path}${match[2] ?? ''}`;
  }
  // universal links (UL2): the bank's https redirect / a split invite
  // opens the app directly — same in-app routes as the scheme form.
  // The allowed hosts derive from publicOrigin (config), not a literal:
  // the domain is a secret in this public repo. Channel siblings
  // (munni./munni-test. on the same parent) stay accepted.
  if (url.startsWith('https://')) {
    try {
      const parsed = new URL(url);
      const own = new URL(publicOrigin()).hostname;
      const parent = own.split('.').slice(1).join('.');
      const hostOk = parsed.hostname === own || (!!parent && parsed.hostname.endsWith(`.${parent}`));
      if (hostOk && UNIVERSAL_LINK_PATHS.some((prefix) => parsed.pathname.startsWith(prefix))) {
        return parsed.pathname + parsed.search;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** the untouched munni:// callback url — the OIDC code exchange must
 *  present EXACTLY the redirect_uri that was registered, not the
 *  webview's localhost translation of it */
export const NATIVE_CALLBACK_KEY = 'munni_native_callback';

/**
 * Native deep links (N3): bank-consent and auth callbacks arrive as
 * munni:// urls while the app runs. Both callback screens live OUTSIDE
 * the hash router on real paths, so a full navigation is the correct
 * (and simplest) re-entry — the shell serves index.html for any path.
 */
export function initDeepLinks(): void {
  if (!isNativeApp()) return;
  const app = capacitor()?.Plugins?.App;
  app?.addListener?.('appUrlOpen', (data: { url?: string }) => {
    const url = data.url ?? '';
    const path = deepLinkToPath(url);
    if (!path) return;
    if (path.startsWith('/auth-callback')) sessionStorage.setItem(NATIVE_CALLBACK_KEY, url);
    // https auth return (universal link — no popup): when the raw url is
    // https it IS the registered redirect_uri; a scheme-bounced fallback
    // stores the path form and the callback screen rebuilds the origin
    if (path.startsWith('/native-auth')) {
      sessionStorage.setItem(NATIVE_CALLBACK_KEY, url.startsWith('https:') ? url : path);
      globalThis.location.assign('/auth-callback');
      return;
    }
    if (path.startsWith('/native-signed-out')) {
      globalThis.location.assign('/#/login');
      return;
    }
    // the post sign-out landing: session is already cleared locally —
    // just bring the app to the login screen
    if (path.startsWith('/signed-out')) {
      globalThis.location.assign('/#/login');
      return;
    }
    // callbacks live on real paths outside the hash router; everything
    // else (app shortcuts like munni://review, §5) is a hash route
    const realPath = path.startsWith('/auth-callback') || path.startsWith('/gc-callback');
    globalThis.location.assign(realPath ? path : `/#${path}`);
  });
}

/**
 * Native status bar follows the app theme: without this, Android keeps
 * light (white) status-bar icons over munni's cream background and the
 * clock becomes invisible in light mode. The plugin's Style.Light means
 * "light BACKGROUND" (dark icons) — inverted from our theme name.
 */
export function syncNativeStatusBar(theme: 'light' | 'dark'): void {
  if (!isNativeApp()) return;
  void capacitor()?.Plugins?.StatusBar?.setStyle?.({ style: theme === 'dark' ? 'DARK' : 'LIGHT' })?.catch(() => undefined);
}

/** 'android' | 'ios' inside the shells, undefined on the web */
export const nativePlatform = (): string | undefined =>
  isNativeApp() ? capacitor()?.getPlatform?.() : undefined;

/** the shell binary's build number (git commit count), null on the web */
export async function getNativeAppBuild(): Promise<number | null> {
  const app = capacitor()?.Plugins?.App;
  if (!isNativeApp() || !app?.getInfo) return null;
  try {
    const info = await app.getInfo();
    const build = Number.parseInt(info.build ?? '', 10);
    return Number.isFinite(build) ? build : null;
  } catch {
    return null;
  }
}

/**
 * Native camera capture: the webview's <input capture> path crashes on
 * iOS and offers gallery-only on Android (user report), so the shells
 * use the Camera plugin instead. 'CAMERA' opens the camera directly
 * (receipts); 'PROMPT' shows the OS Camera-or-Photos chooser (#166 —
 * the generic upload sites). Returns a File ready for the existing
 * attach pipeline, or null when cancelled/unavailable.
 */
export async function takeNativePhoto(source: 'CAMERA' | 'PROMPT' = 'CAMERA'): Promise<File | null> {
  const camera = capacitor()?.Plugins?.Camera;
  if (!isNativeApp() || !camera?.getPhoto) return null;
  try {
    const photo = await camera.getPhoto({
      resultType: 'base64',
      source,
      quality: 80,
      correctOrientation: true,
    });
    if (!photo.base64String) return null;
    const bytes = Uint8Array.from(atob(photo.base64String), (c) => c.codePointAt(0) ?? 0);
    const format = photo.format ?? 'jpeg';
    return new File([bytes], `receipt.${format}`, { type: `image/${format}` });
  } catch {
    return null; // user cancelled or permission denied — the button stays usable
  }
}

/** #166: native Android's file input is gallery-only — route the tap
 *  through the Camera plugin's chooser; the web input stays for browsers.
 *  Callers must treat null differently per platform: native null = the
 *  user cancelled the chooser (do nothing), web null = not native at
 *  all (fall back to clicking the hidden file input). */
export async function pickPhotoNative(): Promise<File | null> {
  if (!isNativeApp()) return null;
  return takeNativePhoto('PROMPT');
}

/**
 * Native push registration (N4): resolves the FCM/APNs device token, or
 * null when not native / permission denied. Web push stays in lib/push.
 */
export async function getNativePushToken(): Promise<string | null> {
  const push = capacitor()?.Plugins?.PushNotifications;
  if (!isNativeApp() || !push?.register) return null;
  const permission = await push.requestPermissions?.();
  if (permission?.receive !== 'granted') return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 10_000); // registration never answered
    push.addListener?.('registration', (token: { value?: string }) => {
      clearTimeout(timer);
      resolve(token.value ?? null);
    });
    push.addListener?.('registrationError', () => {
      clearTimeout(timer);
      resolve(null);
    });
    void push.register?.();
  });
}

/**
 * Native biometric gate (native-benefits §1): the OS Face/Touch ID or
 * fingerprint prompt via the Capacitor plugin. WKWebView has no WebAuthn
 * platform authenticator, so the native shell uses this path while
 * web/PWA keeps WebAuthn (both behind the same lock.ts seam).
 */
export async function nativeBiometricAvailable(): Promise<boolean> {
  const biometric = capacitor()?.Plugins?.NativeBiometric;
  if (!isNativeApp() || !biometric?.isAvailable) return false;
  try {
    return (await biometric.isAvailable()).isAvailable === true;
  } catch {
    return false;
  }
}

/** true when the OS confirmed the user; false on cancel/mismatch/absence */
export async function nativeBiometricVerify(reason: string): Promise<boolean> {
  const biometric = capacitor()?.Plugins?.NativeBiometric;
  if (!biometric?.verifyIdentity) return false;
  try {
    await biometric.verifyIdentity({ reason, title: 'munni' });
    return true;
  } catch {
    return false;
  }
}

/**
 * §5 niceties — every helper no-ops (or returns false) outside the
 * native shell so web/PWA behavior is untouched.
 */

/** OS haptic tick on key confirmations (review confirm, budget alert) */
export function hapticNotify(type: 'SUCCESS' | 'WARNING' = 'SUCCESS'): void {
  if (!isNativeApp()) return;
  void capacitor()?.Plugins?.Haptics?.notification?.({ type })?.catch(() => undefined);
}

/**
 * Native share sheet for exports: writes the content to the app cache
 * and hands the file to the OS sheet (Files/mail/drive). false = not
 * native or share failed — callers fall back to the browser download.
 */
export async function shareNativeFile(fileName: string, content: string): Promise<boolean> {
  const plugins = capacitor()?.Plugins;
  if (!isNativeApp() || !plugins?.Filesystem?.writeFile || !plugins.Share?.share) return false;
  try {
    const written = await plugins.Filesystem.writeFile({
      path: fileName,
      data: content,
      directory: 'CACHE',
      encoding: 'utf8',
    });
    await plugins.Share.share({ title: fileName, files: [written.uri] });
    return true;
  } catch {
    return false; // user closed the sheet or the OS refused — download instead
  }
}

/**
 * Notification taps (§5): the shell's push plugin reports the tapped
 * notification; the payload rides FCM's data field as a JSON string.
 * The callback receives it parsed — pwa.ts routes it through the same
 * NAVIGATE bridge the service worker uses.
 */
export function onNativePushTap(callback: (payload: unknown) => void): void {
  if (!isNativeApp()) return;
  capacitor()?.Plugins?.PushNotifications?.addListener?.(
    'pushNotificationActionPerformed',
    (action: { notification?: { data?: { payload?: string } } }) => {
      const raw = action.notification?.data?.payload;
      if (!raw) return;
      try {
        callback(JSON.parse(raw));
      } catch {
        // malformed payload — ignore
      }
    },
  );
}
