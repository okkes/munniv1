// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import {
  adoptWrapIfApproved,
  approveDevice,
  disableStoreSync,
  enableStoreSync,
  listSyncDevices,
  pullConnections,
  pushConnection,
  requestEnrollment,
} from './storeSync';

/** the server as SC1 defines it: dumb storage it cannot read */
function fakeServer() {
  const devices = new Map<string, { publicJwk: string; name: string; wrappedCsk: string | null }>();
  const ciphers = new Map<string, string>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://api');
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
      const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });
      const wrapMatch = /\/me\/store-sync\/devices\/([^/]+)\/wrap$/.exec(url.pathname);
      const connMatch = /\/me\/store-sync\/connections\/([^/]+)$/.exec(url.pathname);

      if (url.pathname === '/me/store-sync/devices' && method === 'POST') {
        const existing = devices.get(body.deviceId);
        devices.set(body.deviceId, {
          publicJwk: body.publicJwk,
          name: body.name,
          wrappedCsk: existing && existing.publicJwk === body.publicJwk ? existing.wrappedCsk : null,
        });
        return json({});
      }
      if (url.pathname === '/me/store-sync/devices' && method === 'GET') {
        return json([...devices.entries()].map(([deviceId, d]) => ({ deviceId, publicJwk: d.publicJwk, name: d.name, hasWrap: !!d.wrappedCsk, createdAt: '2026-07-17' })));
      }
      if (wrapMatch && method === 'POST') {
        const device = devices.get(decodeURIComponent(wrapMatch[1]));
        if (!device) return json({}, 404);
        device.wrappedCsk = body.wrappedCsk;
        return json({});
      }
      if (wrapMatch && method === 'GET') {
        const device = devices.get(decodeURIComponent(wrapMatch[1]));
        return device?.wrappedCsk ? json({ wrappedCsk: device.wrappedCsk }) : new Response(null, { status: 204 });
      }
      if (connMatch && method === 'PUT') {
        ciphers.set(decodeURIComponent(connMatch[1]), body.cipher);
        return json({});
      }
      if (url.pathname === '/me/store-sync/connections' && method === 'GET') {
        return json([...ciphers.entries()].map(([store, cipher]) => ({ store, cipher, updatedAt: '2026-07-17' })));
      }
      if (url.pathname === '/me/store-sync' && method === 'DELETE') {
        devices.clear();
        ciphers.clear();
        return json({});
      }
      return json({}, 404);
    }),
  );
  return { devices, ciphers };
}

describe('E2EE store-connection sync (two devices, real crypto)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const s of stores.splice(0)) await s.destroy();
  });

  const backend = () => {
    const b = new DexieBackend(new MunniDB(`munni_ss_${Math.random().toString(36).slice(2)}`));
    stores.push(b);
    return b;
  };

  it('phone enables, desktop enrolls, approval hands the tokens over — all ciphertext', async () => {
    const server = fakeServer();
    const phone = backend();
    const desktop = backend();

    // phone: connect AH locally, turn sync on
    await phone.storeConnPut({ id: 'ah', store: 'ah', tokens: { access: 'tok-access', refresh: 'tok-refresh' }, refreshedAt: '2026-07-17T10:00:00Z', status: 'ok' });
    await enableStoreSync(phone);
    await pushConnection(phone, (await phone.storeConnGet('ah'))!);
    // the server never sees plaintext
    expect([...server.ciphers.values()].join()).not.toContain('tok-access');

    // desktop: fresh device asks to join — no tokens yet, wrap pending
    await requestEnrollment(desktop);
    expect(await adoptWrapIfApproved(desktop)).toBe(false);

    // phone approves the desktop (after the human fingerprint check)
    const pending = (await listSyncDevices()).find((d) => !d.hasWrap)!;
    await approveDevice(phone, pending);

    // desktop adopts the wrap and decrypts the connection
    expect(await adoptWrapIfApproved(desktop)).toBe(true);
    const adopted = await desktop.storeConnGet('ah');
    expect(adopted?.tokens.access).toBe('tok-access');
  });

  it('pull adopts only fresher tokens; global off wipes the server', async () => {
    fakeServer();
    const phone = backend();
    await phone.storeConnPut({ id: 'ah', store: 'ah', tokens: { access: 'old' }, refreshedAt: '2026-07-17T10:00:00Z', status: 'ok' });
    await enableStoreSync(phone);
    await pushConnection(phone, (await phone.storeConnGet('ah'))!);

    // local copy got newer meanwhile — the pull must not clobber it
    await phone.storeConnPut({ id: 'ah', store: 'ah', tokens: { access: 'newer' }, refreshedAt: '2026-07-17T12:00:00Z', status: 'ok' });
    expect(await pullConnections(phone)).toBe(0);
    expect((await phone.storeConnGet('ah'))?.tokens.access).toBe('newer');

    await disableStoreSync(phone);
    expect(await listSyncDevices()).toEqual([]);
  });
});
