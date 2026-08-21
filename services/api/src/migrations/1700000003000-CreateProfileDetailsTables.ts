import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProfileDetailsTables1700000003000 implements MigrationInterface {
  name = 'CreateProfileDetailsTables1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Profile details table — stores common profile data for all users
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "profile_details" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "display_name" VARCHAR(255) NOT NULL,
        "phone_number" VARCHAR(20),
        "photo_storage_key" VARCHAR(512),
        "bio" TEXT,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "FK_profile_details_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_profile_details_user"
          UNIQUE ("user_id")
      )
    `);

    // Index on user_id for fast lookups by user
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_profile_details_user"
        ON "profile_details" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_details"`);
  }
}
