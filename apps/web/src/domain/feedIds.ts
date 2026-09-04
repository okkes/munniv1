import { v5 as uuidv5 } from 'uuid';

/**
 * Deterministic ids for feature B (shared financial accounts). The
 * namespace matches the import namespace on both client and server, so
 * any device — or another member reconnecting the same IBAN via PSD2 —
 * derives the identical feed and overlay ids. That is what makes
 * reconnects seamless and concurrent overlay creation convergent.
 */
const IMPORT_NS = '5f3c9a70-0d3e-4e0f-9a57-6d2b3a1c8e42';

export const normalizeIban = (iban: string) => iban.replaceAll(/\s/g, '').toUpperCase();

/** sync-space id of a bank account's feed */
export const feedSpaceId = (iban: string): string => uuidv5(`feed:${normalizeIban(iban)}`, IMPORT_NS);

/**
 * Fallback when the deterministic id is already registered by another
 * user (feed squatting defence, security S1): salted with the owner's
 * subject the id stays deterministic for THIS user's reconnects but
 * un-guessable squat-bait no more. Costs only cross-user dedupe.
 */
export const personalFeedSpaceId = (iban: string, sub: string): string =>
  uuidv5(`feed:${normalizeIban(iban)}:${sub}`, IMPORT_NS);

/** per-space overlay row id for a raw transaction */
export const txMetaId = (spaceId: string, txId: string): string => uuidv5(`meta:${spaceId}:${txId}`, IMPORT_NS);

/** attachment row id (one per account per space) */
export const accountLinkId = (spaceId: string, feedId: string): string =>
  uuidv5(`link:${spaceId}:${feedId}`, IMPORT_NS);

/**
 * Id of a user-scoped category's copy inside a space that became shared —
 * deterministic so two owners' devices adopting concurrently converge on
 * the same rows instead of duplicating them.
 */
export const adoptedCategoryId = (spaceId: string, sourceCatId: string): string =>
  uuidv5(`catcopy:${spaceId}:${sourceCatId}`, IMPORT_NS);

/** one dismissal row per merchant pattern per space (LWW-convergent) */
export const recurringDismissId = (spaceId: string, merchantKeyValue: string): string =>
  uuidv5(`recdis:${spaceId}:${merchantKeyValue}`, IMPORT_NS);

/** receipts v3: one snapshot link per global receipt per space */
export const receiptLinkId = (spaceId: string, receiptId: string): string =>
  uuidv5(`rlink:${spaceId}:${receiptId}`, IMPORT_NS);

/** receipts v3: per-space inclusion of a store-connection instance */
export const storeConnLinkId = (spaceId: string, instanceId: string): string => `sclink:${spaceId}:${instanceId}`;

/** the owner's personal STORE FEED — global receipts + instance metadata */
export const storeFeedId = (sub: string): string => personalFeedSpaceId('STORES', sub);
