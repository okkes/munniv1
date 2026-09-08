// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_CALLBACK_KEY, deepLinkToPath, ensurePersistentStorage, getNativePushToken, initDeepLinks, isNativeApp } from './platform';

type CapacitorStub = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
};

const setCapacitor = (stub: CapacitorStub | undefined) => {
  (globalThis as { Capacitor?: CapacitorStub }).Capacitor = stub;
};

afterEach(() => setCapacitor(undefined));

describe('platform seam', () => {
  // universal-link host checks derive from publicOrigin now (the real
  // domain is a secret) — pin it for the fixtures
  beforeEach(() => vi.stubEnv('VITE_PUBLIC_ORIGIN', 'https://munni.munni.example'));
  afterEach(() => vi.unstubAllEnvs());

  it('detects the shell only through the injected global', () => {
    expect(isNativeApp()).toBe(false);
    setCapacitor({ isNativePlatform: () => true });
    expect(isNativeApp()).toBe(true);
    setCapacitor({ isNativePlatform: () => false }); // capacitor serve (web)
    expect(isNativeApp()).toBe(false);
  });

  it('maps munni:// urls onto app paths and rejects foreign urls', () => {
    expect(deepLinkToPath('munni://gc-callback?ref=r-1&code=c-1')).toBe('/gc-callback?ref=r-1&code=c-1');
    expect(deepLinkToPath('munni://auth-callback?code=x')).toBe('/auth-callback?code=x');
    expect(deepLinkToPath('munni-dev://auth-callback?code=x')).toBe('/auth-callback?code=x'); // staging app scheme
    expect(deepLinkToPath('munni://')).toBe('/');
    expect(deepLinkToPath('https://evil.example/gc-callback')).toBeNull();
    expect(deepLinkToPath('intent://foo')).toBeNull();
  });

  it('universal links map allowed https paths and refuse everything else (UL2)', () => {
    expect(deepLinkToPath('https://munni.munni.example/gc-callback?ref=r-1')).toBe('/gc-callback?ref=r-1');
    expect(deepLinkToPath('https://munni-test.munni.example/splits/join/tok-1')).toBe('/splits/join/tok-1');
    // outside the allowlist: never routed into the shell
    expect(deepLinkToPath('https://munni.munni.example/auth-callback?code=x')).toBeNull();
    expect(deepLinkToPath('https://munni.munni.example/')).toBeNull();
    expect(deepLinkToPath('https://evil.example/splits/join/tok-1')).toBeNull();
  });

  it('an auth deep link stashes the RAW munni:// url for the code exchange', () => {
    sessionStorage.clear();
    const listeners: Record<string, (data: never) => void> = {};
    const assign = vi.fn();
    Object.defineProperty(globalThis, 'location', { value: { assign }, configurable: true });
    setCapacitor({
      isNativePlatform: () => true,
      Plugins: { App: { addListener: (event: string, cb: (data: never) => void) => (listeners[event] = cb) } },
    });
    initDeepLinks();

    listeners.appUrlOpen({ url: 'munni://auth-callback?code=abc&state=xyz' } as never);
    // the localhost translation drives the webview…
    expect(assign).toHaveBeenCalledWith('/auth-callback?code=abc&state=xyz');
    // …but the original url is kept so the SDK sees the real redirect_uri
    expect(sessionStorage.getItem(NATIVE_CALLBACK_KEY)).toBe('munni://auth-callback?code=abc&state=xyz');

    // a bank callback navigates but never stashes
    listeners.appUrlOpen({ url: 'munni://gc-callback?ref=r1' } as never);
    expect(assign).toHaveBeenLastCalledWith('/gc-callback?ref=r1');

    // §5 shortcuts: any other target is a hash route, not a real path
    listeners.appUrlOpen({ url: 'munni://review' } as never);
    expect(assign).toHaveBeenLastCalledWith('/#/review');
  });

  it('asks the browser to persist storage on web, never on native', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true });
    await ensurePersistentStorage();
    expect(persist).toHaveBeenCalledTimes(1);

    setCapacitor({ isNativePlatform: () => true });
    await ensurePersistentStorage();
    expect(persist).toHaveBeenCalledTimes(1); // native: untouched
  });

  it('resolves the native push token through the plugin events', async () => {
    const listeners = new Map<string, (data: unknown) => void>();
    setCapacitor({
      isNativePlatform: () => true,
      Plugins: {
        PushNotifications: {
          requestPermissions: () => Promise.resolve({ receive: 'granted' }),
          register: () => {
            queueMicrotask(() => listeners.get('registration')?.({ value: 'fcm-tok-1' }));
            return Promise.resolve();
          },
          addListener: (event: string, cb: (data: unknown) => void) => listeners.set(event, cb),
        },
      },
    });
    await expect(getNativePushToken()).resolves.toBe('fcm-tok-1');
  });

  it('yields null without the shell or without permission', async () => {
    await expect(getNativePushToken()).resolves.toBeNull();
    setCapacitor({
      isNativePlatform: () => true,
      Plugins: {
        PushNotifications: {
          requestPermissions: () => Promise.resolve({ receive: 'denied' }),
          register: () => Promise.resolve(),
          addListener: () => undefined,
        },
      },
    });
    await expect(getNativePushToken()).resolves.toBeNull();
  });
});

describe('§5 niceties seam', () => {
  it('haptics + share are strict no-ops on the web', async () => {
    setCapacitor(undefined);
    const { hapticNotify, shareNativeFile } = await import('./platform');
    expect(() => hapticNotify('SUCCESS')).not.toThrow();
    expect(await shareNativeFile('x.csv', 'a;b')).toBe(false);
  });

  it('native share writes to the cache and opens the OS sheet', async () => {
    const writeFile = vi.fn().mockResolvedValue({ uri: 'file:///cache/x.csv' });
    const share = vi.fn().mockResolvedValue({});
    setCapacitor({
      isNativePlatform: () => true,
      Plugins: { Filesystem: { writeFile }, Share: { share } },
    });
    const { shareNativeFile } = await import('./platform');
    expect(await shareNativeFile('x.csv', 'a;b')).toBe(true);
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'x.csv', directory: 'CACHE' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///cache/x.csv'] }));

    share.mockRejectedValue(new Error('dismissed'));
    expect(await shareNativeFile('x.csv', 'a;b')).toBe(false); // closing the sheet degrades to download
  });

  it('notification taps hand the PARSED payload to the bridge', async () => {
    const listeners: Record<string, (data: never) => void> = {};
    setCapacitor({
      isNativePlatform: () => true,
      Plugins: {
        PushNotifications: { addListener: (event: string, cb: (data: never) => void) => (listeners[event] = cb) },
      },
    });
    const { onNativePushTap } = await import('./platform');
    const seen: unknown[] = [];
    onNativePushTap((payload) => seen.push(payload));

    listeners.pushNotificationActionPerformed({
      notification: { data: { payload: '{"type":"new-transactions","count":3}' } },
    } as never);
    expect(seen).toEqual([{ type: 'new-transactions', count: 3 }]);

    listeners.pushNotificationActionPerformed({ notification: { data: { payload: 'not-json' } } } as never);
    expect(seen).toHaveLength(1); // malformed payloads are ignored
  });

  it('the shell build number parses from App.getInfo and fails soft', async () => {
    const { getNativeAppBuild, nativePlatform } = await import('./platform');
    expect(await getNativeAppBuild()).toBeNull(); // web: no shell
    expect(nativePlatform()).toBeUndefined();

    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: { App: { getInfo: () => Promise.resolve({ build: '412' }) } },
    } as never);
    expect(await getNativeAppBuild()).toBe(412);
    expect(nativePlatform()).toBe('ios');

    setCapacitor({
      isNativePlatform: () => true,
      Plugins: { App: { getInfo: () => Promise.resolve({ build: 'not-a-number' }) } },
    });
    expect(await getNativeAppBuild()).toBeNull();

    setCapacitor({
      isNativePlatform: () => true,
      Plugins: { App: { getInfo: () => Promise.reject(new Error('boom')) } },
    });
    expect(await getNativeAppBuild()).toBeNull();
  });

  it('native photo capture returns a File and degrades to null', async () => {
    const { takeNativePhoto } = await import('./platform');
    expect(await takeNativePhoto()).toBeNull(); // web: input capture path

    setCapacitor({
      isNativePlatform: () => true,
      Plugins: {
        Camera: { getPhoto: () => Promise.resolve({ base64String: btoa('img-bytes'), format: 'png' }) },
      },
    });
    const file = await takeNativePhoto();
    expect(file?.name).toBe('receipt.png');
    expect(file?.type).toBe('image/png');

    setCapacitor({
      isNativePlatform: () => true,
      Plugins: { Camera: { getPhoto: () => Promise.reject(new Error('cancelled')) } },
    });
    expect(await takeNativePhoto()).toBeNull();

    setCapacitor({
      isNativePlatform: () => true,
      Plugins: { Camera: { getPhoto: () => Promise.resolve({}) } },
    });
    expect(await takeNativePhoto()).toBeNull(); // no bytes returned
  });

  it('biometric availability reflects the plugin and fails closed', async () => {
    const { nativeBiometricAvailable } = await import('./platform');
    expect(await nativeBiometricAvailable()).toBe(false); // web

    setCapacitor({
      isNativePlatform: () => true,
      Plugins: { NativeBiometric: { isAvailable: () => Promise.resolve({ isAvailable: true }) } },
    });
    expect(await nativeBiometricAvailable()).toBe(true);

    setCapacitor({
      isNativePlatform: () => true,
      Plugins: { NativeBiometric: { isAvailable: () => Promise.reject(new Error('no hw')) } },
    });
    expect(await nativeBiometricAvailable()).toBe(false);
  });
});
