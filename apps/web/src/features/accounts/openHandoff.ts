/**
 * #239 r2 (user): "view in all accounts" — the space's account info
 * sheet hands the target account over, and the global overview opens
 * that account's sheet the moment its list knows it. Module-level and
 * read-once, exactly like the debts handoff.
 */
let pending: string | null = null;

export const setAccountOpenHandoff = (accountId: string): void => {
  pending = accountId;
};

/** read-and-clear — the handoff fires exactly once */
export const takeAccountOpenHandoff = (): string | null => {
  const id = pending;
  pending = null;
  return id;
};

/**
 * #310 (user): an "Attach to this space…" door forwards to the SPACE's
 * accounts screen — this read-once handoff opens its attach sheet on
 * arrival. When it carries an accountId the sheet skips the pick list
 * and opens on the FINAL step with that account pre-selected (only the
 * type and the attach button remain); an unknown or already-attached
 * target falls back to the plain pick list. (#204 built the flagless
 * version, #248 retired it with the offer card.)
 */
let attachIntent: { accountId?: string } | null = null;

export const setSpaceAttachIntent = (accountId?: string): void => {
  attachIntent = { accountId };
};

/** read-and-clear — the intent fires exactly once */
export const takeSpaceAttachIntent = (): { accountId?: string } | null => {
  const intent = attachIntent;
  attachIntent = null;
  return intent;
};

