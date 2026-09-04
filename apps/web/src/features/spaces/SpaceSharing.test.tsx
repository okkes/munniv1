// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_TEST_DB, renderAppAsUser } from '@/test/harness';

const ME = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

const member = (userId: string, name: string, role: string) => ({ userId, displayName: name, role, picture: null });

describe('SpaceSharing (user identity, scripted server)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  it('a locked space disables inviting with an explainer (arc 4)', async () => {
    renderAppAsUser('/spaces/s-user/members', {
      spaces: [{ id: 's-user', name: 'Personal', inviteLock: 1 }],
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => [member(ME, 'Me', 'owner')],
        'GET /friends': () => ({ friends: [{ userId: BOB, displayName: 'Bob' }], sentPending: [], receivedPending: [] }),
        'GET /spaces/s-user/invites': () => [],
      },
    });

    // the explainer replaces every invite tool — no friend chips, no
    // add-friend form; the lock lifts in the space's settings
    expect(await screen.findByTestId('space-invite-locked')).toBeTruthy();
    expect(screen.queryByTestId(`space-invite-${BOB}`)).toBeNull();
    expect(screen.queryByTestId('space-addfriend-input')).toBeNull();
  }, 15_000);

  it('owner invites a friend: feedback note, pending row, revoke', async () => {
    let outgoing: { id: string; toUserId: string; toName: string; role: string }[] = [];
    const sentBodies: unknown[] = [];
    renderAppAsUser('/spaces/s-user/members', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => [member(ME, 'Me', 'owner')],
        'GET /friends': () => ({ friends: [{ userId: BOB, displayName: 'Bob' }], sentPending: [], receivedPending: [] }),
        'GET /spaces/s-user/invites': () => outgoing,
        'POST /spaces/s-user/invites': (body) => {
          sentBodies.push(body);
          outgoing = [{ id: 'inv1', toUserId: BOB, toName: 'Bob', role: 'contributor' }];
          return {};
        },
        'DELETE /spaces/invites/inv1': () => {
          outgoing = [];
          return {};
        },
      },
    });

    fireEvent.click(await screen.findByTestId(`space-invite-${BOB}`));
    // real feedback: sent note + a pending row with a revoke control
    expect(await screen.findByTestId('space-invite-sent')).toBeTruthy();
    await screen.findByTestId('space-invite-revoke-inv1');
    expect(screen.queryByTestId(`space-invite-${BOB}`)).toBeNull(); // chip left the invitable list
    expect(sentBodies[0]).toMatchObject({ toUserId: BOB, role: 'contributor' });

    fireEvent.click(screen.getByTestId('space-invite-revoke-inv1'));
    await waitFor(() => expect(screen.queryByTestId('space-invite-revoke-inv1')).toBeNull());
    // the friend becomes invitable again
    expect(await screen.findByTestId(`space-invite-${BOB}`)).toBeTruthy();
  }, 15_000);

  it('owner adjusts roles, kicks a member, and can send an inline friend request', async () => {
    let members = [member(ME, 'Me', 'owner'), member(BOB, 'Bob', 'contributor')];
    const roleChanges: unknown[] = [];
    const friendRequests: unknown[] = [];
    renderAppAsUser('/spaces/s-user/members', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => members,
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
        'GET /spaces/s-user/invites': () => [],
        [`PUT /spaces/s-user/members/${BOB}/role`]: (body) => {
          roleChanges.push(body);
          members = [members[0], { ...members[1], role: 'reader' }];
          return {};
        },
        [`DELETE /spaces/s-user/members/${BOB}`]: () => {
          members = [members[0]];
          return {};
        },
        'POST /friends/requests': (body) => {
          friendRequests.push(body);
          return {};
        },
      },
    });

    // owners assign roles via the select
    fireEvent.change(await screen.findByTestId(`space-role-${BOB}`), { target: { value: 'reader' } });
    await waitFor(() => expect(roleChanges).toEqual([{ role: 'reader' }]));

    // inline friend request (global friends stay the invite guard)
    fireEvent.change(screen.getByTestId('space-addfriend-input'), { target: { value: 'some-user-id' } });
    fireEvent.click(screen.getByTestId('space-addfriend-send'));
    expect(await screen.findByTestId('space-addfriend-sent')).toBeTruthy();
    expect(friendRequests).toEqual([{ toUserId: 'some-user-id' }]);

    // kicking asks first (user request): the X opens a confirm sheet
    fireEvent.click(screen.getByTestId(`space-kick-${BOB}`));
    expect((await screen.findByTestId('space-kick-body')).textContent).toContain('Bob');
    fireEvent.click(screen.getByTestId('space-kick-confirm'));
    await waitFor(() => expect(screen.queryByTestId(`space-kick-${BOB}`)).toBeNull());
  }, 15_000);

  it('a reader sees the read-only note on space settings', async () => {
    renderAppAsUser('/spaces/s-user', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => [member(BOB, 'Bob', 'owner'), member(ME, 'Me', 'reader')],
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
        'GET /spaces/s-user/invites': () => new Response('', { status: 403 }), // not an owner
      },
    });

    // the settings screen learns the role through useMyRole now
    expect(await screen.findByTestId('space-reader-note')).toBeTruthy();
  }, 15_000);

  it('a member leaves the space from space settings: server removal, then local purge', async () => {
    const removals: string[] = [];
    renderAppAsUser('/spaces/s-user', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => [member(BOB, 'Bob', 'owner'), member(ME, 'Me', 'contributor')],
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
        'GET /spaces/s-user/invites': () => new Response('', { status: 403 }),
        [`DELETE /spaces/s-user/members/${ME}`]: () => {
          removals.push(ME);
          return {};
        },
      },
    });

    // two-tap confirm, mirroring delete
    fireEvent.click(await screen.findByTestId('space-edit-leave'));
    await screen.findByTestId('space-leave-confirm-note');
    fireEvent.click(screen.getByTestId('space-edit-leave'));

    await screen.findByTestId('screen-spaces', {}, { timeout: 5000 });
    expect(removals).toEqual([ME]);
    // the local copy of the space is gone (feed access ends server-side)
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB(USER_TEST_DB);
    await waitFor(async () => expect(await db.spaces.get('s-user')).toBeUndefined());
    db.close();
  }, 15_000);

  it('a reader sees no invite tools on the members screen', async () => {
    // reached from Settings now — the space-settings doors are gone
    renderAppAsUser('/spaces/s-user/members', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => [member(BOB, 'Bob', 'owner'), member(ME, 'Me', 'reader')],
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
        'GET /spaces/s-user/invites': () => new Response('', { status: 403 }), // not an owner
      },
    });

    await screen.findByTestId('screen-space-members');
    await waitFor(() => expect(screen.queryByTestId('space-addfriend-input')).toBeNull());
    // non-owners cannot kick or re-role anyone
    expect(screen.queryByTestId(`space-kick-${BOB}`)).toBeNull();
    expect(screen.queryByTestId(`space-role-${BOB}`)).toBeNull();
  }, 15_000);

  it('pending space invites show on the Spaces tab; accepting clears the banner', async () => {
    let invites = [
      { id: 'i1', spaceId: 's-new', spaceName: 'Big Family', fromUserId: BOB, fromName: 'Bob', role: 'contributor' },
    ];
    const responses: string[] = [];
    renderAppAsUser('/spaces', {
      api: {
        'GET /me/invites': () => invites,
        'POST /spaces/invites/i1/accept': () => {
          responses.push('accept');
          invites = [];
          return {};
        },
      },
    });

    const banner = await screen.findByTestId('space-invites');
    expect(banner.textContent).toContain('Big Family');
    expect(banner.textContent).toContain('Bob');

    fireEvent.click(screen.getByTestId('space-invite-accept-i1'));
    await waitFor(() => expect(screen.queryByTestId('space-invites')).toBeNull());
    expect(responses).toEqual(['accept']);
  }, 15_000);
});
