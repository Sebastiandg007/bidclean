import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `deletion_status` column to the `users` table for async account deletion.
 *
 * Values:
 * - NULL    → active user (default)
 * - 'DELETION_PENDING' → deletion requested, Keycloak disabled, BullMQ job enqueued
 * - 'DELETED'          → cascade complete, PII anonymized
 *
 * Uses VARCHAR with application-level validation (not PostgreSQL ENUM) per database standards.
 */
export class AddDeletionStatusToUsers1700000006000 implements MigrationInterface {
  name = 'AddDeletionStatusToUsers1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add deletion_status column — nullable, defaults to NULL (active user)
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "deletion_status" VARCHAR(30) DEFAULT NULL
    `);

    // Partial index for efficient lookups of users pending deletion
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_deletion_status"
        ON "users" ("deletion_status")
        WHERE "deletion_status" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_users_deletion_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "deletion_status"
    `);
  }
}
