import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePropertyIdempotencyKeysTable1700000009000
  implements MigrationInterface
{
  name = 'CreatePropertyIdempotencyKeysTable1700000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_idempotency_keys" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "property_id" UUID NOT NULL,
        "idempotency_key" VARCHAR(255) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "FK_prop_idempotency_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_prop_idempotency_property"
          FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_prop_idempotency_user_key"
          UNIQUE ("user_id", "idempotency_key")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prop_idempotency_user"
        ON "property_idempotency_keys" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prop_idempotency_user"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "property_idempotency_keys"`,
    );
  }
}
