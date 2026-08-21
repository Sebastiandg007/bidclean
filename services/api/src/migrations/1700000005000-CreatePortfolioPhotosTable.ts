import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePortfolioPhotosTable1700000005000 implements MigrationInterface {
  name = 'CreatePortfolioPhotosTable1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Portfolio photos table — stores cleaner portfolio images with display ordering
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "portfolio_photos" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "storage_key" VARCHAR(512) NOT NULL,
        "display_order" INTEGER NOT NULL DEFAULT 0,
        "caption" VARCHAR(255),
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "FK_portfolio_photos_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_portfolio_photos_key"
          UNIQUE ("storage_key")
      )
    `);

    // Index on user_id for fast lookups by user
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_portfolio_photos_user"
        ON "portfolio_photos" ("user_id")
    `);

    // Composite index on user_id + display_order for ordered portfolio queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_portfolio_photos_order"
        ON "portfolio_photos" ("user_id", "display_order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "portfolio_photos"`);
  }
}
