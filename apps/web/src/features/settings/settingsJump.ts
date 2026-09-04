/**
 * #302 (user): quick links INTO a specific settings row — a read-once
 * handoff (the reviewReturn pattern): the linking surface stashes the
 * target, navigates, and the settings screen consumes it exactly once,
 * scrolling to the row and flashing it after the scroll settles.
 */
export type SettingsJumpTarget = 'invite-lock';

let pending: SettingsJumpTarget | null = null;

export function setSettingsJump(target: SettingsJumpTarget): void {
  pending = target;
}

export function takeSettingsJump(): SettingsJumpTarget | null {
  const taken = pending;
  pending = null;
  return taken;
}
