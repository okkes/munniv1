// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

// demo facts the assertions lean on: this month has consumption spending
// (groceries/coffee/restaurants) under €1,000 and NO housing spending.

async function assign(catId: string, value: string) {
  const input = screen.getByTestId(`alloc-input-${catId}`) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  await waitFor(() => expect((screen.getByTestId(`alloc-input-${catId}`) as HTMLInputElement).value).toBe(`${value}.00`));
}

describe('Allocation (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('assigning gives money a job and the header counts it', async () => {
    renderApp('/allocate');
    await screen.findByTestId('screen-allocate');
    // no income this period and nothing assigned → everything has a job
    await waitFor(() => expect(screen.getByTestId('alloc-toallocate').textContent).toMatch(/€0[.,]00/));

    await assign('housing', '100');
    // spending nothing on housing this month leaves the full assignment
    await waitFor(() => expect(screen.getByTestId('alloc-avail-housing').textContent).toMatch(/€100[.,]00/));
    // over-assigned beyond income → the header flags it negative
    expect(screen.getByTestId('alloc-toallocate').textContent).toMatch(/-.*100[.,]00/);
  }, 15_000);

  it('an overspent envelope gets covered from a calmer one', async () => {
    renderApp('/allocate');
    await screen.findByTestId('screen-allocate');
    await waitFor(() => expect(screen.getByTestId('alloc-toallocate').textContent).toMatch(/€/));

    await assign('housing', '1000');
    // consumption is overspent (real demo spending, nothing assigned) —
    // waits for the live spend to arrive
    await waitFor(() => expect(screen.getByTestId('alloc-avail-consumption').textContent).toMatch(/-/), { timeout: 5000 });
    fireEvent.click(screen.getByTestId('alloc-avail-consumption'));
    await screen.findByTestId('alloc-cover-list');
    fireEvent.click(await screen.findByTestId('alloc-cover-housing'));
    // the move zeroes the shortfall
    await waitFor(() => expect(screen.getByTestId('alloc-avail-consumption').textContent).toMatch(/€0[.,]00/));
  }, 15_000);

  it('chips suggest amounts; past periods are read-only', async () => {
    renderApp('/allocate');
    await screen.findByTestId('screen-allocate');
    await waitFor(() => expect(screen.getByTestId('alloc-toallocate').textContent).toMatch(/€/));

    fireEvent.focus(screen.getByTestId('alloc-input-consumption'));
    await screen.findByTestId('alloc-chips');
    fireEvent.click(screen.getByTestId('alloc-chip-last'));
    // nothing was assigned last period
    await waitFor(() => expect((screen.getByTestId('alloc-input-consumption') as HTMLInputElement).value).toBe('0.00'));

    fireEvent.click(screen.getByTestId('alloc-prev'));
    await screen.findByTestId('alloc-readonly');
    expect((screen.getByTestId('alloc-input-consumption') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('alloc-next'));
    await waitFor(() => expect(screen.queryByTestId('alloc-readonly')).toBeNull());
  }, 15_000);

  it('topics group envelopes with a subtotal and can be edited', async () => {
    renderApp('/allocate');
    await screen.findByTestId('screen-allocate');
    await screen.findByTestId('alloc-input-housing');

    fireEvent.click(screen.getByTestId('alloc-topic-new'));
    fireEvent.change(await screen.findByTestId('alloc-topic-name'), { target: { value: 'Fun' } });
    fireEvent.click(screen.getByTestId('alloc-topiccat-consumption'));
    fireEvent.click(screen.getByTestId('alloc-topic-save'));

    // the group renders with its member row inside and a subtotal chip
    await waitFor(() => expect(document.querySelector('[data-testid^="alloc-topicgroup-"]')).toBeTruthy());
    const topic = document.querySelector('[data-testid^="alloc-topicgroup-"]')!;
    expect(topic.textContent).toContain('Fun');
    await waitFor(() => expect(topic.querySelector('[data-testid="alloc-input-consumption"]')).toBeTruthy());

    // deleting from the editor dissolves the group back into the flat list
    fireEvent.click(topic.querySelector('[data-testid^="alloc-topic-edit-"]')!);
    fireEvent.click(await screen.findByTestId('alloc-topic-delete'));
    await waitFor(() =>
      expect(screen.getByTestId('alloc-list').querySelector('[data-testid="alloc-input-consumption"]')).toBeTruthy(),
    );
  }, 15_000);

  it('recurring costs offer a set-aside envelope with a per-period suggestion', async () => {
    // lean unit-test seed carries no recurrings — plant one (monthly €15.99)
    const recId = 'rec_alloc';
    const first = renderApp('/allocate');
    await screen.findByTestId('screen-allocate');
    const { MunniDB } = await import('@/db/schema');
    const { Repo } = await import('@/db/repo');
    const { DexieBackend } = await import('@/db/backend');
    const { HlcClock } = await import('@/sync/hlc');
    const { DEMO_SPACE_ID } = await import('@/db/seed');
    const db = new MunniDB('munni_demo');
    const repo = new Repo(new DexieBackend(db), new HlcClock('seed-alloc'), { trackOutbox: false });
    await repo.upsert('recurring', DEMO_SPACE_ID, recId, {
      name: 'Streamo',
      kind: 'subscription',
      amountCents: 1599,
      every: 'month',
      dueDay: 7,
      active: 1,
    });
    first.unmount();

    renderApp('/allocate');
    await screen.findByTestId('screen-allocate');
    const fill = await screen.findByTestId(`alloc-rec-fill-${recId}`, {}, { timeout: 5000 });
    fireEvent.click(fill); // one tap sets the suggested share aside
    await waitFor(() => {
      const input = screen.getByTestId(`alloc-rec-input-${recId}`) as HTMLInputElement;
      expect(Number.parseFloat(input.value)).toBeGreaterThan(0);
    });
    // the set-aside draws from the same income pool as the envelopes
    await waitFor(() => expect(screen.getByTestId('alloc-toallocate').textContent).toMatch(/-/));
  }, 15_000);

  it('rollover is a visible per-space toggle', async () => {
    renderApp('/allocate');
    await screen.findByTestId('screen-allocate');
    const toggle = () => screen.getByTestId('alloc-rollover');
    expect(toggle().innerHTML).toContain('justify-end'); // default on
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle().innerHTML).toContain('justify-start'));
  }, 15_000);

  it('settings row and home block both land on the allocate screen', async () => {
    renderApp('/settings');
    await screen.findByTestId('screen-settings');
    fireEvent.click(screen.getByTestId('settings-allocation-row'));
    await screen.findByTestId('screen-allocate');
    await waitFor(() => expect(screen.getByTestId('alloc-toallocate').textContent).toMatch(/€/));
    await assign('housing', '50');

    cleanup();
    renderApp('/home');
    const block = await screen.findByTestId('home-allocation', {}, { timeout: 5000 });
    expect(block.textContent).toMatch(/€/);
    fireEvent.click(block);
    await screen.findByTestId('screen-allocate');
  }, 15_000);
});
