// Vaultwarden-as-code crypto: Bitwarden protocol shapes pinned with
// round-trip proofs (the live registration is the interop check; these
// keep the derivations from drifting).
import { createPrivateKey } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KDF_ITERATIONS, buildAccount, buildCipher, decString, encString,
  masterKey, masterPasswordHash, splitSymKey, stretchKey, vaultLogin,
} from '../modules/vault.mjs';

test('master key + hash: deterministic, email case/space-insensitive, right sizes', () => {
  const a = masterKey('Admin@Munni.dev ', 'pw-123456789012');
  const b = masterKey('admin@munni.dev', 'pw-123456789012');
  assert.deepEqual(a, b);
  assert.equal(a.length, 32);
  const hash = masterPasswordHash(a, 'pw-123456789012');
  assert.equal(Buffer.from(hash, 'base64').length, 32);
  assert.equal(masterPasswordHash(b, 'pw-123456789012'), hash);
  assert.notEqual(masterPasswordHash(a, 'other-password-1'), hash);
});

test('encString type 2 round-trips and rejects tampering', () => {
  const keys = splitSymKey(Buffer.alloc(64, 7));
  const enc = encString(keys, 'the secret value');
  assert.match(enc, /^2\.[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+$/);
  assert.equal(decString(keys, enc).toString('utf8'), 'the secret value');
  const [head, ct, mac] = enc.split('|');
  const tampered = `${head}|${ct.slice(0, -4)}AAAA|${mac}`;
  assert.throws(() => decString(keys, tampered), /mac mismatch/);
});

test('buildAccount: register payload decrypts back to a working key set', () => {
  const email = 'vault@munni.dev';
  const password = 'master-password-16';
  const { hash, userKeys, register } = buildAccount(email, password);
  assert.equal(register.kdf, 0);
  assert.equal(register.kdfIterations, KDF_ITERATIONS);
  assert.equal(register.masterPasswordHash, hash);
  // the protected key opens with the stretched master key → 64 bytes
  const stretched = stretchKey(masterKey(email, password));
  const symBytes = decString(stretched, register.key);
  assert.equal(symBytes.length, 64);
  assert.deepEqual(splitSymKey(symBytes).enc, userKeys.enc);
  // the encrypted private key opens with the user key → valid pkcs8
  const der = decString(userKeys, register.keys.encryptedPrivateKey);
  const pk = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  assert.equal(pk.asymmetricKeyType, 'rsa');
});

test('buildCipher encrypts every present field and keeps absent ones null', () => {
  const keys = splitSymKey(Buffer.alloc(64, 3));
  const full = buildCipher(keys, { name: 'pg', username: 'munni', password: 'pw', uri: 'http://x', notes: 'n' });
  assert.equal(full.type, 1);
  assert.equal(decString(keys, full.name).toString(), 'pg');
  assert.equal(decString(keys, full.login.username).toString(), 'munni');
  assert.equal(decString(keys, full.login.password).toString(), 'pw');
  assert.equal(decString(keys, full.login.uris[0].uri).toString(), 'http://x');
  assert.equal(decString(keys, full.notes).toString(), 'n');
  const bare = buildCipher(keys, { name: 'only-name' });
  assert.equal(bare.login.username, null);
  assert.equal(bare.login.uris, null);
  assert.equal(bare.notes, null);
});

test('vaultLogin sends the password grant with the auth-email header; bad creds → null', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ access_token: 'tok-1' }) };
  };
  const token = await vaultLogin('http://localhost:8384', 'admin@munni.dev', 'HASH=', fetchImpl);
  assert.equal(token, 'tok-1');
  assert.equal(calls[0].url, 'http://localhost:8384/identity/connect/token');
  assert.equal(calls[0].init.headers['auth-email'], Buffer.from('admin@munni.dev').toString('base64url'));
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('grant_type'), 'password');
  assert.equal(form.get('username'), 'admin@munni.dev');
  assert.equal(form.get('password'), 'HASH=');
  const denied = await vaultLogin('http://x', 'a@b.c', 'H', async () => ({ ok: false }));
  assert.equal(denied, null);
});
