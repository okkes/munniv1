import { execFileSync } from 'node:child_process';
import { localAwareFetch } from './insecure-fetch.mjs';
import { lanHost, loadStack } from './stack.mjs';

/** LAN mode: the plain-http localhost twin of every https sslip origin
 * stays registered too, so browsing http://localhost:PORT keeps signing
 * in while phones and Enable Banking use the https hostnames */
const originVariants = (url, twinPort) => {
  if (!lanHost() || !url?.startsWith('https://') || !twinPort) return [url];
  return [url, `http://localhost:${twinPort}`];
};

/**
 * Logto-as-code for one IaC pair. Talks to the PAIR's own Logto
 * instance (never the live stacks') through the one operator-created
 * "infra" M2M credential. Upserts by app name, writes the resulting
 * ids back to each stack's GitHub Environment variables under the
 * SAME names the workflows already read.
 */

const MGMT_RESOURCE = 'https://default.logto.app/api';

async function mgmtToken(logtoUrl, m2mId, m2mSecret) {
  const res = await localAwareFetch(`${logtoUrl}/oidc/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${m2mId}:${m2mSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', resource: MGMT_RESOURCE, scope: 'all' }),
  });
  if (!res.ok) throw new Error(`logto token failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function api(logtoUrl, token, path, init = {}) {
  const res = await localAwareFetch(`${logtoUrl}/api${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`logto ${init.method ?? 'GET'} ${path} failed (${res.status}): ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** the app definitions one STACK needs (SPA web+admin, native, m2m) —
 * the redirect URIs mirror what the APPS really send (found live
 * 2026-08-26 as oidc.invalid_redirect_uri): both SPAs redirect to
 * `origin + /auth-callback` (features/auth/logto.tsx callbackUri, admin
 * main.tsx) and post-logout to their origin; the native shell returns
 * via the hosted universal link /native-auth (scheme bounce as the
 * fallback) and signs out to /native-signed-out + scheme://signed-out. */
export function appDefinitions(stack) {
  const spa = (name, url, twinPort) => {
    const origins = originVariants(url, twinPort);
    return {
      name,
      type: 'SPA',
      oidcClientMetadata: {
        redirectUris: origins.map((o) => `${o}/auth-callback`),
        postLogoutRedirectUris: origins,
      },
      customClientMetadata: { corsAllowedOrigins: origins },
    };
  };
  const native = {
    name: `${stack.stack} native`,
    type: 'Native',
    oidcClientMetadata: {
      redirectUris: [`${stack.urls.web}/native-auth`, `${stack.native.scheme}://auth-callback`],
      postLogoutRedirectUris: [`${stack.urls.web}/native-signed-out`, `${stack.native.scheme}://signed-out`],
    },
    customClientMetadata: { corsAllowedOrigins: ['capacitor://localhost', 'https://localhost'] },
  };
  const defs = {
    web: spa(`${stack.stack} web`, stack.urls.web, stack.ports?.web),
    admin: spa(`${stack.stack} admin`, stack.urls.admin, stack.ports?.admin),
    native,
    m2m: { name: `${stack.stack} api m2m`, type: 'MachineToMachine' },
  };
  // when this env powers munni-control (the shared-services cockpit),
  // the cockpit gets its OWN app — a fully separate product, per the
  // user's two-apps ruling — signing in against this env's Logto
  if (stack.sharedStack) {
    const shared = loadStack(stack.sharedStack);
    if (shared.controlApi === stack.stack && shared.urls.control) {
      defs.control = spa(`${stack.stack} control`, shared.urls.control, shared.ports?.control);
    }
  }
  return defs;
}

/** upsert-by-name; returns {web, admin, native, m2m} app records */
export async function applyApps(pairStack, stack, { m2mId, m2mSecret }) {
  const logtoUrl = pairStack.urls.logto;
  const token = await mgmtToken(logtoUrl, m2mId, m2mSecret);
  const existing = await api(logtoUrl, token, '/applications?page_size=100');
  const defs = appDefinitions(stack);
  const out = {};
  for (const [key, def] of Object.entries(defs)) {
    const match = existing.find((a) => a.name === def.name);
    out[key] = match
      ? await api(logtoUrl, token, `/applications/${match.id}`, { method: 'PATCH', body: JSON.stringify(def) })
      : await api(logtoUrl, token, '/applications', { method: 'POST', body: JSON.stringify(def) });
  }
  // the API resource (audience) — one per stack, indicator = api url
  const resources = await api(logtoUrl, token, '/resources?page_size=100');
  const indicator = stack.urls.api;
  out.resource =
    resources.find((r) => r.indicator === indicator) ??
    (await api(logtoUrl, token, '/resources', {
      method: 'POST',
      body: JSON.stringify({ name: `${stack.stack} api`, indicator }),
    }));
  return out;
}

/**
 * Social sign-in as code (user request): Google + Apple connectors on
 * the PAIR's Logto, from operator-provided OAuth credentials in the
 * environment. Absent credentials skip that provider — the runbook
 * lists the one-time console steps to mint them.
 */
export async function applySocialConnectors(pairStack, { m2mId, m2mSecret }) {
  const logtoUrl = pairStack.urls.logto;
  const token = await mgmtToken(logtoUrl, m2mId, m2mSecret);
  const wanted = [];
  const { LOGTO_GOOGLE_CLIENT_ID, LOGTO_GOOGLE_CLIENT_SECRET, LOGTO_APPLE_CLIENT_ID, LOGTO_APPLE_TEAM_ID, LOGTO_APPLE_KEY_ID, LOGTO_APPLE_PRIVATE_KEY } = process.env;
  if (LOGTO_GOOGLE_CLIENT_ID && LOGTO_GOOGLE_CLIENT_SECRET) {
    wanted.push({
      target: 'google',
      connectorId: 'google-universal',
      config: { clientId: LOGTO_GOOGLE_CLIENT_ID, clientSecret: LOGTO_GOOGLE_CLIENT_SECRET, scope: 'openid profile email' },
    });
  }
  if (LOGTO_APPLE_CLIENT_ID && LOGTO_APPLE_TEAM_ID && LOGTO_APPLE_KEY_ID && LOGTO_APPLE_PRIVATE_KEY) {
    wanted.push({
      target: 'apple',
      connectorId: 'apple-universal',
      config: { clientId: LOGTO_APPLE_CLIENT_ID, teamId: LOGTO_APPLE_TEAM_ID, keyId: LOGTO_APPLE_KEY_ID, privateKey: LOGTO_APPLE_PRIVATE_KEY, scope: 'name email' },
    });
  }
  if (!wanted.length) return { applied: [] };

  const existing = await api(logtoUrl, token, '/connectors?page_size=100');
  const applied = [];
  for (const def of wanted) {
    const match = existing.find((c) => c.target === def.target);
    if (match) {
      await api(logtoUrl, token, `/connectors/${match.id}`, { method: 'PATCH', body: JSON.stringify({ config: def.config }) });
    } else {
      await api(logtoUrl, token, '/connectors', { method: 'POST', body: JSON.stringify({ connectorId: def.connectorId, config: def.config, syncProfile: true }) });
    }
    applied.push(def.target);
  }
  // surface them on the sign-in screen
  await api(logtoUrl, token, '/sign-in-exp', {
    method: 'PATCH',
    body: JSON.stringify({ socialSignInConnectorTargets: applied }),
  });
  return { applied };
}

/**
 * Sign-in screen branding (user request: munni instead of the Logto
 * default): logo + brand color on the PAIR's sign-in experience. The
 * logo is served by the stack's own web app — no extra hosting.
 */
export async function applyBranding(pairStack, { m2mId, m2mSecret }) {
  const logtoUrl = pairStack.urls.logto;
  const token = await mgmtToken(logtoUrl, m2mId, m2mSecret);
  const { logoUrl, favicon } = await brandingImages(pairStack);
  await api(logtoUrl, token, '/sign-in-exp', {
    method: 'PATCH',
    body: JSON.stringify({
      branding: { logoUrl, darkLogoUrl: logoUrl, favicon },
      // darkPrimaryColor is REQUIRED by the API (found live 2026-08-26:
      // 400 ZodError without it) — the light mint the app uses on dark
      color: { primaryColor: '#08372B', darkPrimaryColor: '#8FC7B4', isDarkModeEnabled: true },
    }),
  });
  return { logoUrl };
}

/** Logto's own CSP allows img-src 'self' data: https: blob: — a plain-http
 * web origin (the LOCAL twin) can't serve the logo by URL (blocked live
 * 2026-08-26), so http stacks inline the icons as data: URIs instead. */
async function brandingImages(pairStack) {
  const web = pairStack.urls.web;
  if (web.startsWith('https://')) {
    return { logoUrl: `${web}/icon-512.png`, favicon: `${web}/icon-192.png` };
  }
  const asDataUri = async (url) => {
    const res = await localAwareFetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`icon fetch ${url} failed (${res.status})`);
    const type = res.headers.get('content-type') ?? 'image/png';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  };
  const logo = await asDataUri(`${web}/icon-192.png`);
  return { logoUrl: logo, favicon: logo };
}

/** write the ids where CI reads them (variables) + m2m secret (secret) */
export function writeBack(stack, apps) {
  const env = stack.githubEnvironment;
  const setVar = (name, value) => execFileSync('gh', ['variable', 'set', name, '--env', env, '--body', value]);
  setVar('VITE_LOGTO_APP_ID', apps.web.id);
  setVar('VITE_LOGTO_APP_ID_ADMIN', apps.admin.id);
  setVar('VITE_LOGTO_ENDPOINT', pairLogtoUrl(stack));
  setVar('NATIVE_LOGTO_APP_ID_ANDROID', apps.native.id);
  setVar('NATIVE_LOGTO_APP_ID_IOS', apps.native.id);
  // the native workflows read their whole stack config from these — a
  // dispatched iac build baked EMPTY urls before (gap found 2026-08-28)
  setVar('NATIVE_API_URL', stack.urls.api);
  setVar('NATIVE_PUBLIC_ORIGIN', stack.urls.web);
  setVar('NATIVE_LOGTO_ENDPOINT', pairLogtoUrl(stack));
  setVar('NATIVE_LOGTO_RESOURCE', stack.urls.api);
  execFileSync('gh', ['secret', 'set', 'NAS_LOGTO_M2M_APP_ID', '--env', env, '--body', apps.m2m.id]);
  execFileSync('gh', ['secret', 'set', 'NAS_LOGTO_M2M_APP_SECRET', '--env', env, '--body', apps.m2m.secret]);
}

function pairLogtoUrl(stack) {
  return stack.urls.logto;
}
