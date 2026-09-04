/**
 * Build-time configuration (Vite env). Everything is optional: without an
 * API URL the app is purely local (demo/offline identities only), without
 * Logto config the real sign-in buttons stay disabled.
 */
export const config = {
  /** sync/API base URL; dev default matches deploy/docker-compose.test.yml */
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8180' : ''),
  logto: {
    endpoint: (import.meta.env.VITE_LOGTO_ENDPOINT as string | undefined) ?? '',
    appId: (import.meta.env.VITE_LOGTO_APP_ID as string | undefined) ?? '',
    /** API resource indicator, e.g. https://munni-api.<your-domain> */
    resource: (import.meta.env.VITE_LOGTO_RESOURCE as string | undefined) ?? '',
  },
  glitchtipDsn: (import.meta.env.VITE_GLITCHTIP_DSN as string | undefined) ?? '',
  /** 'production' | 'staging' | '' (local dev) — shown in the Settings footer */
  channel: (import.meta.env.VITE_CHANNEL as string | undefined) ?? '',
  /** deep-link scheme of the app this bundle belongs to: 'munni' for
   *  production, 'munni-dev' for staging (app.munni.dev). Native shells
   *  bake VITE_NATIVE_SCHEME; the HOSTED web image never did — its
   *  /native-auth scheme-bounce fell back to 'munni' and sent munni-dev
   *  logins into the PROD app (user bug). The channel decides now. */
  nativeScheme:
    (import.meta.env.VITE_NATIVE_SCHEME as string | undefined) ??
    (((import.meta.env.VITE_CHANNEL as string | undefined) ?? '') === 'staging' ? 'munni-dev' : 'munni'),
};

export const logtoConfigured = Boolean(config.logto.endpoint && config.logto.appId);

/**
 * The canonical https origin of the HOSTED web app. Inside the native
 * shell `window.location.origin` is the local webview (localhost) —
 * useless as a bank redirect target — so shell builds set
 * VITE_PUBLIC_ORIGIN. Web/PWA builds fall back to their own origin.
 */
export const publicOrigin = (): string =>
  ((import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined) ?? '') || window.location.origin;
