// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

    // #165: the row opens the profile sheet with the FULL id; removal
    // moved there (the list has no trash button anymore)
    expect(screen.queryByTestId(`friends-remove-${BOB}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`friends-row-${BOB}`));
    expect((await screen.findByTestId('friend-profile-id')).textContent).toBe(BOB);
    fireEvent.click(screen.getByTestId('friend-profile-remove'));
    expect((await screen.findByTestId('friends-remove-text')).textContent).toContain('Bob');
    fireEvent.click(screen.getByTestId('friends-remove-confirm'));
    await waitFor(() => expect(screen.getByTestId('friends-list').textContent).not.toContain('Bob'));
    expect(calls).toEqual(['accept', 'remove']);
  }, 15_000);

  it('the profile sheet copies the full id and zooms a real picture (#165)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderAppAsUser('/friends', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /friends': () => ({
          friends: [{ userId: BOB, displayName: 'Bob', picture: 'data:image/png;base64,x' }],
          sentPending: [],
          receivedPending: [],
        }),
      },
    });

    fireEvent.click(await screen.findByTestId(`friends-row-${BOB}`));
    await screen.findByTestId('friend-profile-sheet');
    fireEvent.click(await screen.findByTestId('friend-profile-copy'));
    expect(writeText).toHaveBeenCalledWith(BOB);

    // tapping the avatar opens the fullscreen viewer; any click closes it
    fireEvent.click(screen.getByTestId('friend-profile-avatar'));
    fireEvent.click(await screen.findByTestId('friend-picture-viewer'));
    await waitFor(() => expect(screen.queryByTestId('friend-picture-viewer')).toBeNull());
  }, 15_000);

  it('a space-carrying request explains that accepting also joins (#169)', async () => {
    renderAppAsUser('/friends', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /friends': () => ({
          friends: [],
          sentPending: [],
          receivedPending: [
            { id: 'r1', fromUserId: CARA, fromName: 'Cara', toUserId: ME, toName: null, spaceName: 'Big Family' },
          ],
        }),
      },
    });

    const received = await screen.findByTestId('friends-received');
    await waitFor(() => expect(received.textContent).toContain('Accepting also joins Big Family'));
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

    // #195: an empty click never disables the button — it says why
    const send = (await screen.findByTestId('friends-add-send')) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(await screen.findByTestId('friends-add-blocker')).toBeTruthy();
    expect(requests).toEqual([]); // nothing was sent

    fireEvent.change(await screen.findByTestId('friends-add-input'), { target: { value: ` ${BOB} ` } });
    fireEvent.click(screen.getByTestId('friends-add-send'));
    await screen.findByTestId('friends-sent');
    expect(requests).toEqual([{ toUserId: BOB }]); // trimmed, no space piggyback
    expect((screen.getByTestId('friends-add-input') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('friends-add-blocker')).toBeNull(); // cleared on success
  }, 15_000);

  it('#291: a 404 send says "no such user" at the field and pends nothing', async () => {
    const requests: unknown[] = [];
    renderAppAsUser('/friends', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
        'POST /friends/requests': (body) => {
          requests.push(body);
          return new Response('', { status: 404 });
        },
      },
    });

    fireEvent.change(await screen.findByTestId('friends-add-input'), { target: { value: 'ghost-id' } });
    fireEvent.click(screen.getByTestId('friends-add-send'));
    expect(await screen.findByTestId('friends-add-notfound')).toBeTruthy();
    expect(requests).toHaveLength(1);
    // nothing pends and the typed id stays put for fixing
    expect(screen.queryByTestId('friends-sent')).toBeNull();
    expect((screen.getByTestId('friends-add-input') as HTMLInputElement).value).toBe('ghost-id');

    // typing again clears the field error
    fireEvent.change(screen.getByTestId('friends-add-input'), { target: { value: 'ghost-i' } });
    await waitFor(() => expect(screen.queryByTestId('friends-add-notfound')).toBeNull());
  }, 15_000);

  it('#277 r2: accepting a space-carrying request stamps the arriving space shared', async () => {
    let joined = false;
    renderAppAsUser('/friends', {
      // Big Family exists server-side; /me/spaces admits it only after
      // the accept — exactly how a joiner first meets the space
      spaces: [
        { id: 's-user', name: 'Personal' },
        { id: 's-fam', name: 'Big Family' },
      ],
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/spaces': () => (joined ? ['s-user', 's-fam'] : ['s-user']),
        'GET /friends': () => ({
          friends: [],
          sentPending: [],
          receivedPending: joined
            ? []
            : [{ id: 'r1', fromUserId: CARA, fromName: 'Cara', toUserId: ME, toName: null, spaceName: 'Big Family' }],
        }),
        'POST /friends/requests/r1/accept': () => {
          joined = true;
          return {};
        },
      },
    });

    fireEvent.click(await screen.findByTestId('friends-accept-r1'));

    // the synced-in row got the shared fact + the sender as creator
    // (the request names no space id — the stamp keys on what arrived NEW
    // wearing the request's space name)
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB(USER_TEST_DB);
    await waitFor(
      async () => {
        const row = await db.spaces.get('s-fam');
        expect(row?.kind).toBe('shared');
        expect(row?.createdByName).toBe('Cara');
      },
      { timeout: 10_000 },
    );
    // the personal space was never touched
    expect((await db.spaces.get('s-user'))?.kind).toBe('personal');
    db.close();
  }, 15_000);

  it('an add-friend handoff focuses the id input on arrival (#180)', async () => {
    const { setFriendsAddIntent } = await import('./friendsHandoff');
    setFriendsAddIntent();
    renderAppAsUser('/friends', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
      },
    });
    const input = await screen.findByTestId('friends-add-input');
    await waitFor(() => expect(document.activeElement).toBe(input));
  }, 15_000);
});
