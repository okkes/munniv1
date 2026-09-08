// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_TEST_DB, renderApp, renderAppAsUser } from '@/test/harness';

const ME = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const CARA = '33333333-3333-3333-3333-333333333333';

describe('FriendsScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
    indexedDB.deleteDatabase('munni_demo');
  });

  it('demo identities see the requires-account note instead of the tools', async () => {
    renderApp('/friends');
    expect(await screen.findByTestId('friends-requires-account')).toBeTruthy();
    expect(screen.queryByTestId('friends-add-input')).toBeNull();
  });

  it('lists friends and pending requests; accept and remove round-trip', async () => {
    let friends = [{ userId: BOB, displayName: 'Bob', picture: null }];
    let received = [{ id: 'r1', fromUserId: CARA, fromName: 'Cara', toUserId: ME, toName: null }];
    const calls: string[] = [];
    renderAppAsUser('/friends', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /friends': () => ({ friends, sentPending: [], receivedPending: received }),
        'POST /friends/requests/r1/accept': () => {
          calls.push('accept');
          friends = [...friends, { userId: CARA, displayName: 'Cara', picture: null }];
          received = [];
          return {};
        },
        [`DELETE /friends/${BOB}`]: () => {
          calls.push('remove');
          friends = friends.filter((f) => f.userId !== BOB);
          return {};
        },
      },
    });

    // pending request from Cara is visible and acceptable
    fireEvent.click(await screen.findByTestId('friends-accept-r1'));
    await waitFor(() => expect(screen.queryByTestId('friends-received')).toBeNull());
    expect(screen.getByTestId('friends-list').textContent).toContain('Cara');

    // removing Bob asks first, then shrinks the list
    fireEvent.click(screen.getByTestId(`friends-remove-${BOB}`));
    expect((await screen.findByTestId('friends-remove-text')).textContent).toContain('Bob');
    fireEvent.click(screen.getByTestId('friends-remove-confirm'));
    await waitFor(() => expect(screen.getByTestId('friends-list').textContent).not.toContain('Bob'));
    expect(calls).toEqual(['accept', 'remove']);
  }, 15_000);

  it('sends a friend request from the id box', async () => {
    const requests: unknown[] = [];
    let sent: { id: string; fromUserId: string; fromName: string | null; toUserId: string; toName: string | null }[] = [];
    renderAppAsUser('/friends', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /friends': () => ({ friends: [], sentPending: sent, receivedPending: [] }),
        'POST /friends/requests': (body) => {
          requests.push(body);
          sent = [{ id: 's1', fromUserId: ME, fromName: null, toUserId: BOB, toName: 'Bob' }];
          return {};
        },
      },
    });

    fireEvent.change(await screen.findByTestId('friends-add-input'), { target: { value: ` ${BOB} ` } });
    fireEvent.click(screen.getByTestId('friends-add-send'));
    await screen.findByTestId('friends-sent');
    expect(requests).toEqual([{ toUserId: BOB }]); // trimmed
    expect((screen.getByTestId('friends-add-input') as HTMLInputElement).value).toBe('');
  }, 15_000);
});
