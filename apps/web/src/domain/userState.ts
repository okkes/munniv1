import { v5 as uuidv5 } from 'uuid';
import { decodeHlc } from '@/sync/hlc';

/**
 * #148 r3 (user): per-user state that must AGREE across the user's
 * devices ("24 hours later on my mobile, those transactions I saw on
 * the desktop should disappear") rides the normal sync through a
 * PRIVATE state space. The id derives from the Logto sub — a value
 * other users never see, so nobody can pre-claim it — and the version
 * nibble is forced to 8: the server's feed-shape guard keys on v5, and
 * v8 passes the first-push-creates-the-space door like any client-
 * minted space. The space gets no local `space` row, so no list ever
 * shows it; the sync engine reaches it through /me/spaces + the outbox.
 */
const USER_STATE_NS = '9c1f4b2e-6a3d-4f7b-8c5e-2d1a0b9e8f31';

export function userStateSpaceId(sub: string): string {
  const id = uuidv5(`userstate:${sub}`, USER_STATE_NS);
  return `${id.slice(0, 14)}8${id.slice(15)}`;
}

/** the per-space baseline row: when the first-seen scheme started */
export const txSeenBaseId = (forSpaceId: string): string => uuidv5(`txseenbase:${forSpaceId}`, USER_STATE_NS);

/** one row per first-seen transaction — deterministic, so two devices
 *  first-seeing the same row converge on ONE record */
export const txSeenRowId = (forSpaceId: string, txId: string): string =>
  uuidv5(`txseen:${forSpaceId}:${txId}`, USER_STATE_NS);

/** the earliest wall-clock any field of the row was written — a row
 *  born before the baseline is known history, never "new" */
export function bornAtMs(fieldVersions: Record<string, string> | undefined): number {
  const versions = Object.values(fieldVersions ?? {});
  if (versions.length === 0) return 0;
  return Math.min(...versions.map((v) => decodeHlc(v).wallMs));
}
