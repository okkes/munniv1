// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';
import { isoDaysAgo } from '@/db/seed';

async function createEvent(name: string, from?: string, to?: string, budget?: string) {
  fireEvent.click(await screen.findByTestId('events-add'));
  await screen.findByTestId('eventform-name');
  fireEvent.change(screen.getByTestId('eventform-name'), { target: { value: name } });
  if (from) fireEvent.change(screen.getByTestId('eventform-from'), { target: { value: from } });
  if (to) fireEvent.change(screen.getByTestId('eventform-to'), { target: { value: to } });
  if (budget) fireEvent.change(screen.getByTestId('eventform-budget'), { target: { value: budget } });
  fireEvent.click(screen.getByTestId('eventform-save'));
  await waitFor(() => {
    expect(document.querySelector('[data-testid^="event-card-"]')).toBeTruthy();
  });
  return document.querySelector('[data-testid^="event-card-"]')!;
}

describe('Events (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('an edited form asks before a stray dismissal drops it (dirty guard)', async () => {
    renderApp('/events');
    await screen.findByTestId('screen-events');
    fireEvent.click(await screen.findByTestId('events-add'));
    fireEvent.change(await screen.findByTestId('eventform-name'), { target: { value: 'Ski trip' } });

    // Escape = a dismissal gesture: the guard asks instead of dropping
    fireEvent.keyDown(window, { key: 'Escape' });
    await screen.findByTestId('sheet-discard');
    fireEvent.click(screen.getByTestId('sheet-keep-editing'));
    // the form survived the gesture (test-mode sheets stay mounted, so
    // the retained value is the observable, not the confirm's absence)
    expect((screen.getByTestId('eventform-name') as HTMLInputElement).value).toBe('Ski trip');

    // choosing Discard really closes the form: the host clears `initial`,
    // dirty drops, and the guard subtree unmounts with it
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(await screen.findByTestId('sheet-discard'));
    await waitFor(() => expect(screen.queryByTestId('sheet-discard')).toBeNull());
    expect(document.querySelector('[data-testid^="event-card-"]')).toBeNull();
  }, 15_000);

  it('creates an event; the card shows range and a zero total', async () => {
    renderApp('/events');
    await screen.findByTestId('screen-events');
    await screen.findByTestId('events-empty');

    const card = await createEvent('Rome trip', isoDaysAgo(180), isoDaysAgo(160), '500');
    expect(card.textContent).toContain('Rome trip');
    // nothing attached yet
    expect(card.textContent).toMatch(/€0[.,]00/);
  }, 15_000);

  it('detail suggests txs in the date range and attach-all adopts them', async () => {
    renderApp('/events');
    await screen.findByTestId('screen-events');
    const card = await createEvent('Rome trip', isoDaysAgo(180), isoDaysAgo(160));

    fireEvent.click(card);
    await screen.findByTestId('eventdetail-hero');
    const banner = await screen.findByTestId('eventdetail-suggest');
    expect(banner.textContent).toMatch(/[1-9]/);

    // the picker opens pre-checked; unticking one keeps it out
    fireEvent.click(screen.getByTestId('eventdetail-attach-all'));
    await screen.findByTestId('eventpick-list');
    const firstPick = document.querySelector('[data-testid^="eventpick-"]')!;
    fireEvent.click(firstPick); // exclude one
    fireEvent.click(screen.getByTestId('eventpick-attach'));
    await waitFor(() => expect(screen.getByTestId('eventdetail-total').textContent).toMatch(/€[1-9]/), { timeout: 8000 });
    // the excluded transaction keeps the banner alive with exactly one left
    await waitFor(() => expect(screen.getByTestId('eventdetail-suggest').textContent).toMatch(/1 /));
    expect(screen.getByTestId('eventdetail-cats')).toBeTruthy();
    expect(screen.getByTestId('eventdetail-txs')).toBeTruthy();
  }, 20_000);

  it('tapping a breakdown category unfolds subs and filters the payments (user request)', async () => {
    renderApp('/events');
    await screen.findByTestId('screen-events');
    const card = await createEvent('Rome trip', isoDaysAgo(180), isoDaysAgo(160));
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId('eventdetail-attach-all'));
    await screen.findByTestId('eventpick-list');
    fireEvent.click(screen.getByTestId('eventpick-attach')); // everything pre-checked
    await screen.findByTestId('eventdetail-txs', {}, { timeout: 8000 });
    // attach-all writes one tx at a time — sample the count only once the
    // suggestion banner is gone (everything in range has been adopted)
    await waitFor(() => expect(screen.queryByTestId('eventdetail-suggest')).toBeNull(), { timeout: 8000 });

    const allCount = document.querySelectorAll('[data-testid="eventdetail-txs"] [data-testid^="tx-row-"]').length;
    const mainRow = document.querySelector('[data-testid^="eventdetail-cat-"]')!;
    fireEvent.click(mainRow);
    // subs unfold under the tapped main…
    await waitFor(() => expect(document.querySelector('[data-testid^="eventdetail-subcat-"]')).toBeTruthy());
    // …and the payments list narrows to that main (never grows)
    const filtered = document.querySelectorAll('[data-testid="eventdetail-txs"] [data-testid^="tx-row-"]').length;
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThanOrEqual(allCount);

    // the sub narrows further; the clear chip restores everything
    fireEvent.click(document.querySelector('[data-testid^="eventdetail-subcat-"]')!);
    fireEvent.click(await screen.findByTestId('eventdetail-filter-clear'));
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid="eventdetail-txs"] [data-testid^="tx-row-"]').length).toBe(allCount),
    );
  }, 20_000);

  it('a transaction can leave the event through the tx-detail picker', async () => {
    renderApp('/events');
    await screen.findByTestId('screen-events');
    const card = await createEvent('Rome trip', isoDaysAgo(180), isoDaysAgo(160));
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId('eventdetail-attach-all'));
    await screen.findByTestId('eventpick-list');
    fireEvent.click(screen.getByTestId('eventpick-attach')); // everything pre-checked
    const txList = await screen.findByTestId('eventdetail-txs', {}, { timeout: 8000 });

    // into the transaction: the event row names the event, None clears it
    fireEvent.click(txList.querySelector('button')!);
    const row = await screen.findByTestId('tx-detail-event-row');
    expect(row.textContent).toContain('Rome trip');
    fireEvent.click(row);
    await screen.findByTestId('tx-event-list');
    fireEvent.click(screen.getByTestId('tx-event-none'));
    await waitFor(() => expect(screen.getByTestId('tx-detail-event-row').textContent).toContain('None'));
  }, 20_000);

  it('settings row reaches events; archiving dims the card', async () => {
    renderApp('/settings');
    await screen.findByTestId('screen-settings');
    fireEvent.click(screen.getByTestId('settings-events-row'));
    await screen.findByTestId('screen-events');

    const card = await createEvent('Old party');
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId('eventdetail-edit'));
    fireEvent.click(await screen.findByTestId('eventform-archive'));
    // the button unmounts via onClose only after the write resolved —
    // unmounting earlier would close the db under the in-flight put
    await waitFor(() => expect(screen.queryByTestId('eventform-archive')).toBeNull());

    cleanup();
    renderApp('/events');
    await waitFor(
      () => {
        const archived = document.querySelector('[data-testid^="event-card-"]');
        expect(archived?.className).toContain('opacity-60');
      },
      { timeout: 5000 },
    );
  }, 15_000);
});
