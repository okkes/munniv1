import { apiFetch } from '@/lib/api';

export interface SettlementCandidate {
  cents: number;
  splitId: string;
  splitName: string;
  /** who settled (their display name, or null for unnamed accounts) */
  fromName: string | null;
}

/**
 * Open settlements where I am the RECEIVER (SP5, design: "when the
 * actual bank transfer shows up in B's feed, review suggests linking
 * it"). Splits are online-only — any failure returns [] and review
 * simply shows no suggestion.
 */
export async function fetchSettlementCandidates(): Promise<SettlementCandidate[]> {
  const list = await apiFetch('/splits').catch(() => null);
  if (!list?.ok) return [];
  const splits = (await list.json()) as { id: string; name: string; status: string }[];
  const candidates: SettlementCandidate[] = [];
  for (const split of splits.filter((s) => s.status === 'open')) {
    const res = await apiFetch(`/splits/${split.id}`).catch(() => null);
    if (!res?.ok) continue;
    const detail = (await res.json()) as {
      members: { userId: string; displayName: string | null; isMe: boolean }[];
      entries: { kind: string; paidByUserId: string; amountCents: number; shares: { userId: string; cents: number }[] }[];
    };
    const me = detail.members.find((m) => m.isMe);
    if (!me) continue;
    for (const entry of detail.entries) {
      // a settlement to me: I'm the sole share holder and not the payer
      if (entry.kind !== 'settlement' || entry.paidByUserId === me.userId) continue;
      if (entry.shares.length !== 1 || entry.shares[0].userId !== me.userId) continue;
      const payer = detail.members.find((m) => m.userId === entry.paidByUserId);
      candidates.push({
        cents: entry.amountCents,
        splitId: split.id,
        splitName: split.name,
        fromName: payer?.displayName ?? null,
      });
    }
  }
  return candidates;
}
