// @vitest-environment happy-dom
// Runtime-config overlay: one public docker image serves every stack —
// /runtime-config.js (nginx entrypoint) sets window.__MUNNI_CONFIG__ and
// the app prefers it over the baked Vite env, per key. Baked values vary
// by machine (a developer's gitignored .env.local feeds import.meta.env),
// so the fallback specs compare against import.meta.env, never literals.
import { afterEach, describe, expect, it, vi } from 'vitest';

type Overlay = Partial<Record<string, string>>;

const withOverlay = async (overlay: Overlay | undefined) => {
  vi.resetModules();
  const host = globalThis as { __MUNNI_CONFIG__?: Overlay };
  if (overlay) host.__MUNNI_CONFIG__ = overlay;
  else delete host.__MUNNI_CONFIG__;
  return import('./config');
};

const env = import.meta.env as Record<string, string | undefined>;
const baked = (name: string): string => env[name] ?? '';

afterEach(() => {
  delete (globalThis as { __MUNNI_CONFIG__?: Overlay }).__MUNNI_CONFIG__;
});

describe('runtime config overlay', () => {
  it('falls back to build-time config when no overlay exists', async () => {
    const { config, logtoConfigured } = await withOverlay(undefined);
    expect(config.apiUrl).toBe(baked('VITE_API_URL') || (import.meta.env.DEV ? 'http://localhost:8180' : ''));
    expect(config.logto.endpoint).toBe(baked('VITE_LOGTO_ENDPOINT'));
    expect(config.logto.appId).toBe(baked('VITE_LOGTO_APP_ID'));
    expect(config.nativeScheme).toBe(
      baked('VITE_NATIVE_SCHEME') || (baked('VITE_CHANNEL') === 'staging' ? 'munni-dev' : 'munni'),
    );
    expect(logtoConfigured).toBe(Boolean(config.logto.endpoint && config.logto.appId));
  });

  it('prefers runtime values over the baked ones, key by key', async () => {
    const { config, logtoConfigured } = await withOverlay({
      API_URL: 'https://munni-iac-api.example.test',
      LOGTO_ENDPOINT: 'https://logto-iac.example.test',
      LOGTO_APP_ID: 'iac-web-app',
      LOGTO_RESOURCE: 'https://munni-iac-api.example.test',
      GLITCHTIP_DSN: 'https://key@glitchtip-iac.example.test/1',
    });
    expect(config.apiUrl).toBe('https://munni-iac-api.example.test');
    expect(config.logto).toEqual({
      endpoint: 'https://logto-iac.example.test',
      appId: 'iac-web-app',
      resource: 'https://munni-iac-api.example.test',
    });
    expect(config.glitchtipDsn).toBe('https://key@glitchtip-iac.example.test/1');
    expect(logtoConfigured).toBe(true);
  });

  it('derives the native scheme from the RUNTIME channel when no scheme is set', async () => {
    const { config } = await withOverlay({ CHANNEL: 'staging' });
    expect(config.channel).toBe('staging');
    // a baked VITE_NATIVE_SCHEME (native shells) still outranks the derivation
    expect(config.nativeScheme).toBe(baked('VITE_NATIVE_SCHEME') || 'munni-dev');
  });

  it('lets an explicit runtime scheme beat channel derivation and bake', async () => {
    const { config } = await withOverlay({ CHANNEL: 'staging', NATIVE_SCHEME: 'munni-iac' });
    expect(config.nativeScheme).toBe('munni-iac');
  });

  it('treats empty-string overlay values as unset', async () => {
    const bare = await withOverlay(undefined);
    const emptied = await withOverlay({ API_URL: '', LOGTO_ENDPOINT: '', GLITCHTIP_DSN: '' });
    expect(emptied.config).toEqual(bare.config);
  });

  it('publicOrigin: runtime overlay first, then bake, then the page origin', async () => {
    const withRuntime = await withOverlay({ PUBLIC_ORIGIN: 'https://munni-iac.example.test' });
    expect(withRuntime.publicOrigin()).toBe('https://munni-iac.example.test');
    const bare = await withOverlay(undefined);
    expect(bare.publicOrigin()).toBe(baked('VITE_PUBLIC_ORIGIN') || window.location.origin);
  });

  it('localCaUrl: only LOCAL native builds on the sslip family get the CA download', async () => {
    // a local build on the LAN family → the ca host of the same family
    const local = await withOverlay({
      NATIVE_SCHEME: 'munni-local',
      PUBLIC_ORIGIN: 'https://munni-prod.192-168-2-2.sslip.io',
    });
    expect(local.localCaUrl()).toBe('http://ca.192-168-2-2.sslip.io/root.crt');
    // per-env schemes count as local too
    const dev = await withOverlay({
      NATIVE_SCHEME: 'munni-local-dev',
      PUBLIC_ORIGIN: 'https://munni-dev.192-168-2-2.sslip.io',
    });
    expect(dev.localCaUrl()).toBe('http://ca.192-168-2-2.sslip.io/root.crt');
    // hosted builds and non-sslip origins stay silent
    const hosted = await withOverlay({ NATIVE_SCHEME: 'munni', PUBLIC_ORIGIN: 'https://munni.example.test' });
    expect(hosted.localCaUrl()).toBeNull();
    const localButHosted = await withOverlay({ NATIVE_SCHEME: 'munni-local', PUBLIC_ORIGIN: 'https://munni.example.test' });
    expect(localButHosted.localCaUrl()).toBeNull();
  });
});
