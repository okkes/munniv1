import { apiFetch } from './api';
import { getCurrentLang } from '@/i18n';
import { getNativePushToken, isNativeApp } from './platform';

/**
 * Push subscription management. Only user identities subscribe —
 * demo/offline have no server to push from. Web/PWA: Web Push, rendered
 * by the service worker (src/sw.ts). Native shell: FCM/APNs device
 * tokens through the platform adapter — the server fans out per kind.
 */

/** the native shell remembers its device token so disable can unregister */
const FCM_TOKEN_KEY = 'munni_fcm_token';

// truthiness, not `in`: WebKit exposes the serviceWorker interface with
// an undefined getter inside the capacitor:// webview (GlitchTip iOS
// crash: "undefined is not an object (evaluating 'navigator.serviceWorker.ready')")
export const pushSupported = (): boolean =>
  isNativeApp() || (!!navigator.serviceWorker && 'PushManager' in window && 'Notification' in window);

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(raw, (c) => c.codePointAt(0)!);
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  // native has FCM/APNs tokens, never a web push subscription
  if (isNativeApp() || !navigator.serviceWorker || !pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * The settings toggle's source of truth. The native shell registers an
 * FCM token (kept in localStorage), NOT a web push subscription — the
 * old subscription check read OFF after every app kill on Android even
 * though pushes kept arriving (user report).
 */
export async function pushEnabled(): Promise<boolean> {
  if (isNativeApp()) return !!localStorage.getItem(FCM_TOKEN_KEY);
  return !!(await getPushSubscription());
}

/** asks permission, subscribes the browser and registers with the API */
export async function enablePush(vapidPublicKey: string): Promise<boolean> {
  if (isNativeApp()) {
    const token = await getNativePushToken();
    if (!token) return false;
    const response = await apiFetch('/me/push-subscriptions', {
      method: 'POST',
      // lang: the server localizes the native notification text per
      // device (iOS shows nothing for data-only pushes when closed)
      body: JSON.stringify({ kind: 'fcm', endpoint: token, lang: getCurrentLang() }),
    });
    if (response.ok) localStorage.setItem(FCM_TOKEN_KEY, token);
    return response.ok;
  }
  if (!pushSupported() || !navigator.serviceWorker) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));

  const json = subscription.toJSON();
  const response = await apiFetch('/me/push-subscriptions', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, lang: getCurrentLang() }),
  });
  return response.ok;
}

export async function disablePush(): Promise<void> {
  if (isNativeApp()) {
    const token = localStorage.getItem(FCM_TOKEN_KEY);
    if (!token) return;
    await apiFetch(`/me/push-subscriptions?endpoint=${encodeURIComponent(token)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
    localStorage.removeItem(FCM_TOKEN_KEY);
    return;
  }
  const subscription = await getPushSubscription();
  if (!subscription) return;
  await apiFetch(`/me/push-subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
    method: 'DELETE',
  }).catch(() => undefined);
  await subscription.unsubscribe();
}

