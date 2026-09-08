// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_TEST_DB, renderAppAsUser } from '@/test/harness';

describe('NotificationsBell (user identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  it('counts pending requests + invites + the fresh what’s-new; rows lead to their screens', async () => {
    renderAppAsUser('/home', {
      api: {
        'GET /friends': () => ({
          friends: [],
          sentPending: [],
          receivedPending: [{ id: 'r1', fromUserId: 'u-carol', fromName: 'Carol' }],
        }),
        'GET /me/invites': () => [
          { id: 'i1', spaceId: 's-shared', spaceName: 'Household', fromName: 'Bob' },
        ],
        'GET /me': () => ({ userId: 'test-user' }),
      },
    });
    await screen.findByTestId('screen-home');

    // 2 server alerts + 1 unread inbox entry (this release's what's-new)
    await waitFor(() => expect(screen.getByTestId('home-notifications-badge').textContent).toBe('3'), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('home-notifications'));
    expect((await screen.findByTestId('notif-request-r1')).textContent).toContain('Carol');
    expect(screen.getByTestId('notif-invite-i1').textContent).toContain('Household');

    // a row leads to where the decision is made
    fireEvent.click(screen.getByTestId('notif-invite-i1'));
    expect(await screen.findByTestId('screen-spaces')).toBeTruthy();
  }, 15_000);

  it('opening the Notifications tab clears the inbox share of the badge (arc 6)', async () => {
    renderAppAsUser('/home', {
      api: {
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
        'GET /me/invites': () => [],
      },
    });
    await screen.findByTestId('screen-home');
    // fresh identity: the release's what's-new is the one unread entry
    await waitFor(() => expect(screen.getByTestId('home-notifications-badge').textContent).toBe('1'), { timeout: 5000 });

    // opening the tab stamps notifSeenAt — the badge clears, the row stays
    fireEvent.click(screen.getByTestId('home-notifications'));
    await waitFor(() => {
      expect(document.querySelector('[data-testid^="notif-inbox-"]')).toBeTruthy();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('home-notifications-badge')).toBeNull(), { timeout: 5000 });
  }, 15_000);

  it('the Activity tab keeps the audit trail behind the same bell', async () => {
    renderAppAsUser('/home', {
      api: {
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
        'GET /me/invites': () => [],
      },
    });
    await screen.findByTestId('screen-home');
    fireEvent.click(await screen.findByTestId('home-notifications'));
    fireEvent.click(await screen.findByTestId('notif-tab-activity'));
    expect(await screen.findByTestId('history-empty')).toBeTruthy();
  }, 15_000);
});
