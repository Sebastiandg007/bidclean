import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserSettingsTable1700000004000 implements MigrationInterface {
  name = 'CreateUserSettingsTable1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // User settings table — stores per-user preferences (language, theme, notifications)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_settings" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "language" VARCHAR(35) NOT NULL DEFAULT 'en',
        "theme" VARCHAR(10) NOT NULL DEFAULT 'system',
        "is_push_enabled" BOOLEAN NOT NULL DEFAULT true,
        "is_email_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
        "is_sounds_enabled" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "FK_user_settings_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_user_settings_user"
          UNIQUE ("user_id"),
        CONSTRAINT "chk_theme"
          CHECK ("theme" IN ('dark', 'light', 'system'))
      )
    `);

    // Index on user_id for fast lookups by user
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_settings_user"
        ON "user_settings" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_settings"`);
  }
}
