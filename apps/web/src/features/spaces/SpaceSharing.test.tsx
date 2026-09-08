// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_TEST_DB, renderAppAsUser } from '@/test/harness';

const ME = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const CARA = '33333333-3333-3333-3333-333333333333';

const member = (userId: string, name: string, role: string) => ({ userId, displayName: name, role, picture: null });

describe('SpaceSharing (user identity, scripted server)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  it('a locked space disables inviting with an explainer; its quick link jumps to Settings (arc 4, #302)', async () => {
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

    // the explainer replaces every invite tool — no invite door (#304:
    // the one members-add button included); the lock lifts in Settings
    expect(await screen.findByTestId('space-invite-locked')).toBeTruthy();
    expect(screen.queryByTestId('space-members-add')).toBeNull();
    expect(screen.queryByTestId('space-addfriend-input')).toBeNull();

    // #302: the note carries a quick link straight to the setting
    fireEvent.click(screen.getByTestId('space-invite-locked-go'));
    expect(await screen.findByTestId('screen-settings', {}, { timeout: 5000 })).toBeTruthy();
  }, 15_000);

  it('owner invites via the ONE sheet: search narrows, role travels, cancel confirms (#170/#171/#304/#303)', async () => {
    let outgoing: { id: string; toUserId: string; toName: string; role: string }[] = [];
    const sentBodies: unknown[] = [];
    let revoked = 0;
    renderAppAsUser('/spaces/s-user/members', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => [member(ME, 'Me', 'owner')],
        'GET /friends': () => ({
          friends: [
            { userId: BOB, displayName: 'Bob' },
            { userId: CARA, displayName: 'Cara' },
          ],
          sentPending: [],
          receivedPending: [],
        }),
        'GET /spaces/s-user/invites': () => outgoing,
        'POST /spaces/s-user/invites': (body) => {
          sentBodies.push(body);
          outgoing = [{ id: 'inv1', toUserId: BOB, toName: 'Bob', role: 'reader' }];
          return {};
        },
        'DELETE /spaces/invites/inv1': () => {
          revoked += 1;
          outgoing = [];
          return {};
        },
      },
    });

    // #304: ONE action button opens the combined invite sheet
    fireEvent.click(await screen.findByTestId('space-members-add'));
    await screen.findByTestId('space-invite-sheet');
    await screen.findByTestId(`space-invite-row-${CARA}`);
    fireEvent.change(screen.getByTestId('space-invite-search'), { target: { value: 'bo' } });
    await waitFor(() => expect(screen.queryByTestId(`space-invite-row-${CARA}`)).toBeNull());

    // expanding shows the FULL id + the role picker (contributor default)
    fireEvent.click(screen.getByTestId(`space-invite-row-${BOB}`));
    expect((await screen.findByTestId('space-invite-full-id')).textContent).toBe(BOB);
    fireEvent.click(screen.getByTestId('space-invite-role-reader'));
    fireEvent.click(screen.getByTestId('space-invite-send'));

    // real feedback: sent note + a pending row with a cancel control
    expect(await screen.findByTestId('space-invite-sent')).toBeTruthy();
    const pendingRow = (await screen.findByTestId('space-invite-revoke-inv1')).closest('div')!;
    expect(sentBodies[0]).toMatchObject({ toUserId: BOB, role: 'reader', spaceName: 'Personal' });
    // #303: the pending row names the role the invite was sent with
    expect(pendingRow.textContent).toContain('Reader');

    // #303: the X asks first — dismissing keeps the invite alive
    fireEvent.click(screen.getByTestId('space-invite-revoke-inv1'));
    expect((await screen.findByTestId('space-revoke-body')).textContent).toContain('Bob');
    fireEvent.click(screen.getByTestId('space-revoke-cancel'));
    expect(revoked).toBe(0);
    expect(screen.getByTestId('space-invite-revoke-inv1')).toBeTruthy();

    // confirming cancels it server-side and the row vanishes
    fireEvent.click(screen.getByTestId('space-invite-revoke-inv1'));
    fireEvent.click(await screen.findByTestId('space-revoke-confirm'));
    await waitFor(() => expect(screen.queryByTestId('space-invite-revoke-inv1')).toBeNull());
    expect(revoked).toBe(1);
  }, 15_000);

  it('member rows open the sheet: member-since, role change and kick live there (#172)', async () => {
    let members = [
      member(ME, 'Me', 'owner'),
      { ...member(BOB, 'Bob', 'contributor'), joinedAt: '2026-03-05T12:00:00Z' },
    ];
    const roleChanges: unknown[] = [];
    let kickUrl: URL | null = null;
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
        [`DELETE /spaces/s-user/members/${BOB}`]: (_body, url) => {
          kickUrl = url;
          members = [members[0]];
          return {};
        },
      },
    });

    // the inline select and X are gone — the row opens the member sheet
    expect(screen.queryByTestId(`space-role-${BOB}`)).toBeNull();
    expect(screen.queryByTestId(`space-kick-${BOB}`)).toBeNull();
    fireEvent.click(await screen.findByTestId(`member-row-${BOB}`));
    expect((await screen.findByTestId('member-sheet-id')).textContent).toBe(BOB);
    expect(screen.getByTestId('member-sheet-since').textContent).toContain('2026');

    // owner changes the role from the sheet — the space name rides along
    fireEvent.click(screen.getByTestId('member-sheet-role-reader'));
    await waitFor(() => expect(roleChanges).toEqual([{ role: 'reader', spaceName: 'Personal' }]));

    // kicking still asks first; the DELETE carries the name for the push
    fireEvent.click(screen.getByTestId('member-sheet-remove'));
    expect((await screen.findByTestId('space-kick-body')).textContent).toContain('Bob');
    fireEvent.click(screen.getByTestId('space-kick-confirm'));
    await waitFor(() => expect(screen.queryByTestId(`member-row-${BOB}`)).toBeNull());
    expect(kickUrl!.searchParams.get('spaceName')).toBe('Personal');
  }, 15_000);

  it('adding a NEW person carries the space and the picked role (#169)', async () => {
    const friendRequests: unknown[] = [];
    renderAppAsUser('/spaces/s-user/members', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => [member(ME, 'Me', 'owner')],
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
        'GET /spaces/s-user/invites': () => [],
        'POST /friends/requests': (body) => {
          friendRequests.push(body);
          return {};
        },
      },
    });

    // #304: the request door lives INSIDE the one invite sheet now
    fireEvent.click(await screen.findByTestId('space-members-add'));
    await screen.findByTestId('space-invite-sheet');

    // #195: an empty send is refused with the blocker, nothing posted
    fireEvent.click(await screen.findByTestId('space-addfriend-send'));
    expect(await screen.findByTestId('space-addfriend-blocker')).toBeTruthy();
    expect(friendRequests).toEqual([]);

    // the note says what accepting will do; the role picker rides along
    expect(screen.getByTestId('space-addfriend-autonote').textContent).toContain('Personal');
    fireEvent.change(screen.getByTestId('space-addfriend-input'), { target: { value: 'some-user-id' } });
    fireEvent.click(screen.getByTestId('space-addfriend-role-reader'));
    fireEvent.click(screen.getByTestId('space-addfriend-send'));
    expect(await screen.findByTestId('space-addfriend-sent')).toBeTruthy();
    expect(friendRequests).toEqual([
      { toUserId: 'some-user-id', spaceId: 's-user', role: 'reader', spaceName: 'Personal' },
    ]);
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

    // #304: the countdown danger sheet, on the settings surface too
    fireEvent.click(await screen.findByTestId('space-edit-leave'));
    fireEvent.click(await screen.findByTestId('space-edit-leave-sheet-confirm'));

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
    expect(screen.queryByTestId('space-members-add')).toBeNull();
    // #172: rows still open the sheet, but it is read-only info — no
    // role control, no remove door
    fireEvent.click(await screen.findByTestId(`member-row-${BOB}`));
    await screen.findByTestId('member-sheet');
    expect(await screen.findByTestId('member-sheet-rolelabel')).toBeTruthy();
    expect(screen.queryByTestId('member-sheet-role-reader')).toBeNull();
    expect(screen.queryByTestId('member-sheet-remove')).toBeNull();
  }, 15_000);

  it('pending space invites show on the Spaces tab; accepting clears the banner and stamps the space shared (#277 r2)', async () => {
    let invites = [
      { id: 'i1', spaceId: 's-new', spaceName: 'Big Family', fromUserId: BOB, fromName: 'Bob', role: 'contributor' },
    ];
    const responses: string[] = [];
    renderAppAsUser('/spaces', {
      // the joined space syncs in still claiming kind personal — the
      // owner-side flip never reached this device
      spaces: [
        { id: 's-user', name: 'Personal' },
        { id: 's-new', name: 'Big Family' },
      ],
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

    // #277 r2 (user): the JOINER's copy now wears the badge too — the
    // accept path stamped kind shared + the inviter as the creator line
    expect(await screen.findByTestId('space-shared-badge-s-new', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId('space-row-s-new').textContent).toContain('Bob');
  }, 15_000);

  it('#277 r2 heal: a 2-member payload flips a joiner row that still says personal', async () => {
    const membersApi = {
      'GET /me': () => ({ userId: ME, displayName: 'Me' }),
      'GET /me/invites': () => [],
      'GET /spaces/s-user/members': () => [member(BOB, 'Bob', 'owner'), member(ME, 'Me', 'contributor')],
      'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
      'GET /spaces/s-user/invites': () => new Response('', { status: 403 }), // not an owner
    };
    renderAppAsUser('/spaces/s-user/members', {
      spaces: [{ id: 's-user', name: 'Family' }], // arrives kind personal
      api: membersApi,
    });

    // the member list loading IS the heal trigger
    await screen.findByTestId(`member-row-${BOB}`);
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB(USER_TEST_DB);
    await waitFor(async () => {
      const row = await db.spaces.get('s-user');
      expect(row?.kind).toBe('shared');
      expect(row?.createdByName).toBe('Bob'); // the payload's owner
    });
    db.close();

    // the spaces list reads the healed fact: badge + creator line
    cleanup();
    renderAppAsUser('/spaces', { spaces: [{ id: 's-user', name: 'Family' }], api: membersApi });
    expect(await screen.findByTestId('space-shared-badge-s-user', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByTestId('space-row-s-user').textContent).toContain('Bob');
  }, 15_000);

  it('#291: a friend request pends right there; 404 AND a malformed id both say no such user (r2)', async () => {
    let sent: { id: string; toUserId: string; toName: string | null; spaceName: string }[] = [];
    renderAppAsUser('/spaces/s-user/members', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => [member(ME, 'Me', 'owner')],
        'GET /friends': () => ({ friends: [], sentPending: sent, receivedPending: [] }),
        'GET /spaces/s-user/invites': () => [],
        'POST /friends/requests': (body) => {
          const to = (body as { toUserId: string }).toUserId;
          if (to === 'ghost') return new Response('', { status: 404 });
          // #291 r2: ToUserId is a Guid server-side — a malformed id dies
          // in model binding as a 400 before the 404 branch can answer
          if (to === 'not-a-guid') return new Response('', { status: 400 });
          sent = [
            { id: 's1', toUserId: BOB, toName: 'Bob', spaceName: 'Personal' },
            { id: 's2', toUserId: CARA, toName: 'Cara', spaceName: 'Elsewhere' },
          ];
          return {};
        },
      },
    });

    // #304: the request fields live inside the one invite sheet
    fireEvent.click(await screen.findByTestId('space-members-add'));
    await screen.findByTestId('space-invite-sheet');

    // an id nobody owns: field-level error, no "sent" claim, id kept
    fireEvent.change(await screen.findByTestId('space-addfriend-input'), { target: { value: 'ghost' } });
    fireEvent.click(screen.getByTestId('space-addfriend-send'));
    expect(await screen.findByTestId('space-addfriend-notfound')).toBeTruthy();
    expect(screen.queryByTestId('space-addfriend-sent')).toBeNull();
    expect((screen.getByTestId('space-addfriend-input') as HTMLInputElement).value).toBe('ghost');

    // #291 r2: a malformed (non-guid) id gets the SAME friendly answer —
    // the server's 400 used to leave the field silent
    fireEvent.change(screen.getByTestId('space-addfriend-input'), { target: { value: 'not-a-guid' } });
    await waitFor(() => expect(screen.queryByTestId('space-addfriend-notfound')).toBeNull());
    fireEvent.click(screen.getByTestId('space-addfriend-send'));
    expect(await screen.findByTestId('space-addfriend-notfound')).toBeTruthy();
    expect(screen.queryByTestId('space-addfriend-sent')).toBeNull();

    // typing clears the error; a real send pends IN the members surface
    fireEvent.change(screen.getByTestId('space-addfriend-input'), { target: { value: BOB } });
    await waitFor(() => expect(screen.queryByTestId('space-addfriend-notfound')).toBeNull());
    fireEvent.click(screen.getByTestId('space-addfriend-send'));
    const row = await screen.findByTestId(`space-friendpending-${BOB}`);
    expect(row.textContent).toContain('Bob');
    expect(row.textContent).toContain('Friend request pending');
    expect(await screen.findByTestId('space-addfriend-sent')).toBeTruthy();
    // …but only requests carrying THIS space's name
    expect(screen.queryByTestId(`space-friendpending-${CARA}`)).toBeNull();
  }, 15_000);

  it('#292/#304: the self row reads a bare "Me" with the mark AFTER it — a member NAMED Me gets neither', async () => {
    renderAppAsUser('/spaces/s-user/members', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Okkes' }),
        'GET /me/invites': () => [],
        // BOB tries to pose by naming himself "Me"
        'GET /spaces/s-user/members': () => [member(ME, 'Okkes', 'owner'), member(BOB, 'Me', 'contributor')],
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
        'GET /spaces/s-user/invites': () => [],
      },
    });

    // the genuine self row: authenticated-id match → "Me" + the mark;
    // #304 (user): the real-name suffix is gone, the mark FOLLOWS the name
    const selfRow = await screen.findByTestId(`member-row-${ME}`);
    const mark = await within(selfRow).findByTestId('member-me-icon');
    expect(selfRow.textContent).toContain('Me');
    expect(selfRow.textContent).not.toContain('Okkes');
    const name = within(selfRow).getByText('Me');
    // DOCUMENT_POSITION_FOLLOWING (4): the mark comes after the name
    expect(name.compareDocumentPosition(mark) & 4).toBe(4);

    // the impostor renders his NAME, unmarked
    const bobRow = screen.getByTestId(`member-row-${BOB}`);
    expect(within(bobRow).queryByTestId('member-me-icon')).toBeNull();
    expect(bobRow.textContent).toContain('Me');
    expect(bobRow.textContent).not.toContain('Okkes');
  }, 15_000);

  it('#304: leaving from the members screen asks with the aligned danger sheet, then removes + navigates', async () => {
    const removals: string[] = [];
    renderAppAsUser('/spaces/s-user/members', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => [member(BOB, 'Bob', 'owner'), member(ME, 'Me', 'contributor')],
        'GET /friends': () => ({ friends: [], sentPending: [], receivedPending: [] }),
        'GET /spaces/s-user/invites': () => new Response('', { status: 403 }), // not an owner
        [`DELETE /spaces/s-user/members/${ME}`]: () => {
          removals.push(ME);
          return {};
        },
      },
    });

    // the door only opens the confirm — nothing happens yet
    fireEvent.click(await screen.findByTestId('space-leave'));
    expect(await screen.findByTestId('space-leave-body')).toBeTruthy();
    expect(removals).toEqual([]);

    // dismissing keeps the membership
    fireEvent.click(screen.getByTestId('space-leave-cancel'));
    expect(removals).toEqual([]);

    // confirming (cooldown is 0 in tests) leaves: server removal, then
    // the members screen hands off to the Spaces list
    fireEvent.click(screen.getByTestId('space-leave'));
    fireEvent.click(await screen.findByTestId('space-leave-confirm'));
    await screen.findByTestId('screen-spaces', {}, { timeout: 5000 });
    expect(removals).toEqual([ME]);
  }, 15_000);

  it('#291 r2: someone with a pending SPACE invite never doubles as a friend-request row', async () => {
    renderAppAsUser('/spaces/s-user/members', {
      api: {
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/invites': () => [],
        'GET /spaces/s-user/members': () => [member(ME, 'Me', 'owner')],
        // the same person shows up in BOTH sources — the richer space
        // invite must be the only row (CARA has just the friend request)
        'GET /friends': () => ({
          friends: [],
          sentPending: [
            { id: 's1', toUserId: BOB, toName: 'Bob', spaceName: 'Personal' },
            { id: 's2', toUserId: CARA, toName: 'Cara', spaceName: 'Personal' },
          ],
          receivedPending: [],
        }),
        'GET /spaces/s-user/invites': () => [{ id: 'inv1', toUserId: BOB, toName: 'Bob', role: 'contributor' }],
      },
    });

    // Bob: the space-invite row (with its cancel) — no duplicate
    await screen.findByTestId('space-invite-revoke-inv1');
    expect(screen.queryByTestId(`space-friendpending-${BOB}`)).toBeNull();
    // Cara still pends as a friend request (no space invite for her)
    expect(await screen.findByTestId(`space-friendpending-${CARA}`)).toBeTruthy();
  }, 15_000);
});
