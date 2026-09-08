import { apiFetch } from '@/lib/api';

export type FriendRequestOutcome = 'sent' | 'notFound' | 'failed';

/**
 * #291: ONE sender for both request surfaces (global friends screen +
 * space members). The server answers 404 when the id points at nobody —
 * that must become a field-level error, not a console line.
 */
export async function postFriendRequest(body: {
  toUserId: string;
  spaceId?: string;
  role?: string;
  spaceName?: string;
}): Promise<FriendRequestOutcome> {
  const res = await apiFetch('/friends/requests', { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
  if (res?.ok) return 'sent';
  // #291 r2: a malformed id never reaches the 404 branch — ToUserId is a
  // Guid server-side, so model binding/validation answers 400/422 first.
  // The user can't act differently on "malformed" vs "no such user";
  // both get the same friendly field error.
  return res && [400, 404, 422].includes(res.status) ? 'notFound' : 'failed';
}
