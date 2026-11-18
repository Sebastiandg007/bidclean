import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * checklist-photos schema (Spec 19).
 *
 * Six tables + a BEFORE DELETE tombstone trigger:
 *  - checklist_runs: the durable run for a session (snapshot of the property checklist + policies).
 *  - checklist_tasks: per-task snapshot + completion state.
 *  - checklist_task_photos: evidence metadata (never the bytes).
 *  - checklist_upload_grants: single-use grant binding an object key to run/task+user (key != cred).
 *  - checklist_photo_object_deletions: deletion tombstone drained idempotently (the voice-notes lesson).
 *  - checklist_outbox: durable completion facts fanned out to Spec 20/21.
 *
 * All tables follow the DB standards: UUID PKs, snake_case, timestamptz, explicit FK ON DELETE,
 * indexes on every FK + partial sweep indexes, application-validated VARCHAR (no PG enums), no
 * `deleted_at` on metadata rows. Reversible: `down()` drops in dependency order.
 */
export class CreateChecklistPhotoTables1700000043000 implements MigrationInterface {
  name = 'CreateChecklistPhotoTables1700000043000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── checklist_runs ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checklist_runs" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "service_session_id" UUID NOT NULL,
        "offer_id" UUID NOT NULL,
        "property_id" UUID,
        "total_tasks" INTEGER NOT NULL DEFAULT 0,
        "completed_tasks" INTEGER NOT NULL DEFAULT 0,
        "photo_required_policy_snapshot" JSONB NOT NULL,
        "completion_precondition_snapshot" JSONB NOT NULL,
        "max_photos_per_task_snapshot" INTEGER NOT NULL,
        "state" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "abandoned_reason" VARCHAR(30),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_checklist_runs_service_session" UNIQUE ("service_session_id"),
        CONSTRAINT "chk_checklist_runs_state" CHECK ("state" IN ('ACTIVE', 'COMPLETED', 'ABANDONED')),
        CONSTRAINT "chk_checklist_runs_completed_range"
          CHECK ("completed_tasks" >= 0 AND "completed_tasks" <= "total_tasks"),
        CONSTRAINT "fk_checklist_runs_session"
          FOREIGN KEY ("service_session_id") REFERENCES "service_sessions" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_checklist_runs_offer"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_checklist_runs_property"
          FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_runs_offer" ON "checklist_runs" ("offer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_runs_property" ON "checklist_runs" ("property_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_runs_active"
        ON "checklist_runs" ("state", "updated_at") WHERE "state" = 'ACTIVE'`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "checklist_runs" IS
        'The durable checklist run bound 1:1 to a service session; a temporally-exact snapshot of the property checklist + policies at IN_PROGRESS. No deleted_at (terminal run is an immutable audit fact).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "checklist_runs"."completed_tasks" IS
        'Derived count kept in sync with COUNT(is_done=true) under the run FOR UPDATE lock (count invariant).'`,
    );

    // ─── checklist_tasks ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checklist_tasks" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "run_id" UUID NOT NULL,
        "position" INTEGER NOT NULL,
        "task_text" TEXT NOT NULL,
        "is_done" BOOLEAN NOT NULL DEFAULT false,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_checklist_tasks_run_position" UNIQUE ("run_id", "position"),
        CONSTRAINT "fk_checklist_tasks_run"
          FOREIGN KEY ("run_id") REFERENCES "checklist_runs" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_tasks_run" ON "checklist_tasks" ("run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_tasks_run_done"
        ON "checklist_tasks" ("run_id", "is_done")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "checklist_tasks" IS
        'Per-task snapshot of the property checklist item at start + its done/undone completion state. UNIQUE (run_id, position) preserves order.'`,
    );

    // ─── checklist_task_photos ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checklist_task_photos" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "task_id" UUID NOT NULL,
        "run_id" UUID NOT NULL,
        "object_key" VARCHAR(512) NOT NULL,
        "kind" VARCHAR(20) NOT NULL DEFAULT 'GENERAL',
        "size_bytes" INTEGER NOT NULL,
        "mime_type" VARCHAR(64) NOT NULL,
        "width" INTEGER,
        "height" INTEGER,
        "object_deleted_at" TIMESTAMP WITH TIME ZONE,
        "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_checklist_task_photos_object" UNIQUE ("object_key"),
        CONSTRAINT "chk_checklist_task_photos_kind"
          CHECK ("kind" IN ('BEFORE', 'AFTER', 'GENERAL')),
        CONSTRAINT "fk_checklist_task_photos_task"
          FOREIGN KEY ("task_id") REFERENCES "checklist_tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_checklist_task_photos_run"
          FOREIGN KEY ("run_id") REFERENCES "checklist_runs" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_task_photos_task"
        ON "checklist_task_photos" ("task_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_task_photos_run"
        ON "checklist_task_photos" ("run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_task_photos_retention"
        ON "checklist_task_photos" ("uploaded_at") WHERE "object_deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "checklist_task_photos" IS
        'Evidence metadata only (never bytes). Bytes live in MinIO; object_deleted_at is set once bytes are hard-deleted by retention/tombstone. No deleted_at (metadata is audit).'`,
    );

    // ─── checklist_upload_grants ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checklist_upload_grants" (
        "object_key" VARCHAR(512) PRIMARY KEY,
        "run_id" UUID NOT NULL,
        "task_id" UUID NOT NULL,
        "issued_to_user_id" UUID,
        "status" VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "consumed_photo_id" UUID,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "chk_checklist_grants_status"
          CHECK ("status" IN ('ISSUED', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
        CONSTRAINT "fk_checklist_grants_run"
          FOREIGN KEY ("run_id") REFERENCES "checklist_runs" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_checklist_grants_task"
          FOREIGN KEY ("task_id") REFERENCES "checklist_tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_checklist_grants_user"
          FOREIGN KEY ("issued_to_user_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_checklist_grants_photo"
          FOREIGN KEY ("consumed_photo_id") REFERENCES "checklist_task_photos" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_grants_run" ON "checklist_upload_grants" ("run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_grants_task" ON "checklist_upload_grants" ("task_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_grants_status_expires"
        ON "checklist_upload_grants" ("status", "expires_at")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "checklist_upload_grants" IS
        'Single-use grant binding a server-generated object_key to run/task + issuing Cleaner (key != credential). Persisted before the pre-signed PUT; reserves a per-task slot while ISSUED.'`,
    );

    // ─── checklist_photo_object_deletions (tombstone) ─────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checklist_photo_object_deletions" (
        "object_key" VARCHAR(512) PRIMARY KEY,
        "reason" VARCHAR(30) NOT NULL DEFAULT 'CASCADE',
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "processed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "chk_checklist_object_deletions_reason"
          CHECK ("reason" IN ('ROW_DELETED', 'CASCADE')),
        CONSTRAINT "chk_checklist_object_deletions_status"
          CHECK ("status" IN ('PENDING', 'DONE'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_object_deletions_status_created"
        ON "checklist_photo_object_deletions" ("status", "created_at")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "checklist_photo_object_deletions" IS
        'Tombstone of MinIO object_keys freed by a deleted/cascaded checklist_task_photos row; drained idempotently by the cleanup worker so cascade never orphans a MinIO object.'`,
    );

    // Trigger: capture the freed object_key inside the deleting transaction (rolls back with it).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION checklist_photo_tombstone_object() RETURNS trigger AS $$
      BEGIN
        IF OLD."object_key" IS NOT NULL AND OLD."object_deleted_at" IS NULL THEN
          INSERT INTO "checklist_photo_object_deletions" ("object_key", "reason")
          VALUES (OLD."object_key", 'CASCADE')
          ON CONFLICT ("object_key") DO NOTHING;
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_checklist_photo_tombstone_object" ON "checklist_task_photos"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "trg_checklist_photo_tombstone_object"
        BEFORE DELETE ON "checklist_task_photos"
        FOR EACH ROW EXECUTE FUNCTION checklist_photo_tombstone_object()
    `);

    // ─── checklist_outbox (durable completion facts; fan-out, no relayed_at) ───
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checklist_outbox" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" VARCHAR(255) NOT NULL,
        "aggregate_type" VARCHAR(30) NOT NULL DEFAULT 'checklist_run',
        "aggregate_id" UUID NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "payload" JSONB NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_checklist_outbox_event" UNIQUE ("event_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_outbox_created" ON "checklist_outbox" ("created_at")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "checklist_outbox" IS
        'Durable checklist_completed facts written in the SAME tx as run ACTIVE->COMPLETED; fanned out to Spec 20/21 via their own per-consumer checkpoints (no shared relayed_at).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dependency order: outbox (independent) → trigger/function → grants (FK photos) →
    // photos → tasks → runs; object_deletions is independent.
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_outbox_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "checklist_outbox"`);

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_checklist_photo_tombstone_object" ON "checklist_task_photos"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS checklist_photo_tombstone_object()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_object_deletions_status_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "checklist_photo_object_deletions"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_grants_status_expires"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_grants_task"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_grants_run"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "checklist_upload_grants"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_task_photos_retention"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_task_photos_run"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_task_photos_task"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "checklist_task_photos"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_tasks_run_done"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_tasks_run"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "checklist_tasks"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_runs_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_runs_property"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_runs_offer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "checklist_runs"`);
  }
}
