import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the append-only `subscription_events` ledger + delivery outbox.
 *
 * Every RevenueCat webhook, sanitized (no tokens/receipts/PII), is recorded here with a
 * `dispatch_status` lifecycle (RECEIVED -> QUEUED -> PROCESSED, or FAILED). The row is
 * committed RECEIVED before the webhook is acknowledged, so an acknowledged event is never
 * lost: a recovery worker re-enqueues RECEIVED/QUEUED rows that were never PROCESSED.
 *
 * There is deliberately NO FK to `users`: audit history must survive account deletion, so
 * `user_id` is nullable and anonymized (set NULL) on deletion instead of being cascaded away.
 * `uq_subscription_event_rc_id` is the dedup guarantee for redelivered events.
 */
export class CreateSubscriptionEvents1700000018000 implements MigrationInterface {
  name = 'CreateSubscriptionEvents1700000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription_events" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        "revenuecat_event_id" VARCHAR(255) NOT NULL,

        -- resolved app_user_id; NOT a FK (audit survives deletion; anonymized to NULL)
        "user_id" UUID,

        "event_type" VARCHAR(40) NOT NULL,
        "entitlement_ids" VARCHAR(40)[] NOT NULL DEFAULT '{}',
        "store" VARCHAR(20),

        -- RevenueCat event time in epoch ms (per-entitlement ordering)
        "event_timestamp_ms" BIGINT NOT NULL,
        "expiration_at" TIMESTAMP WITH TIME ZONE,

        -- sanitized payload (no PII/secrets)
        "payload_json" JSONB NOT NULL,

        "dispatch_status" VARCHAR(12) NOT NULL DEFAULT 'RECEIVED',
        "processed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "uq_subscription_event_rc_id" UNIQUE ("revenuecat_event_id"),
        CONSTRAINT "chk_subscription_event_dispatch" CHECK
          ("dispatch_status" IN ('RECEIVED','QUEUED','PROCESSED','FAILED'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_subscription_events_user"
        ON "subscription_events" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_subscription_events_type"
        ON "subscription_events" ("event_type")
    `);
    // Recovery worker: RECEIVED/QUEUED rows not yet processed, oldest first.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_subscription_events_dispatch"
        ON "subscription_events" ("dispatch_status", "created_at")
        WHERE "dispatch_status" IN ('RECEIVED','QUEUED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_subscription_events_dispatch"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_subscription_events_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_subscription_events_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_events"`);
  }
}
