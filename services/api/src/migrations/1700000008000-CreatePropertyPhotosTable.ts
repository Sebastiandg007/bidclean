import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePropertyPhotosTable1700000008000 implements MigrationInterface {
  name = 'CreatePropertyPhotosTable1700000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Property photos table — stores property images with display ordering and metadata
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_photos" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "property_id" UUID NOT NULL,
        "storage_key" VARCHAR(512) NOT NULL,
        "mime_type" VARCHAR(50) NOT NULL,
        "file_size_bytes" INTEGER NOT NULL,
        "display_order" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "FK_property_photos_property_id"
          FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_property_photos_key"
          UNIQUE ("storage_key")
      )
    `);

    // Index on property_id for fast FK lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_property_photos_property"
        ON "property_photos" ("property_id")
    `);

    // Composite index on property_id + display_order for ordered photo queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_property_photos_order"
        ON "property_photos" ("property_id", "display_order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "property_photos"`);
  }
}
