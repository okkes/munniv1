import { useEffect, useMemo } from 'react';
import { useData } from '@/app/data';
import { readSessionIdentity } from '@/app/session';
import { useQuery } from '@/db/useQuery';
import type { SpaceTx } from '@/db/joined';
import type { TxSeenRow } from '@/db/types';
import { bornAtMs, txSeenBaseId, txSeenRowId, userStateSpaceId } from '@/domain/userState';

const LEGACY_KEY = 'txSeen';
const KEY_PREFIX = 'txNew_';
const KNOWN_CAP = 1500;
const NEW_TTL_MS = 24 * 60 * 60 * 1000;

interface NewMarker {
  /** every id this device has ever registered for the space */
  known: string[];
  /** id → when it was labeled new (ms) — the 24h badge clock */
  fresh: Record<string, number>;
}

/**
 * "New transactions" (#148 r2, user spec): a row seen for the FIRST
 * time — linked, imported or created since the previous usage — is
 * labeled new and stays new for 24 hours from that labeling, then
 * quietly expires. Reviewing/categorizing does not clear the label.
 *
 * r3 (user): for SIGNED-IN identities the clock is one clock across the
 * user's devices — the first-seen rows sync through the private state
 * space (domain/userState), so what the desktop saw yesterday is not
 * "new" on the phone today. A per-space BASELINE row marks when the
 * scheme started: rows born (by their field HLCs) before it are known
 * without a row of their own, so history never floods a fresh device.
 * Offline/demo identities keep the device-local marker — there is no
 * server to agree through, as the user noted.
 */
export function useNewTransactions(txs: SpaceTx[] | undefined): { newTxs: SpaceTx[]; newIds: ReadonlySet<string> } {
  const { store, repo, spaceId } = useData();
  const identity = readSessionIdentity();
  const stateSpaceId = identity?.kind === 'user' ? userStateSpaceId(identity.sub) : null;

  // ── synced path (user identities) ─────────────────────────────────
  const seenRows = useQuery(
    store,
    // #296: a backend missing the entity must degrade to "nothing new",
    // never crash the screen that mounted the hook
    async () => (stateSpaceId ? await store.bySpace('txSeen', stateSpaceId).catch(() => []) : null),
    [stateSpaceId],
  );
  const spaceSeen = useMemo(
    () => (seenRows ?? []).filter((row) => row.deleted === 0 && row.forSpaceId === spaceId),
    [seenRows, spaceId],
  );
  const baseline = useMemo(() => spaceSeen.find((row) => row.baseline === 1), [spaceSeen]);

  // ── device-local path (offline/demo) ──────────────────────────────
  const key = KEY_PREFIX + spaceId;
  const marker = useQuery(
    store,
    async () => {
      if (stateSpaceId) return null; // the synced rows own it
      const own = (await store.metaGet(key))?.value as NewMarker | undefined;
      if (own) return own;
      // migration: the old device-wide seen list seeds `known` so nothing
      // historic floods the block on the first run of the new scheme
      const legacy = (await store.metaGet(LEGACY_KEY))?.value as { ids?: string[] } | undefined;
      return legacy?.ids ? ({ known: legacy.ids, fresh: {} } satisfies NewMarker) : null;
    },
    [spaceId, stateSpaceId],
  );

  // label arrivals — one write per real change, whichever path owns it
  useEffect(() => {
    if (!txs) return;
    if (stateSpaceId) {
      if (seenRows === undefined) return;
      void labelSynced(repo, stateSpaceId, spaceId, txs, spaceSeen, baseline, store).catch(() => undefined);
      return;
    }
    if (marker === undefined) return;
    void labelLocal(store, key, txs, marker).catch(() => undefined);
  }, [txs, seenRows, spaceSeen, baseline, marker, store, repo, key, spaceId, stateSpaceId]);

  const newIds = useMemo(() => {
    const now = Date.now();
    if (stateSpaceId) {
      return new Set(
        spaceSeen
          .filter((row) => row.baseline !== 1 && row.txId && now - row.labeledAt < NEW_TTL_MS)
          .map((row) => row.txId!),
      );
    }
    if (!marker) return new Set<string>();
    return new Set(
      Object.entries(marker.fresh)
        .filter(([, at]) => now - at < NEW_TTL_MS)
        .map(([id]) => id),
    );
  }, [stateSpaceId, spaceSeen, marker]);

  const newTxs = useMemo(() => {
    if (!txs) return [];
    return txs.filter((tx) => tx.deleted === 0 && newIds.has(tx.id)).sort((a, b) => b.date.localeCompare(a.date));
  }, [txs, newIds]);

  return { newTxs, newIds };
}

/** the synced labeling pass — module-level for S3776 */
async function labelSynced(
  repo: ReturnType<typeof useData>['repo'],
  stateSpaceId: string,
  spaceId: string,
  txs: SpaceTx[],
  spaceSeen: TxSeenRow[],
  baseline: TxSeenRow | undefined,
  store: ReturnType<typeof useData>['store'],
): Promise<void> {
  const now = Date.now();
  if (!baseline) {
    // first sight of this space under the scheme: everything current is
    // history. The device-local marker's fresh labels (r2) migrate so a
    // running 24h clock survives the upgrade.
    await repo.upsert('txSeen', stateSpaceId, txSeenBaseId(spaceId), {
      forSpaceId: spaceId,
      labeledAt: now,
      baseline: 1 as const,
    });
    const legacy = (await store.metaGet(KEY_PREFIX + spaceId))?.value as NewMarker | undefined;
    for (const [txId, at] of Object.entries(legacy?.fresh ?? {})) {
      if (now - at >= NEW_TTL_MS) continue;
      await repo.upsert('txSeen', stateSpaceId, txSeenRowId(spaceId, txId), { forSpaceId: spaceId, txId, labeledAt: at });
    }
    return;
  }
  const seenTxIds = new Set(spaceSeen.map((row) => row.txId).filter(Boolean));
  for (const tx of txs) {
    if (tx.deleted !== 0 || seenTxIds.has(tx.id)) continue;
    // born before the baseline = known history on every device
    if (bornAtMs(tx.fieldVersions) <= baseline.labeledAt) continue;
    await repo.upsert('txSeen', stateSpaceId, txSeenRowId(spaceId, tx.id), { forSpaceId: spaceId, txId: tx.id, labeledAt: now });
  }
}

/** the device-local labeling pass (offline/demo) — r2 behavior */
async function labelLocal(
  store: ReturnType<typeof useData>['store'],
  key: string,
  txs: SpaceTx[],
  marker: NewMarker | null,
): Promise<void> {
  const now = Date.now();
  if (marker === null) {
    // first sight of this space: everything counts as already seen
    await store.metaPut(key, {
      known: txs.slice(0, KNOWN_CAP).map((t) => t.id),
      fresh: {},
    } satisfies NewMarker);
    return;
  }
  const known = new Set(marker.known);
  const fresh: Record<string, number> = {};
  let changed = false;
  for (const [id, at] of Object.entries(marker.fresh)) {
    if (now - at < NEW_TTL_MS) fresh[id] = at;
    else changed = true; // badge expired
  }
  for (const tx of txs) {
    if (tx.deleted !== 0 || known.has(tx.id)) continue;
    known.add(tx.id);
    fresh[tx.id] = now;
    changed = true;
  }
  if (!changed) return;
  await store.metaPut(key, {
    known: [...known].slice(-KNOWN_CAP),
    fresh,
  } satisfies NewMarker);
}
