// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, fingerprintOf, generateDeviceKeys, mintCsk, unwrapCsk, wrapCsk } from './connCrypto';

describe('store-sync crypto (SC1)', () => {
  it('the CSK round-trips a wrap to the target device only', async () => {
    const target = await generateDeviceKeys();
    const intruder = await generateDeviceKeys();
    const csk = mintCsk();

    const wrapped = await wrapCsk(csk, target.publicJwk);
    expect(await unwrapCsk(wrapped, target.privateJwk)).toBe(csk);
    // a different private key cannot repeat the agreement
    await expect(unwrapCsk(wrapped, intruder.privateJwk)).rejects.toThrow();
    // the wrap never contains the key material in the clear
    expect(wrapped).not.toContain(csk);
  });

  it('connection payloads round-trip and fail closed on the wrong key', async () => {
    const csk = mintCsk();
    const tokens = { store: 'ah', tokens: { access: 'secret-a', refresh: 'secret-r' }, refreshedAt: '2026-07-17' };
    const cipher = await encryptJson(csk, tokens);
    expect(cipher).not.toContain('secret-a');
    expect(await decryptJson(csk, cipher)).toEqual(tokens);
    await expect(decryptJson(mintCsk(), cipher)).rejects.toThrow();
  });

  it('fingerprints are stable 6-digit codes tied to the key', async () => {
    const device = await generateDeviceKeys();
    const fp1 = await fingerprintOf(device.publicJwk);
    expect(fp1).toMatch(/^\d{6}$/);
    expect(await fingerprintOf(device.publicJwk)).toBe(fp1);
    const other = await generateDeviceKeys();
    expect(await fingerprintOf(other.publicJwk)).not.toBe(fp1); // 1e-6 collision odds
  });
});
