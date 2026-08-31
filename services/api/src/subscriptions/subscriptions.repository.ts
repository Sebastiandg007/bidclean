import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, LessThan } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionEvent } from './entities/subscription-event.entity';
import {
  DispatchStatus,
  EntitlementDelta,
  EntitlementKey,
  Store,
} from './subscriptions.types';

/** Parameters for appending a sanitized webhook event to the ledger (as RECEIVED). */
export interface AppendEventParams {
  readonly revenuecatEventId: string;
  readonly userId: string | null;
  readonly eventType: string;
  readonly entitlementIds: string[];
  readonly store: Store | null;
  readonly eventTimestampMs: number;
  readonly expirationAt: Date | null;
  readonly payload: Record<string, unknown>;
}

/** A per-entitlement snapshot used to converge the mirror during reconciliation. */
export interface ReconciledEntitlement {
  readonly key: EntitlementKey;
  readonly active: boolean;
  readonly expiresAt: Date | null;
  readonly store: Store | null;
}

/** The authoritative RevenueCat snapshot for one subscriber, as seen by reconciliation. */
export interface ReconciledSubscriber {
  readonly userId: string;
  readonly entitlements: readonly ReconciledEntitlement[];
}

/** Column group names for a single entitlement on the mirror row. */
interface EntitlementColumns {
  readonly active: 'cleanerProActive' | 'hostProActive' | 'adFreeActive';
  readonly expiresAt: 'cleanerProExpiresAt' | 'hostProExpiresAt' | 'adFreeExpiresAt';
  readonly store: 'cleanerProStore' | 'hostProStore' | 'adFreeStore';
  readonly lastEventAt: 'cleanerProLastEventAt' | 'hostProLastEventAt' | 'adFreeLastEventAt';
}

/** Maps each logical entitlement to its column group on the {@link Subscription} row. */
const ENTITLEMENT_COLUMNS: Record<EntitlementKey, EntitlementColumns> = {
  [EntitlementKey.CLEANER_PRO]: {
    active: 'cleanerProActive',
    expiresAt: 'cleanerProExpiresAt',
    store: 'cleanerProStore',
    lastEventAt: 'cleanerProLastEventAt',
  },
  [EntitlementKey.HOST_PRO]: {
    active: 'hostProActive',
    expiresAt: 'hostProExpiresAt',
    store: 'hostProStore',
    lastEventAt: 'hostProLastEventAt',
  },
  [EntitlementKey.AD_FREE]: {
    active: 'adFreeActive',
    expiresAt: 'adFreeExpiresAt',
    store: 'adFreeStore',
    lastEventAt: 'adFreeLastEventAt',
  },
};

/**
 * Subscriptions repository.
 *
 * Owns every read/write to `subscriptions` (mirror) and `subscription_events` (ledger/outbox).
 * The mirror upsert applies deltas per entitlement with an out-of-order guard
 * (`eventTimestampMs > *_last_event_at`) and applies a TRANSFER to both users in ONE
 * transaction. Dedup is guaranteed by the unique `revenuecat_event_id`. NEVER writes `users`.
 */
@Injectable()
export class SubscriptionsRepository {
  /** Postgres unique-violation error code. */
  private static readonly UNIQUE_VIOLATION = '23505';

  constructor(private readonly dataSource: DataSource) {}

  // ─── Mirror reads ──────────────────────────────────────────────────────────

  /** Find the mirror row for a user, or null when none exists (resolves FREE). */
  async findByUserId(userId: string): Promise<Subscription | null> {
    return this.dataSource.getRepository(Subscription).findOne({ where: { userId } });
  }

  // ─── Ledger / outbox ────────────────────────────────────────────────────────

  /** True when an event id has already been recorded (dedup guarantee). */
  async hasProcessedEvent(revenuecatEventId: string): Promise<boolean> {
    const count = await this.dataSource
      .getRepository(SubscriptionEvent)
      .count({ where: { revenuecatEventId } });
    return count > 0;
  }

  /**
   * Append a sanitized event as RECEIVED (committed before the webhook is acknowledged).
   * Returns the new ledger row id, or null when the event id already exists (redelivery).
   */
  async appendEvent(params: AppendEventParams): Promise<string | null> {
    try {
      const result = await this.dataSource.getRepository(SubscriptionEvent).insert({
        revenuecatEventId: params.revenuecatEventId,
        userId: params.userId,
        eventType: params.eventType,
        entitlementIds: params.entitlementIds,
        store: params.store,
        eventTimestampMs: String(params.eventTimestampMs),
        expirationAt: params.expirationAt,
        payloadJson: params.payload,
        dispatchStatus: DispatchStatus.RECEIVED,
      });
      return (result.identifiers[0]?.id as string | undefined) ?? null;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  /** Mark a ledger row QUEUED after a successful enqueue. */
  async markQueued(ledgerId: string): Promise<void> {
    await this.updateDispatchStatus(ledgerId, DispatchStatus.QUEUED, null);
  }

  /** Mark a ledger row PROCESSED after the mirror has been applied. */
  async markProcessed(ledgerId: string): Promise<void> {
    await this.updateDispatchStatus(ledgerId, DispatchStatus.PROCESSED, new Date());
  }

  /** Mark a ledger row FAILED after retries are exhausted (dead-letter). */
  async markFailed(ledgerId: string): Promise<void> {
    await this.updateDispatchStatus(ledgerId, DispatchStatus.FAILED, null);
  }

  private async updateDispatchStatus(
    ledgerId: string,
    dispatchStatus: DispatchStatus,
    processedAt: Date | null,
  ): Promise<void> {
    await this.dataSource
      .getRepository(SubscriptionEvent)
      .update({ id: ledgerId }, { dispatchStatus, processedAt });
  }

  /**
   * Find RECEIVED/QUEUED ledger rows older than the grace period that were never PROCESSED.
   * These are re-enqueued by the recovery worker so no acknowledged event is lost (P16).
   */
  async findRecovered(graceMs: number, limit: number): Promise<SubscriptionEvent[]> {
    const cutoff = new Date(Date.now() - graceMs);
    return this.dataSource.getRepository(SubscriptionEvent).find({
      where: {
        dispatchStatus: In([DispatchStatus.RECEIVED, DispatchStatus.QUEUED]),
        createdAt: LessThan(cutoff),
      },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  // ─── Mirror mutation (per-entitlement ordering + atomic TRANSFER) ────────────

  /**
   * Apply a batch of deltas to the mirror in ONE transaction, marking the ledger row PROCESSED.
   *
   * Each entitlement is written only when the delta is newer than that entitlement's
   * `*_last_event_at` (per-entitlement out-of-order guard, P5/P15). A TRANSFER delta carries
   * `transferToUserId`: the source loses the entitlement and the destination gains it, both in
   * the same transaction (P13).
   */
  async applyDeltas(deltas: readonly EntitlementDelta[], ledgerId: string | null): Promise<void> {
    if (deltas.length === 0) {
      if (ledgerId) {
        await this.markProcessed(ledgerId);
      }
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      for (const delta of deltas) {
        await this.applyOneDelta(manager, delta);
      }
      if (ledgerId) {
        await manager
          .getRepository(SubscriptionEvent)
          .update({ id: ledgerId }, { dispatchStatus: DispatchStatus.PROCESSED, processedAt: new Date() });
      }
    });
  }

  /** Apply a single delta (and, for a TRANSFER, its destination grant) within a transaction. */
  private async applyOneDelta(manager: EntityManager, delta: EntitlementDelta): Promise<void> {
    // The delta's own user is the entitlement HOLDER after this event, except on TRANSFER where
    // `delta.active=false` removes it from the source and `transferToUserId` gains it.
    await this.writeEntitlement(manager, delta.userId, delta, delta.active);

    if (delta.transferToUserId !== undefined) {
      await this.writeEntitlement(
        manager,
        delta.transferToUserId,
        delta,
        true, // destination gains the entitlement
      );
    }
  }

  /**
   * Upsert one entitlement's columns for a user, honoring the per-entitlement ordering guard.
   * Locks the user's mirror row (creating it if absent) so concurrent events serialize.
   */
  private async writeEntitlement(
    manager: EntityManager,
    userId: string,
    delta: EntitlementDelta,
    active: boolean,
  ): Promise<void> {
    const repo = manager.getRepository(Subscription);
    const cols = ENTITLEMENT_COLUMNS[delta.entitlementKey];
    const eventAt = new Date(delta.eventTimestampMs);

    const row = await this.lockOrCreateRow(manager, userId);
    const currentLastEventAt = row[cols.lastEventAt] as Date | null;

    // Out-of-order guard: ignore a delta that is not newer than the entitlement's last event.
    if (currentLastEventAt !== null && eventAt.getTime() <= currentLastEventAt.getTime()) {
      return;
    }

    await repo.update(
      { id: row.id },
      {
        [cols.active]: active,
        [cols.expiresAt]: delta.expiresAt !== null ? new Date(delta.expiresAt) : null,
        [cols.store]: delta.store,
        [cols.lastEventAt]: eventAt,
      },
    );
  }

  /** Lock the user's mirror row FOR UPDATE, inserting an empty row first if none exists. */
  private async lockOrCreateRow(manager: EntityManager, userId: string): Promise<Subscription> {
    const repo = manager.getRepository(Subscription);
    const existing = await repo
      .createQueryBuilder('s')
      .setLock('pessimistic_write')
      .where('s.user_id = :userId', { userId })
      .getOne();
    if (existing) {
      return existing;
    }

    try {
      await repo.insert({ userId });
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
      // A concurrent insert won the race; fall through to re-lock the now-existing row.
    }

    const locked = await repo
      .createQueryBuilder('s')
      .setLock('pessimistic_write')
      .where('s.user_id = :userId', { userId })
      .getOne();
    if (!locked) {
      throw new Error(`Failed to lock subscription mirror row for user ${userId}`);
    }
    return locked;
  }

  // ─── Reconciliation support ──────────────────────────────────────────────────

  /**
   * Find mirror rows most likely to be stale: never reconciled, or not reconciled within the
   * staleness window, prioritizing the oldest. Idempotent no-op when a row is already correct.
   */
  async findStaleForReconciliation(staleWindowMs: number, limit: number): Promise<Subscription[]> {
    const cutoff = new Date(Date.now() - staleWindowMs);
    const repo = this.dataSource.getRepository(Subscription);
    const neverReconciled = await repo.find({
      where: { lastReconciledAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: limit,
    });
    if (neverReconciled.length >= limit) {
      return neverReconciled;
    }
    const stale = await repo.find({
      where: { lastReconciledAt: LessThan(cutoff) },
      order: { lastReconciledAt: 'ASC' },
      take: limit - neverReconciled.length,
    });
    return [...neverReconciled, ...stale];
  }

  /**
   * From a set of candidate user ids, return those WITHOUT a mirror row yet (discovery, P18).
   * Reconciliation creates rows for these from RevenueCat truth.
   */
  async findUserIdsMissingMirror(candidateUserIds: readonly string[]): Promise<string[]> {
    if (candidateUserIds.length === 0) {
      return [];
    }
    const existing = await this.dataSource
      .getRepository(Subscription)
      .find({ where: { userId: In([...candidateUserIds]) }, select: { userId: true } });
    const existingIds = new Set(existing.map((row) => row.userId));
    return candidateUserIds.filter((id) => !existingIds.has(id));
  }

  /**
   * Converge a mirror row to an authoritative RevenueCat snapshot (idempotent).
   * Overwrites every entitlement's state and refreshes `last_reconciled_at`; reconciliation is
   * the arbiter, so it does not consult per-entitlement event timestamps.
   */
  async upsertFromReconcile(snapshot: ReconciledSubscriber, reconciledAt: Date): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockOrCreateRow(manager, snapshot.userId);
      const patch: Record<string, unknown> = { lastReconciledAt: reconciledAt };
      for (const ent of snapshot.entitlements) {
        const cols = ENTITLEMENT_COLUMNS[ent.key];
        patch[cols.active] = ent.active;
        patch[cols.expiresAt] = ent.expiresAt;
        patch[cols.store] = ent.store;
      }
      await manager.getRepository(Subscription).update({ id: row.id }, patch);
    });
  }

  /** Refresh only `last_reconciled_at` (used when a row is already correct). */
  async markReconciled(userId: string, reconciledAt: Date): Promise<void> {
    await this.dataSource
      .getRepository(Subscription)
      .update({ userId }, { lastReconciledAt: reconciledAt });
  }

  // ─── Account deletion cleanup ────────────────────────────────────────────────

  /** Remove the mirror row for a user (idempotent; safe when none exists). */
  async removeForUser(userId: string): Promise<void> {
    await this.dataSource.getRepository(Subscription).delete({ userId });
  }

  /**
   * Anonymize ledger rows for a deleted user (`user_id -> NULL`), preserving audit history.
   * There is no FK, so history survives; idempotent.
   */
  async anonymizeLedgerForUser(userId: string): Promise<void> {
    await this.dataSource
      .getRepository(SubscriptionEvent)
      .update({ userId }, { userId: null });
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === SubscriptionsRepository.UNIQUE_VIOLATION
    );
  }
}
