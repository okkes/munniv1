// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

/**
 * The balance band's configurable meaning (user design 2026-08-01):
 * per-space mode + per-account say in the sum. Lean demo: checking
 * €3,420.55 + savings €8,150.00.
 */
describe('Home balance band (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('#180: the FAB opens the quick-add sheet; the tx door hosts the form in place', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    fireEvent.click(screen.getByTestId('home-fab'));
    await screen.findByTestId('home-quick-sheet');
    // the six doors, in the user's stated order
    for (const id of ['tx', 'import', 'category', 'account', 'friend', 'space']) {
      expect(screen.getByTestId(`home-quick-${id}`)).toBeTruthy();
    }
    // the manual-transaction door opens the form right here
    fireEvent.click(screen.getByTestId('home-quick-tx'));
    await screen.findByTestId('txform-save');
    expect(screen.getByTestId('txform-merchant')).toBeTruthy();
  }, 15_000);

  it('modes switch the meaning; account toggles bend the sum; all persisted per space', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    // default = net worth, the pre-config behavior
    await waitFor(() => expect(screen.getByTestId('home-total-balance').textContent).toContain('11,570.55'));
    expect(screen.getByTestId('band-mode-label').textContent).toContain('Net worth');

    fireEvent.click(screen.getByTestId('home-balance-band'));
    await screen.findByTestId('band-mode-row');

    // #142 (user): net worth is PREMADE — no per-account checkboxes
    expect(screen.queryByTestId('band-acct-demo_save')).toBeNull();

    // custom mode starts empty and counts only picked accounts
    fireEvent.click(screen.getByTestId('band-mode-custom'));
    await waitFor(() => expect(screen.getByTestId('band-mode-label').textContent).toContain('Picked accounts'));
    await waitFor(() => expect(screen.getByTestId('home-total-balance').textContent).toContain('0.00'));
    fireEvent.click(await screen.findByTestId('band-acct-demo_main'));
    await waitFor(() => expect(screen.getByTestId('home-total-balance').textContent).toContain('3,420.55'));

    // #142: total cash is premade too — the full liquid formula, no
    // checkboxes, unaffected by any stored exclusions
    fireEvent.click(screen.getByTestId('band-mode-cash'));
    await waitFor(() => expect(screen.getByTestId('band-mode-label').textContent).toContain('Total cash'));
    await waitFor(() => expect(screen.getByTestId('home-total-balance').textContent).toContain('11,570.55'));
    expect(screen.queryByTestId('band-acct-demo_main')).toBeNull();
  }, 15_000);

  it('unused features collapse into ONE Explore block instead of a pile of teaser cards (#121)', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    // the lean demo has no budgets, goals or debts — three teasers'
    // worth of unused features, one compact door
    const explore = await screen.findByTestId('home-explore');
    expect(explore.textContent).toContain('Explore');
    expect(screen.queryByTestId('home-budgets-teaser')).toBeNull();
    expect(screen.queryByTestId('home-goals-teaser')).toBeNull();
    expect(screen.queryByTestId('home-debts-teaser')).toBeNull();
    // rows lead straight to the feature
    fireEvent.click(await screen.findByTestId('home-explore-goals'));
    expect(await screen.findByTestId('screen-goals')).toBeTruthy();
  }, 15_000);

  it('Explore is a first-class block: it appears in Customize Home like any other (#121 v2)', async () => {
    renderApp('/home/customize');
    const rows = await screen.findAllByText('Explore');
    expect(rows.length).toBeGreaterThanOrEqual(1);
  }, 15_000);
});

/**
 * #313 (user ss): the desktop split used to count CONFIGURED blocks, so a
 * nearly empty home (most features unused → their blocks render null and
 * collapse into Explore) kept a broken half-empty grid, left-aligned.
 * Now only blocks that actually RENDER earn a column: under four, the one
 * column centers itself and widens to the width the user picked.
 */
describe('#313: desktop columns follow what actually renders', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('few rendering blocks: no grid — the single column centers and widens', async () => {
    const first = renderApp('/home');
    await screen.findByTestId('screen-home');
    // the boot chain must settle before this handle's writes (db.close trap)
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const { HOME_BLOCK_IDS } = await import('./HomeCustomizeScreen');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    // hide everything but the two blocks the lean demo always renders —
    // the CONFIGURED count alone used to keep the grid switched on
    const kept = new Set(['overview', 'explore']);
    await repo.upsert('space', 'demo_space', 'demo_space', {
      homeBlocks: HOME_BLOCK_IDS.map((id) => ({ id, hidden: kept.has(id) ? (0 as const) : (1 as const) })),
    });
    db.close();
    first.unmount();

    renderApp('/home');
    await screen.findByTestId('home-explore', {}, { timeout: 10_000 });
    // until the space row + txs land, the configured-count fallback may
    // hold the grid — the settled state is the centered single column
    await waitFor(() => expect(screen.getByTestId('home-columns').className).toContain('lg:mx-auto'), { timeout: 10_000 });
    const wrap = screen.getByTestId('home-columns');
    expect(wrap.className).toContain('lg:max-w-[720px]');
    expect(wrap.className).not.toContain('lg:grid');
    // the customize door joins the centered column instead of straying wide
    expect(screen.getByTestId('home-customize').className).toContain('lg:max-w-[720px]');
  }, 20_000);

  it('four rendering blocks still earn the two-column grid', async () => {
    const first = renderApp('/home');
    await screen.findByTestId('screen-home');
    await (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain;
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('t'), { trackOutbox: false });
    // a goal makes the goals block render — with the demo's review rows,
    // This period and Explore that is four blocks of real content
    await repo.upsert('goal', 'demo_space', 'g313', { name: 'Trip', targetCents: 100_000, allocatedCents: 25_000 });
    db.close();
    first.unmount();

    renderApp('/home');
    // all four content blocks are on screen…
    await screen.findByTestId('home-goal-g313', {}, { timeout: 10_000 });
    await screen.findByTestId('home-review-banner', {}, { timeout: 10_000 });
    await screen.findByTestId('home-explore', {}, { timeout: 10_000 });
    expect(screen.getByTestId('home-overview-income')).toBeTruthy();
    // …so the desktop split stays a grid
    await waitFor(() => expect(screen.getByTestId('home-columns').className).toContain('lg:grid-cols-2'), { timeout: 10_000 });
  }, 20_000);
});
