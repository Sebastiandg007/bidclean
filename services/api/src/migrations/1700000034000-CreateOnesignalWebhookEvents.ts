import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `onesignal_webhook_events` — the webhook idempotency ledger.
 *
 * OneSignal delivery/subscription callbacks are authenticated (signature over the raw body) and
 * deduped by their own `provider_event_id` (stored UNIQUE) so a redelivered callback is a no-op
 * and never re-mutates the notifications ledger or the device registry.
 */
export class CreateOnesignalWebhookEvents1700000034000 implements MigrationInterface {
  name = 'CreateOnesignalWebhookEvents1700000034000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "onesignal_webhook_events" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider_event_id" VARCHAR(255) NOT NULL,
        "event_type" VARCHAR(50) NOT NULL,
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_onesignal_webhook_provider_event" UNIQUE ("provider_event_id")
      )
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "onesignal_webhook_events" IS 'Webhook idempotency ledger; a redelivered OneSignal callback (same provider_event_id) is a no-op.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "onesignal_webhook_events"."provider_event_id" IS 'UNIQUE — OneSignal''s own event id; guarantees a redelivered callback never re-mutates state.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "onesignal_webhook_events"`);
  }
}
