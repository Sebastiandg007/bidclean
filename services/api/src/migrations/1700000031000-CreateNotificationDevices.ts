import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `notification_devices` — the Model B per-device subscription registry.
 *
 * Maps an internal `user_id` to its per-device OneSignal `player id` (the per-send TARGET) plus
 * platform and per-device `consent_granted`. `onesignal_external_user_id` equals the `user_id` and
 * is used ONLY for OneSignal tags/segments, never as a target. `is_stale` flags a player id
 * OneSignal reported invalid so it is excluded from targeting rather than repeatedly retried.
 *
 * FK -> users ON DELETE CASCADE: notification data is user-owned (the deliberate contrast with
 * chat/voip SET NULL, which preserve shared history). Unregister is a hard delete; consent
 * withdrawal flips `consent_granted`.
 */
export class CreateNotificationDevices1700000031000 implements MigrationInterface {
  name = 'CreateNotificationDevices1700000031000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_devices" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "platform" VARCHAR(10) NOT NULL,
        "onesignal_player_id" VARCHAR(255) NOT NULL,
        "onesignal_external_user_id" VARCHAR(255) NOT NULL,
        "consent_granted" BOOLEAN NOT NULL DEFAULT false,
        "is_stale" BOOLEAN NOT NULL DEFAULT false,
        "last_seen_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "fk_notification_devices_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_notification_devices_user_player"
          UNIQUE ("user_id", "onesignal_player_id"),
        CONSTRAINT "chk_notification_devices_platform"
          CHECK ("platform" IN ('IOS', 'ANDROID', 'WEB'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_devices_user"
        ON "notification_devices" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_devices_consented"
        ON "notification_devices" ("user_id")
        WHERE "consent_granted" = true AND "is_stale" = false
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "notification_devices" IS 'Model B per-device subscription registry: which OneSignal player ids (per-device targets) belong to a user, with per-device consent.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "notification_devices"."onesignal_player_id" IS 'Per-device subscription id; the actual per-send target (Model B).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "notification_devices"."onesignal_external_user_id" IS 'Equals user_id; used for OneSignal tags/segments only, never as a target.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "notification_devices"."is_stale" IS 'True when OneSignal reported the player id invalid; excluded from targeting.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_notification_devices_consented"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_notification_devices_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_devices"`);
  }
}
