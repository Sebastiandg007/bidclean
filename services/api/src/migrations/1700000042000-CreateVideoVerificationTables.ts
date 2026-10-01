import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * video-verification schema (Spec 18) — the on-arrival identity check.
 *
 * A verification is NOT a new domain: it is a `verification_sessions` row bound 1:1 to a service
 * session's arrival, holding the durable record (participants, state, the derived
 * `{ decision, match_score }`, the snapshotted `match_threshold`, retention/deletion bookkeeping)
 * but NEVER the video bytes (those live in MinIO). This migration creates:
 *
 * (a) `verification_sessions` — UUID PK, `service_session_id` FK → `service_sessions` CASCADE and
 *     UNIQUE (one verification per arrival, the idempotency backstop), `offer_id` FK → `offers`
 *     CASCADE, `cleaner_id`/`host_id` FK → `users` SET NULL (Spec 13 invariant — never a
 *     user-cascade), nullable `object_key` (partial UNIQUE when set). There is intentionally NO
 *     `deleted_at` — the record is an immutable audit fact; only the VIDEO object is deleted by
 *     retention. State/decision/reference_source/failure_reason are VARCHAR + CHECK (not PG enums).
 *
 * (b) `video_verification_upload_grants` — an object key is a GRANT, not a credential. Binds a
 *     server-generated `object_key` (PK) to a service session + the issuing Cleaner, single-use,
 *     with an expiry. `service_session_id` CASCADEs; `issued_to_user_id`/`consumed_verification_id`
 *     are ON DELETE SET NULL (deletion coherence).
 *
 * (c) `video_verification_object_deletions` — a deletion tombstone. A `BEFORE DELETE` trigger on
 *     `verification_sessions` copies the freed `object_key` here IN THE SAME TRANSACTION as the
 *     delete (direct or CASCADE from `service_sessions`/`offers`), so the cleanup worker can delete
 *     the MinIO object even after the metadata row is gone. Object deletion is always
 *     eventual/idempotent — never a synchronous cross-system DELETE inside the DB transaction.
 *
 * (d) `verification_outbox` — durable result events (`verification_completed` / `verification_flagged`)
 *     written in the SAME transaction as the terminal state transition; a fan-out source drained by
 *     push-notifications (Spec 16) via its own per-consumer checkpoint (no shared `relayed_at`).
 *
 * Reversible: `down()` drops in dependency order (trigger/function first, then tombstone, grants,
 * outbox, and finally `verification_sessions`).
 */
export class CreateVideoVerificationTables1700000042000 implements MigrationInterface {
  name = 'CreateVideoVerificationTables1700000042000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createVerificationSessions(queryRunner);
    await this.createUploadGrants(queryRunner);
    await this.createObjectDeletions(queryRunner);
    await this.createTombstoneTrigger(queryRunner);
    await this.createOutbox(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_verification_outbox_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "verification_outbox"`);

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_video_verification_tombstone_object" ON "verification_sessions"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS video_verification_tombstone_object()`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_video_verification_object_deletions_status_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "video_verification_object_deletions"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_video_verification_grants_status_expires"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_video_verification_grants_session"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "video_verification_upload_grants"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_verification_sessions_retention"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_verification_sessions_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_verification_sessions_host"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_verification_sessions_cleaner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_verification_sessions_offer"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_verification_sessions_object_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "verification_sessions"`);
  }

  /** (a) The durable verification record — never the video bytes; no `deleted_at`. */
  private async createVerificationSessions(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "verification_sessions" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- One verification per arrival: UNIQUE + CASCADE from the parent service session
        "service_session_id" UUID NOT NULL,
        -- Denormalized parent offer (cascades with the offer)
        "offer_id" UUID NOT NULL,
        -- Participants copied from the session; SET NULL on user deletion (never user-cascade)
        "cleaner_id" UUID,
        "host_id" UUID,

        -- The arrival-video object in MinIO; null until UPLOADED / after retention delete
        "object_key" VARCHAR(512),

        "state" VARCHAR(20) NOT NULL DEFAULT 'PENDING_UPLOAD',
        -- Derived comparison decision (set with the terminal comparison transition)
        "decision" VARCHAR(20),
        -- Derived similarity 0..1 — INTERNAL, never exposed raw to the Host
        "match_score" NUMERIC(5,4),
        -- Snapshot of the config threshold at creation; the decision uses THIS, not live config
        "match_threshold" NUMERIC(5,4) NOT NULL,
        "reference_source" VARCHAR(20) NOT NULL DEFAULT 'KYC_SELFIE',
        -- Monotonic async-comparison retry counter; bumped only by a controlled-transition winner
        "processing_attempt" INTEGER NOT NULL DEFAULT 0,
        -- Non-sensitive failure reason (never a stack trace, never biometric data)
        "failure_reason" VARCHAR(40),

        -- The retention clock starts at uploaded_at
        "uploaded_at" TIMESTAMP WITH TIME ZONE,
        "processed_at" TIMESTAMP WITH TIME ZONE,
        "video_deleted_at" TIMESTAMP WITH TIME ZONE,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "uq_verification_sessions_service_session" UNIQUE ("service_session_id"),
        CONSTRAINT "fk_verification_sessions_service_session"
          FOREIGN KEY ("service_session_id") REFERENCES "service_sessions" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_verification_sessions_offer"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_verification_sessions_cleaner"
          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_verification_sessions_host"
          FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_verification_sessions_state" CHECK ("state" IN (
          'PENDING_UPLOAD','UPLOADED','PROCESSING','MATCH','NO_MATCH',
          'INCONCLUSIVE','FAILED','DISABLED','EXPIRED'
        )),
        CONSTRAINT "chk_verification_sessions_decision" CHECK (
          "decision" IS NULL OR "decision" IN ('MATCH','NO_MATCH','INCONCLUSIVE')
        ),
        CONSTRAINT "chk_verification_sessions_reference_source" CHECK (
          "reference_source" IN ('KYC_SELFIE')
        ),
        CONSTRAINT "chk_verification_sessions_failure_reason" CHECK (
          "failure_reason" IS NULL OR "failure_reason" IN (
            'NO_REFERENCE','VIDEO_UNAVAILABLE','AI_UNAVAILABLE','AI_TIMEOUT','MAX_ATTEMPTS'
          )
        ),
        CONSTRAINT "chk_verification_sessions_threshold_range" CHECK (
          "match_threshold" > 0 AND "match_threshold" <= 1
        ),
        CONSTRAINT "chk_verification_sessions_score_range" CHECK (
          "match_score" IS NULL OR ("match_score" >= 0 AND "match_score" <= 1)
        )
      )
    `);
    // Partial UNIQUE: a key maps to at most one verification (only when set).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_verification_sessions_object_key"
        ON "verification_sessions" ("object_key")
        WHERE "object_key" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_verification_sessions_offer"
        ON "verification_sessions" ("offer_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_verification_sessions_cleaner"
        ON "verification_sessions" ("cleaner_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_verification_sessions_host"
        ON "verification_sessions" ("host_id")
    `);
    // Bounded sweep scan over the non-terminal states only.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_verification_sessions_active"
        ON "verification_sessions" ("state", "updated_at")
        WHERE "state" IN ('PENDING_UPLOAD','UPLOADED','PROCESSING')
    `);
    // Bounded retention scan (clock = uploaded_at; only rows with a live, undeleted video).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_verification_sessions_retention"
        ON "verification_sessions" ("uploaded_at")
        WHERE "video_deleted_at" IS NULL AND "uploaded_at" IS NOT NULL
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "verification_sessions" IS
        'Durable on-arrival identity-check record (Spec 18); video bytes live in MinIO, never here. No deleted_at — immutable audit fact.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "verification_sessions"."match_score" IS
        'Derived similarity 0..1 — INTERNAL only; the Host is exposed only a derived classification, never this raw score.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "verification_sessions"."match_threshold" IS
        'Snapshot of the config threshold at creation; the decision uses THIS, not live config (never retroactively re-decided).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "verification_sessions"."processing_attempt" IS
        'Monotonic counter bumped only by the winner of a controlled transition; a slower older attempt never overwrites a newer result.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "verification_sessions"."uploaded_at" IS
        'The retention clock starts here (not created_at/processed_at).'`,
    );
  }

  /** (b) Upload grants — object key ≠ credential (single-use, bound to session + Cleaner). */
  private async createUploadGrants(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "video_verification_upload_grants" (
        "object_key" VARCHAR(512) PRIMARY KEY,
        "service_session_id" UUID NOT NULL,
        -- Issuing Cleaner; nullable so a deleted user does not destroy the grant record
        "issued_to_user_id" UUID,
        "status" VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        -- The durable verification that consumed the grant (at most one)
        "consumed_verification_id" UUID,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "fk_video_verification_grant_session"
          FOREIGN KEY ("service_session_id") REFERENCES "service_sessions" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_video_verification_grant_user"
          FOREIGN KEY ("issued_to_user_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_video_verification_grant_verification"
          FOREIGN KEY ("consumed_verification_id")
          REFERENCES "verification_sessions" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_video_verification_grant_status" CHECK ("status" IN ('ISSUED', 'CONSUMED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_video_verification_grants_session"
        ON "video_verification_upload_grants" ("service_session_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_video_verification_grants_status_expires"
        ON "video_verification_upload_grants" ("status", "expires_at")
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "video_verification_upload_grants" IS
        'Binds a server-generated object_key to a service session + Cleaner, single-use with expiry; a key is a grant, never a credential.'`,
    );
  }

  /** (c) Deletion tombstone drained by the tombstone-drain worker. */
  private async createObjectDeletions(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "video_verification_object_deletions" (
        "object_key" VARCHAR(512) PRIMARY KEY,
        "reason" VARCHAR(30) NOT NULL DEFAULT 'ROW_DELETED',
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "processed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "chk_video_verification_object_deletions_reason"
          CHECK ("reason" IN ('ROW_DELETED', 'CASCADE')),
        CONSTRAINT "chk_video_verification_object_deletions_status"
          CHECK ("status" IN ('PENDING', 'DONE'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_video_verification_object_deletions_status_created"
        ON "video_verification_object_deletions" ("status", "created_at")
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "video_verification_object_deletions" IS
        'Tombstone of MinIO object_keys freed by a deleted/cascaded verification_sessions row; drained idempotently by the tombstone-drain worker.'`,
    );
  }

  /** Trigger: capture the freed object_key inside the deleting transaction (rolls back with it). */
  private async createTombstoneTrigger(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION video_verification_tombstone_object() RETURNS trigger AS $$
      BEGIN
        IF OLD."object_key" IS NOT NULL AND OLD."video_deleted_at" IS NULL THEN
          INSERT INTO "video_verification_object_deletions" ("object_key", "reason")
          VALUES (OLD."object_key", 'CASCADE')
          ON CONFLICT ("object_key") DO NOTHING;
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_video_verification_tombstone_object" ON "verification_sessions"
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_video_verification_tombstone_object"
        BEFORE DELETE ON "verification_sessions"
        FOR EACH ROW EXECUTE FUNCTION video_verification_tombstone_object()
    `);
  }

  /** (d) Durable result events (fan-out source; NO shared relayed_at). */
  private async createOutbox(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "verification_outbox" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" VARCHAR(255) NOT NULL,
        "aggregate_type" VARCHAR(30) NOT NULL DEFAULT 'verification_session',
        "aggregate_id" UUID NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "payload" JSONB NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_verification_outbox_event" UNIQUE ("event_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_verification_outbox_created"
        ON "verification_outbox" ("created_at")
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "verification_outbox" IS
        'Durable verification_completed/verification_flagged events written in the same TX as the terminal transition; fanned out to per-consumer checkpoints (no shared relayed_at).'`,
    );
  }
}
