// Runtime-config overlay for the admin console — same contract as the web
// app: /runtime-config.js sets window.__MUNNI_CONFIG__ and it wins over
// the baked Vite env, key by key.
import { afterEach, describe, expect, it, vi } from 'vitest';

type Overlay = Partial<Record<string, string>>;

const withOverlay = async (overlay: Overlay | undefined) => {
  vi.resetModules();
  const host = globalThis as { __MUNNI_CONFIG__?: Overlay };
  if (overlay) host.__MUNNI_CONFIG__ = overlay;
  else delete host.__MUNNI_CONFIG__;
  return import('./config');
};

afterEach(() => {
  delete (globalThis as { __MUNNI_CONFIG__?: Overlay }).__MUNNI_CONFIG__;
});

describe('admin runtime config overlay', () => {
  it('falls back to the baked defaults without an overlay', async () => {
    const { config, glitchtipDsn } = await withOverlay(undefined);
    expect(config.apiUrl).toBe('http://localhost:8180');
    expect(config.logtoEndpoint).toBe('');
    expect(glitchtipDsn).toBe('');
  });

  it('prefers runtime values over the baked ones', async () => {
    const { config, glitchtipDsn } = await withOverlay({
      API_URL: 'https://munni-iac-api.example.test',
      LOGTO_ENDPOINT: 'https://logto-iac.example.test',
      LOGTO_APP_ID: 'iac-admin-app',
      LOGTO_RESOURCE: 'https://munni-iac-api.example.test',
      GLITCHTIP_DSN: 'https://key@glitchtip-iac.example.test/2',
    });
    expect(config).toEqual({
      apiUrl: 'https://munni-iac-api.example.test',
      logtoEndpoint: 'https://logto-iac.example.test',
      logtoAppId: 'iac-admin-app',
      logtoResource: 'https://munni-iac-api.example.test',
    });
    expect(glitchtipDsn).toBe('https://key@glitchtip-iac.example.test/2');
  });

  it('treats empty-string overlay values as unset', async () => {
    const { config } = await withOverlay({ API_URL: '' });
    expect(config.apiUrl).toBe('http://localhost:8180');
  });
});
