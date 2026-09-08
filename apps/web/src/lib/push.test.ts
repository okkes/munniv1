// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api';
import { disablePush, enablePush, getPushSubscription, pushSupported } from './push';

vi.mock('./api', () => ({ apiFetch: vi.fn() }));
const apiFetchMock = vi.mocked(apiFetch);

interface FakeSubscription {
  endpoint: string;
  toJSON: () => { keys?: { p256dh?: string; auth?: string } };
  unsubscribe: () => Promise<boolean>;
}

/** installs the push-capable browser surface happy-dom lacks */
function installPushEnv(existing: FakeSubscription | null) {
  const subscription: FakeSubscription = existing ?? {
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existing),
    subscribe: vi.fn().mockResolvedValue(subscription),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { requestPermission: vi.fn().mockResolvedValue('granted') },
  });
  return { subscription, pushManager };
}

afterEach(() => {
  apiFetchMock.mockReset();
});

describe('push subscription management', () => {
  it('pushSupported is false on a bare environment', () => {
    expect(pushSupported()).toBe(false);
  });

  it('enablePush asks permission, subscribes and registers with the API', async () => {
    const { pushManager } = installPushEnv(null);
    apiFetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    expect(await enablePush('BPtestkey-_123')).toBe(true);
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.anything() }),
    );
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/me/push-subscriptions');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      endpoint: 'https://push.example/abc',
      p256dh: 'p',
      auth: 'a',
      lang: 'en', // the server localizes native/visible text per device
    });
  });

  it('enablePush is false when permission is denied — nothing subscribes', async () => {
    const { pushManager } = installPushEnv(null);
    (window.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('denied');
    expect(await enablePush('key')).toBe(false);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('disablePush removes the server row and unsubscribes the browser', async () => {
    const existing: FakeSubscription = {
      endpoint: 'https://push.example/old',
      toJSON: () => ({}),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    installPushEnv(existing);
    apiFetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    expect(await getPushSubscription()).toBe(existing);
    await disablePush();
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/me/push-subscriptions?endpoint=${encodeURIComponent('https://push.example/old')}`,
      { method: 'DELETE' },
    );
    expect(existing.unsubscribe).toHaveBeenCalled();
  });

  it('disablePush is a no-op without a subscription', async () => {
    installPushEnv(null);
    await disablePush();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe('pushEnabled (settings toggle source of truth)', () => {
  it('native: reads the stored FCM token, not the web subscription', async () => {
    localStorage.setItem('munni_fcm_token', 'tok-1');
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    try {
      const { pushEnabled } = await import('./push');
      expect(await pushEnabled()).toBe(true); // survives app kills — no SW involved
      localStorage.removeItem('munni_fcm_token');
      expect(await pushEnabled()).toBe(false);
    } finally {
      delete (globalThis as { Capacitor?: unknown }).Capacitor;
    }
  });
});
