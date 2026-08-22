import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePropertiesTable1700000007000 implements MigrationInterface {
  name = 'CreatePropertiesTable1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PostGIS extension (idempotent — already created in 1700000001000 but kept for safety)
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS postgis
    `);

    // Properties table — physical spaces where cleaning services are performed
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "properties" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "name" VARCHAR(100) NOT NULL,
        "type" VARCHAR(30) NOT NULL,
        "description" TEXT,

        -- Address (structured — user-entered or reverse-geocoded)
        "address_street" VARCHAR(255) NOT NULL,
        "address_city" VARCHAR(100) NOT NULL,
        "address_state" VARCHAR(100),
        "address_postal_code" VARCHAR(20),
        "address_country" CHAR(2) NOT NULL,

        -- Geocoded location (PostGIS)
        "location" GEOGRAPHY(Point, 4326) NOT NULL,
        "formatted_address" VARCHAR(500),
        "location_source" VARCHAR(20) NOT NULL,

        -- Dimensions
        "square_meters" NUMERIC(8,2) NOT NULL,
        "bedrooms" INTEGER NOT NULL DEFAULT 0,
        "bathrooms" INTEGER NOT NULL DEFAULT 1,
        "floor_number" INTEGER,

        -- Amenities
        "has_parking" BOOLEAN NOT NULL DEFAULT false,
        "has_elevator" BOOLEAN NOT NULL DEFAULT false,
        "special_requirements" VARCHAR(100)[] DEFAULT '{}',

        -- Checklist
        "checklist_items" VARCHAR(200)[] DEFAULT '{}',

        -- Private (revealed only after match)
        "access_instructions" TEXT,

        -- Metadata
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- Constraints
        CONSTRAINT "chk_type" CHECK ("type" IN ('apartment', 'house', 'office', 'airbnb', 'commercial_space', 'other')),
        CONSTRAINT "chk_country" CHECK ("address_country" IN ('CO', 'US', 'CA', 'GB', 'DE', 'FR', 'IT', 'ES', 'PT', 'NL')),
        CONSTRAINT "chk_sqm" CHECK ("square_meters" > 0),
        CONSTRAINT "chk_bedrooms" CHECK ("bedrooms" >= 0),
        CONSTRAINT "chk_bathrooms" CHECK ("bathrooms" >= 1),
        CONSTRAINT "chk_location_source" CHECK ("location_source" IN ('GEOCODED', 'MANUAL')),

        -- Foreign key
        CONSTRAINT "FK_properties_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // Index on user_id for fast lookups (FK index)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_properties_user"
        ON "properties" ("user_id")
    `);

    // Partial index on user_id for active (non-deleted) properties
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_properties_user_active"
        ON "properties" ("user_id") WHERE "deleted_at" IS NULL
    `);

    // GiST index on location for spatial queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_properties_location"
        ON "properties" USING GIST ("location")
    `);

    // Partial index on type for active properties
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_properties_type"
        ON "properties" ("type") WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_properties_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_properties_location"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_properties_user_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_properties_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "properties"`);
  }
}
