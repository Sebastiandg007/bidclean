import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRoleTables1700000001000 implements MigrationInterface {
  name = 'CreateRoleTables1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add role-related columns to users table
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "roles" VARCHAR(50)[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "active_role" VARCHAR(20),
        ADD COLUMN IF NOT EXISTS "onboarding_status_host" VARCHAR(20) DEFAULT 'NOT_STARTED',
        ADD COLUMN IF NOT EXISTS "onboarding_status_cleaner" VARCHAR(20) DEFAULT 'NOT_STARTED'
    `);

    // Host profiles table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "host_profiles" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID UNIQUE NOT NULL,
        "display_name" VARCHAR(255) NOT NULL,
        "is_business" BOOLEAN DEFAULT FALSE,
        "business_name" VARCHAR(255),
        "payment_method_added" BOOLEAN DEFAULT FALSE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "FK_host_profiles_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_host_profiles_user"
        ON "host_profiles" ("user_id")
    `);

    // Cleaner profiles table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cleaner_profiles" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID UNIQUE NOT NULL,
        "display_name" VARCHAR(255) NOT NULL,
        "work_zone_lat" DOUBLE PRECISION,
        "work_zone_lng" DOUBLE PRECISION,
        "work_zone_radius_km" DOUBLE PRECISION,
        "availability" JSONB DEFAULT '{}',
        "specialties" VARCHAR(50)[] DEFAULT '{}',
        "has_portfolio" BOOLEAN DEFAULT FALSE,
        "bank_account_added" BOOLEAN DEFAULT FALSE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "FK_cleaner_profiles_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_cleaner_profiles_user"
        ON "cleaner_profiles" ("user_id")
    `);

    // PostGIS extension for geospatial queries (idempotent)
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS postgis
    `);

    // GiST index for geospatial queries on cleaner work zone
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_cleaner_profiles_zone"
        ON "cleaner_profiles" USING GIST (
          ST_MakePoint("work_zone_lng", "work_zone_lat")
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cleaner_profiles_zone"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cleaner_profiles_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleaner_profiles"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_host_profiles_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "host_profiles"`);

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "onboarding_status_cleaner",
        DROP COLUMN IF EXISTS "onboarding_status_host",
        DROP COLUMN IF EXISTS "active_role",
        DROP COLUMN IF EXISTS "roles"
    `);
  }
}
