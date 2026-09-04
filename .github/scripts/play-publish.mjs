// Publish an .aab to a Play track with the bare androidpublisher API —
// replaces r0adkll/upload-google-play (deprecated 'track' input, ancient
// googleapis client full of DEP0040/DEP0169 noise, no retry when a
// concurrent edit — the wizard's store probe, an open Play Console tab —
// expires ours). Env: PLAY_JSON, PACKAGE, AAB_PATH, MAPPING_PATH?, TRACK?
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const { PLAY_JSON, PACKAGE, AAB_PATH, MAPPING_PATH, TRACK = 'internal' } = process.env;
if (!PLAY_JSON || !PACKAGE || !AAB_PATH) {
  console.error('PLAY_JSON, PACKAGE and AAB_PATH are required');
  process.exit(1);
}
const sa = JSON.parse(PLAY_JSON);
const b64url = (b) => Buffer.from(b).toString('base64url');

async function token() {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: sa.token_uri,
    iat: now,
    exp: now + 600,
  }))}`;
  const sig = createSign('RSA-SHA256').update(input).end().sign(sa.private_key);
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${b64url(sig)}` }).toString(),
  });
  if (!res.ok) throw new Error(`token mint failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

const BASE = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE)}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE)}`;

async function api(access, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${access}`, ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url.replace(BASE, '').replace(UPLOAD, '')} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function publishOnce(access) {
  const edit = await api(access, `${BASE}/edits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  console.log(`edit ${edit.id} opened`);
  const bundle = await api(access, `${UPLOAD}/edits/${edit.id}/bundles?uploadType=media`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: readFileSync(AAB_PATH),
  });
  console.log(`bundle uploaded — versionCode ${bundle.versionCode}`);
  if (MAPPING_PATH && existsSync(MAPPING_PATH)) {
    await api(access, `${UPLOAD}/edits/${edit.id}/apks/${bundle.versionCode}/deobfuscationFiles/proguard?uploadType=media`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: readFileSync(MAPPING_PATH),
    });
    console.log('mapping uploaded');
  }
  await api(access, `${BASE}/edits/${edit.id}/tracks/${encodeURIComponent(TRACK)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track: TRACK, releases: [{ status: 'completed', versionCodes: [String(bundle.versionCode)] }] }),
  });
  await api(access, `${BASE}/edits/${edit.id}:commit`, { method: 'POST' });
  console.log(`released versionCode ${bundle.versionCode} to the ${TRACK} track ✓`);
}

const access = await token();
try {
  await publishOnce(access);
} catch (e) {
  // a CONCURRENT edit (store probe, an open Play Console tab) expires
  // ours — one clean retry on a fresh edit wins the second time
  if (/edit has expired|editExpired|editAlreadyCommitted/i.test(String(e.message))) {
    console.log(`edit expired mid-flight (${e.message.slice(0, 120)}) — retrying once on a fresh edit`);
    await publishOnce(access);
  } else {
    throw e;
  }
}
