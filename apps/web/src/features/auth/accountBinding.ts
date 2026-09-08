import { apiFetch } from '@/lib/api';
import type { Identity } from '@/app/session';

/**
 * Remote-wipe detection: when an account is deleted (full deletion or a
 * go-offline conversion on ANOTHER device), this device's local copy
 * belongs to a dead account. The server JIT-provisions a FRESH user row
 * (new id) for the same login on the next request, so the device can
 * detect death by comparing the /me userId against the one it bound to
 * at first sync — a MISMATCH means "your account is gone": wipe local
 * data and return to the login screen. Nothing else acts: offline,
 * transient failures and even 404s verify nothing (a gateway hiccup
 * must never wipe a device) — JIT provisioning guarantees the mismatch
 * signal arrives on the next authenticated /me anyway.
 */
export const BOUND_USER_KEY = 'boundUserId';

interface MetaStore {
  metaGet(key: string): Promise<{ key: string; value: unknown } | undefined>;
  metaPut(key: string, value: unknown): Promise<void>;
}

export async function verifyAccountBinding(
  store: MetaStore,
  identity: Identity,
  onDead: () => Promise<void>,
): Promise<void> {
  if (identity.kind !== 'user') return;
  const res = await apiFetch('/me').catch(() => null);
  if (!res?.ok) return; // offline / error / 404 — no positive signal, no action
  const me = (await res.json().catch(() => null)) as { userId?: string } | null;
  if (!me?.userId) return;
  const bound = (await store.metaGet(BOUND_USER_KEY))?.value as string | undefined;
  if (!bound) {
    await store.metaPut(BOUND_USER_KEY, me.userId);
    return;
  }
  if (bound !== me.userId) await onDead();
}
