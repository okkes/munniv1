// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

describe('SpacesScreen (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  // the 'Active space' badge can transiently match zero or two elements
  // mid-render (coverage slows liveQuery), so always resolve inside waitFor
  const activeRow = () =>
    screen
      .getAllByText('Active space')
      .map((el) => el.closest('[data-testid^="space-row-"]'))
      .find(Boolean);
  const findActiveRow = async () => {
    let row: Element | undefined;
    await waitFor(() => {
      row = activeRow() ?? undefined;
      expect(row).toBeTruthy();
    });
    return row!;
  };

  it('shows the demo space as active', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    await findActiveRow();
  });

  it('creates a space and switches to it, then can switch back', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    const first = (await findActiveRow()).getAttribute('data-testid')!;

    fireEvent.click(screen.getByTestId('spaces-add'));
    fireEvent.change(await screen.findByTestId('space-create-name'), { target: { value: 'Side hustle' } });
    // arc 4: the private-lock note sits on the form; defaults carry the rest
    expect(screen.getByTestId('space-create-lock-note')).toBeTruthy();
    fireEvent.click(screen.getByTestId('space-create-save'));

    // new space appears and becomes active
    await waitFor(() => {
      expect(screen.getByText('Side hustle')).toBeTruthy();
      expect(activeRow()!.textContent).toContain('Side hustle');
    });

    // born private (arc 4) with the persisted defaults
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    const made = (await db.spaces.toArray()).find((s) => s.name === 'Side hustle');
    expect(made).toMatchObject({ inviteLock: 1, periodType: 'month', periodDay: 1, currency: 'EUR' });
    expect(made?.historyStartDate).toBeTruthy();
    db.close();

    // switch back to the original space
    fireEvent.click(screen.getByTestId(first));
    await waitFor(() => expect(activeRow()!.getAttribute('data-testid')).toBe(first));
  });

  it('the full create form customizes period, currency, history and look (arc 4)', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');

    fireEvent.click(screen.getByTestId('spaces-add'));
    fireEvent.change(await screen.findByTestId('space-create-name'), { target: { value: 'Reis' } });
    fireEvent.click(screen.getByTestId('space-create-icon-airplane'));

    // period: weekly, starting Wednesday — the settings screen's controls
    fireEvent.click(screen.getByTestId('space-create-period'));
    fireEvent.click(await screen.findByTestId('space-period-week'));
    fireEvent.click(screen.getByTestId('space-weekday-3'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('space-create-period').textContent).toContain('Weekly'));

    // currency: USD via the chip sheet (closes itself on pick)
    fireEvent.click(screen.getByTestId('space-create-currency'));
    fireEvent.click(await screen.findByTestId('space-create-currency-USD'));
    await waitFor(() => expect(screen.getByTestId('space-create-currency').textContent).toContain('USD'));

    // history start: an explicit date + the start-small hint
    fireEvent.click(screen.getByTestId('space-create-history'));
    await screen.findByTestId('space-create-history-hint');
    fireEvent.change(screen.getByTestId('space-create-history-date'), { target: { value: '2026-06-01' } });
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(screen.getByTestId('space-create-save'));
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => {
      const made = (await db.spaces.toArray()).find((s) => s.name === 'Reis');
      expect(made).toMatchObject({
        icon: 'airplane',
        periodType: 'week',
        periodDay: 3,
        currency: 'USD',
        historyStartDate: '2026-06-01',
        inviteLock: 1,
      });
    }, { timeout: 5000 });
    db.close();
  }, 15_000);

  it('attention pills on the switcher; the avatar dots for OTHER spaces (arc 7)', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    const [{ MunniDB }, { DexieBackend }, { Repo }, { HlcClock }] = await Promise.all([
      import('@/db/schema'),
      import('@/db/backend'),
      import('@/db/repo'),
      import('@/sync/hlc'),
    ]);
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('sa'), { trackOutbox: false });
    await repo.upsert('space', 'busy', 'busy', { name: 'Busy', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await repo.upsert('transaction', 'busy', 'bz1', {
      accountId: 'a', date: '2026-07-30', amountCents: -500, currency: 'EUR', merchant: 'Z', txType: 'expense', needsReview: 1,
    });
    db.close();

    // the dot computes on mount — a fresh Home sees the other space's backlog
    cleanup();
    renderApp('/home');
    await screen.findByTestId('screen-home');
    await screen.findByTestId('home-space-switcher-dot', {}, { timeout: 5000 });

    // the sheet counts lazily on open: the busy space wears its pill
    fireEvent.click(screen.getByTestId('home-space-switcher'));
    const pill = await screen.findByTestId('space-attn-busy', {}, { timeout: 5000 });
    expect(pill.textContent).toContain('1');
  }, 15_000);

  it('the owner toggle lifts and re-arms the private lock (arc 4)', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    const id = (await findActiveRow()).getAttribute('data-testid')!.replace('space-row-', '');

    fireEvent.click(screen.getByTestId(`space-edit-${id}`));
    await screen.findByTestId('screen-space-settings');
    // demo space predates the lock: unlocked until the owner arms it
    const toggle = (await screen.findByTestId('space-invite-lock')) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(async () => expect((await db.spaces.get(id))?.inviteLock).toBe(1), { timeout: 5000 });
    // the controlled checkbox must SHOW the write before the next tap —
    // clicking mid-liveQuery-emission would re-toggle from stale state
    await waitFor(() => expect((screen.getByTestId('space-invite-lock') as HTMLInputElement).checked).toBe(true), { timeout: 5000 });
    fireEvent.click(screen.getByTestId('space-invite-lock'));
    await waitFor(async () => expect((await db.spaces.get(id))?.inviteLock).toBe(0), { timeout: 5000 });
    db.close();
  }, 15_000);

  it('renames a space from the edit sheet', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    const id = (await findActiveRow()).getAttribute('data-testid')!.replace('space-row-', '');

    fireEvent.click(screen.getByTestId(`space-edit-${id}`));
    fireEvent.change(await screen.findByTestId('space-edit-name'), { target: { value: 'Household' } });
    fireEvent.click(screen.getByTestId('space-edit-save'));
    // save navigates back to the list; live query re-render can lag under load
    await waitFor(() => expect(screen.getByTestId(`space-row-${id}`).textContent).toContain('Household'), {
      timeout: 5000,
    });
  });

  it('saves icon and color from the slimmed settings screen (period/currency/history moved out)', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    const id = (await findActiveRow()).getAttribute('data-testid')!.replace('space-row-', '');

    fireEvent.click(screen.getByTestId(`space-edit-${id}`));
    fireEvent.click(await screen.findByTestId('space-icon-briefcase-outline'));
    fireEvent.click(screen.getByTestId('space-color-3498DB'));
    // extracted settings must be GONE from this screen (user request:
    // only the space's identity + danger zone live here)
    expect(screen.queryByTestId('space-currency-TRY')).toBeNull();
    expect(screen.queryByTestId('space-period-week')).toBeNull();
    expect(screen.queryByTestId('space-history-start')).toBeNull();
    fireEvent.click(screen.getByTestId('space-edit-save'));

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    // generous timeout: parallel suites slow the Dexie round-trip
    await waitFor(
      async () => {
        const space = await db.spaces.get(id);
        expect(space?.icon).toBe('briefcase-outline');
        expect(space?.color).toBe('#3498DB');
      },
      { timeout: 5000 },
    );
    db.close();

    // the list row shows the chosen icon (live query re-render — must wait)
    await waitFor(
      () => {
        expect(screen.getByTestId(`space-row-${id}`).innerHTML).toContain('briefcase-outline');
      },
      { timeout: 5000 },
    );
  });

  it('refuses deleting the active or only space, allows deleting another', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    const firstId = (await findActiveRow()).getAttribute('data-testid')!.replace('space-row-', '');

    // active space cannot be deleted
    fireEvent.click(screen.getByTestId(`space-edit-${firstId}`));
    fireEvent.click(await screen.findByTestId('space-edit-delete'));
    expect(await screen.findByTestId('space-delete-error')).toBeTruthy();
    fireEvent.click(screen.getByTestId('spacesettings-back')); // settings is a screen now

    // create a second space (becomes active), then the first is deletable
    fireEvent.click(await screen.findByTestId('spaces-add'));
    fireEvent.change(await screen.findByTestId('space-create-name'), { target: { value: 'Temp' } });
    fireEvent.click(screen.getByTestId('space-create-save'));
    await waitFor(() => expect(activeRow()!.textContent).toContain('Temp'));

    fireEvent.click(screen.getByTestId(`space-edit-${firstId}`));
    // destructive: the shared danger sheet asks with the consequences
    // spelled out (cooldown is 0 in tests)
    fireEvent.click(await screen.findByTestId('space-edit-delete'));
    expect(await screen.findByTestId('space-delete-body')).toBeTruthy();
    fireEvent.click(screen.getByTestId('space-delete-confirm'));
    await waitFor(() => expect(screen.queryByTestId(`space-row-${firstId}`)).toBeNull());
    // multi-step flow: the default 5s test budget trips under coverage load
  }, 15_000);

  it('lists the accounts attached to the space behind its own door', async () => {
    // the only door is on Settings now (user remark: the space-settings
    // doors were redundant) — it targets the active space
    renderApp('/settings');
    await screen.findByTestId('screen-settings');
    fireEvent.click(await screen.findByTestId('settings-space-accounts-row'));
    const section = await screen.findByTestId('space-accounts');
    await waitFor(() => expect(section.textContent).toContain('Demo Savings'), { timeout: 5000 });
    // provenance moved into the tap-through info sheet (redesign ss13)
    const row = [...section.querySelectorAll('[data-testid^="space-account-"]')].find((el) =>
      el.textContent?.includes('Demo Savings'),
    ) as HTMLElement;
    fireEvent.click(row);
    const infoSheet = await screen.findByTestId('space-account-info');
    expect(infoSheet.textContent).toContain('created in this space');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('space-accounts-manage')).toBeTruthy();
  }, 10_000);

  it('creates a space-scoped manual account from the space accounts screen', async () => {
    renderApp('/settings');
    await screen.findByTestId('screen-settings');
    fireEvent.click(await screen.findByTestId('settings-space-accounts-row'));
    await screen.findByTestId('space-accounts');

    fireEvent.click(screen.getByTestId('space-accounts-add'));
    // "Add a manual account" opens the type grid DIRECTLY (redesign
    // ss13/ss14) — no intent step in between
    expect(await screen.findByTestId('chooser-manual-form')).toBeTruthy();
    fireEvent.click(screen.getByTestId('chooser-accttype-cash'));
    fireEvent.change(await screen.findByTestId('chooser-acctform-name'), { target: { value: 'Holiday jar' } });
    fireEvent.change(screen.getByTestId('chooser-acctform-balance'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('chooser-acctform-save'));
    await waitFor(() => expect(screen.getByTestId('space-accounts').textContent).toContain('Holiday jar'), {
      timeout: 5000,
    });
  }, 10_000);
});
