import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';
import { router } from '@/app/router';
import { isNativeApp, onNativePushTap } from '@/lib/platform';
import { buildNotification } from '@/sync/swNotifications';
import type { PushPayload } from '@/sync/swNotifications';

interface PwaState {
  needRefresh: boolean;
  /** apply the waiting service worker and reload */
  update: () => void;
  dismiss: () => void;
}

export const usePwa = create<PwaState>((set) => ({
  needRefresh: false,
  update: () => undefined,
  dismiss: () => set({ needRefresh: false }),
}));

export function initPwa(): void {
  initViewportHeightVar();
  // the native shell bundles the web assets in the binary — a service
  // worker there is pointless and its "new version" toast is a lie
  // (the real update is a store update). Native updates are prompted by
  // useNativeUpdateCheck instead.
  if (isNativeApp()) return;
  const updateSW = registerSW({
    onNeedRefresh() {
      usePwa.setState({ needRefresh: true, update: () => void updateSW(true) });
    },
  });
  initNotificationNav();
}

// only routes a notification may ever target — a whitelist keeps the
// worker message from steering the router anywhere else
const NOTIFICATION_TARGETS = ['/transactions', '/friends', '/spaces'] as const;
/** id shapes riding worker messages are validated before the router sees them */
const ID_SHAPE = /^[A-Za-z0-9_-]+$/;

/** window event re-broadcast when the worker receives a push while the
 *  app is open — screens with server-backed lists refresh on it */
export const PUSH_EVENT = 'munni-push';

/**
 * Worker → app messages. NAVIGATE deep-links notification clicks while
 * the app is already open (the worker can only focus a client, not
 * re-point its URL); PUSH re-broadcasts an incoming push as a window
 * event. Exported for tests.
 */
export function handleWorkerMessage(data: unknown): void {
  const message = data as { type?: string; url?: string; spaceId?: string } | undefined;
  if (message?.type === 'PUSH') {
    window.dispatchEvent(new Event(PUSH_EVENT));
    return;
  }
  if (message?.type !== 'NAVIGATE' || typeof message.url !== 'string') return;
  const path = message.url.split('#')[1]?.split('?')[0]; // './#/review?space=x' → '/review'
  // #132: a new-transactions tap lands in the ANNOUNCED space's review —
  // the space id rides the message (or the url query on cold starts)
  if (path === '/review') {
    const spaceId = message.spaceId ?? /[?&]space=([A-Za-z0-9_-]+)/.exec(message.url)?.[1];
    void router.navigate({
      to: '/review',
      search: spaceId && ID_SHAPE.test(spaceId) ? { space: spaceId } : {},
    });
    return;
  }
  const target = NOTIFICATION_TARGETS.find((route) => route === path);
  if (target) {
    void router.navigate({ to: target });
    return;
  }
  // budget alerts target their detail screen; the id shape is validated
  const budget = /^\/budgets\/([A-Za-z0-9_-]+)$/.exec(path ?? '');
  if (budget && budget[1] !== 'new') {
    void router.navigate({ to: '/budgets/$budgetId', params: { budgetId: budget[1] } });
  }
}

function initNotificationNav(): void {
  navigator.serviceWorker?.addEventListener('message', (event) => handleWorkerMessage(event.data));
  // §5: the native shell's notification taps ride the same bridge — the
  // FCM data payload maps to a target url exactly like the sw's clicks
  onNativePushTap((payload) => {
    const lang = localStorage.getItem('munni_lang') ?? 'en';
    const target = buildNotification(payload as PushPayload, lang);
    if (target?.url) handleWorkerMessage({ type: 'NAVIGATE', url: target.url, spaceId: target.pullSpaceId });
  });
}

/**
 * iOS viewport height, measured instead of trusted: 100dvh (and 100vh)
 * proved unreliable on iPhones — both left a dead band under the tab
 * bar. window.innerHeight is what WebKit actually renders: it tracks
 * Safari's toolbar collapse/expansion and — unlike
 * visualViewport.height — does NOT shrink when the keyboard overlays
 * the page. styles.css consumes the value as --vvh (iOS only).
 *
 * Installed (standalone) PWAs are the treacherous case: the viewport
 * settles AFTER launch without firing any resize event, so a single
 * boot-time measurement sticks at the launch-screen size and leaves a
 * dead band. Hence the extra signals and the timed boot re-measures.
 */
function initViewportHeightVar(): void {
  const apply = () => {
    // measured on-device (iPhone standalone, via the Settings diagnostics
    // overlay): inner = dvh = svh = visual < screen.height — the webview
    // does NOT cover the status bar band, so a screen.height fallback
    // overshoots and clips the tab bar. innerHeight is the truth.
    const height = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
    document.documentElement.style.setProperty('--vvh', `${height}px`);
  };
  apply();
  window.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('resize', apply);
  window.addEventListener('pageshow', apply); // bfcache restores skip load
  document.addEventListener('visibilitychange', apply); // standalone app-switch return
  window.addEventListener('orientationchange', () => setTimeout(apply, 250));
  for (const delay of [150, 500, 1000, 2500]) setTimeout(apply, delay);
}

/**
 * Ask the browser to flush the outbox when connectivity returns, even
 * if the app is killed meanwhile (Android's one-shot Background Sync;
 * iOS has no equivalent — there the outbox flushes on next open).
 */
export function requestOutboxSync(): void {
  void navigator.serviceWorker?.ready
    .then((registration) => {
      const syncable = registration as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      };
      return syncable.sync?.register('munni-outbox');
    })
    .catch(() => undefined); // unsupported/denied — normal on iOS
}
