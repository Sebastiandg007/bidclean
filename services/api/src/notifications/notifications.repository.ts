import { Injectable } from '@nestjs/common';
import { DataSource, LessThan } from 'typeorm';
import { NotificationDevice } from './entities/notification-device.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { Notification } from './entities/notification.entity';
import { OnesignalWebhookEvent } from './entities/onesignal-webhook-event.entity';
import type { DeepLink } from './notifications.types';

/** Parameters to upsert a device (Model B registry). */
export interface UpsertDeviceParams {
  readonly userId: string;
  readonly platform: string;
  readonly onesignalPlayerId: string;
  readonly consentGranted: boolean;
}

/** Parameters to insert a ledger row already in its final initial status. */
export interface InsertLedgerParams {
  readonly recipientUserId: string;
  readonly type: string;
  readonly category: string;
  readonly dedupKey: string;
  readonly deepLink: DeepLink;
  readonly payloadRef: Record<string, string> | null;
  readonly priority: string;
  readonly status: 'PENDING' | 'SUPPRESSED';
  readonly suppressionReason: string | null;
}

/**
 * Notifications repository — every read/write to the device registry, preferences, ledger, and
 * webhook idempotency table. Parameterized queries only; never writes `users`. The single-winner
 * transition and dedup insert are the two correctness-critical operations.
 */
@Injectable()
export class NotificationsRepository {
  /** Postgres unique-violation error code. */
  private static readonly UNIQUE_VIOLATION = '23505';

  constructor(private readonly dataSource: DataSource) {}

  // ─── Device registry (Model B) ──────────────────────────────────────────────

  /**
   * Upsert a device keyed by `(user_id, onesignal_player_id)`. Re-registering resets `is_stale`
   * and refreshes consent/last_seen. `onesignal_external_user_id` is always the internal user id.
   */
  async upsertDevice(params: UpsertDeviceParams): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "notification_devices"
         ("user_id", "platform", "onesignal_player_id", "onesignal_external_user_id",
          "consent_granted", "is_stale", "last_seen_at")
       VALUES ($1, $2, $3, $1, $4, false, NOW())
       ON CONFLICT ("user_id", "onesignal_player_id")
       DO UPDATE SET
         "platform" = EXCLUDED."platform",
         "consent_granted" = EXCLUDED."consent_granted",
         "is_stale" = false,
         "last_seen_at" = NOW(),
         "updated_at" = NOW()`,
      [params.userId, params.platform, params.onesignalPlayerId, params.consentGranted],
    );
  }

  /** Update a single device's consent without affecting the user's other devices. */
  async updateConsent(userId: string, playerId: string, consentGranted: boolean): Promise<void> {
    await this.dataSource.query(
      `UPDATE "notification_devices"
         SET "consent_granted" = $3, "updated_at" = NOW()
       WHERE "user_id" = $1 AND "onesignal_player_id" = $2`,
      [userId, playerId, consentGranted],
    );
  }

  /** Hard-delete a single device (logout/unregister) without affecting other devices. */
  async deleteDevice(userId: string, playerId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM "notification_devices" WHERE "user_id" = $1 AND "onesignal_player_id" = $2`,
      [userId, playerId],
    );
  }

  /**
   * Resolve the reconciled per-send targeting set (Model B): consented, non-stale player ids for
   * the recipient. Uses the partial consented index.
   */
  async resolveConsentedPlayerIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ onesignal_player_id: string }>>(
      `SELECT "onesignal_player_id"
         FROM "notification_devices"
        WHERE "user_id" = $1 AND "consent_granted" = true AND "is_stale" = false`,
      [userId],
    );
    return rows.map((row) => row.onesignal_player_id);
  }

  /** True when the recipient has at least one consented, non-stale device. */
  async hasConsentedDevice(userId: string): Promise<boolean> {
    const ids = await this.resolveConsentedPlayerIds(userId);
    return ids.length > 0;
  }

  /** Flag a player id OneSignal reported invalid so it is excluded from targeting. */
  async markStale(playerId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "notification_devices" SET "is_stale" = true, "updated_at" = NOW()
        WHERE "onesignal_player_id" = $1`,
      [playerId],
    );
  }

  /** List all devices for a user (registry reads / reconciliation). */
  async findDevicesForUser(userId: string): Promise<NotificationDevice[]> {
    return this.dataSource
      .getRepository(NotificationDevice)
      .find({ where: { userId } });
  }

  /**
   * A bounded batch of consented, non-stale devices ordered by least-recently-seen, used by the
   * reconciliation sweep to re-push authoritative state to OneSignal (drift repair).
   */
  async findDevicesForReconciliation(limit: number): Promise<NotificationDevice[]> {
    return this.dataSource.getRepository(NotificationDevice).find({
      where: { consentGranted: true, isStale: false },
      order: { lastSeenAt: 'ASC' },
      take: limit,
    });
  }

  // ─── Preferences ─────────────────────────────────────────────────────────────

  /** Load a user's preferences, or null when none exist (defaults applied downstream). */
  async findPreferences(userId: string): Promise<NotificationPreference | null> {
    return this.dataSource.getRepository(NotificationPreference).findOne({ where: { userId } });
  }

  /** Upsert a user's preferences (one row per user). */
  async upsertPreferences(
    userId: string,
    patch: Partial<Pick<
      NotificationPreference,
      'categoryOptOut' | 'quietHoursStart' | 'quietHoursEnd' | 'quietHoursTimezone' | 'language'
    >>,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "notification_preferences"
         ("user_id", "category_opt_out", "quiet_hours_start", "quiet_hours_end",
          "quiet_hours_timezone", "language")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("user_id") DO UPDATE SET
         "category_opt_out" = EXCLUDED."category_opt_out",
         "quiet_hours_start" = EXCLUDED."quiet_hours_start",
         "quiet_hours_end" = EXCLUDED."quiet_hours_end",
         "quiet_hours_timezone" = EXCLUDED."quiet_hours_timezone",
         "language" = EXCLUDED."language",
         "updated_at" = NOW()`,
      [
        userId,
        JSON.stringify(patch.categoryOptOut ?? {}),
        patch.quietHoursStart ?? null,
        patch.quietHoursEnd ?? null,
        patch.quietHoursTimezone ?? null,
        patch.language ?? null,
      ],
    );
  }

  // ─── Ledger ──────────────────────────────────────────────────────────────────

  /**
   * Insert a ledger row already in its final initial status (PENDING or SUPPRESSED). Returns the
   * new row id, or null when the dedup_key already exists (exactly-once intent — a no-op).
   */
  async insertLedger(params: InsertLedgerParams): Promise<string | null> {
    try {
      const rows = await this.dataSource.query<Array<{ id: string }>>(
        `INSERT INTO "notifications"
           ("recipient_user_id", "type", "category", "channel", "dedup_key", "deep_link",
            "payload_ref", "priority", "status", "suppression_reason")
         VALUES ($1, $2, $3, 'PUSH', $4, $5, $6, $7, $8, $9)
         RETURNING "id"`,
        [
          params.recipientUserId,
          params.type,
          params.category,
          params.dedupKey,
          JSON.stringify(params.deepLink),
          params.payloadRef ? JSON.stringify(params.payloadRef) : null,
          params.priority,
          params.status,
          params.suppressionReason,
        ],
      );
      return rows[0]?.id ?? null;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  /** Load a ledger row by id. */
  async findLedger(id: string): Promise<Notification | null> {
    return this.dataSource.getRepository(Notification).findOne({ where: { id } });
  }

  /** Load a ledger row by its dedup key (used by createIntent no-op path). */
  async findLedgerByDedupKey(dedupKey: string): Promise<Notification | null> {
    return this.dataSource.getRepository(Notification).findOne({ where: { dedupKey } });
  }

  /** Self-scoped audit read of a recipient's recent notifications. */
  async listForRecipient(userId: string, limit: number): Promise<Notification[]> {
    return this.dataSource.getRepository(Notification).find({
      where: { recipientUserId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Single-winner transition PENDING -> PROCESSING. Returns true only for the worker that won the
   * conditional update (rows=1); a loser sees rows=0 and must no-op.
   */
  async claimForDelivery(id: string): Promise<boolean> {
    const result = await this.dataSource.query<[unknown[], number]>(
      `UPDATE "notifications"
         SET "status" = 'PROCESSING', "attempt" = "attempt" + 1, "updated_at" = NOW()
       WHERE "id" = $1 AND "status" = 'PENDING'`,
      [id],
    );
    // node-postgres returns [rows, rowCount] for UPDATE via query(); TypeORM returns affected count.
    const affected = Array.isArray(result) ? Number(result[1]) : Number(result);
    return affected === 1;
  }

  /** Mark a ledger row SENT. */
  async markSent(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "notifications" SET "status" = 'SENT', "sent_at" = NOW(), "updated_at" = NOW()
        WHERE "id" = $1`,
      [id],
    );
  }

  /** Mark a ledger row with a terminal/retryable status. */
  async markStatus(
    id: string,
    status: 'FAILED_RETRYABLE' | 'FAILED_FINAL' | 'SUPPRESSED' | 'PENDING',
    suppressionReason: string | null = null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE "notifications" SET "status" = $2, "suppression_reason" = $3, "updated_at" = NOW()
        WHERE "id" = $1`,
      [id, status, suppressionReason],
    );
  }

  /** Prune terminal ledger rows older than the retention horizon (returns count removed). */
  async pruneTerminalLedger(olderThan: Date): Promise<number> {
    const result = await this.dataSource.query<[unknown[], number]>(
      `DELETE FROM "notifications"
        WHERE "status" IN ('SENT', 'FAILED_FINAL', 'SUPPRESSED') AND "created_at" < $1`,
      [olderThan],
    );
    return Array.isArray(result) ? Number(result[1]) : Number(result);
  }

  // ─── Webhook idempotency ──────────────────────────────────────────────────────

  /**
   * Record a webhook `provider_event_id`. Returns true when newly inserted, false when it already
   * existed (a redelivery — the caller must no-op).
   */
  async recordWebhookEvent(providerEventId: string, eventType: string): Promise<boolean> {
    try {
      await this.dataSource.query(
        `INSERT INTO "onesignal_webhook_events" ("provider_event_id", "event_type")
         VALUES ($1, $2)`,
        [providerEventId, eventType],
      );
      return true;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  async hasWebhookEvent(providerEventId: string): Promise<boolean> {
    const count = await this.dataSource
      .getRepository(OnesignalWebhookEvent)
      .count({ where: { providerEventId } });
    return count > 0;
  }

  /** Prune webhook idempotency rows older than the retention horizon. */
  async pruneWebhookEvents(olderThan: Date): Promise<void> {
    await this.dataSource
      .getRepository(OnesignalWebhookEvent)
      .delete({ receivedAt: LessThan(olderThan) });
  }

  // ─── Outbox relay ──────────────────────────────────────────────────────────

  /**
   * Drain a bounded batch of committed-but-unrelayed rows from a named outbox table, oldest first.
   * The table name is a module-owned constant (never user input) and is whitelisted before use.
   */
  async findUnrelayed(tableName: string, limit: number): Promise<OutboxRowRecord[]> {
    assertSafeOutboxTable(tableName);
    const rows = await this.dataSource.query<OutboxRowRecord[]>(
      `SELECT "id", "event_id" AS "eventId", "aggregate_type" AS "aggregateType",
              "aggregate_id" AS "aggregateId", "type", "payload", "version",
              "created_at" AS "createdAt", "relayed_at" AS "relayedAt"
         FROM "${tableName}"
        WHERE "relayed_at" IS NULL
        ORDER BY "created_at" ASC
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** Mark an outbox row relayed (idempotent; a re-drain of an already-relayed row is skipped). */
  async markRelayed(tableName: string, eventId: string): Promise<void> {
    assertSafeOutboxTable(tableName);
    await this.dataSource.query(
      `UPDATE "${tableName}" SET "relayed_at" = NOW() WHERE "event_id" = $1`,
      [eventId],
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === NotificationsRepository.UNIQUE_VIOLATION
    );
  }
}

/** A raw outbox row as read by the relay (snake->camel projected). */
export interface OutboxRowRecord {
  readonly id: string;
  readonly eventId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly version: number;
  readonly createdAt: Date;
  readonly relayedAt: Date | null;
}

/** Whitelist an outbox table identifier (module-owned constant) before interpolation. */
function assertSafeOutboxTable(tableName: string): void {
  if (!/^[a-z_][a-z0-9_]*_outbox$/.test(tableName)) {
    throw new Error(`Unsafe outbox table name: ${tableName}`);
  }
}
