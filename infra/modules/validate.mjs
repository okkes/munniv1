import { createSign, sign as cryptoSign } from 'node:crypto';
import { dsmLogin, dsmLogout } from './dsm.mjs';
import { localAwareFetch } from './insecure-fetch.mjs';
import { loadStack, localEnvRegistry } from './stack.mjs';

/**
 * Credential validators for the setup wizard (user request: "whenever I
 * enter them, check if the value is correct — like the GitHub PAT").
 * Each mirrors how the SERVER really authenticates (GoCardlessApi,
 * EnableBankingApi, LogoEndpoints…), so a green check here means the
 * stack will work. Most providers block browser calls (CORS), so these
 * run in the local helper; values are transient — never stored, never
 * logged. Verdicts: {ok, detail} — a thrown/failed network hop becomes
 * {ok:false, unreachable:true} so the wizard can store-with-warning
 * instead of refusing.
 */

const T = (ms = 10000) => AbortSignal.timeout(ms);
const b64url = (input) => Buffer.from(input).toString('base64url');
const need = (values, names) => {
  const missing = names.filter((n) => !values[n]);
  return missing.length ? `missing: ${missing.join(', ')}` : null;
};

export function jwtRS256({ header, payload, pem }) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign('RSA-SHA256').update(input).end().sign(pem);
  return `${input}.${b64url(sig)}`;
}

export function jwtES256({ header, payload, pem }) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // JOSE wants the raw r‖s signature, not ASN.1
  const sig = cryptoSign('sha256', Buffer.from(input), { key: pem, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}

/* DSM's SYNO.API.Auth error codes, as the operator meets them (2026-09-10:
   a bare {"code":402} sent the user hunting) */
export const DSM_LOGIN_ADVICE = {
  400: 'no such account, or the password is wrong',
  401: 'the account is disabled (DSM → Control Panel → User & Group)',
  402: 'permission denied — the account exists but may not sign in to DSM: Control Panel → User & Group → the deploy user → Applications → allow DSM and File Station; and it must be in the administrators group (reverse-proxy rules need admin rights)',
  403: '2-step verification is on for this account — turn it off for the deploy user (the login API cannot answer an OTP prompt)',
  404: 'the 2-step verification code was rejected — turn 2FA off for the deploy user',
  406: 'DSM enforces 2-factor authentication for this account — exempt the deploy user (Control Panel → Security → Account)',
  407: 'this address is blocked by DSM auto-block (Control Panel → Security → Account → Auto Block)',
  408: 'the password expired and this account cannot change it',
  409: 'the password expired — change it in DSM first',
  410: 'DSM demands a password change on first sign-in — sign in once in the browser',
};
export const dsmLoginAdvice = (message) => {
  const code = Number(/"code":\s*(\d+)/.exec(String(message ?? ''))?.[1]);
  return DSM_LOGIN_ADVICE[code] ? ` — code ${code}: ${DSM_LOGIN_ADVICE[code]}` : '';
};

export const VALIDATORS = {
  /** POST token/new — the exact call GoCardlessApi makes */
  async gocardless(values, fetchImpl) {
    const gap = need(values, ['NAS_GOCARDLESS_SECRET_ID', 'NAS_GOCARDLESS_SECRET_KEY']);
    if (gap) return { ok: false, detail: gap };
    const res = await fetchImpl('https://bankaccountdata.gocardless.com/api/v2/token/new/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ secret_id: values.NAS_GOCARDLESS_SECRET_ID, secret_key: values.NAS_GOCARDLESS_SECRET_KEY }),
      signal: T(),
    });
    if (res.ok) return { ok: true, detail: 'GoCardless accepted the credentials (access token minted)' };
    return { ok: false, detail: `GoCardless rejected them (${res.status}) — re-copy Secret ID + Key from the portal` };
  },

  /** RS256 JWT (iss/aud per EnableBankingApi) against GET /aspsps */
  async enablebanking(values, fetchImpl) {
    const gap = need(values, ['NAS_ENABLEBANKING_APPLICATION_ID', 'NAS_ENABLEBANKING_PRIVATE_KEY_PEM']);
    if (gap) return { ok: false, detail: gap };
    const now = Math.floor(Date.now() / 1000);
    let jwt;
    try {
      jwt = jwtRS256({
        header: { alg: 'RS256', typ: 'JWT', kid: values.NAS_ENABLEBANKING_APPLICATION_ID },
        payload: { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 },
        pem: values.NAS_ENABLEBANKING_PRIVATE_KEY_PEM.replaceAll('\\n', '\n'),
      });
    } catch (e) {
      return { ok: false, detail: `the PEM does not parse as a private key (${e.message})` };
    }
    const res = await fetchImpl('https://api.enablebanking.com/aspsps?country=NL', {
      headers: { authorization: `Bearer ${jwt}` },
      signal: T(),
    });
    if (res.ok) return { ok: true, detail: 'Enable Banking accepted the application credentials' };
    const body = (await res.text()).slice(0, 200);
    return { ok: false, detail: `Enable Banking rejected them (${res.status}): ${body}` };
  },

  /** parse the service account + actually mint a Google OAuth token */
  async fcm(values, fetchImpl) {
    const gap = need(values, ['NAS_FCM_SERVICE_ACCOUNT_JSON']);
    if (gap) return { ok: false, detail: gap };
    let sa;
    try {
      sa = JSON.parse(values.NAS_FCM_SERVICE_ACCOUNT_JSON);
    } catch {
      return { ok: false, detail: 'not valid JSON — paste the WHOLE downloaded service-account file' };
    }
    for (const field of ['private_key', 'client_email', 'token_uri', 'project_id']) {
      if (!sa[field]) return { ok: false, detail: `service-account JSON lacks "${field}" — wrong file?` };
    }
    const now = Math.floor(Date.now() / 1000);
    let assertion;
    try {
      assertion = jwtRS256({
        header: { alg: 'RS256', typ: 'JWT' },
        payload: { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: sa.token_uri, iat: now, exp: now + 300 },
        pem: sa.private_key,
      });
    } catch (e) {
      return { ok: false, detail: `the embedded private key does not parse (${e.message})` };
    }
    const res = await fetchImpl(sa.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: T(),
    });
    if (res.ok) return { ok: true, detail: `Google accepted the service account (${sa.client_email}, project ${sa.project_id})` };
    const body = (await res.text()).slice(0, 160);
    return { ok: false, detail: `Google rejected the service account (${res.status}): ${body}` };
  },

  /** sk_ search auth + pk_ image fetch — mirrors LogoEndpoints incl. the swap check */
  /** the registry pull token — GitHub names the user and the scopes of a
   *  classic PAT; the page's own check needs the pasted value, this twin
   *  lets "Check all" verify the STORED one through the helper */
  async ghcr(values, fetchImpl) {
    const gap = need(values, ['NAS_GHCR_PAT']);
    if (gap) return { ok: false, detail: gap };
    const res = await fetchImpl('https://api.github.com/user', { headers: { authorization: `Bearer ${values.NAS_GHCR_PAT}`, accept: 'application/vnd.github+json' }, signal: T() });
    if (!res.ok) return { ok: false, detail: `GitHub rejected the token (${res.status})` };
    const scopes = res.headers?.get?.('x-oauth-scopes') ?? '';
    const login = (await res.json()).login;
    if (!/(read|write):packages/.test(scopes)) return { ok: false, detail: `the token authenticates as ${login} but lacks read:packages (scopes: ${scopes || 'none — is it fine-grained? use classic here'})` };
    return { ok: true, detail: `valid — ${login}, scopes: ${scopes}` };
  },

  async logodev(values, fetchImpl) {
    const gap = need(values, ['NAS_LOGODEV_SECRET_KEY', 'NAS_LOGODEV_PUBLIC_TOKEN']);
    if (gap) return { ok: false, detail: gap };
    const { NAS_LOGODEV_SECRET_KEY: sk, NAS_LOGODEV_PUBLIC_TOKEN: pk } = values;
    if (sk.startsWith('pk_')) return { ok: false, detail: 'the SECRET key field holds a publishable key (pk_…) — the two are swapped' };
    if (pk.startsWith('sk_')) return { ok: false, detail: 'the PUBLIC token field holds a secret key (sk_…) — the two are swapped' };
    const search = await fetchImpl('https://api.logo.dev/search?q=google', { headers: { authorization: `Bearer ${sk}` }, signal: T() });
    if (!search.ok) return { ok: false, detail: `logo.dev rejected the secret key (${search.status})` };
    const img = await fetchImpl(`https://img.logo.dev/google.com?token=${encodeURIComponent(pk)}&size=64&format=png`, { signal: T() });
    if (!img.ok) return { ok: false, detail: `secret key OK, but img.logo.dev rejected the publishable token (${img.status})` };
    return { ok: true, detail: 'both keys accepted (search + image fetch)' };
  },

  /** dummy-code trick: invalid_client = bad creds, any other error = client is real */
  async google(values, fetchImpl, { redirectUris = [] } = {}) {
    const gap = need(values, ['LOGTO_GOOGLE_CLIENT_ID', 'LOGTO_GOOGLE_CLIENT_SECRET']);
    if (gap) return { ok: false, detail: gap };
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: values.LOGTO_GOOGLE_CLIENT_ID,
        client_secret: values.LOGTO_GOOGLE_CLIENT_SECRET,
        code: 'munni-validation-dummy',
        grant_type: 'authorization_code',
        redirect_uri: 'https://localhost/unused',
      }).toString(),
      signal: T(),
    });
    const body = await res.json().catch(() => ({}));
    if (body.error === 'invalid_client') return { ok: false, detail: 'Google says invalid_client — the id/secret pair is wrong' };
    const refused = await refusedRedirects(googleRedirectProbe, values.LOGTO_GOOGLE_CLIENT_ID, redirectUris, fetchImpl);
    if (refused.length) {
      return { ok: true, warn: true, detail: `the client is real, but Google refuses ${refused.map((p) => `${p.uri} (${p.code})`).join(', ')} — add it under Authorized redirect URIs of the OAuth client, then Check again` };
    }
    return { ok: true, detail: `Google recognized the OAuth client${redirectUris.length ? ` and accepts all ${redirectUris.length} redirect URI(s)` : ''} (dummy code rejected with "${body.error ?? res.status}", as expected)` };
  },

  /** ES256 client-secret JWT + the same dummy-code trick against Apple */
  async apple(raw, fetchImpl, { redirectUris = [], iosAppIds = [] } = {}) {
    // the Team ID is the TestFlight card's Team ID — one membership
    const values = { ...raw, LOGTO_APPLE_TEAM_ID: raw.LOGTO_APPLE_TEAM_ID || raw.APPLE_TEAM_ID };
    const gap = need(values, ['LOGTO_APPLE_CLIENT_ID', 'LOGTO_APPLE_TEAM_ID', 'LOGTO_APPLE_KEY_ID', 'LOGTO_APPLE_PRIVATE_KEY']);
    if (gap) return { ok: false, detail: gap };
    // the App ID passes the token check (native flow) yet can never carry
    // a return URL — Apple's web flow wants the SERVICES ID (user pasted
    // app.munni.local.prod, found live 2026-09-09: invalid_request)
    if (iosAppIds.includes(values.LOGTO_APPLE_CLIENT_ID)) {
      return { ok: false, detail: `${values.LOGTO_APPLE_CLIENT_ID} is the App ID (the app bundle) — Sign in with Apple on the web needs the SERVICES ID identifier: developer.apple.com → Identifiers → Services IDs, the one whose Sign in with Apple configuration carries the domain + return URL (e.g. app.munni.local.signin)` };
    }
    const now = Math.floor(Date.now() / 1000);
    let clientSecret;
    try {
      clientSecret = jwtES256({
        header: { alg: 'ES256', kid: values.LOGTO_APPLE_KEY_ID },
        payload: { iss: values.LOGTO_APPLE_TEAM_ID, aud: 'https://appleid.apple.com', sub: values.LOGTO_APPLE_CLIENT_ID, iat: now, exp: now + 600 },
        pem: values.LOGTO_APPLE_PRIVATE_KEY.replaceAll('\\n', '\n'),
      });
    } catch (e) {
      return { ok: false, detail: `the .p8 key does not parse (${e.message})` };
    }
    const res = await fetchImpl('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: values.LOGTO_APPLE_CLIENT_ID,
        client_secret: clientSecret,
        code: 'munni-validation-dummy',
        grant_type: 'authorization_code',
      }).toString(),
      signal: T(),
    });
    const body = await res.json().catch(() => ({}));
    if (body.error === 'invalid_client') return { ok: false, detail: 'Apple says invalid_client — check Services ID, Team ID, Key ID and the .p8 contents together' };
    const refused = await refusedRedirects(appleRedirectProbe, values.LOGTO_APPLE_CLIENT_ID, redirectUris, fetchImpl);
    if (refused.length) {
      const named = refused.map((p) => `${p.uri} (${p.code}${p.message ? `: ${p.message}` : ''})`).join(', ');
      const hint = refused.some((p) => p.code === 'invalid_request')
        ? 'Apple answers invalid_request when the client id is not a Services ID, or when the Services ID’s web configuration was never saved (Configure → Done → Continue → Save)'
        : 'add the domain + return URL to the Services ID (Sign in with Apple → Configure → Done → Continue → Save)';
      return { ok: true, warn: true, detail: `the client is real, but Apple refuses ${named} — ${hint}, then Check again` };
    }
    return { ok: true, detail: `Apple recognized the client${redirectUris.length ? ` and accepts all ${redirectUris.length} return URL(s)` : ''} (dummy code rejected with "${body.error ?? res.status}", as expected)` };
  },

  /** parse the Play service account + mint an androidpublisher-scoped
   * token — the exact credential the CI publish step and the wizard's
   * store-app detection use */
  async playstore(values, fetchImpl) {
    const gap = need(values, ['PLAY_SERVICE_ACCOUNT_JSON']);
    if (gap) return { ok: false, detail: gap };
    let sa;
    try {
      sa = JSON.parse(values.PLAY_SERVICE_ACCOUNT_JSON);
    } catch {
      return { ok: false, detail: 'not valid JSON — paste the WHOLE downloaded service-account file' };
    }
    for (const field of ['private_key', 'client_email', 'token_uri']) {
      if (!sa[field]) return { ok: false, detail: `service-account JSON lacks "${field}" — wrong file?` };
    }
    const now = Math.floor(Date.now() / 1000);
    let assertion;
    try {
      assertion = jwtRS256({
        header: { alg: 'RS256', typ: 'JWT' },
        payload: { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: sa.token_uri, iat: now, exp: now + 300 },
        pem: sa.private_key,
      });
    } catch (e) {
      return { ok: false, detail: `the embedded private key does not parse (${e.message})` };
    }
    const res = await fetchImpl(sa.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: T(),
    });
    if (res.ok) return { ok: true, detail: `Google accepted the service account (${sa.client_email}) with Play-publishing scope` };
    const body = (await res.text()).slice(0, 160);
    return { ok: false, detail: `Google rejected the service account (${res.status}): ${body}` };
  },

  /** ES256 App Store Connect JWT against GET /v1/apps — the key CI
   * uploads with and the wizard checks app records with */
  async ascstore(values, fetchImpl) {
    const gap = need(values, ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8']);
    if (gap) return { ok: false, detail: gap };
    if (values.APPLE_TEAM_ID && !/^[A-Z0-9]{10}$/i.test(values.APPLE_TEAM_ID)) {
      return { ok: false, detail: 'the Team ID should be 10 letters/digits (developer.apple.com → Membership details)' };
    }
    const now = Math.floor(Date.now() / 1000);
    // stored base64 normally; a raw BEGIN/END paste works too
    const rawP8 = values.ASC_KEY_P8.includes('BEGIN') ? values.ASC_KEY_P8 : Buffer.from(values.ASC_KEY_P8, 'base64').toString('utf8');
    let jwt;
    try {
      jwt = jwtES256({
        header: { alg: 'ES256', kid: values.ASC_KEY_ID, typ: 'JWT' },
        payload: { iss: values.ASC_ISSUER_ID, aud: 'appstoreconnect-v1', iat: now, exp: now + 600 },
        pem: rawP8,
      });
    } catch (e) {
      return { ok: false, detail: `the .p8 does not parse — paste the WHOLE file content, BEGIN/END lines included (${e.message})` };
    }
    const res = await fetchImpl('https://api.appstoreconnect.apple.com/v1/apps?limit=1', {
      headers: { authorization: `Bearer ${jwt}` },
      signal: T(),
    });
    if (res.ok) return { ok: true, detail: 'App Store Connect accepted the key' };
    return { ok: false, detail: `App Store Connect rejected it (${res.status}) — check Key ID, Issuer ID and the .p8 together` };
  },

  /** a real DSM login + logout via the same module the bootstrap uses */
  async synology(values) {
    const gap = need(values, ['SYNOLOGY_URL', 'SYNOLOGY_USER', 'SYNOLOGY_PASS']);
    if (gap) return { ok: false, detail: gap };
    if (values.SYNOLOGY_PATH && !values.SYNOLOGY_PATH.startsWith('/')) return { ok: false, detail: `SYNOLOGY_PATH must be absolute — the shared-folder path bundles land in, e.g. /docker/munni/published (yours: ${values.SYNOLOGY_PATH})` };
    try {
      const { sid } = await dsmLogin(values.SYNOLOGY_URL, values.SYNOLOGY_USER, values.SYNOLOGY_PASS);
      await dsmLogout(values.SYNOLOGY_URL, sid);
      return { ok: true, detail: 'DSM accepted the login (remember: the account needs admin rights, 2FA off)' };
    } catch (e) {
      return { ok: false, detail: `DSM refused the login: ${e.message}${dsmLoginAdvice(e.message)}` };
    }
  },

  /** the local pair's Logto management token — what bootstrap will do */
  async 'logto-m2m'(values, fetchImpl) {
    const gap = need(values, ['IAC_LOGTO_INFRA_M2M_ID', 'IAC_LOGTO_INFRA_M2M_SECRET']);
    if (gap) return { ok: false, detail: gap };
    // the registry names the environments (no hardcoded "prod" — it may
    // not exist mid-recreate, or at all under custom names)
    const envs = localEnvRegistry();
    if (!envs.length) return { ok: false, detail: 'no local environment exists yet — Set up & start munni first, then re-check' };
    const logto = loadStack(`munni-local-${envs[0].name}`).urls.logto;
    const res = await fetchImpl(`${logto}/oidc/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${values.IAC_LOGTO_INFRA_M2M_ID}:${values.IAC_LOGTO_INFRA_M2M_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', resource: 'https://default.logto.app/api', scope: 'all' }).toString(),
      signal: T(),
    });
    if (res.ok) return { ok: true, detail: 'Logto minted a management token — the credential works' };
    return { ok: false, detail: `Logto rejected it (${res.status}) — is it the M2M app with the Management API role?` };
  },

  /** the local GlitchTip token against its own API */
  async 'glitchtip-token'(values, fetchImpl) {
    const gap = need(values, ['IAC_GLITCHTIP_API_TOKEN']);
    if (gap) return { ok: false, detail: gap };
    const glitchtip = loadStack('munni-local-shared').urls.glitchtip;
    const res = await fetchImpl(`${glitchtip}/api/0/organizations/`, {
      headers: { authorization: `Bearer ${values.IAC_GLITCHTIP_API_TOKEN}` },
      signal: T(),
    });
    if (res.ok) return { ok: true, detail: 'GlitchTip accepted the token' };
    return { ok: false, detail: `GlitchTip rejected it (${res.status})` };
  },
};

/* ── redirect registration probes (user ask 2026-09-09: automate the
   OAuth setup — neither Google nor Apple offers an API that CREATES a
   client / Services ID, but both authorization endpoints judge a
   redirect WITHOUT a user, so the wizard can at least verify every
   environment's callback the moment the credentials are pasted). ── */

/** Google: a refused request 302s to /signin/oauth/error whose authError
 * is a base64url proto that starts with the error code
 * (redirect_uri_mismatch, invalid_client, …); an accepted one lands on
 * the sign-in page instead */
async function googleRedirectProbe(clientId, uri, fetchImpl) {
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(uri)}&response_type=code&scope=openid`;
  const res = await fetchImpl(url, { redirect: 'manual', signal: T() });
  const location = res.headers?.get?.('location') ?? '';
  if (!location.includes('/signin/oauth/error')) return { uri, ok: true };
  const raw = /authError=([^&]+)/.exec(location)?.[1] ?? '';
  const decoded = Buffer.from(decodeURIComponent(raw).replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('latin1');
  return { uri, ok: false, code: /([a-z][a-z_]{4,})/.exec(decoded)?.[1] ?? 'refused' };
}

/** Apple: the authorize page embeds {"errorCode":"invalid_client"} (or
 * another code) when it will not proceed; a clean sign-in page otherwise */
async function appleRedirectProbe(clientId, uri, fetchImpl) {
  const url = `https://appleid.apple.com/auth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(uri)}&response_type=code&response_mode=form_post&scope=name%20email`;
  const res = await fetchImpl(url, { redirect: 'manual', signal: T() });
  const text = res.status >= 300 && res.status < 400 ? (res.headers?.get?.('location') ?? '') : await res.text();
  const code = /"errorCode":"([a-z_]+)"/.exec(text)?.[1] ?? /[?&]error=([a-z_]+)/.exec(text)?.[1];
  const message = /"errorMessage":"([^"]{1,120})"/.exec(text)?.[1];
  return code ? { uri, ok: false, code, message } : { uri, ok: true };
}

/** every refused uri — a probe that cannot be reached counts as accepted (never block on Google's hiccup) */
async function refusedRedirects(probe, clientId, uris, fetchImpl) {
  const results = await Promise.all(uris.map((uri) => probe(clientId, uri, fetchImpl).catch(() => ({ uri, ok: true }))));
  return results.filter((r) => !r.ok);
}

// localAwareFetch: public providers stay strictly verified; the two
// LOCAL validators (logto-m2m, glitchtip-token) hit our own family
// urls, which under LAN mode are https signed by the local Caddy CA
export async function validate(provider, values, { fetchImpl = localAwareFetch, redirectUris = [], iosAppIds = [] } = {}) {
  const fn = VALIDATORS[provider];
  if (!fn) return { ok: false, detail: `no validator for "${provider}"` };
  try {
    return await fn(values ?? {}, fetchImpl, { redirectUris, iosAppIds });
  } catch (e) {
    return { ok: false, unreachable: true, detail: `could not reach the provider (${e.cause?.code ?? e.message})` };
  }
}
