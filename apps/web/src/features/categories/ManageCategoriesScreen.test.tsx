// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/harness';

const openScreen = async () => {
  renderApp('/categories');
  // groups start collapsed (user redesign) — headers are the ready signal
  await screen.findByTestId('cats-group-consumption');
};

const expandGroup = (id: string) => fireEvent.click(screen.getByTestId(`cats-group-${id}`));

/** press-and-hold on a group header opens its action menu */
const openGroupMenu = async (id: string) => {
  fireEvent.pointerDown(screen.getByTestId(`cats-group-${id}`));
  await new Promise((resolve) => setTimeout(resolve, 550));
  fireEvent.pointerUp(screen.getByTestId(`cats-group-${id}`));
  await screen.findByTestId('cats-group-menu');
};

describe('ManageCategoriesScreen (demo identity)', { timeout: 15_000 }, () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('lists built-in categories as read-only rows', async () => {
    await openScreen();
    expandGroup('consumption');
    const row = await screen.findByTestId('managecat-groceries');
    expect((row as HTMLButtonElement).disabled).toBe(true);
    expect(row.textContent).not.toContain('Custom');
  });

  it('a quick tap cancels the hold: no menu, the group just toggles', async () => {
    await openScreen();
    const header = screen.getByTestId('cats-group-consumption');
    // press shorter than the 450ms hold window (arms the grow highlight,
    // then cancels it) — the trailing click must still expand the group
    fireEvent.pointerDown(header);
    expect(header.className).toContain('m-holding');
    fireEvent.pointerUp(header);
    expect(header.className).not.toContain('m-holding');
    fireEvent.click(header);
    await screen.findByTestId('managecat-groceries');
    expect(screen.queryByTestId('cats-group-menu')).toBeNull();
  });

  it('creates a custom MAIN category with type, color and a locked Other sub', async () => {
    await openScreen();
    fireEvent.click(screen.getByTestId('cats-add'));
    fireEvent.change(await screen.findByTestId('catform-name'), { target: { value: 'Music lessons' } });
    fireEvent.click(screen.getByTestId('catform-type-income'));
    fireEvent.click(screen.getByTestId('catform-color-3498DB'));
    fireEvent.click(screen.getByTestId('catform-icon-laptop'));
    fireEvent.click(screen.getByTestId('catform-save'));

    // the new main appears as a group header with its type badge…
    // (generous timeout: coverage instrumentation slows the live query)
    await waitFor(() => expect(screen.getByText('Music lessons')).toBeTruthy(), { timeout: 5000 });
    const header = screen.getByText('Music lessons').closest('button')!;
    expect(header.textContent).toContain('Income');
    fireEvent.click(header); // groups start collapsed — unfold the new main
    // …and the auto "Other" sub exists but is not editable (it lands in a
    // second write — wait for its own live-query emission)
    const group = header.closest('[data-cat-group]')!;
    await waitFor(() => {
      const other = [...group.querySelectorAll('[data-testid^="managecat-"]')].find((b) =>
        b.textContent?.includes('Other'),
      ) as HTMLButtonElement;
      expect(other).toBeTruthy();
      expect(other.disabled).toBe(true);
    });
  }, 15_000);

  it('hides a main per space via the hold menu; it stays manageable', async () => {
    await openScreen();
    expandGroup('pet');
    await screen.findByTestId('managecat-petFood');
    // hide "pet" for this space (visibility lives in the hold menu now)
    await openGroupMenu('pet');
    fireEvent.click(screen.getByTestId('cats-togglemain-pet'));
    await screen.findByTestId('cats-hiddennote-pet', {}, { timeout: 5000 });
    // its subs are folded away and no sub can be added while hidden
    expect(screen.queryByTestId('managecat-petFood')).toBeNull();
    expect(screen.queryByTestId('cats-addsub-pet')).toBeNull();
    // the menu brings it back
    await openGroupMenu('pet');
    fireEvent.click(screen.getByTestId('cats-togglemain-pet'));
    await screen.findByTestId('managecat-petFood', {}, { timeout: 5000 });
  }, 15_000);

  it('creates a sub with a direction under a builtin parent (type inherited)', async () => {
    await openScreen();
    expandGroup('sport');
    fireEvent.click(screen.getByTestId('cats-addsub-sport'));
    expect((await screen.findByTestId('catform-inherited-type')).textContent).toBe('Expense');
    fireEvent.change(screen.getByTestId('catform-name'), { target: { value: 'Padel' } });
    fireEvent.click(screen.getByTestId('catform-direction-debit'));
    fireEvent.click(screen.getByTestId('catform-icon-dumbbell'));
    fireEvent.click(screen.getByTestId('catform-save'));

    // live query re-render after the write can lag under coverage load
    const custom = await screen.findByText('Padel', {}, { timeout: 5000 });
    expect(custom.closest('button')!.textContent).toContain('Custom');
  });

  it('drags a custom sub onto another main group to move it (restored)', async () => {
    await openScreen();
    expandGroup('sport');
    fireEvent.click(screen.getByTestId('cats-addsub-sport'));
    fireEvent.change(await screen.findByTestId('catform-name'), { target: { value: 'Padel' } });
    fireEvent.click(screen.getByTestId('catform-save'));
    await screen.findByText('Padel', {}, { timeout: 5000 });

    const subRow = screen.getByText('Padel').closest('[data-testid^="cats-subrow-"]') as HTMLElement;
    const subId = subRow.getAttribute('data-testid')!.replace('cats-subrow-', '');
    const handle = screen.getByTestId(`cats-drag-${subId}`);

    // lift: every main folds into a drop row, the ghost floats on the rail
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 120 });
    const drop = await screen.findByTestId('cats-drop-entertainment');
    expect(screen.getByTestId('cats-drag-ghost')).toBeTruthy();

    // happy-dom has no real hit-testing — route the rail probe to the row
    const originalFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => drop;
    try {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 440 });
      fireEvent.pointerUp(window, { pointerId: 1 });
      // release opens the confirmation sheet; only confirm commits
      fireEvent.click(await screen.findByTestId('cats-move-confirm'));
    } finally {
      document.elementFromPoint = originalFromPoint;
    }

    // the sub now lives under Entertainment (types match: both expense)
    await waitFor(async () => {
      const { MunniDB } = await import('@/db/schema');
      const db = new MunniDB('munni_demo');
      const row = await db.categories.get(subId);
      db.close();
      expect(row?.parentId).toBe('entertainment');
    }, { timeout: 5000 });
  });

  it('drop conflicts show the drag error; cancel paths commit nothing', async () => {
    await openScreen();
    // a sub named like one the target already has → duplicateSub on drop
    expandGroup('entertainment');
    fireEvent.click(screen.getByTestId('cats-addsub-entertainment'));
    fireEvent.change(await screen.findByTestId('catform-name'), { target: { value: 'Padel' } });
    fireEvent.click(screen.getByTestId('catform-save'));
    await screen.findByText('Padel', {}, { timeout: 5000 });
    expandGroup('sport');
    fireEvent.click(screen.getByTestId('cats-addsub-sport'));
    fireEvent.change(await screen.findByTestId('catform-name'), { target: { value: 'Padel' } });
    fireEvent.click(screen.getByTestId('catform-save'));
    // the SPORT copy is the one being dragged — wait for it inside its group
    const findSportRow = () =>
      [...document.querySelectorAll('[data-cat-group="sport"] [data-testid^="cats-subrow-"]')].find((el) =>
        el.textContent?.includes('Padel'),
      ) as HTMLElement | undefined;
    await waitFor(() => expect(findSportRow()).toBeTruthy(), { timeout: 5000 });
    const subId = findSportRow()!.getAttribute('data-testid')!.replace('cats-subrow-', '');

    // a cancelled drag leaves fold mode with no confirm sheet
    fireEvent.pointerDown(screen.getAllByTestId(`cats-drag-${subId}`).at(-1)!, { pointerId: 1, clientY: 120 });
    await screen.findByTestId('cats-drop-entertainment');
    fireEvent.pointerCancel(window, { pointerId: 1 });
    await waitFor(() => expect(screen.queryByTestId('cats-drop-entertainment')).toBeNull());
    expect(screen.queryByTestId('cats-move-confirm')).toBeNull();

    // dropping onto a parent that already owns the name → error banner
    fireEvent.pointerDown(screen.getAllByTestId(`cats-drag-${subId}`).at(-1)!, { pointerId: 2, clientY: 120 });
    const drop = await screen.findByTestId('cats-drop-entertainment');
    const originalFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => drop;
    try {
      fireEvent.pointerMove(window, { pointerId: 2, clientY: 300 });
      fireEvent.pointerUp(window, { pointerId: 2 });
    } finally {
      document.elementFromPoint = originalFromPoint;
    }
    await screen.findByTestId('cats-drag-error');
    expect(screen.queryByTestId('cats-move-confirm')).toBeNull();
  });

  it('renames and deletes an unused custom sub without a warning', async () => {
    await openScreen();
    expandGroup('sport');
    fireEvent.click(screen.getByTestId('cats-addsub-sport'));
    fireEvent.change(await screen.findByTestId('catform-name'), { target: { value: 'Padel' } });
    fireEvent.click(screen.getByTestId('catform-save'));
    const row = (await screen.findByText('Padel')).closest('button')!;

    fireEvent.click(row);
    fireEvent.change(await screen.findByTestId('catform-name'), { target: { value: 'Padel & Tennis' } });
    fireEvent.click(screen.getByTestId('catform-save'));
    await waitFor(() => expect(screen.getByText('Padel & Tennis')).toBeTruthy());

    fireEvent.click(screen.getByText('Padel & Tennis').closest('button')!);
    fireEvent.click(await screen.findByTestId('catform-delete'));
    await waitFor(() => expect(screen.queryByText('Padel & Tennis')).toBeNull());
  });

  it('holding a custom sub opens its action menu; Move to… jumps into the move picker', async () => {
    await openScreen();
    expandGroup('sport');
    fireEvent.click(screen.getByTestId('cats-addsub-sport'));
    fireEvent.change(await screen.findByTestId('catform-name'), { target: { value: 'Padel' } });
    fireEvent.click(screen.getByTestId('catform-save'));
    const row = (await screen.findByText('Padel', {}, { timeout: 5000 })).closest('button')!;
    const catId = row.getAttribute('data-testid')!.replace('managecat-', '');

    // press-and-hold on the row (drag is retired) opens the sub menu
    fireEvent.pointerDown(screen.getByTestId(`managecat-${catId}`));
    await new Promise((resolve) => setTimeout(resolve, 550));
    fireEvent.pointerUp(screen.getByTestId(`managecat-${catId}`));
    await screen.findByTestId('cats-sub-menu');

    // Move to… opens the edit form WITH the move picker on top
    fireEvent.click(screen.getByTestId(`cats-movesub-${catId}`));
    fireEvent.click(await screen.findByTestId('catform-move-entertainment'));
    fireEvent.click(screen.getByTestId('catform-save'));
    expandGroup('entertainment');
    await waitFor(
      () => {
        const moved = screen.getByText('Padel').closest('[data-cat-group]');
        expect(moved?.getAttribute('data-cat-group')).toBe('entertainment');
      },
      { timeout: 5000 },
    );
  }, 15_000);

  it('moving a sub via Move to… works instantly when types match', async () => {
    await openScreen();
    expandGroup('sport');
    fireEvent.click(screen.getByTestId('cats-addsub-sport'));
    fireEvent.change(await screen.findByTestId('catform-name'), { target: { value: 'Padel' } });
    fireEvent.click(screen.getByTestId('catform-save'));
    const row = (await screen.findByText('Padel')).closest('button')!;

    fireEvent.click(row);
    // the move target lives behind a picker row now (chips didn't scale)
    fireEvent.click(await screen.findByTestId('catform-move-open'));
    fireEvent.click(await screen.findByTestId('catform-move-entertainment')); // expense -> expense
    fireEvent.click(screen.getByTestId('catform-save'));
    expandGroup('entertainment');
    await waitFor(() => {
      const moved = screen.getByText('Padel').closest('[data-cat-group]');
      expect(moved?.getAttribute('data-cat-group')).toBe('entertainment');
    });
  });
});

describe('category impact warnings (demo identity)', { timeout: 15_000 }, () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('deleting a category that transactions use warns first, then detaches them', async () => {
    await openScreen();
    expandGroup('consumption');
    // create a sub, assign it to a demo transaction, then delete the sub
    fireEvent.click(screen.getByTestId('cats-addsub-consumption'));
    fireEvent.change(await screen.findByTestId('catform-name'), { target: { value: 'Doomed' } });
    fireEvent.click(screen.getByTestId('catform-save'));
    const row = (await screen.findByText('Doomed')).closest('button')!;
    const catId = row.getAttribute('data-testid')!.replace('managecat-', '');

    // assign directly through the demo db (dm6 is an expense)
    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await db.transactions.update('dm6', { catId });
    db.close();

    fireEvent.click(row);
    fireEvent.click(await screen.findByTestId('catform-delete'));
    const warning = await screen.findByTestId('cats-impact-text');
    expect(warning.textContent).toContain('1 transaction');

    fireEvent.click(screen.getByTestId('cats-impact-confirm'));
    await waitFor(() => expect(screen.queryByText('Doomed')).toBeNull());

    const check = new MunniDB('munni_demo');
    const tx = await check.transactions.get('dm6');
    expect(tx?.catId).toBe('uncategorized');
    expect(tx?.needsReview).toBe(1);
    check.close();
  });

  it('cancelling the warning keeps everything unchanged', async () => {
    await openScreen();
    expandGroup('consumption');
    fireEvent.click(screen.getByTestId('cats-addsub-consumption'));
    fireEvent.change(await screen.findByTestId('catform-name'), { target: { value: 'Kept' } });
    fireEvent.click(screen.getByTestId('catform-save'));
    const row = (await screen.findByText('Kept')).closest('button')!;
    const catId = row.getAttribute('data-testid')!.replace('managecat-', '');

    const { MunniDB } = await import('@/db/schema');
    const db = new MunniDB('munni_demo');
    await db.transactions.update('dm6', { catId });
    db.close();

    fireEvent.click(row);
    fireEvent.click(await screen.findByTestId('catform-delete'));
    await screen.findByTestId('cats-impact-text');
    fireEvent.click(screen.getByTestId('cats-impact-cancel'));

    const check = new MunniDB('munni_demo');
    expect((await check.transactions.get('dm6'))?.catId).toBe(catId);
    check.close();
    expect(screen.getByText('Kept')).toBeTruthy();
  });
});
