// The setup wizard writes GitHub secrets from the browser, which demands
// libsodium's crypto_box_seal built from the vendored tweetnacl + blakejs
// inlined in infra/setup/index.html. A wrong construction would produce
// secrets GitHub ACCEPTS but that decrypt to garbage at workflow time —
// the worst failure mode — so this spec extracts the EXACT inline script
// blocks from the shipped HTML and pins every moving part:
//   - blake2b against the RFC 7693 test vector,
//   - X25519 against the RFC 7748 §6.1 vectors,
//   - the sealed-box layout (epk ‖ box) and a full seal/open roundtrip.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../setup/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
assert.ok(scripts.length >= 4, 'wizard html lost a script block');

// script 0: tweetnacl UMD — give it a `self` to hang nacl on. In the real
// page self.crypto is the browser's; here node's WebCrypto stands in so
// the PRNG init path matches the browser one.
const selfShim = { crypto: globalThis.crypto };
new Function('self', scripts[0])(selfShim);
const nacl = selfShim.nacl;
assert.ok(nacl?.box && nacl?.scalarMult, 'tweetnacl failed to load from the inline block');

// script 1: blakejs wrapper (declares const blakejs)
const blakejs = new Function(`${scripts[1]}\nreturn blakejs;`)();
assert.ok(blakejs?.blake2b, 'blakejs failed to load from the inline block');

// script 2: the sealed-box block between the MARKER comments
assert.match(scripts[2], /MARKER:SEALEDBOX-BEGIN/, 'sealed-box block moved — update this extractor');
const box = new Function('nacl', 'blakejs', `${scripts[2]}\nreturn { sealedBox, sealedOpen, sealedNonce, b64decode, b64encode };`)(nacl, blakejs);

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));

test('blake2b matches the RFC 7693 appendix-A vector', () => {
  const out = blakejs.blake2b(new TextEncoder().encode('abc'), null, 64);
  assert.equal(
    hex(out),
    'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1' +
      '7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
  );
});

test('x25519 matches the RFC 7748 §6.1 key-pair vectors', () => {
  const alice = fromHex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const bob = fromHex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  assert.equal(hex(nacl.scalarMult.base(alice)), '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
  assert.equal(hex(nacl.scalarMult.base(bob)), 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
  assert.equal(
    hex(nacl.scalarMult(alice, nacl.scalarMult.base(bob))),
    '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742',
  );
});

test('sealed box: layout, nonce derivation, roundtrip, tamper rejection', () => {
  const recipient = nacl.box.keyPair();
  const message = new TextEncoder().encode('munni sealed-box smoke value');
  const sealed = box.sealedBox(recipient.publicKey, message);

  // libsodium layout: 32-byte ephemeral pk ‖ box (which adds a 16-byte MAC)
  assert.equal(sealed.length, 32 + 16 + message.length);
  const epk = sealed.slice(0, 32);
  assert.deepEqual(box.sealedNonce(epk, recipient.publicKey), blakejs.blake2b(Uint8Array.from([...epk, ...recipient.publicKey]), null, 24));

  const opened = box.sealedOpen(sealed, recipient.publicKey, recipient.secretKey);
  assert.equal(new TextDecoder().decode(opened), 'munni sealed-box smoke value');

  const tampered = Uint8Array.from(sealed);
  tampered[40] ^= 0x01;
  assert.equal(box.sealedOpen(tampered, recipient.publicKey, recipient.secretKey), null);
  const wrongKey = nacl.box.keyPair();
  assert.equal(box.sealedOpen(sealed, wrongKey.publicKey, wrongKey.secretKey), null);
});

test('two seals of the same value differ (fresh ephemeral key each time)', () => {
  const recipient = nacl.box.keyPair();
  const message = new TextEncoder().encode('same value');
  assert.notDeepEqual(box.sealedBox(recipient.publicKey, message), box.sealedBox(recipient.publicKey, message));
});

test('base64 helpers roundtrip arbitrary bytes', () => {
  const bytes = Uint8Array.from({ length: 97 }, (_, i) => (i * 37 + 11) % 256);
  assert.deepEqual(box.b64decode(box.b64encode(bytes)), bytes);
});
