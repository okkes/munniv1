import { execFileSync } from 'node:child_process';

/**
 * Logto-as-code for one IaC pair. Talks to the PAIR's own Logto
 * instance (never the live stacks') through the one operator-created
 * "infra" M2M credential. Upserts by app name, writes the resulting
 * ids back to each stack's GitHub Environment variables under the
 * SAME names the workflows already read.
 */

const MGMT_RESOURCE = 'https://default.logto.app/api';

async function mgmtToken(logtoUrl, m2mId, m2mSecret) {
  const res = await fetch(`${logtoUrl}/oidc/token`, {
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
  const res = await fetch(`${logtoUrl}/api${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`logto ${init.method ?? 'GET'} ${path} failed (${res.status}): ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** the app definitions one STACK needs (SPA web+admin, native, m2m) */
export function appDefinitions(stack) {
  const spa = (name, url) => ({
    name,
    type: 'SPA',
    oidcClientMetadata: {
      redirectUris: [`${url}/callback`, url],
      postLogoutRedirectUris: [url],
    },
    customClientMetadata: { corsAllowedOrigins: [url] },
  });
  const native = {
    name: `${stack.stack} native`,
    type: 'Native',
    oidcClientMetadata: {
      redirectUris: [`${stack.native.scheme}://auth-callback`],
      postLogoutRedirectUris: [`${stack.native.scheme}://signed-out`],
    },
    customClientMetadata: { corsAllowedOrigins: ['capacitor://localhost', 'https://localhost'] },
  };
  return {
    web: spa(`${stack.stack} web`, stack.urls.web),
    admin: spa(`${stack.stack} admin`, stack.urls.admin),
    native,
    m2m: { name: `${stack.stack} api m2m`, type: 'MachineToMachine' },
  };
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
  const logoUrl = `${pairStack.urls.web}/icon-512.png`;
  await api(logtoUrl, token, '/sign-in-exp', {
    method: 'PATCH',
    body: JSON.stringify({
      branding: { logoUrl, darkLogoUrl: logoUrl, favicon: `${pairStack.urls.web}/icon-192.png` },
      color: { primaryColor: '#08372B', isDarkModeEnabled: true },
    }),
  });
  return { logoUrl };
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
  execFileSync('gh', ['secret', 'set', 'NAS_LOGTO_M2M_APP_ID', '--env', env, '--body', apps.m2m.id]);
  execFileSync('gh', ['secret', 'set', 'NAS_LOGTO_M2M_APP_SECRET', '--env', env, '--body', apps.m2m.secret]);
}

function pairLogtoUrl(stack) {
  return stack.urls.logto;
}
