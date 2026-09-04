// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { MunniDB } from '@/db/schema';
import { DexieBackend } from '@/db/backend';
import { appendNotification, readInbox, stampNotifSeen, unreadNotifCount } from './notifications';

describe('notification inbox (arc 6)', () => {
  const stores: DexieBackend[] = [];
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.destroy();
  });
  const fresh = () => {
    const store = new DexieBackend(new MunniDB(`munni_ni_${Math.random().toString(36).slice(2)}`));
    stores.push(store);
    return store;
  };

  it('appends newest-first; a dedupe key makes an event once-only', async () => {
    const store = fresh();
    await appendNotification(store, 'whatsnew', { version: '2.27.0' }, 'v2.27.0');
    await appendNotification(store, 'recurringDue', { name: 'Rent', date: '1 Aug' }, 'rec_1');
    // the same version again is a no-op
    await appendNotification(store, 'whatsnew', { version: '2.27.0' }, 'v2.27.0');

    const list = await readInbox(store);
    expect(list).toHaveLength(2);
    expect(list[0].kind).toBe('recurringDue');
    expect(list[1].payload?.version).toBe('2.27.0');
  });

  it('caps the list at 50 — the oldest fall off', async () => {
    const store = fresh();
    for (let i = 0; i < 55; i++) await appendNotification(store, 'digest', { n: String(i) });
    const list = await readInbox(store);
    expect(list).toHaveLength(50);
    expect(list[0].payload?.n).toBe('54'); // newest survives on top
  });

  it('unread counts entries newer than the stamp; opening the tab clears it', async () => {
    const store = fresh();
    await appendNotification(store, 'debtRate', { name: 'Car loan' });
    await appendNotification(store, 'digest', { n: '3' });
    expect(await unreadNotifCount(store)).toBe(2);

    await stampNotifSeen(store);
    expect(await unreadNotifCount(store)).toBe(0);

    // a later arrival counts again
    await new Promise((r) => setTimeout(r, 5));
    await appendNotification(store, 'debtRate', { name: 'Car loan' });
    expect(await unreadNotifCount(store)).toBe(1);
  });
});
