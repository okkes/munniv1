import React from 'react';
import ReactDOM from 'react-dom/client';
import { LogtoProvider, useHandleSignInCallback, useLogto } from '@logto/react';
import * as Sentry from '@sentry/react';
import { AdminApp } from './AdminApp';
import { config, glitchtipDsn } from './config';
import './styles.css';

if (glitchtipDsn) {
  Sentry.init({ dsn: glitchtipDsn, sendDefaultPii: false, sendClientReports: false });
}

const logtoConfigured = Boolean(config.logtoEndpoint && config.logtoAppId);

/** OIDC entry: sign in via Logto when configured, else test-auth sub input */
function Root() {
  if (!logtoConfigured) return <AdminApp config={config} getToken={null} />;
  return (
    <LogtoProvider
      config={{
        endpoint: config.logtoEndpoint,
        appId: config.logtoAppId,
        resources: config.logtoResource ? [config.logtoResource] : [],
      }}
    >
      <LogtoGate />
    </LogtoProvider>
  );
}

// Single-flight token fetch: reload() fires several /admin/* calls in
// parallel and Logto ROTATES refresh tokens — concurrent refreshes race and
// the loser's consumed token gets the whole grant revoked (the "invalid
// token, sign in again" loop). One in-flight fetch serves all callers.
let tokenInflight: Promise<string | undefined> | null = null;
function singleFlight(fetchToken: () => Promise<string | undefined>): Promise<string | undefined> {
  tokenInflight ??= fetchToken().finally(() => {
    tokenInflight = null;
  });
  return tokenInflight;
}

function LogtoGate() {
  const { isAuthenticated, isLoading, signIn, getAccessToken } = useLogto();
  const isCallback = window.location.pathname.endsWith('/auth-callback');
  if (isCallback) return <Callback />;
  if (isLoading) return <p className="center">…</p>;
  if (!isAuthenticated) {
    return (
      <div className="center">
        <button className="btn" onClick={() => void signIn(`${window.location.origin}/auth-callback`)}>
          Sign in
        </button>
      </div>
    );
  }
  return <AdminApp config={config} getToken={() => singleFlight(() => getAccessToken(config.logtoResource || undefined))} />;
}

function Callback() {
  useHandleSignInCallback(() => window.location.replace(window.location.origin));
  return <p className="center">…</p>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
