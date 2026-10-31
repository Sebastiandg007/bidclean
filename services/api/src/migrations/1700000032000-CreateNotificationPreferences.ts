import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `notification_preferences` — one row per user with per-category opt-in/out and a
 * quiet-hours window (with IANA timezone). An absent category in `category_opt_out` falls back to
 * the `NotificationType` metadata `defaultEnabled` (decided in application logic, not hardcoded).
 *
 * FK -> users ON DELETE CASCADE (notification data is user-owned). UNIQUE (user_id) enforces one
 * preference row per user.
 */
export class CreateNotificationPreferences1700000032000 implements MigrationInterface {
  name = 'CreateNotificationPreferences1700000032000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_preferences" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "category_opt_out" JSONB NOT NULL DEFAULT '{}',
        "quiet_hours_start" TIME,
        "quiet_hours_end" TIME,
        "quiet_hours_timezone" VARCHAR(64),
        "language" VARCHAR(35),
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "fk_notification_preferences_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_notification_preferences_user" UNIQUE ("user_id")
      )
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "notification_preferences" IS 'Per-user, per-category opt-in/out and quiet-hours window (with tz). Absent category falls back to metadata defaultEnabled.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "notification_preferences"."category_opt_out" IS 'JSONB { [category]: false } overrides; absent category uses NotificationType metadata defaultEnabled.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "notification_preferences"."quiet_hours_timezone" IS 'IANA timezone for the quiet-hours window (e.g. America/Bogota).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_preferences"`);
  }
}
