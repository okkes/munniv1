// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { CLIENT_PROTOCOL } from '@/lib/protocol';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { HlcClock } from '@/sync/hlc';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { USER_TEST_DB, renderAppAsUser } from '@/test/harness';

const ME = '11111111-1111-1111-1111-111111111111';
const ANNA = '22222222-2222-2222-2222-222222222222';

const DETAIL = {
  id: 'split-1',
  name: 'Barcelona',
  currency: 'EUR',
  status: 'open',
  role: 'owner',
  members: [
    { userId: ME, role: 'owner', displayName: 'Me', isMe: true },
    { userId: ANNA, role: 'member', displayName: 'Anna', isMe: false },
  ],
  entries: [
    {
      id: 'e-tapas',
      kind: 'expense',
      paidByUserId: ME,
      description: 'Tapas',
      amountCents: 3000,
      date: '2026-07-12',
      shares: [
        { userId: ME, cents: 1500 },
        { userId: ANNA, cents: 1500 },
      ],
      createdBy: ME,
    },
  ],
};

describe('Splits (SP1)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  it('lists splits, opens the detail, and the ledger says who owes whom', async () => {
    renderAppAsUser('/splits', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits': () => [
          { id: 'split-1', name: 'Barcelona', currency: 'EUR', status: 'open', role: 'owner', memberCount: 2, entryCount: 1 },
        ],
        'GET /splits/split-1': () => DETAIL,
      },
    });

    fireEvent.click(await screen.findByTestId('split-row-split-1'));
    await screen.findByTestId('screen-split-detail');

    // balances: I paid €30, my share is €15 → +15, Anna −15
    const ledger = await screen.findByTestId('split-ledger');
    expect(ledger.textContent).toContain('+€15.00');
    expect(ledger.textContent).toContain('-€15.00');
    // and the plan spells it out
    expect(screen.getByTestId('split-transfer').textContent).toContain('Anna');
    expect(screen.getByTestId('split-transfer').textContent).toContain('€15.00');

    const entries = screen.getByTestId('split-entries');
    expect(entries.textContent).toContain('Tapas');
    expect(entries.textContent).toContain('€30.00');
  });

  it('adds a manual expense with a chosen payer and reloads', async () => {
    const posted: unknown[] = [];
    let entries = [...DETAIL.entries];
    renderAppAsUser('/splits/split-1', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits/split-1': () => ({ ...DETAIL, entries }),
        'POST /splits/split-1/entries': (body) => {
          posted.push(body);
          const req = body as { id: string; description: string; amountCents: number; paidByUserId: string };
          entries = [
            ...entries,
            {
              id: req.id,
              kind: 'expense',
              paidByUserId: req.paidByUserId,
              description: req.description,
              amountCents: req.amountCents,
              date: '2026-07-16',
              shares: [
                { userId: ME, cents: req.amountCents / 2 },
                { userId: ANNA, cents: req.amountCents / 2 },
              ],
              createdBy: ME,
            },
          ];
          return { id: req.id };
        },
      },
    });

    fireEvent.click(await screen.findByTestId('split-add-entry'));
    fireEvent.change(await screen.findByTestId('split-entry-desc'), { target: { value: 'Metro' } });
    fireEvent.change(screen.getByTestId('split-entry-amount'), { target: { value: '9,00' } });
    fireEvent.click(screen.getByTestId(`split-payer-${ANNA}`)); // Anna paid
    fireEvent.click(screen.getByTestId('split-entry-save'));

    await waitFor(() => expect(screen.getByTestId('split-entries').textContent).toContain('Metro'));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ description: 'Metro', amountCents: 900, paidByUserId: ANNA, kind: 'expense' });
  });

  it('adds expenses picked from MY space transactions as frozen snapshots (SP2)', async () => {
    // my attached space's local transactions (other members never see these)
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed'), { trackOutbox: false });
    await repo.upsert('transaction', 's-user', 'tx-ah', {
      accountId: 'a1', date: '2026-07-14', amountCents: -2350, currency: 'EUR',
      merchant: 'Albert Heijn', txType: 'expense', needsReview: 0,
    });
    await repo.upsert('transaction', 's-user', 'tx-salary', {
      accountId: 'a1', date: '2026-07-01', amountCents: 250000, currency: 'EUR',
      merchant: 'Salary', txType: 'income', needsReview: 0, // income: never offered
    });
    db.close();

    const posted: unknown[] = [];
    renderAppAsUser('/splits/split-1', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits/split-1': () => DETAIL,
        'POST /splits/split-1/entries': (body) => {
          posted.push(body);
          return { id: (body as { id: string }).id };
        },
      },
    });

    fireEvent.click(await screen.findByTestId('split-add-entry'));
    fireEvent.click(await screen.findByTestId('split-add-from-tx'));
    // only the expense shows up; income and foreign spaces are filtered out
    fireEvent.click(await screen.findByTestId('split-tx-tx-ah'));
    expect(screen.queryByTestId('split-tx-tx-salary')).toBeNull();
    fireEvent.click(screen.getByTestId('split-tx-add'));

    await waitFor(() => expect(posted).toHaveLength(1));
    // snapshot copy: merchant/amount/date frozen, private backlink kept
    expect(posted[0]).toMatchObject({
      kind: 'expense', description: 'Albert Heijn', amountCents: 2350, date: '2026-07-14',
      sourceTxId: 'tx-ah', paidByUserId: ME,
    });
  });

  it('posts custom shares when adjusted — and blocks until they add up (SP2)', async () => {
    const posted: unknown[] = [];
    renderAppAsUser('/splits/split-1', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits/split-1': () => DETAIL,
        'POST /splits/split-1/entries': (body) => {
          posted.push(body);
          return { id: (body as { id: string }).id };
        },
      },
    });

    fireEvent.click(await screen.findByTestId('split-add-entry'));
    fireEvent.change(await screen.findByTestId('split-entry-desc'), { target: { value: 'Dinner' } });
    fireEvent.change(screen.getByTestId('split-entry-amount'), { target: { value: '10,00' } });
    fireEvent.click(screen.getByTestId('split-shares-toggle'));

    // 7 of 10 assigned — the save stays disabled and the gap is named
    fireEvent.change(screen.getByTestId(`split-share-${ME}`), { target: { value: '7,00' } });
    expect(screen.getByTestId('split-shares-sum').textContent).toContain('3.00');
    expect((screen.getByTestId('split-entry-save') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId(`split-share-${ANNA}`), { target: { value: '3,00' } });
    fireEvent.click(screen.getByTestId('split-entry-save'));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      amountCents: 1000,
      shares: [
        { userId: ME, cents: 700 },
        { userId: ANNA, cents: 300 },
      ],
    });
  });

  it('mints a share link from the members card (SP3)', async () => {
    renderAppAsUser('/splits/split-1', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits/split-1': () => DETAIL,
        'POST /splits/split-1/invites': () => ({ token: 'tok-abc', expiresAt: '2026-07-23' }),
      },
    });

    fireEvent.click(await screen.findByTestId('split-invite'));
    // real path (no #): verified app links can only match real paths
    await waitFor(() => expect(screen.getByTestId('split-invite-link').textContent).toContain('/splits/join/tok-abc'));
    expect(screen.getByTestId('split-invite-link').textContent).not.toContain('#');
  });

  it('join screen shows ONLY name + inviter, then accepts with MY chosen space (SP3)', async () => {
    const accepted: unknown[] = [];
    renderAppAsUser('/splits/join/tok-abc', {
      spaces: [
        { id: 's-user', name: 'Personal' },
        { id: 's-house', name: 'Household', kind: 'shared' },
      ],
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits/invites/tok-abc': () => ({ splitName: 'Barcelona', currency: 'EUR', inviterName: 'Anna' }),
        'POST /splits/invites/tok-abc/accept': (body) => {
          accepted.push(body);
          return { splitId: 'split-1' };
        },
        'GET /splits/split-1': () => DETAIL,
      },
    });

    const card = await screen.findByTestId('split-join-card');
    expect(card.textContent).toContain('Barcelona');
    expect(card.textContent).toContain('Anna');

    fireEvent.click(await screen.findByTestId('split-join-space-s-house'));
    fireEvent.click(screen.getByTestId('split-join-confirm'));

    await screen.findByTestId('screen-split-detail');
    expect(accepted[0]).toMatchObject({ spaceId: 's-house' });
  });

  it('a dead invite link says so instead of joining (SP3)', async () => {
    renderAppAsUser('/splits/join/expired', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits/invites/expired': () => new Response(null, { status: 404 }),
      },
    });
    expect(await screen.findByTestId('split-join-invalid')).toBeTruthy();
    expect(screen.queryByTestId('split-join-confirm')).toBeNull();
  });

  it('settling my debt posts a settlement entry to the receiver (SP4)', async () => {
    // Anna paid €30 equally → I owe her €15; the plan offers me Settle
    const owes = {
      ...DETAIL,
      entries: [{ ...DETAIL.entries[0], paidByUserId: ANNA }],
    };
    const posted: unknown[] = [];
    renderAppAsUser('/splits/split-1', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits/split-1': () => owes,
        'POST /splits/split-1/entries': (body) => {
          posted.push(body);
          return { id: (body as { id: string }).id };
        },
      },
    });

    fireEvent.click(await screen.findByTestId('split-settle'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      kind: 'settlement',
      paidByUserId: ME,
      amountCents: 1500,
      shares: [{ userId: ANNA, cents: 1500 }],
    });
  });

  it('only the owner closes; a closed split locks the UI (SP4)', async () => {
    let status = 'open';
    renderAppAsUser('/splits/split-1', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits/split-1': () => ({ ...DETAIL, status }),
        'POST /splits/split-1/close': () => {
          status = 'settled';
          return { id: 'split-1', status };
        },
      },
    });

    fireEvent.click(await screen.findByTestId('split-close'));
    fireEvent.click(await screen.findByTestId('split-close-confirm'));

    await screen.findByTestId('split-closed-note');
    // locked: no add button, no invite row, no close button anymore
    expect(screen.queryByTestId('split-add-entry')).toBeNull();
    expect(screen.queryByTestId('split-invite')).toBeNull();
    expect(screen.queryByTestId('split-close')).toBeNull();
  });

  it('linking MY event retro-attaches my searched-in expenses locally (SP5)', async () => {
    // local db: my event + the source tx behind an existing entry
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed'), { trackOutbox: false });
    await repo.upsert('event', 's-user', 'ev-rome', { name: 'Rome weekend' });
    await repo.upsert('transaction', 's-user', 'tx-ah', {
      accountId: 'a1', date: '2026-07-14', amountCents: -2350, currency: 'EUR',
      merchant: 'Albert Heijn', txType: 'expense', needsReview: 0,
    });
    db.close();

    const attached: unknown[] = [];
    let eventId: string | null = null;
    const withSource = () => ({
      ...DETAIL,
      attachedEventId: eventId,
      entries: [{ ...DETAIL.entries[0], sourceTxId: 'tx-ah' }],
    });
    renderAppAsUser('/splits/split-1', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits/split-1': withSource,
        'POST /splits/split-1/attach': (body) => {
          attached.push(body);
          eventId = (body as { eventId: string | null }).eventId;
          return { spaceId: 's-user', eventId };
        },
      },
    });

    fireEvent.click(await screen.findByTestId('split-event-row'));
    fireEvent.click(await screen.findByTestId('split-event-ev-rome'));

    await waitFor(() => expect(attached).toHaveLength(1));
    expect(attached[0]).toMatchObject({ eventId: 'ev-rome' });
    // the local transaction joined the event (auto-attach, retroactive)
    await waitFor(async () => {
      const check = new MunniDB(USER_TEST_DB);
      const tx = await check.transactions.get('tx-ah');
      check.close();
      expect(tx?.eventId).toBe('ev-rome');
    });
    // the row now names the linked event
    await waitFor(() => expect(screen.getByTestId('split-event-row').textContent).toContain('Rome weekend'));
  });

  it('the event detail shows my split summary and links into it (SP5)', async () => {
    const db = new MunniDB(USER_TEST_DB);
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed'), { trackOutbox: false });
    await repo.upsert('event', 's-user', 'ev-rome', { name: 'Rome weekend' });
    db.close();

    renderAppAsUser('/events/ev-rome', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits': () => [
          { id: 'split-1', name: 'Barcelona', currency: 'EUR', status: 'open', role: 'owner', attachedEventId: 'ev-rome', memberCount: 2, entryCount: 1 },
        ],
        'GET /splits/split-1': () => DETAIL,
      },
    });

    // I paid €30 of a €15/€15 split → the event card says I'm owed €15
    const summary = await screen.findByTestId('event-split-summary');
    expect(summary.textContent).toContain('Barcelona');
    expect(summary.textContent).toContain('€15.00');

    fireEvent.click(summary);
    await screen.findByTestId('screen-split-detail');
  });

  it('the Home block surfaces my current split and jumps into it', async () => {
    renderAppAsUser('/', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits': () => [
          { id: 'split-1', name: 'Barcelona', currency: 'EUR', status: 'open', role: 'owner', memberCount: 2, entryCount: 1 },
        ],
        'GET /splits/split-1': () => DETAIL,
      },
    });

    const block = await screen.findByTestId('home-split-top');
    expect(block.textContent).toContain('Barcelona');
    expect(block.textContent).toContain('€15.00'); // my net from DETAIL

    fireEvent.click(screen.getByTestId('home-splits-all'));
    await screen.findByTestId('screen-splits');
  });

  it('creates a split from the list and navigates into it', async () => {
    const created: unknown[] = [];
    renderAppAsUser('/splits', {
      api: {
        'GET /health': () => ({ status: 'ok', capabilities: {}, protocol: CLIENT_PROTOCOL, minClientProtocol: 1 }),
        'GET /splits': () => [],
        'POST /splits': (body) => {
          created.push(body);
          return { id: (body as { id: string }).id };
        },
      },
    });

    await screen.findByTestId('splits-empty');
    fireEvent.click(screen.getByTestId('splits-add'));
    fireEvent.change(await screen.findByTestId('split-name'), { target: { value: 'Weekend' } });
    fireEvent.click(screen.getByTestId('split-create'));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ name: 'Weekend', currency: 'EUR' });
  });
});
