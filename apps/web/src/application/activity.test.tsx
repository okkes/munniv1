// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';
import { ACTIVITY_CAP, logActivity, logRowActivity, pruneActivity } from './activity';

describe('activity history', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
    indexedDB.deleteDatabase('munni_act_test');
  });

  it('logActivity appends who-did-what and prunes beyond the cap', async () => {
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB('munni_act_test');
    const store = new DexieBackend(db);
    const repo = new Repo(store, new HlcClock('t'), { trackOutbox: false });
    await store.metaPut('profile', { name: 'Okkes' });

    await logActivity(store, repo, 's1', 'txAdd', 'Coffee');
    let rows = (await store.bySpace('activity', 's1')).filter((r) => r.deleted === 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorName).toBe('Okkes');
    expect(rows[0].kind).toBe('txAdd');
    expect(rows[0].detail).toBe('Coffee');

    // stuff the log past the cap, then one prune pass trims to the cap
    for (let i = 0; i < ACTIVITY_CAP + 10; i++) {
      await repo.upsert('activity', 's1', repo.newId(), {
        kind: 'note',
        at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      });
    }
    await pruneActivity(store, repo, 's1');
    rows = (await store.bySpace('activity', 's1')).filter((r) => r.deleted === 0);
    // the 2026-01-01 seeds are older than the 90-day age bound too, so
    // the age rule removes them all — only the fresh first row survives
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toBe('Coffee');

    // rows within the age window prune by COUNT only
    for (let i = 0; i < ACTIVITY_CAP + 10; i++) {
      await repo.upsert('activity', 's2', repo.newId(), {
        kind: 'note',
        at: new Date(Date.now() - i * 1000).toISOString(),
      });
    }
    await pruneActivity(store, repo, 's2');
    rows = (await store.bySpace('activity', 's2')).filter((r) => r.deleted === 0);
    expect(rows).toHaveLength(ACTIVITY_CAP);
    // the newest rows survive — the seconds run up to CAP+9, so the very
    // first (i=0 …) seeded rows are the pruned ones
    const times = rows.map((r) => r.at).sort((a, b) => a.localeCompare(b));
    expect(times[0] > new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString()).toBe(true);
    db.close();
  });

  it('logRowActivity resolves the row name when the patch has none', async () => {
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB('munni_act_test');
    const store = new DexieBackend(db);
    const repo = new Repo(store, new HlcClock('t'), { trackOutbox: false });
    await repo.upsert('budget', 's1', 'b1', { name: 'Groceries' });

    // no explicit name: the helper reads it off the stored row
    await logRowActivity(store, repo, 's1', 'budget', 'b1', 'budgetEdit');
    // explicit name wins without a lookup
    await logRowActivity(store, repo, 's1', 'budget', 'b1', 'budgetRemove', 'Renamed');
    const rows = (await store.bySpace('activity', 's1')).filter((r) => r.deleted === 0);
    expect(rows.map((r) => [r.kind, r.detail]).sort()).toEqual([
      ['budgetEdit', 'Groceries'],
      ['budgetRemove', 'Renamed'],
    ]);
    db.close();
  });

  it('a manual transaction shows up in the bell history tab', async () => {
    renderApp('/transactions');
    await screen.findByTestId('tx-list');
    fireEvent.click(screen.getByTestId('tx-add'));
    fireEvent.change(await screen.findByTestId('txform-amount'), { target: { value: '4,50' } });
    fireEvent.change(screen.getByTestId('txform-merchant'), { target: { value: 'Bakery' } });
    // two demo manual accounts → the account must be picked explicitly
    fireEvent.click(await screen.findByTestId('txform-account'));
    fireEvent.click(await screen.findByTestId('txform-account-demo_main'));
    fireEvent.click(screen.getByTestId('txform-save'));
    await waitFor(() => expect(screen.getByTestId('tx-list').textContent).toContain('Bakery'));

    fireEvent.click(screen.getAllByTestId('tab-home')[0]);
    await screen.findByTestId('screen-home');
    fireEvent.click(screen.getByTestId('home-notifications'));
    // the audit trail lives on the Activity tab now (arc 6)
    fireEvent.click(await screen.findByTestId('notif-tab-activity'));
    const list = await screen.findByTestId('history-list');
    expect(list.textContent).toContain('Bakery');

    // only the person is tappable (user rule): the row itself is not a
    // button; clicking the actor name opens my profile
    const row = list.querySelector('[data-testid^="history-row-"]');
    expect(row?.tagName).not.toBe('BUTTON');
    const actorButton = list.querySelector('[data-testid^="history-actor-"]') as HTMLElement;
    fireEvent.click(actorButton);
    await screen.findByTestId('screen-profile');
  }, 15_000);
});
