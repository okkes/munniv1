// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useData } from '@/app/data';
import { UNCATEGORIZED_ID } from '@/domain/categories';
import { useLang } from '@/i18n';
import { renderWithData } from '@/test/harness';
import type { Catalog } from './useCategories';
import { catName, useCategories } from './useCategories';

let latest: Catalog | null = null;
let store: ReturnType<typeof useData>['store'] | null = null;
let spaceId = '';

function Probe() {
  const data = useData();
  const cats = useCategories();
  const { t } = useLang();
  latest = cats;
  store = data.store;
  spaceId = data.spaceId;
  return <div data-testid="probe">{catName(cats.byId('groceries'), t)}</div>;
}

async function putAll(rows: (Record<string, unknown> & { id: string })[]) {
  for (const row of rows) await store!.put('category', row);
}

describe('useCategories', () => {
  beforeEach(async () => {
    latest = null;
    store = null;
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('munni_demo');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });

  it('serves built-ins with localized names and safe fallbacks', async () => {
    renderWithData(<Probe />);
    expect((await screen.findByTestId('probe')).textContent).toBe('Grocery');
    expect(latest!.byId(undefined).id).toBe(UNCATEGORIZED_ID);
    expect(latest!.byId('never-existed').id).toBe(UNCATEGORIZED_ID);
    expect(latest!.parents.length).toBeGreaterThan(0);
    expect(latest!.parents.every((p) => p.isParent)).toBe(true);
    const kids = latest!.childrenOf(latest!.parents[0].id);
    expect(kids.every((k) => k.parentId === latest!.parents[0].id)).toBe(true);
  });

  it('merges custom space categories into the catalog', async () => {
    renderWithData(<Probe />);
    await screen.findByTestId('probe');
    await store!.put('category', {
      id: 'cat_custom1',
      spaceId,
      name: 'Padel',
      icon: 'tennis',
      color: '#123456',
      txType: 'expense',
      direction: 'debit',
      parentId: 'sport',
      deleted: 0,
      fieldVersions: {},
    } as never);
    await waitFor(() => {
      const cat = latest!.byId('cat_custom1');
      expect(cat.custom).toBe(true);
      expect(cat.name).toBe('Padel');
      expect(cat.direction).toBe('debit');
      // type derives from the builtin parent, not the stored field
      expect(cat.txTypes).toEqual(['expense']);
    });
  });

  it('custom mains carry their type; subs inherit it and default to both directions', async () => {
    renderWithData(<Probe />);
    await screen.findByTestId('probe');
    await putAll([
      {
        id: 'main1',
        spaceId,
        name: 'Side gig',
        icon: 'briefcase-outline',
        color: '#654321',
        txType: 'income',
        isParent: 1,
        sortOrder: 1,
        deleted: 0,
        fieldVersions: {},
      },
      {
        id: 'main1_other',
        spaceId,
        name: 'Other',
        icon: 'briefcase-outline',
        color: '',
        parentId: 'main1',
        isOther: 1,
        direction: 'debit', // must be ignored: Other is locked to both
        sortOrder: 2,
        deleted: 0,
        fieldVersions: {},
      },
      {
        id: 'sub1',
        spaceId,
        name: 'Coaching',
        icon: 'school-outline',
        color: '',
        parentId: 'main1',
        direction: 'credit',
        sortOrder: 3,
        deleted: 0,
        fieldVersions: {},
      },
    ]);
    await waitFor(() => {
      const main = latest!.byId('main1');
      expect(main.isParent).toBe(true);
      expect(main.txTypes).toEqual(['income']);
      expect(latest!.parents.some((p) => p.id === 'main1')).toBe(true);

      const other = latest!.byId('main1_other');
      expect(other.isOther).toBe(true);
      expect(other.direction).toBe('both');
      expect(other.txTypes).toEqual(['income']);

      const sub = latest!.byId('sub1');
      expect(sub.direction).toBe('credit');
      expect(sub.txTypes).toEqual(['income']); // inherited from main1
      expect(latest!.childrenOf('main1').map((c) => c.id)).toEqual(['main1_other', 'sub1']);
    });
  });
});
