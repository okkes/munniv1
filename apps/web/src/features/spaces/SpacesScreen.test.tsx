// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, renderWithProviders } from '@/test/harness';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';

// happy-dom has no canvas — the downscaler is covered by lib/image.test.ts,
// here we care about the flow around it (#301)
const FAKE_PHOTO = 'data:image/jpeg;base64,ZmFrZQ==';
vi.mock('@/lib/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/image')>()),
  downscaleImage: vi.fn(async () => FAKE_PHOTO),
}));

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
    // #147: the private lock is a real choice now — ticked by default,
    // so the bare "name + Create" path still births a locked space
    expect((screen.getByTestId('space-create-lock') as HTMLInputElement).checked).toBe(true);
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

  it('unticking the private checkbox births the space open (#147)', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');

    fireEvent.click(screen.getByTestId('spaces-add'));
    fireEvent.change(await screen.findByTestId('space-create-name'), { target: { value: 'Open club' } });
    fireEvent.click(screen.getByTestId('space-create-lock'));
    expect((screen.getByTestId('space-create-lock') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId('space-create-save'));

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(
      async () => {
        const made = (await db.spaces.toArray()).find((s) => s.name === 'Open club');
        expect(made?.inviteLock).toBe(0);
      },
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('the full create form customizes period, currency, history and look (arc 4)', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');

    fireEvent.click(screen.getByTestId('spaces-add'));
    fireEvent.change(await screen.findByTestId('space-create-name'), { target: { value: 'Reis' } });
    fireEvent.click(screen.getByTestId('space-create-icon-airplane'));

    // period: weekly, starting Wednesday — the settings screen's controls
    fireEvent.click(screen.getByTestId('space-create-period'));
    // #137: the period sheet explains itself like its settings twin
    expect(await screen.findByTestId('space-create-period-explain')).toBeTruthy();
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

  it('a create handoff opens the sheet on arrival (#180)', async () => {
    const { setSpacesCreateIntent } = await import('./spacesHandoff');
    setSpacesCreateIntent();
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    // the create sheet is open without touching the + button
    expect(await screen.findByTestId('space-create-name')).toBeTruthy();
  });

  it('Create stays enabled; an empty-name click shows the blocker (#195)', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    fireEvent.click(screen.getByTestId('spaces-add'));
    const name = await screen.findByTestId('space-create-name');
    fireEvent.change(name, { target: { value: '   ' } });
    const save = screen.getByTestId('space-create-save') as HTMLButtonElement;
    expect(save.disabled).toBe(false); // never disabled for validity
    fireEvent.click(save);
    expect(await screen.findByTestId('space-create-blocker')).toBeTruthy();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    // a real name clears the block and creates
    fireEvent.change(name, { target: { value: 'Blocked no more' } });
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByText('Blocked no more')).toBeTruthy(), { timeout: 5000 });
  }, 15_000);

  it('back with unsaved edits asks first; Stay keeps editing, Leave discards (#164)', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    const id = (await findActiveRow()).getAttribute('data-testid')!.replace('space-row-', '');

    fireEvent.click(screen.getByTestId(`space-edit-${id}`));
    const input = (await screen.findByTestId('space-edit-name')) as HTMLInputElement;
    // wait for the seed — dirty compares against it
    await waitFor(() => expect(input.value).not.toBe(''));
    fireEvent.change(input, { target: { value: 'Dirty name' } });

    fireEvent.click(screen.getByTestId('spacesettings-back'));
    expect(await screen.findByTestId('screen-discard')).toBeTruthy();
    fireEvent.click(screen.getByTestId('screen-discard-stay'));
    // still on the settings screen, edits intact
    expect(screen.getByTestId('screen-space-settings')).toBeTruthy();
    expect((screen.getByTestId('space-edit-name') as HTMLInputElement).value).toBe('Dirty name');

    fireEvent.click(screen.getByTestId('spacesettings-back'));
    fireEvent.click(await screen.findByTestId('screen-discard-leave'));
    await screen.findByTestId('screen-spaces');
    // the rename was discarded (the list re-queries after the remount)
    await waitFor(
      () => expect(screen.getByTestId(`space-row-${id}`).textContent).not.toContain('Dirty name'),
      { timeout: 5000 },
    );
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
    // #162: the private lock moved to the Settings tab
    expect(screen.queryByTestId('space-invite-lock')).toBeNull();
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

  it('a set picture puts the symbol and color pickers to sleep (#146)', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    const id = (await findActiveRow()).getAttribute('data-testid')!.replace('space-row-', '');

    // seed the picture directly — the file input needs a real image decoder
    const [{ MunniDB }, { DexieBackend }, { Repo }, { HlcClock }] = await Promise.all([
      import('@/db/schema'),
      import('@/db/backend'),
      import('@/db/repo'),
      import('@/sync/hlc'),
    ]);
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('pic'), { trackOutbox: false });
    await repo.upsert('space', id, id, { picture: 'data:image/png;base64,x' });
    db.close();

    fireEvent.click(screen.getByTestId(`space-edit-${id}`));
    await screen.findByTestId('screen-space-settings');
    // the note says WHY; both pickers refuse taps while the picture rules
    expect(await screen.findByTestId('space-icon-picture-note')).toBeTruthy();
    expect((screen.getByTestId('space-icon-briefcase-outline') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('space-color-3498DB') as HTMLButtonElement).disabled).toBe(true);
    // clearing the picture wakes them up again
    fireEvent.click(screen.getByTestId('space-photo-clear'));
    await waitFor(() => expect(screen.queryByTestId('space-icon-picture-note')).toBeNull());
    expect((screen.getByTestId('space-icon-briefcase-outline') as HTMLButtonElement).disabled).toBe(false);
  }, 15_000);

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
    // #206: a manual (space-owned) row opens the EDITOR directly — the
    // tap-through info sheet is for feed-fed rows only now
    const row = [...section.querySelectorAll('[data-testid^="space-account-"]')].find((el) =>
      el.textContent?.includes('Demo Savings'),
    ) as HTMLElement;
    fireEvent.click(row);
    expect(await screen.findByTestId('acctedit-name')).toBeTruthy();
    expect(screen.queryByTestId('space-account-info')).toBeNull();
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

  it('#277: shared rows wear the people badge and ALWAYS name their creator', async () => {
    const first = renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    // seeding a bare space row mid-boot races the every-boot folds
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const [{ MunniDB }, { DexieBackend }, { Repo }, { HlcClock }] = await Promise.all([
      import('@/db/schema'),
      import('@/db/backend'),
      import('@/db/repo'),
      import('@/sync/hlc'),
    ]);
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('shared'), { trackOutbox: false });
    await repo.upsert('space', 'sh1', 'sh1', {
      name: 'Familie',
      kind: 'shared',
      createdByName: 'Bob',
      currency: 'EUR',
      periodType: 'month',
      periodDay: 1,
    });
    db.close();
    first.unmount();

    renderApp('/spaces');
    const row = await screen.findByTestId('space-row-sh1', {}, { timeout: 5000 });
    expect(screen.getByTestId('space-shared-badge-sh1')).toBeTruthy();
    // the creator line no longer waits for a name collision (#277)
    expect(row.textContent).toContain('created by Bob');
    // personal rows carry neither badge nor creator
    expect(screen.queryByTestId('space-shared-badge-demo_space')).toBeNull();
    expect(screen.getByTestId('space-row-demo_space').textContent).not.toContain('created by');
  }, 15_000);

  // the glyph's live color — Icon paints an inline style from the prop
  const glyphColor = (tileTestId: string) => {
    const glyph = screen.getByTestId(tileTestId).querySelector('i') as HTMLElement;
    return glyph.style.color.replace(/\s+/g, '').toLowerCase();
  };

  it('#285: create-form icon search opens the whole font; swatches repaint the grid', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');

    fireEvent.click(screen.getByTestId('spaces-add'));
    await screen.findByTestId('space-create-name');
    // curated set by default — the full-font glyph is not offered yet
    expect(screen.getByTestId('space-create-icon-leaf')).toBeTruthy();
    expect(screen.queryByTestId('space-create-icon-rocket-launch')).toBeNull();

    // searching swaps the grid to the FULL mdi set (non-curated result)
    fireEvent.change(screen.getByTestId('space-create-icon-search'), { target: { value: 'rocket-lau' } });
    const found = await screen.findByTestId('space-create-icon-rocket-launch');
    // …and the curated rows stand down while a query narrows the grid
    expect(screen.queryByTestId('space-create-icon-leaf')).toBeNull();

    // the grid previews the picked color live (default first, then a swatch)
    expect(glyphColor('space-create-icon-rocket-launch')).toMatch(/#08372b|rgb\(8,55,43\)/);
    fireEvent.click(screen.getByTestId('space-create-color-E74C3C'));
    await waitFor(() => expect(glyphColor('space-create-icon-rocket-launch')).toMatch(/#e74c3c|rgb\(231,76,60\)/));

    // a searched glyph is a real pick — it lands on the created space
    fireEvent.click(found);
    fireEvent.change(screen.getByTestId('space-create-name'), { target: { value: 'Launchpad' } });
    fireEvent.click(screen.getByTestId('space-create-save'));
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(
      async () => {
        const made = (await db.spaces.toArray()).find((s) => s.name === 'Launchpad');
        expect(made).toMatchObject({ icon: 'rocket-launch', color: '#E74C3C' });
      },
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('#285: settings icon search narrows and extends the grid; color previews live', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');
    const id = (await findActiveRow()).getAttribute('data-testid')!.replace('space-row-', '');

    fireEvent.click(screen.getByTestId(`space-edit-${id}`));
    // the identity form mounts once the space row loads — wait for it
    const search = await screen.findByTestId('space-icon-search');
    expect(screen.queryByTestId('space-icon-campfire')).toBeNull();

    fireEvent.change(search, { target: { value: 'campfire' } });
    await screen.findByTestId('space-icon-campfire');
    expect(screen.queryByTestId('space-icon-briefcase-outline')).toBeNull();

    // a swatch pick recolors every glyph in the grid on the spot
    fireEvent.click(screen.getByTestId('space-color-3498DB'));
    await waitFor(() => expect(glyphColor('space-icon-campfire')).toMatch(/#3498db|rgb\(52,152,219\)/));

    // a hopeless query says so instead of showing an empty void
    fireEvent.change(screen.getByTestId('space-icon-search'), { target: { value: 'zzqx' } });
    expect(await screen.findByTestId('space-icon-none')).toBeTruthy();
    // clearing the query brings the curated set back
    fireEvent.click(screen.getByTestId('space-icon-search-clear'));
    expect(await screen.findByTestId('space-icon-briefcase-outline')).toBeTruthy();
  }, 15_000);

  it('#301: the create form takes a picture through the shared strip and births the space with it', async () => {
    renderApp('/spaces');
    await screen.findByTestId('screen-spaces');

    fireEvent.click(screen.getByTestId('spaces-add'));
    await screen.findByTestId('space-create-name');
    // the settings strip, re-housed: upload tile + hidden input
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    expect(screen.getByTestId('space-create-photo-upload')).toBeTruthy();
    fireEvent.change(screen.getByTestId('space-create-photo-input'), { target: { files: [file] } });

    // the picked picture shows as the clear tile and puts the symbol +
    // color pickers to sleep with the #146 note, like its settings twin
    expect(await screen.findByTestId('space-create-photo-clear')).toBeTruthy();
    expect(await screen.findByTestId('space-create-icon-picture-note')).toBeTruthy();
    expect((screen.getByTestId('space-create-icon-leaf') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId('space-create-name'), { target: { value: 'Pictured' } });
    fireEvent.click(screen.getByTestId('space-create-save'));

    // the picture persists ON the new space
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await waitFor(
      async () => {
        const made = (await db.spaces.toArray()).find((s) => s.name === 'Pictured');
        expect(made?.picture).toBe(FAKE_PHOTO);
      },
      { timeout: 5000 },
    );
    db.close();
  }, 15_000);

  it('#304: the leave/remove danger confirm arms only after the 5s countdown', () => {
    // the flows pass no cooldown prop, so they inherit the standard
    // (5s in production, 0 in test mode) — the countdown machinery is
    // proven here with the prod value and fake timers
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      renderWithProviders(
        <DangerConfirmSheet
          open
          onOpenChange={() => undefined}
          title="Leave space?"
          body="You will lose access to this space and its data on this device."
          confirmLabel="Leave space"
          onConfirm={() => undefined}
          testId="space-leave"
          cooldown={5}
        />,
      );
      const confirm = screen.getByTestId('space-leave-confirm') as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      expect(confirm.textContent).toContain('(5)');

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(confirm.disabled).toBe(true);
      expect(confirm.textContent).toContain('(2)');

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(confirm.disabled).toBe(false);
      expect(confirm.textContent).not.toContain('(');
    } finally {
      vi.useRealTimers();
    }
  });
});
