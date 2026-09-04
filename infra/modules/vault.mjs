import { createCipheriv, createDecipheriv, createHmac, generateKeyPairSync, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { insecureFetch } from './insecure-fetch.mjs';

/**
 * Vaultwarden (Bitwarden-compatible) as code: register the account,
 * purge + import the family's sign-ins as real login items — all the
 * client-side crypto the Bitwarden apps normally do, in node:crypto.
 * User ruling 2026-08-28: the master password is generated and KEPT in
 * the local secret store (readable under Reveal) instead of living only
 * in the operator's head.
 *
 * Crypto shapes (Bitwarden protocol):
 * - master key = PBKDF2-SHA256(password, lower(email), 600k, 32)
 * - master password hash = PBKDF2-SHA256(masterKey, password, 1, 32) b64
 * - stretched master key = HKDF-EXPAND(masterKey, "enc"/"mac") (expand
 *   ONLY — the master key IS the PRK; node's hkdfSync would re-extract)
 * - user symmetric key = 64 random bytes (enc: first 32, mac: last 32),
 *   stored as EncString type 2 under the stretched key
 * - EncString type 2 = "2.iv|ct|mac" (AES-256-CBC + HMAC-SHA256 over iv+ct)
 */

export const KDF_ITERATIONS = 600000;

export const masterKey = (email, password) =>
  pbkdf2Sync(password, email.trim().toLowerCase(), KDF_ITERATIONS, 32, 'sha256');

export const masterPasswordHash = (key, password) =>
  pbkdf2Sync(key, password, 1, 32, 'sha256').toString('base64');

/** single-block HKDF-EXPAND (L=32): HMAC(prk, info || 0x01) */
const hkdfExpand = (prk, info) =>
  createHmac('sha256', prk).update(Buffer.concat([Buffer.from(info, 'utf8'), Buffer.from([1])])).digest();

export const stretchKey = (key) => ({ enc: hkdfExpand(key, 'enc'), mac: hkdfExpand(key, 'mac') });

export const splitSymKey = (bytes) => ({ enc: bytes.subarray(0, 32), mac: bytes.subarray(32, 64) });

export function encString(keys, plaintext) {
  const iv = randomBytes(16);
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
  const cipher = createCipheriv('aes-256-cbc', keys.enc, iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const mac = createHmac('sha256', keys.mac).update(Buffer.concat([iv, ct])).digest();
  return `2.${iv.toString('base64')}|${ct.toString('base64')}|${mac.toString('base64')}`;
}

/** test/verification helper: decrypt an EncString type 2 with the keys */
export function decString(keys, enc) {
  const [type, rest] = [enc.slice(0, 2), enc.slice(2)];
  if (type !== '2.') throw new Error(`unexpected EncString type: ${enc.slice(0, 2)}`);
  const [iv, ct, mac] = rest.split('|').map((p) => Buffer.from(p, 'base64'));
  const expect = createHmac('sha256', keys.mac).update(Buffer.concat([iv, ct])).digest();
  if (!timingSafeEqual(mac, expect)) throw new Error('mac mismatch');
  const decipher = createDecipheriv('aes-256-cbc', keys.enc, iv);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** everything the register endpoint needs, plus the user key for imports */
export function buildAccount(email, password) {
  const key = masterKey(email, password);
  const hash = masterPasswordHash(key, password);
  const stretched = stretchKey(key);
  const symBytes = randomBytes(64);
  const userKeys = splitSymKey(symBytes);
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const register = {
    email,
    name: 'munni operator',
    masterPasswordHash: hash,
    masterPasswordHint: null,
    key: encString(stretched, symBytes),
    kdf: 0, // PBKDF2-SHA256
    kdfIterations: KDF_ITERATIONS,
    keys: {
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      encryptedPrivateKey: encString(userKeys, privateKey.export({ type: 'pkcs8', format: 'der' })),
    },
    referenceData: null,
  };
  return { hash, userKeys, register };
}

/** {name, username, password, uri, notes} → encrypted Bitwarden cipher */
export const buildCipher = (userKeys, item) => ({
  type: 1,
  name: encString(userKeys, item.name),
  notes: item.notes ? encString(userKeys, item.notes) : null,
  favorite: false,
  login: {
    username: item.username ? encString(userKeys, item.username) : null,
    password: item.password ? encString(userKeys, item.password) : null,
    uris: item.uri ? [{ uri: encString(userKeys, item.uri), match: null }] : null,
  },
  fields: null,
  folderId: null,
});

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');

/** password-grant login; returns the access token or null on bad creds */
export async function vaultLogin(base, email, hash, fetchImpl = insecureFetch) {
  const res = await fetchImpl(`${base}/identity/connect/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // vaultwarden requires the email echoed on token requests
      'auth-email': b64url(email),
      'device-type': '9',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      username: email,
      password: hash,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '9',
      deviceIdentifier: 'munni-setup-wizard',
      deviceName: 'munni setup',
    }).toString(),
  });
  if (!res.ok) return null;
  return (await res.json()).access_token;
}

export const vaultRegister = (base, payload, fetchImpl = insecureFetch) =>
  fetchImpl(`${base}/identity/accounts/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const vaultPurge = (base, token, hash, fetchImpl = insecureFetch) =>
  fetchImpl(`${base}/api/ciphers/purge`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ masterPasswordHash: hash }),
  });

export const vaultImport = (base, token, payload, fetchImpl = insecureFetch) => {
  // accepts either a bare cipher array or {ciphers, folders, folderRelationships}
  const body = Array.isArray(payload) ? { ciphers: payload, folders: [], folderRelationships: [] } : payload;
  return fetchImpl(`${base}/api/ciphers/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
};
