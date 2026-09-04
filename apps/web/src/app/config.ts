/**
 * App configuration: runtime overlay first, build-time Vite env second.
 *
 * The docker image bakes VITE_* values for the LIVE stacks at build time;
 * every other deployment of the SAME public image (the iac pair, a local
 * twin, a fork's self-host) overrides them through /runtime-config.js,
 * which the nginx entrypoint renders from MUNNI_* container env vars into
 * `window.__MUNNI_CONFIG__` (deploy/nginx/40-runtime-config.sh). The
 * committed public/runtime-config.js stub sets nothing, so dev servers,
 * native shells and env-less containers keep the baked behavior.
 */
type RuntimeKey =
  | 'API_URL'
  | 'LOGTO_ENDPOINT'
  | 'LOGTO_APP_ID'
  | 'LOGTO_RESOURCE'
  | 'GLITCHTIP_DSN'
  | 'CHANNEL'
  | 'NATIVE_SCHEME'
  | 'PUBLIC_ORIGIN';

const runtime = (key: RuntimeKey): string | undefined => {
  const overlay = (globalThis as { __MUNNI_CONFIG__?: Partial<Record<RuntimeKey, string>> }).__MUNNI_CONFIG__;
  // empty string means "not set" — the entrypoint only writes present vars
  return overlay?.[key] || undefined;
};

/** 'production' | 'staging' | '' (local dev) — shown in the Settings footer */
const channel = runtime('CHANNEL') ?? (import.meta.env.VITE_CHANNEL as string | undefined) ?? '';

export const config = {
  /** sync/API base URL; dev default matches deploy/docker-compose.test.yml */
  apiUrl:
    runtime('API_URL') ?? (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8180' : ''),
  logto: {
    endpoint: runtime('LOGTO_ENDPOINT') ?? (import.meta.env.VITE_LOGTO_ENDPOINT as string | undefined) ?? '',
    appId: runtime('LOGTO_APP_ID') ?? (import.meta.env.VITE_LOGTO_APP_ID as string | undefined) ?? '',
    /** API resource indicator, e.g. https://munni-api.<your-domain> */
    resource: runtime('LOGTO_RESOURCE') ?? (import.meta.env.VITE_LOGTO_RESOURCE as string | undefined) ?? '',
  },
  glitchtipDsn: runtime('GLITCHTIP_DSN') ?? (import.meta.env.VITE_GLITCHTIP_DSN as string | undefined) ?? '',
  channel,
  /** deep-link scheme of the app this bundle belongs to: 'munni' for
   *  production, 'munni-dev' for staging (app.munni.dev). Native shells
   *  bake VITE_NATIVE_SCHEME; the HOSTED web image never did — its
   *  /native-auth scheme-bounce fell back to 'munni' and sent munni-dev
   *  logins into the PROD app (user bug). The channel decides now. */
  nativeScheme:
    runtime('NATIVE_SCHEME') ??
    (import.meta.env.VITE_NATIVE_SCHEME as string | undefined) ??
    (channel === 'staging' ? 'munni-dev' : 'munni'),
};

export const logtoConfigured = Boolean(config.logto.endpoint && config.logto.appId);

/**
 * The canonical https origin of the HOSTED web app. Inside the native
 * shell `window.location.origin` is the local webview (localhost) —
 * useless as a bank redirect target — so shell builds set
 * VITE_PUBLIC_ORIGIN. Web/PWA builds fall back to their own origin.
 */
export const publicOrigin = (): string =>
  runtime('PUBLIC_ORIGIN') ?? (((import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined) ?? '') || window.location.origin);

/**
 * The family-CA download for LOCAL native builds, or null anywhere else.
 * Sign-in rides the SYSTEM browser, which does not inherit the app's
 * bundled trust anchor — the phone installs this root once (user
 * request 2026-08-31: a login-screen button instead of a remembered
 * url). Derived from the public origin: munni-<env>.<ip-dashed>.sslip.io
 * → http://ca.<ip-dashed>.sslip.io/root.crt
 */
export const localCaUrl = (): string | null => {
  if (!config.nativeScheme.startsWith('munni-local')) return null;
  let host = '';
  try {
    host = new URL(publicOrigin()).hostname;
  } catch {
    return null;
  }
  if (!host.endsWith('.sslip.io')) return null;
  return `http://ca.${host.split('.').slice(1).join('.')}/root.crt`;
};
