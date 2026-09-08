/**
 * #180: the home FAB's "new space" door — the intent is set before
 * navigating to /spaces, and the screen opens its create sheet on
 * arrival. Module-level and read-once, like the accounts handoff.
 */
let pendingCreate = false;

export const setSpacesCreateIntent = (): void => {
  pendingCreate = true;
};

/** read-and-clear — the handoff fires exactly once */
export const takeSpacesCreateIntent = (): boolean => {
  const pending = pendingCreate;
  pendingCreate = false;
  return pending;
};
