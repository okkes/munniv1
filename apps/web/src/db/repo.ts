import { v7 as uuidv7 } from 'uuid';
import type { HlcClock } from '@/sync/hlc';
import { applyOp } from '@/sync/merge';
import type { Op, SyncEnvelope } from '@/sync/merge';
import { reportError } from '@/lib/report';
import type { StorageBackend } from './backend';
import { InvariantViolation, rowProblems } from './invariants';
import type { EntityName, EntityRowMap, OutboxRow } from './types';

export interface RepoOptions {
  /**
   * Demo and offline identities never sync, so they skip the outbox
   * (otherwise it would grow forever with nowhere to drain).
   */
  trackOutbox: boolean;
  /** called after every local write — used to nudge the sync engine */
  onWrite?: () => void;
}

/**
 * The only write path to synced tables. Every write goes through the
 * LWW merge (stamping fieldVersions) and queues an op in the outbox,
 * so local edits and remote edits are literally the same operation.
 */
export class Repo {
  constructor(
    readonly store: StorageBackend,
    private readonly clock: HlcClock,
    private readonly options: RepoOptions,
  ) {}

  newId(): string {
    return uuidv7();
  }

  /** Create or partially update a row. `fields` contains only what changed. */
  async upsert<E extends EntityName>(
    entity: E,
    spaceId: string,
    entityId: string,
    fields: Partial<Omit<EntityRowMap[E], keyof SyncEnvelope | 'id' | 'spaceId'>>,
  ): Promise<void> {
    await this.write(entity, spaceId, entityId, fields, false);
  }

  /** Tombstone a row. It stays in the table and is filtered from queries. */
  async remove(entity: EntityName, spaceId: string, entityId: string): Promise<void> {
    await this.write(entity, spaceId, entityId, {}, true);
  }

  private async write(
    entity: EntityName,
    spaceId: string,
    entityId: string,
    fields: Record<string, unknown>,
    deleted: boolean,
  ): Promise<void> {
    const op = {
      opId: uuidv7(),
      spaceId,
      entity,
      entityId,
      fields,
      hlc: this.clock.now(),
      ...(deleted ? { deleted: true } : {}),
    } satisfies OutboxRow;
    await this.store.transact([entity, 'outbox'], async () => {
      const local = ((await this.store.get(entity, entityId)) ?? null) as
        | (Record<string, unknown> & SyncEnvelope)
        | null;
      const { row, changed } = applyOp(local, op);
      if (!changed) return;
      // model-level invariants on the MERGED row (user request: the
      // FluentValidation idea) — a violation blocks the write and lands
      // in GlitchTip, because it means a screen's own validation leaked.
      // applyRemoteOps stays unchecked on purpose: convergence with data
      // other devices already own must never be refused.
      const merged = { ...row, id: entityId, spaceId };
      const problems = deleted ? [] : rowProblems(entity, merged);
      if (problems.length > 0) {
        const violation = new InvariantViolation(entity, entityId, problems);
        reportError('invariant', violation);
        throw violation;
      }
      await this.store.put(entity, merged);
      if (this.options.trackOutbox) await this.store.outboxAdd(op);
    });
    this.options.onWrite?.();
  }

  /**
   * Apply ops that arrived from the server (pull). Stale ops are dropped by
   * the merge; the clock observes every stamp so local edits sort after.
   */
  async applyRemoteOps(ops: Op[]): Promise<void> {
    if (ops.length === 0) return;
    const entities = [...new Set(ops.map((op) => op.entity as EntityName))];
    await this.store.transact(entities, async () => {
      for (const op of ops) {
        const local = ((await this.store.get(op.entity as EntityName, op.entityId)) ?? null) as
          | (Record<string, unknown> & SyncEnvelope)
          | null;
        const { row, changed } = applyOp(local, op);
        if (changed) {
          await this.store.put(op.entity as EntityName, { ...row, id: op.entityId, spaceId: op.spaceId });
        }
      }
    });
    for (const op of ops) this.clock.observe(op.hlc);
  }
}
