/// <reference lib="webworker" />
/* eslint-env serviceworker */
// Custom service worker (vite-plugin-pwa injectManifest): precaching like
// the old generateSW build, plus Web Push — a notification wakes the
// device so new bank transactions are announced even while the app is
// closed, and opening the notification lands in a freshly syncing app.
// Runtime glue only — the decisions live in sync/swNotifications (tested).
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { backgroundPull, flushOutbox } from '@/sync/swSync';
import { evaluateBudgetAlertsFromWorker } from '@/sync/swBudgets';
import { buildNotification, readWorkerLang } from '@/sync/swNotifications';
import type { PushPayload } from '@/sync/swNotifications';

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
// ignoreURLParametersMatching: the MDI icon font is referenced as
// …webfont.woff2?v=7.4.47 — with the default matcher that query defeats
// the precache lookup and the request goes to the network, which is why
// icons rendered as squares offline. Every precached asset is
// content-hashed, so matching URLs without their query is always safe.
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/.*/] });

// UpdateToast's reload button posts SKIP_WAITING (registerSW prompt mode)
self.addEventListener('message', (event) => {
  // defense-in-depth: only act on messages from same-origin clients (a
  // worker only ever receives them from pages it controls, but verify
  // the origin explicitly rather than trust it)
  if (event.origin && event.origin !== self.location.origin) return;
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('push', (event) => {
  const payload = (() => {
    try {
      return (event.data?.json() ?? {}) as PushPayload;
    } catch {
      return {} as PushPayload;
    }
  })();

  event.waitUntil(
    (async () => {
      // the notification first — iOS requires one per push event
      const lang = await readWorkerLang();
      const notification = buildNotification(payload, lang);
      if (!notification) return;
      await self.registration.showNotification(notification.title, {
        body: notification.body,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: notification.tag,
        data: { url: notification.url, spaceId: notification.pullSpaceId },
      });
      // open clients refresh their server-backed lists (notification
      // bell, members, invites) the moment a push lands
      const clientList = await self.clients.matchAll({ type: 'window' });
      for (const client of clientList) client.postMessage({ type: 'PUSH', payloadType: payload.type });

      if (!notification.pull) return;
      // …then pre-sync the announced data into IndexedDB while we're
      // awake, so opening the app (or the notification) starts hot.
      // Best-effort: an expired mirrored token just skips.
      try {
        await backgroundPull(notification.pullSpaceId);
        // budgets stay client-side (the server never learns them) — this
        // wake-up is the moment to warn about limits the new bank
        // transactions just crossed (budgets design P4)
        for (const alert of await evaluateBudgetAlertsFromWorker(notification.pullSpaceId, lang)) {
          await self.registration.showNotification(alert.title, {
            body: alert.body,
            icon: 'icon-192.png',
            badge: 'icon-192.png',
            tag: alert.tag,
            data: { url: alert.url },
          });
        }
      } catch {
        // offline again / server hiccup — the app syncs on next open
      }
    })(),
  );
});

// Android one-shot Background Sync: connectivity returned while the app
// is killed — flush queued local ops, then pull what we missed.
self.addEventListener('sync', (event: Event) => {
  const sync = event as Event & { tag?: string; waitUntil: (p: Promise<unknown>) => void };
  if (sync.tag !== 'munni-outbox') return;
  sync.waitUntil(
    (async () => {
      try {
        await flushOutbox();
        await backgroundPull();
      } catch {
        // the sync manager retries with backoff on rejection — but a
        // missing/expired session must NOT loop, hence catch-all here
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? './#/transactions';
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientList[0];
      // focusing (or opening) the app triggers its start-up sync,
      // pulling the announced transactions immediately
      if (existing) {
        // a focused client keeps its current screen — post the target so
        // the app's listener routes there (friend request → friends, …)
        existing.postMessage({ type: 'NAVIGATE', url });
        await existing.focus();
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
