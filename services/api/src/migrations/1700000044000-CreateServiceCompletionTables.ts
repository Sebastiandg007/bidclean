import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * service-completion schema (Spec 20 — the last of Sprint 5, Service Execution).
 *
 * Five tables (the completion DECISION + its durable release command + ratings + the fan-out
 * outbox + the checklist_outbox per-consumer checkpoint):
 *  - service_completions: the durable completion DECISION bound 1:1 to a service session (never the
 *    money ledger). Pre-release state machine + snapshotted auto-release deadline.
 *  - release_intents: the durable financial COMMAND persisted in the same tx as the decision; drained
 *    out-of-band by a worker into Spec 9's single-winner release. SURVIVES completion deletion
 *    (service_completion_id ON DELETE SET NULL) so the release path is never lost.
 *  - service_ratings: mutual Host<->Cleaner rating (one per side), captured never gating.
 *  - completion_outbox: durable service_confirmed/service_disputed/service_rated facts (fan-out,
 *    per-consumer checkpoints downstream — no shared relayed_at).
 *  - checklist_outbox_consumers: the per-consumer ack checkpoint over checklist-photos'
 *    checklist_outbox fan-out (this module is its first consumer, consumer_name = 'completion').
 *
 * DB standards: UUID PKs, snake_case, timestamptz, explicit FK ON DELETE, indexes on every FK +
 * partial sweep/drain indexes, application-validated VARCHAR (no PG enums). No `deleted_at` on any
 * table (a terminal completion / a rating / an intent are immutable audit facts). Reversible:
 * `down()` drops indexes then tables in reverse dependency order.
 */
export class CreateServiceCompletionTables1700000044000 implements MigrationInterface {
  name = 'CreateServiceCompletionTables1700000044000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── service_completions (the durable completion DECISION) ────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_completions" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "service_session_id" UUID NOT NULL,
        "offer_id" UUID NOT NULL,
        "payment_id" UUID NOT NULL,
        "host_id" UUID,
        "cleaner_id" UUID,
        "state" VARCHAR(30) NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
        "checklist_completed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "auto_release_deadline" TIMESTAMP WITH TIME ZONE NOT NULL,
        "confirmed_at" TIMESTAMP WITH TIME ZONE,
        "released_trigger" VARCHAR(20),
        "dispute_id" UUID,
        "post_release_dispute_id" UUID,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_service_completions_session" UNIQUE ("service_session_id"),
        CONSTRAINT "chk_service_completions_state"
          CHECK ("state" IN ('AWAITING_CONFIRMATION', 'CONFIRMED', 'AUTO_RELEASED', 'DISPUTED')),
        CONSTRAINT "chk_service_completions_trigger"
          CHECK ("released_trigger" IS NULL OR "released_trigger" IN ('HOST_CONFIRMED', 'AUTO_RELEASE')),
        CONSTRAINT "chk_service_completions_trigger_coherence"
          CHECK (("released_trigger" IS NULL) = ("state" NOT IN ('CONFIRMED', 'AUTO_RELEASED'))),
        CONSTRAINT "fk_service_completions_session"
          FOREIGN KEY ("service_session_id") REFERENCES "service_sessions" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_service_completions_offer"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_service_completions_host"
          FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_service_completions_cleaner"
          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_completions_offer" ON "service_completions" ("offer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_completions_payment" ON "service_completions" ("payment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_completions_host" ON "service_completions" ("host_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_completions_cleaner" ON "service_completions" ("cleaner_id")`,
    );
    // Auto-release sweep scan: only AWAITING_CONFIRMATION completions ordered by their deadline.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_completions_due"
        ON "service_completions" ("auto_release_deadline") WHERE "state" = 'AWAITING_CONFIRMATION'`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "service_completions" IS
        'The durable completion DECISION bound 1:1 to a service session (UNIQUE service_session_id); records confirm/auto-release/dispute, never the money ledger. auto_release_deadline is snapshotted from the event-carried finish time. No deleted_at (immutable audit fact).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "service_completions"."payment_id" IS
        'Reference by id to the escrow payment (Spec 9, its own bounded context); NO FK cascade from payments.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "service_completions"."post_release_dispute_id" IS
        'A dispute opened AFTER release fired (distinct concept; does NOT overload the pre-release DISPUTED state).'`,
    );

    // ─── release_intents (durable financial command; survives completion deletion) ─
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "release_intents" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "service_completion_id" UUID,
        "payment_id" UUID NOT NULL,
        "reason" VARCHAR(20) NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "attempt" INTEGER NOT NULL DEFAULT 0,
        "dispatched_at" TIMESTAMP WITH TIME ZONE,
        "lease_until" TIMESTAMP WITH TIME ZONE,
        "last_error" TEXT,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_release_intents_completion" UNIQUE ("service_completion_id"),
        CONSTRAINT "chk_release_intents_reason"
          CHECK ("reason" IN ('HOST_CONFIRMED', 'AUTO_RELEASE')),
        CONSTRAINT "chk_release_intents_status"
          CHECK ("status" IN ('PENDING', 'DISPATCHED', 'ACCEPTED', 'FAILED_RETRYABLE')),
        CONSTRAINT "fk_release_intents_completion"
          FOREIGN KEY ("service_completion_id") REFERENCES "service_completions" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_release_intents_completion" ON "release_intents" ("service_completion_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_release_intents_payment" ON "release_intents" ("payment_id")`,
    );
    // Drain/claim scan: PENDING/FAILED_RETRYABLE plus DISPATCHED (whose expired lease is reclaimed).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_release_intents_drain"
        ON "release_intents" ("created_at")
        WHERE "status" IN ('PENDING', 'FAILED_RETRYABLE', 'DISPATCHED')`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "release_intents" IS
        'Durable financial COMMAND persisted in the same tx as a release-bearing decision; drained by a worker into Spec 9 release (idempotent, single-winner). ON DELETE SET NULL (NOT cascade): carries its own payment_id + reason so it survives completion deletion and the release path is never lost.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "release_intents"."status" IS
        'ACCEPTED = Spec 9 durably accepted the release COMMAND (NOT that funds settled; a deferred payout is still ACCEPTED). DISPATCHED = a worker holds a lease and is/was mid-flight.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "release_intents"."lease_until" IS
        'Claim lease expiry (= dispatched_at + SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS); a DISPATCHED intent whose lease elapsed is an orphaned/crashed dispatch, durably re-claimable by the next drain.'`,
    );

    // ─── service_ratings (mutual rating, captured never gating) ───────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_ratings" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "service_completion_id" UUID NOT NULL,
        "rater_id" UUID,
        "ratee_id" UUID,
        "role" VARCHAR(20) NOT NULL,
        "stars" SMALLINT NOT NULL,
        "comment" TEXT,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_service_ratings_completion_role" UNIQUE ("service_completion_id", "role"),
        CONSTRAINT "chk_service_ratings_role"
          CHECK ("role" IN ('HOST_RATES_CLEANER', 'CLEANER_RATES_HOST')),
        CONSTRAINT "chk_service_ratings_stars" CHECK ("stars" >= 1 AND "stars" <= 5),
        CONSTRAINT "fk_service_ratings_completion"
          FOREIGN KEY ("service_completion_id") REFERENCES "service_completions" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_service_ratings_rater"
          FOREIGN KEY ("rater_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_service_ratings_ratee"
          FOREIGN KEY ("ratee_id") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_ratings_completion" ON "service_ratings" ("service_completion_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_ratings_rater" ON "service_ratings" ("rater_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_ratings_ratee" ON "service_ratings" ("ratee_id")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "service_ratings" IS
        'Mutual Host<->Cleaner rating (one per side via UNIQUE (service_completion_id, role)); captured on CONFIRMED/AUTO_RELEASED, never gating release. CASCADE with the completion (audit/reputation data). No deleted_at.'`,
    );

    // ─── completion_outbox (durable events; fan-out, no relayed_at) ───────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "completion_outbox" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" VARCHAR(255) NOT NULL,
        "aggregate_type" VARCHAR(30) NOT NULL DEFAULT 'service_completion',
        "aggregate_id" UUID NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "payload" JSONB NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_completion_outbox_event" UNIQUE ("event_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_completion_outbox_created" ON "completion_outbox" ("created_at")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "completion_outbox" IS
        'Durable service_confirmed/service_disputed/service_rated facts written in the SAME tx as their transition; fanned out to Push (Spec 16) + reputation (Spec 22) + disputes (Spec 21) via their own per-consumer checkpoints (no shared relayed_at).'`,
    );

    // ─── checklist_outbox_consumers (per-consumer ack over checklist_outbox) ──────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checklist_outbox_consumers" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" VARCHAR(255) NOT NULL,
        "consumer_name" VARCHAR(50) NOT NULL,
        "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_checklist_outbox_consumers_event_consumer" UNIQUE ("event_id", "consumer_name"),
        CONSTRAINT "fk_checklist_outbox_consumers_event"
          FOREIGN KEY ("event_id") REFERENCES "checklist_outbox" ("event_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_checklist_outbox_consumers_consumer"
        ON "checklist_outbox_consumers" ("consumer_name")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "checklist_outbox_consumers" IS
        'Per-consumer ack of a checklist_outbox event; each consumer drains events lacking its own (event_id, consumer_name) row, so one consumer never starves another. service-completion is the consumer_name = ''completion'' consumer.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dependency order: the checkpoint FKs checklist_outbox(event_id), independent of the rest.
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_checklist_outbox_consumers_consumer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "checklist_outbox_consumers"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_completion_outbox_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "completion_outbox"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_ratings_ratee"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_ratings_rater"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_ratings_completion"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_ratings"`);

    // release_intents FKs service_completions(id) — drop the intents before the completions.
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_release_intents_drain"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_release_intents_payment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_release_intents_completion"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "release_intents"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_completions_due"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_completions_cleaner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_completions_host"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_completions_payment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_completions_offer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_completions"`);
  }
}
