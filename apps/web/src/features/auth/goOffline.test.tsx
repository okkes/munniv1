// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_TEST_DB, USER_TEST_SUB, renderAppAsUser } from '@/test/harness';
import { useSession, identityKey } from '@/app/session';
import { listOfflineProfiles } from './offlineProfiles';

/** online → offline conversion (OO1-OO3): identity rebind adopting the
 *  existing store, per-space triage, bank accounts → manual */
describe('Go offline (user identity, scripted server)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  const seedStore = async () => {
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('space', 'sh-1', 'sh-1', { name: 'Family', kind: 'shared', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await repo.upsert('transaction', 'sh-1', 'tx-sh', { accountId: 'feedacct-1', date: '2026-07-01', amountCents: -500, currency: 'EUR', merchant: 'Bakery' });
    await repo.upsert('account', 'feed-1', 'feedacct-1', {
      name: 'ING Betaal',
      type: 'checking',
      source: 'gocardless',
      currency: 'EUR',
      balanceCents: 5000,
      iban: 'NL69INGB0123456789',
    });
    db.close();
  };

  const api = (calls: string[]) => ({
    'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false } }),
    'GET /me/spaces': () => ['s-user', 'sh-1', 'feed-1'],
    'GET /me/feeds': () => [{ feedSpaceId: 'feed-1' }],
    'GET /me': () => ({ userId: '00000000-0000-0000-0000-000000000001', displayName: 'Okkes', picture: null }),
    'DELETE /me': () => {
      calls.push('delete-me');
      return { deleted: true };
    },
  });

  it('converts: rebinds the store, flips bank accounts to manual, purges dropped spaces, deletes server data', async () => {
    await seedStore();
    const calls: string[] = [];
    renderAppAsUser('/settings/go-offline', { spaces: [{ id: 's-user', name: 'Personal' }], api: api(calls) });

    await screen.findByTestId('screen-go-offline');
    expect(screen.getByTestId('gooffline-keep-card')).toBeTruthy();
    // the shared space offers keep/remove — choose remove
    fireEvent.click(await screen.findByTestId('gooffline-drop-sh-1', {}, { timeout: 5000 }));

    fireEvent.click(screen.getByTestId('gooffline-open-confirm'));
    // danger sheet (cooldown 0 in tests)
    fireEvent.click(await screen.findByTestId('gooffline-confirm', {}, { timeout: 5000 }));

    // the app relaunches as the offline profile on Home
    await waitFor(() => expect(useSession.getState().identity?.kind).toBe('offline'), { timeout: 8000 });
    await screen.findByTestId('screen-home', {}, { timeout: 8000 });

    // server: clean exit
    await waitFor(() => expect(calls).toContain('delete-me'));

    // registry: ONE profile, adopting the user store
    const profile = listOfflineProfiles()[0];
    expect(profile?.storeKey).toBe(`user_${USER_TEST_SUB}`);
    expect(identityKey({ kind: 'offline', profileId: profile.id })).toBe(`user_${USER_TEST_SUB}`);

    // the SAME database: bank account flipped to manual, dropped space purged
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB(USER_TEST_DB);
    await waitFor(
      async () => {
        expect((await db.accounts.get('feedacct-1'))?.source).toBe('manual');
        expect(await db.spaces.get('sh-1')).toBeUndefined();
        expect(await db.transactions.get('tx-sh')).toBeUndefined();
      },
      { timeout: 5000 },
    );
    db.close();
  }, 20_000);

  it('keeping the snapshot leaves the space locally; the server account is deleted either way', async () => {
    await seedStore();
    const calls: string[] = [];
    renderAppAsUser('/settings/go-offline', { spaces: [{ id: 's-user', name: 'Personal' }], api: api(calls) });

    await screen.findByTestId('screen-go-offline');
    await screen.findByTestId('gooffline-keep-sh-1', {}, { timeout: 5000 }); // default = keep

    fireEvent.click(screen.getByTestId('gooffline-open-confirm'));
    fireEvent.click(await screen.findByTestId('gooffline-confirm', {}, { timeout: 5000 }));

    await waitFor(() => expect(useSession.getState().identity?.kind).toBe('offline'), { timeout: 8000 });
    // always a clean exit (user ruling) — but keepIdentity spares the login
    await waitFor(() => expect(calls).toContain('delete-me'));

    // the snapshot survives in the adopted store
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB(USER_TEST_DB);
    await waitFor(async () => {
      expect((await db.spaces.get('sh-1'))?.name).toBe('Family');
      expect((await db.transactions.get('tx-sh'))?.merchant).toBe('Bakery');
    });
    db.close();
  }, 20_000);

  it('converts happily next to an existing offline profile (arc 8)', async () => {
    await seedStore();
    localStorage.setItem(
      'munni_offline_profiles',
      JSON.stringify([{ id: 'p1', name: 'Existing', createdAt: 1 }]),
    );
    renderAppAsUser('/settings/go-offline', { spaces: [{ id: 's-user', name: 'Personal' }], api: api([]) });

    // the one-per-device refusal is gone: no blocked note, the confirm arms
    await screen.findByTestId('screen-go-offline');
    expect(screen.queryByTestId('gooffline-blocked')).toBeNull();
    expect((screen.getByTestId('gooffline-open-confirm') as HTMLButtonElement).disabled).toBe(false);
  }, 15_000);
});
