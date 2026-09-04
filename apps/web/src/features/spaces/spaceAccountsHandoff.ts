/**
 * #179: "add an account" pressed somewhere without room for the flow
 * (TxFormSheet's account picker, the Home FAB) hands the intent to the
 * space's accounts screen, which opens its add chooser on arrival.
 * Module-level and read-once, exactly like the account open handoff.
 */
let pending = false;

export const setSpaceAddAccountIntent = (): void => {
  pending = true;
};

/** read-and-clear — the intent fires exactly once */
export const takeSpaceAddAccountIntent = (): boolean => {
  const taken = pending;
  pending = false;
  return taken;
};
