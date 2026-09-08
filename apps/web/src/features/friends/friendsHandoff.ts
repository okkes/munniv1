/**
 * #180: "add a friend" from elsewhere — the intent is set before
 * navigating to /friends, and the screen focuses its add-by-id input on
 * arrival. Module-level and read-once, like the accounts handoff.
 */
let pendingAdd = false;

export const setFriendsAddIntent = (): void => {
  pendingAdd = true;
};

/** read-and-clear — the handoff fires exactly once */
export const takeFriendsAddIntent = (): boolean => {
  const pending = pendingAdd;
  pendingAdd = false;
  return pending;
};
