// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildNotification, readWorkerLang } from './swNotifications';

describe('buildNotification', () => {
  it('announces new transactions with count, per-space tag and a pre-sync pull', () => {
    const one = buildNotification({ type: 'new-transactions', spaceId: 's1', count: 1 }, 'en')!;
    expect(one).toMatchObject({ body: '1 new transaction arrived', tag: 'new-tx-s1', pull: true, pullSpaceId: 's1' });
    const many = buildNotification({ type: 'new-transactions', count: 7 }, 'nl')!;
    expect(many.body).toBe('7 nieuwe transacties ontvangen');
    expect(many.tag).toBe('new-tx-all');
  });

  it('localizes social events and routes their clicks', () => {
    const request = buildNotification({ type: 'friend-request', fromName: 'Elif' }, 'tr')!;
    expect(request.body).toBe('Elif sana arkadaşlık isteği gönderdi');
    expect(request).toMatchObject({ url: './#/friends', pull: false });

    const invite = buildNotification({ type: 'space-invite', fromName: 'Elif', spaceName: 'Big Family' }, 'en')!;
    expect(invite.body).toBe('Elif invited you to "Big Family"');
    expect(invite.url).toBe('./#/spaces');

    const join = buildNotification({ type: 'space-join', spaceName: 'Big Family' }, 'nl')!;
    expect(join.body).toBe('Iemand doet nu mee in "Big Family"'); // missing name falls back
  });

  it('unknown payloads and unknown languages degrade safely', () => {
    expect(buildNotification({ type: 'mystery' }, 'en')).toBeNull();
    expect(buildNotification({}, 'en')).toBeNull();
    const fallback = buildNotification({ type: 'friend-accept', fromName: 'Bob' }, 'xx')!;
    expect(fallback.body).toBe('Bob accepted your friend request'); // en fallback
  });
});

describe('readWorkerLang', () => {
  it("returns the mirrored language, or 'en' when nothing is stored", async () => {
    expect(await readWorkerLang()).toBe('en');
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('munni_sw', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onsuccess = () => {
        const txn = open.result.transaction('kv', 'readwrite');
        txn.objectStore('kv').put('tr', 'lang');
        txn.oncomplete = () => {
          open.result.close();
          resolve();
        };
        txn.onerror = () => reject(txn.error as Error);
      };
      open.onerror = () => reject(open.error as Error);
    });
    expect(await readWorkerLang()).toBe('tr');
  });
});
