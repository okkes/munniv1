import { describe, expect, it } from 'vitest';
import { categoryNameConflict } from './categoryNames';
import type { NamedCategory } from './categoryNames';

const world: NamedCategory[] = [
  { id: 'p-house', name: 'Household', isParent: true },
  { id: 'p-fun', name: 'Fun', isParent: true },
  { id: 's-rent', name: 'Rent', isParent: false, parentId: 'p-house' },
  { id: 's-games', name: 'Games', isParent: false, parentId: 'p-fun' },
];

describe('categoryNameConflict (user rules 2026-07-17)', () => {
  it('blocks a second parent with the same name — case/space-insensitive', () => {
    expect(categoryNameConflict({ name: 'Household' }, world)).toBe('duplicateParent');
    expect(categoryNameConflict({ name: '  household ' }, world)).toBe('duplicateParent');
    expect(categoryNameConflict({ name: 'Garden' }, world)).toBeNull();
  });

  it('blocks a sub named like ANY parent', () => {
    expect(categoryNameConflict({ name: 'Fun', parentId: 'p-house' }, world)).toBe('subNamedLikeParent');
  });

  it('blocks duplicate sub names within one parent, allows them across parents', () => {
    expect(categoryNameConflict({ name: 'rent', parentId: 'p-house' }, world)).toBe('duplicateSub');
    expect(categoryNameConflict({ name: 'Rent', parentId: 'p-fun' }, world)).toBeNull();
  });

  it('renames ignore the row itself; drags are just a sub check on the target', () => {
    expect(categoryNameConflict({ name: 'Household', selfId: 'p-house' }, world)).toBeNull();
    expect(categoryNameConflict({ name: 'Rent', parentId: 'p-house', selfId: 's-rent' }, world)).toBeNull();
    // dragging Games into Household is fine; dragging a 'Rent' twin is not
    expect(categoryNameConflict({ name: 'Games', parentId: 'p-house', selfId: 's-games' }, world)).toBeNull();
    expect(categoryNameConflict({ name: 'Rent', parentId: 'p-house', selfId: 's-games' }, world)).toBe('duplicateSub');
  });
});
