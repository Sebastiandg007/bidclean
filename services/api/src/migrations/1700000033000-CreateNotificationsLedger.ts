import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `notifications` — the delivery ledger and the source of truth for notification intent.
 *
 * One row = ONE notification INTENT for a recipient (NOT one row per device delivery). `SENT`
 * therefore means "at least one successful provider submission for this intent", never
 * "every device delivered exactly once" — external OneSignal delivery is at-least-once/best-effort.
 *
 * The exactly-once INTENT guarantee is the `uq_notifications_dedup` UNIQUE constraint on
 * `dedup_key` (derived from the outbox `event_id` + version + recipient). The single-winner
 * `PENDING -> PROCESSING` transition bounds LOCAL double-processing.
 *
 * FK -> users ON DELETE CASCADE (notification data is user-owned). There is intentionally NO
 * `deleted_at`: terminal rows are hard-pruned via the retention window.
 */
export class CreateNotificationsLedger1700000033000 implements MigrationInterface {
  name = 'CreateNotificationsLedger1700000033000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "recipient_user_id" UUID NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "category" VARCHAR(30) NOT NULL,
        "channel" VARCHAR(20) NOT NULL DEFAULT 'PUSH',
        "dedup_key" VARCHAR(255) NOT NULL,
        "deep_link" JSONB NOT NULL,
        "payload_ref" JSONB,
        "priority" VARCHAR(10) NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "suppression_reason" VARCHAR(30),
        "attempt" INTEGER NOT NULL DEFAULT 0,
        "sent_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "fk_notifications_recipient"
          FOREIGN KEY ("recipient_user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_notifications_dedup" UNIQUE ("dedup_key"),
        CONSTRAINT "chk_notifications_status"
          CHECK ("status" IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'SUPPRESSED')),
        CONSTRAINT "chk_notifications_priority"
          CHECK ("priority" IN ('HIGH', 'NORMAL', 'LOW')),
        CONSTRAINT "chk_notifications_channel"
          CHECK ("channel" IN ('PUSH', 'EMAIL', 'SMS'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_recipient_created"
        ON "notifications" ("recipient_user_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_status"
        ON "notifications" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_pending"
        ON "notifications" ("status", "created_at") WHERE "status" = 'PENDING'
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "notifications" IS 'Notification delivery ledger; one row per INTENT (not per device). SENT = at least one successful provider submission for this intent.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "notifications"."dedup_key" IS 'UNIQUE — derived from the outbox event_id + version + recipient; the exactly-once intent guarantee.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "notifications"."deep_link" IS 'Typed id-based deep-link { type, ...ids }; ids only, never sensitive content.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "notifications"."suppression_reason" IS 'no-device | opted-out | quiet-hours | foreground (audit only, never a delivery failure).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_notifications_pending"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_notifications_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_notifications_recipient_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
  }
}
