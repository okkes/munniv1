import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import * as Sentry from '@sentry/react';

import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/source-serif-4/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import '@fontsource-variable/comfortaa/index.css';
import '@mdi/font/css/materialdesignicons.min.css';
import '@/ui/styles.css';

import { LangProvider } from '@/i18n';
import { config } from '@/app/config';
import { useSession } from '@/app/session';
import { initPwa } from '@/app/pwa';
import { initDeepLinks } from '@/lib/platform';
import { installViewportGuard } from '@/lib/viewportGuard';
import { initPressFeedback } from '@/app/pressFeedback';
import { ThemeProvider } from '@/app/theme';
import { router } from '@/app/router';
import { CallbackScreen, LogtoAppProvider, isCallbackPath } from '@/features/auth/logto';
import { GcCallbackScreen } from '@/features/accounts/BankConnect';
import { LockScreen } from '@/features/lock/LockScreen';
import { initLockWatcher, useLock } from '@/features/lock/lock';
import { UpdateToast } from '@/ui/UpdateToast';

const isGcCallbackPath = window.location.pathname.includes('/gc-callback');
// split invites are REAL paths now (OS link matching never sees a #
// fragment) — bounce into the hash router before anything renders
if (window.location.pathname.startsWith('/splits/join/')) {
  window.location.replace(`${window.location.origin}/#${window.location.pathname}`);
}
// native auth/logout returns that landed in the BROWSER (universal link
// not taken — old build, verification pending): bounce into the app via
// the channel's scheme, carrying the path + query for the code exchange
if (window.location.pathname.startsWith('/native-auth') || window.location.pathname.startsWith('/native-signed-out')) {
  window.location.replace(`${config.nativeScheme}://${window.location.pathname.slice(1)}${window.location.search}`);
}

// Chosen-offline identities (demo / offline mode) promise ZERO network
// traffic — not even crash reports. Signed-in users who merely lost
// connectivity are different: their reports queue locally and flush
// once the network returns (offline transport below).
const isZeroNetworkIdentity = () => {
  const kind = useSession.getState().identity?.kind;
  return kind === 'demo' || kind === 'offline';
};

// error monitoring: GlitchTip speaks the Sentry protocol; no-op when unset
if (config.glitchtipDsn) {
  Sentry.init({
    dsn: config.glitchtipDsn,
    release: `munni-web@${String(__BUILD_NUMBER__)}`,
    // financial app: never send request/response bodies or user input
    sendDefaultPii: false,
    // errors only: the session ping (fires at init, before any identity
    // check could run) and outcome client reports would break the
    // zero-network promise, and we don't use release health anyway
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'BrowserSession'),
    sendClientReports: false,
    // no connectivity ≠ no telemetry: queue in IndexedDB, flush when online
    transport: Sentry.makeBrowserOfflineTransport(Sentry.makeFetchTransport),
    // the offline transport reads OfflineTransportOptions, which the init
    // options type doesn't surface — hence the widened literal
    transportOptions: { flushAtStartup: true } as Partial<Parameters<typeof Sentry.makeFetchTransport>[0]>,
    // pure connectivity noise, not bugs: the browser's generic fetch
    // network errors (WebKit / Chromium / Firefox wording) fire whenever
    // the API or IdP is unreachable — offline is a supported state here
    ignoreErrors: [
      'Load failed',
      'Failed to fetch',
      'NetworkError when attempting to fetch resource',
      // store-teardown noise (GlitchTip 79/80/82): sign-out closes the
      // local store while the sync engine's in-flight queries settle —
      // these signatures only occur around that close and say nothing
      'DatabaseClosedError',
      'The connection was closed',
      /Connection to munni_\w+ not available/,
      /No available connection for database munni_\w+/,
    ],
    beforeSend: (event) => (isZeroNetworkIdentity() ? null : event),
  });
}

initPwa();
initLockWatcher();
initPressFeedback();
initDeepLinks(); // native shell only: munni:// callbacks re-enter here
installViewportGuard(); // iOS keyboard focus-scroll must never displace the shell

// OIDC / bank-consent redirects land outside the hash router
function AppEntry() {
  // the lock gates a signed-in session (and its callbacks); signed out
  // there is nothing to protect and login must stay reachable
  const locked = useLock((s) => s.locked);
  const identity = useSession((s) => s.identity);
  if (identity && locked) return <LockScreen />;
  if (isCallbackPath()) return <CallbackScreen />;
  if (isGcCallbackPath) return <GcCallbackScreen />;
  return <RouterProvider router={router} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <LangProvider>
        <LogtoAppProvider>
          <AppEntry />
          <UpdateToast />
        </LogtoAppProvider>
      </LangProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
