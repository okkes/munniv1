/**
 * Category naming rules (user rules 2026-07-17):
 *  - no two parents with the same name
 *  - a sub may not carry ANY parent's name
 *  - within one parent, sub names are unique
 * The same checks guard dragging a sub into another parent. Comparison
 * is case-insensitive on trimmed names. Existing rows that already
 * violate the rules keep working — only NEW operations are validated
 * (no data deletion needed; renaming the offenders clears them up).
 */

export type CategoryNameConflict = 'duplicateParent' | 'subNamedLikeParent' | 'duplicateSub';

export interface NamedCategory {
  id: string;
  /** RESOLVED display name (builtins localized by the caller) */
  name: string;
  isParent: boolean;
  parentId?: string;
}

export function categoryNameConflict(
  candidate: { name: string; parentId?: string; selfId?: string },
  existing: NamedCategory[],
): CategoryNameConflict | null {
  const norm = (value: string) => value.trim().toLocaleLowerCase();
  const name = norm(candidate.name);
  if (!name) return null; // emptiness is the form's own validation
  const others = existing.filter((category) => category.id !== candidate.selfId);
  if (!candidate.parentId) {
    return others.some((category) => category.isParent && norm(category.name) === name) ? 'duplicateParent' : null;
  }
  if (others.some((category) => category.isParent && norm(category.name) === name)) return 'subNamedLikeParent';
  const sibling = others.some(
    (category) => !category.isParent && category.parentId === candidate.parentId && norm(category.name) === name,
  );
  return sibling ? 'duplicateSub' : null;
}
