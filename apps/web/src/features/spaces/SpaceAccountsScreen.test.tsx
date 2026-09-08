// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { CLIENT_PROTOCOL } from '@/lib/protocol';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_TEST_DB, renderAppAsUser } from '@/test/harness';

const ME = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const member = (userId: string, name: string, role: string) => ({ userId, displayName: name, role, picture: null });

/** one linked feed account + one space-owned manual account */
const seedRows = async () => {
  const { MunniDB } = await import('@/db/schema');
  const { Repo } = await import('@/db/repo');
  const { DexieBackend } = await import('@/db/backend');
  const { HlcClock } = await import('@/sync/hlc');
  const db = new MunniDB(USER_TEST_DB);
  const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
  await repo.upsert('account', 'feed-1', 'feedacct-1', {
    name: 'ING Betaal',
    type: 'checking',
    source: 'gocardless',
    currency: 'EUR',
    balanceCents: 5000,
    iban: 'NL69INGB0123456789',
  });
  await repo.upsert('accountLink', 's-user', 'link-1', { feedSpaceId: 'feed-1', accountId: 'feedacct-1', type: 'checking' });
  await repo.upsert('account', 's-user', 'manual-1', {
    name: 'Cash jar',
    type: 'cash',
    source: 'manual',
    currency: 'EUR',
    balanceCents: 1000,
  });
  db.close();
};

/** one UNATTACHED feed account — the attach candidate (#310) */
const seedCandidate = async () => {
  const { MunniDB } = await import('@/db/schema');
  const { Repo } = await import('@/db/repo');
  const { DexieBackend } = await import('@/db/backend');
  const { HlcClock } = await import('@/sync/hlc');
  const db = new MunniDB(USER_TEST_DB);
  const repo = new Repo(new DexieBackend(db), new HlcClock('t2'), { trackOutbox: false });
  await repo.upsert('account', 'feed-2', 'feedacct-2', {
    name: 'Bunq Main',
    type: 'checking',
    source: 'gocardless',
    currency: 'EUR',
    balanceCents: 100,
    iban: 'NL13BUNQ2025000001',
  });
  db.close();
};

/** the REST surface the attach-intent specs need (#308/#310) — the
 *  member list must agree with the kind: healSharedKind flips a space
 *  to shared the moment a fetch reports 2+ members */
const apiWithCandidate = (kind: 'personal' | 'shared') => ({
  'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
  'GET /me': () => ({ userId: ME, displayName: 'Me' }),
  'GET /me/spaces': () => ['s-user', 'feed-1', 'feed-2'],
  'GET /me/feeds': () => [{ feedSpaceId: 'feed-1' }, { feedSpaceId: 'feed-2' }],
  'GET /spaces/s-user/members': () =>
    kind === 'shared' ? [member(ME, 'Me', 'owner'), member(BOB, 'Bob', 'contributor')] : [member(ME, 'Me', 'owner')],
  'GET /spaces/s-user/accounts': () => [{ id: 'srv-1', feedSpaceId: 'feed-1', accountId: 'feedacct-1' }],
});

describe('SpaceAccountsScreen (#284 reader gating · #308/#310 attach flow)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  it('a reader sees the view-only note; every mutating affordance stands down', async () => {
    await seedRows();
    renderAppAsUser('/spaces/s-user/accounts', {
      spaces: [{ id: 's-user', name: 'Personal', kind: 'shared' }],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/spaces': () => ['s-user', 'feed-1'],
        'GET /me/feeds': () => [{ feedSpaceId: 'feed-1' }],
        'GET /spaces/s-user/members': () => [member(BOB, 'Bob', 'owner'), member(ME, 'Me', 'reader')],
        'GET /spaces/s-user/accounts': () => [{ id: 'srv-1', feedSpaceId: 'feed-1', accountId: 'feedacct-1' }],
      },
    });

    // the quiet note lands once the role resolves…
    await screen.findByTestId('space-accounts-reader-note', {}, { timeout: 5000 });
    // …and the add/attach doors are gone with it
    expect(screen.queryByTestId('space-accounts-add')).toBeNull();
    expect(screen.queryByTestId('space-accounts-attach')).toBeNull();

    // the info sheet stays READABLE; detach, type change and rename don't
    fireEvent.click(await screen.findByTestId('space-account-link-1'));
    const sheet = await screen.findByTestId('space-account-info');
    expect(sheet.textContent).toContain('ING Betaal');
    expect(screen.queryByTestId('space-account-sheet-detach')).toBeNull();
    expect(screen.queryByTestId('account-type-row')).toBeNull();
    expect((screen.getByTestId('space-account-rename') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('space-account-info')).toBeNull());

    // a manual row opens the read-only info sheet, NOT the editor
    fireEvent.click(await screen.findByTestId('space-account-manual-1'));
    expect(await screen.findByTestId('space-account-info')).toBeTruthy();
    expect(screen.queryByTestId('acctedit-name')).toBeNull();
  }, 15_000);

  it('a contributor keeps the mutating affordances (no reader note)', async () => {
    await seedRows();
    renderAppAsUser('/spaces/s-user/accounts', {
      spaces: [{ id: 's-user', name: 'Personal', kind: 'shared' }],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/spaces': () => ['s-user', 'feed-1'],
        'GET /me/feeds': () => [{ feedSpaceId: 'feed-1' }],
        'GET /spaces/s-user/members': () => [member(BOB, 'Bob', 'owner'), member(ME, 'Me', 'contributor')],
        'GET /spaces/s-user/accounts': () => [{ id: 'srv-1', feedSpaceId: 'feed-1', accountId: 'feedacct-1' }],
      },
    });

    await screen.findByTestId('space-account-link-1');
    expect(await screen.findByTestId('space-accounts-add')).toBeTruthy();
    expect(screen.getByTestId('space-accounts-attach')).toBeTruthy();
    expect(screen.queryByTestId('space-accounts-reader-note')).toBeNull();
    // #305: my OWN feed's attachment never wears the shared badge
    expect(screen.queryByTestId('space-account-shared-link-1')).toBeNull();
  }, 15_000);

  it('#310: an attach intent naming a candidate opens the FINAL step — pick list skipped; #308: the shared-space warning rides along', async () => {
    await seedRows();
    await seedCandidate();
    const { setSpaceAttachIntent } = await import('@/features/accounts/openHandoff');
    setSpaceAttachIntent('feedacct-2');
    renderAppAsUser('/spaces/s-user/accounts', {
      spaces: [{ id: 's-user', name: 'Familie', kind: 'shared' }],
      api: apiWithCandidate('shared'),
    });

    // the sheet opened by itself on the final step: the named account
    // stands pre-picked, the pick list never mounts
    const focus = await screen.findByTestId('space-attach-focus', {}, { timeout: 10_000 });
    expect(focus.textContent).toContain('Bunq Main');
    expect(screen.queryByTestId('space-attach-candidates')).toBeNull();
    expect(await screen.findByTestId('space-attach-types', {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByTestId('space-attach-save')).toBeTruthy();

    // #308: attaching into a SHARED space says so, right above the button
    const warn = await screen.findByTestId('space-attach-share-warn', {}, { timeout: 10_000 });
    expect(warn.textContent).toContain('Familie');
  }, 20_000);

  it('#308: a PRIVATE space attaches without the warning', async () => {
    await seedRows();
    await seedCandidate();
    const { setSpaceAttachIntent } = await import('@/features/accounts/openHandoff');
    setSpaceAttachIntent('feedacct-2');
    renderAppAsUser('/spaces/s-user/accounts', {
      spaces: [{ id: 's-user', name: 'Personal' }],
      api: apiWithCandidate('personal'),
    });

    await screen.findByTestId('space-attach-focus', {}, { timeout: 10_000 });
    await screen.findByTestId('space-attach-types', {}, { timeout: 10_000 });
    expect(screen.queryByTestId('space-attach-share-warn')).toBeNull();
  }, 20_000);

  it('#310: an already-attached target falls back to the plain pick list — where a manual pick still warns (#308)', async () => {
    await seedRows();
    await seedCandidate();
    const { setSpaceAttachIntent } = await import('@/features/accounts/openHandoff');
    setSpaceAttachIntent('feedacct-1'); // link-1 already attaches it here
    renderAppAsUser('/spaces/s-user/accounts', {
      spaces: [{ id: 's-user', name: 'Familie', kind: 'shared' }],
      api: apiWithCandidate('shared'),
    });

    // fallback: the sheet still opens, but on the pick list (no focus row)
    await screen.findByTestId('space-attach-candidates', {}, { timeout: 10_000 });
    expect(screen.queryByTestId('space-attach-focus')).toBeNull();

    // picking by hand reaches the same confirm step — warning included
    fireEvent.click(screen.getByTestId('space-attach-pick-feedacct-2'));
    expect(await screen.findByTestId('space-attach-share-warn', {}, { timeout: 10_000 })).toBeTruthy();
  }, 20_000);

  it('#305: an attachment on someone ELSE\'s feed wears the shared badge; space-owned rows do not', async () => {
    await seedRows();
    renderAppAsUser('/spaces/s-user/accounts', {
      spaces: [{ id: 's-user', name: 'Personal', kind: 'shared' }],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: { gocardless: false }, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /me': () => ({ userId: ME, displayName: 'Me' }),
        'GET /me/spaces': () => ['s-user', 'feed-1'],
        // feed-1 is NOT mine — I reach it through Bob's attachment
        'GET /me/feeds': () => [],
        'GET /spaces/s-user/members': () => [member(BOB, 'Bob', 'owner'), member(ME, 'Me', 'contributor')],
        'GET /spaces/s-user/accounts': () => [{ id: 'srv-1', feedSpaceId: 'feed-1', accountId: 'feedacct-1' }],
      },
    });

    expect(await screen.findByTestId('space-account-shared-link-1', {}, { timeout: 5000 })).toBeTruthy();
    // the space's own manual account stays badge-free
    expect(screen.queryByTestId('space-account-shared-manual-1')).toBeNull();
  }, 15_000);
});
