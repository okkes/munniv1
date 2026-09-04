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

/** #311 r4 (user): when a BANK-fed account already owns the canonical
 *  `acct:{iban}` id, statement imports keep their own separate account
 *  row — the two sources stay two visible accounts until the user
 *  explicitly MERGES them (the merge runs the reconcile). The server
 *  mirrors this with an `acct:{iban}:bank` fork when the import owned
 *  the canonical id first. */
export const importAccountId = (iban: string): string => uuidv5(`acct:${normalizeIban(iban)}:import`, IMPORT_NS);

/** the canonical per-IBAN account id (shared with the server's ImportIds) */
export const canonicalAccountId = (iban: string): string => uuidv5(`acct:${normalizeIban(iban)}`, IMPORT_NS);

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

/** typed-splits v2 (2026-08-05): the minted counter leg of a transfer to
 *  a MANUAL account — deterministic so two devices linking the same row
 *  converge on ONE mirror instead of duplicating it */
export const mirrorTxId = (txId: string): string => uuidv5(`mirror:${txId}`, IMPORT_NS);

/** a PART's minted counter leg: keyed on row + part identity — ':' can
 *  never occur inside real ids (uuid charset), so the key is unambiguous */
export const partMirrorSourceId = (txId: string, partId: string): string => `${txId}:${partId}`;

/** #133 r4 (retired by #228): a CATEGORY ENTRY's minted counter leg —
 *  keyed on the owning money (row id, or row:part for a part's spread)
 *  + the category. Entries carry no links anymore; this key only serves
 *  the fold that retires or re-keys the old entry mints. */
export const catMirrorSourceId = (baseId: string, catId: string): string => `${baseId}:cat:${catId}`;

/** #228: the deterministic part a fold mints when an old mixed spread
 *  becomes a real split — content-keyed (the editor forbade duplicate
 *  categories per spread), so two devices folding the same row converge
 *  on identical parts and identical part-mirror ids. */
export const foldPartId = (baseId: string, catId: string): string => uuidv5(`part228:${baseId}:${catId}`, IMPORT_NS);

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
