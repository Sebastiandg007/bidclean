import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * favorites schema (Spec 22 — Sprint 6, Polish & Extras).
 *
 * Owns exactly ONE table: the durable directed Host->Cleaner favorite relationship consumed by the
 * tiered delivery (Spec 7). A favorite is a private, disposable list entry — add-or-remove, never a
 * mutable or audited entity — so there is NO `updated_at`/`deleted_at`; un-favorite is a hard delete.
 *
 * Both FKs are `ON DELETE CASCADE`: a favorite is a LIVE relationship, not shared history, so
 * deleting either user simply removes their favorite links. This is the deliberate, correct use of
 * CASCADE-from-users, unlike chat/calls/completions which preserve history via `SET NULL`.
 *
 * DB standards: UUID PK (`gen_random_uuid()`), snake_case, timestamptz `created_at`, explicit FK
 * `ON DELETE`, `UNIQUE (host_id, cleaner_id)` (idempotency + at-most-one-per-pair), `CHECK
 * (host_id <> cleaner_id)` (no self-favorite at the DDL floor), and indexes on every FK plus a
 * composite keyset-pagination index. Reversible: `down()` drops the indexes then the table.
 */
export class CreateFavorites1700000046000 implements MigrationInterface {
  name = 'CreateFavorites1700000046000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "favorites" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "host_id" UUID NOT NULL,
        "cleaner_id" UUID NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_favorites_host_cleaner" UNIQUE ("host_id", "cleaner_id"),
        CONSTRAINT "chk_favorites_not_self" CHECK ("host_id" <> "cleaner_id"),
        CONSTRAINT "fk_favorites_host"
          FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_favorites_cleaner"
          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // Delivery list query (listFavoriteCleanerIds) + the Host list are host-scoped.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_favorites_host" ON "favorites" ("host_id")`,
    );
    // Aggregate-count (Hosts who favorited a given Cleaner) is cleaner-scoped.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_favorites_cleaner" ON "favorites" ("cleaner_id")`,
    );
    // Deterministic keyset pagination for the Host list: (host_id, created_at DESC, id DESC).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_favorites_host_created"
        ON "favorites" ("host_id", "created_at" DESC, "id" DESC)`,
    );

    await queryRunner.query(
      `COMMENT ON TABLE "favorites" IS
        'Directed Host->Cleaner favorite relationship; private to the Host; feeds Spec 7 favorites-first delivery. Hard delete on un-favorite (no soft-delete/audit). Both FKs ON DELETE CASCADE because a favorite is a live relationship, not shared history.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "favorites"."host_id" IS
        'The Host who favorited (FK users, CASCADE — a favorite is a live relationship, not history).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "favorites"."cleaner_id" IS
        'The favorited Cleaner (FK users, CASCADE). listFavoriteCleanerIds returns this id even when the Cleaner is currently ineligible; Spec 7 filters eligibility at delivery.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "favorites"."created_at" IS
        'When the favorite was added; drives deterministic keyset pagination (created_at DESC, id DESC).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_favorites_host_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_favorites_cleaner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_favorites_host"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "favorites"`);
  }
}
