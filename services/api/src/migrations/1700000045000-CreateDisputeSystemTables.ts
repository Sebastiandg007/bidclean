import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * dispute-system schema (Spec 21 — the first of Sprint 6, Polish & Extras).
 *
 * Owns the dispute CASE + resolution; never the money ledger (Spec 9 stays authoritative). Tables:
 *  - disputes: the durable dispute CASE + resolution. Partial-unique ACTIVE constraint (at most one
 *    OPEN/UNDER_REVIEW dispute per completion). Terminal disputes carry a non-null resolution (data
 *    invariant). No deleted_at (immutable audit fact).
 *  - dispute_evidence: typed references to durable facts (never byte copies) + Host/Cleaner uploads.
 *    A BEFORE DELETE tombstone trigger frees any HOST_PHOTO object key on delete/cascade.
 *  - dispute_upload_grants: single-use grant binding a server-generated object_key to the issuing
 *    participant (key != credential); persisted before the pre-signed PUT.
 *  - dispute_escrow_intents: durable escrow-block command (OPEN then NONE). dispute_id ON DELETE SET
 *    NULL (NOT cascade) + payment_id NOT NULL so a pending clear survives the dispute's deletion.
 *  - dispute_financial_intents: durable money-effect command (release/refund). Same SET NULL survival;
 *    ACTION_BLOCKED is the needs-review terminal for a Spec 9 BLOCKED outcome (money NOT moved).
 *  - dispute_object_deletions: tombstone of freed HOST_PHOTO keys (voice-notes lesson).
 *  - dispute_outbox: durable dispute_opened/dispute_resolved facts (fan-out, per-consumer downstream).
 *  - completion_outbox_consumers: the per-consumer ack checkpoint over Spec 20's completion_outbox
 *    fan-out (this module drains service_disputed as consumer_name = 'dispute').
 *
 * Additive Spec 9 extension (money-authority stays in payments): a `dispute_settled_at` column on
 * `payments` marks a payment that already had a durably applied dispute-driven financial effect, so
 * Spec 9 can reject a second one (P15, PAYMENT_ALREADY_SETTLED). ADDITIVE + reversible.
 *
 * DB standards: UUID PKs, snake_case, timestamptz, explicit FK ON DELETE, indexes on every FK +
 * partial sweep/drain/needs-review/retention indexes, application-validated VARCHAR (no PG enums),
 * partial-UNIQUE active dispute + per-dispute intent uniques. Reversible: down() drops the trigger/
 * function then tables in reverse dependency order and reverts the payments column.
 */
export class CreateDisputeSystemTables1700000045000 implements MigrationInterface {
  name = 'CreateDisputeSystemTables1700000045000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── disputes (the durable dispute CASE + resolution) ─────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "disputes" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "service_completion_id" UUID NOT NULL,
        "offer_id" UUID NOT NULL,
        "payment_id" UUID NOT NULL,
        "initiator_id" UUID,
        "initiator_role" VARCHAR(10) NOT NULL,
        "host_id" UUID,
        "cleaner_id" UUID,
        "phase" VARCHAR(15) NOT NULL,
        "reason_code" VARCHAR(40) NOT NULL,
        "reason_text" TEXT,
        "state" VARCHAR(15) NOT NULL DEFAULT 'OPEN',
        "resolution" VARCHAR(15),
        "resolution_refund_cents" INTEGER,
        "evidence_deadline" TIMESTAMP WITH TIME ZONE NOT NULL,
        "resolution_deadline" TIMESTAMP WITH TIME ZONE NOT NULL,
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "resolved_by" VARCHAR(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "chk_disputes_initiator_role" CHECK ("initiator_role" IN ('HOST', 'CLEANER')),
        CONSTRAINT "chk_disputes_phase" CHECK ("phase" IN ('PRE_RELEASE', 'POST_RELEASE')),
        CONSTRAINT "chk_disputes_state"
          CHECK ("state" IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'EXPIRED')),
        CONSTRAINT "chk_disputes_resolution"
          CHECK ("resolution" IS NULL OR "resolution" IN ('FAVOR_CLEANER', 'FAVOR_HOST', 'PARTIAL')),
        CONSTRAINT "chk_disputes_refund_nonneg"
          CHECK ("resolution_refund_cents" IS NULL OR "resolution_refund_cents" >= 0),
        CONSTRAINT "chk_disputes_terminal_resolution"
          CHECK ("state" NOT IN ('RESOLVED', 'EXPIRED') OR "resolution" IS NOT NULL),
        CONSTRAINT "chk_disputes_partial_amount"
          CHECK ("resolution" <> 'PARTIAL' OR "resolution_refund_cents" IS NOT NULL),
        CONSTRAINT "fk_disputes_completion"
          FOREIGN KEY ("service_completion_id") REFERENCES "service_completions" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_disputes_offer"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_disputes_initiator"
          FOREIGN KEY ("initiator_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_disputes_host"
          FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_disputes_cleaner"
          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    // Partial-unique: at most one ACTIVE dispute per completion (a new one may open after a terminal).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_disputes_active_completion"
        ON "disputes" ("service_completion_id") WHERE "state" IN ('OPEN', 'UNDER_REVIEW')`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_disputes_completion" ON "disputes" ("service_completion_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_disputes_offer" ON "disputes" ("offer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_disputes_payment" ON "disputes" ("payment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_disputes_initiator" ON "disputes" ("initiator_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_disputes_host" ON "disputes" ("host_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_disputes_cleaner" ON "disputes" ("cleaner_id")`,
    );
    // SLA sweep scan: only non-terminal disputes ordered by their snapshotted deadline.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_disputes_sla"
        ON "disputes" ("resolution_deadline") WHERE "state" IN ('OPEN', 'UNDER_REVIEW')`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "disputes" IS
        'The durable dispute CASE + resolution; never the money ledger. Partial-unique uq_disputes_active_completion = at most one ACTIVE dispute per completion. phase derived from Spec 9 payout_status, snapshotted. Terminal disputes carry a non-null resolution. No deleted_at (immutable audit fact).'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "disputes"."payment_id" IS
        'Reference by id to the escrow payment (Spec 9, its own bounded context); NO FK cascade from payments.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "disputes"."resolution_refund_cents" IS
        'The REQUESTED refund for FAVOR_HOST/PARTIAL; NOT the final amount. Spec 9 ceilings it and surfaces the applied amount as dispute_financial_intents.effective_amount_cents.'`,
    );

    // ─── dispute_evidence (typed references; never copies bytes) ──────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dispute_evidence" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "dispute_id" UUID NOT NULL,
        "submitted_by" UUID,
        "kind" VARCHAR(25) NOT NULL,
        "object_key" VARCHAR(512),
        "ref" VARCHAR(512),
        "text_value" TEXT,
        "size_bytes" INTEGER,
        "mime_type" VARCHAR(64),
        "object_deleted_at" TIMESTAMP WITH TIME ZONE,
        "uploaded_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "chk_dispute_evidence_kind"
          CHECK ("kind" IN ('HOST_PHOTO', 'HOST_REASON', 'CHECKLIST_REF', 'CHECKLIST_PHOTO_REF',
                            'VERIFICATION_REF', 'ARRIVAL_REF', 'NOTE')),
        CONSTRAINT "chk_dispute_evidence_shape"
          CHECK (
            ("kind" = 'HOST_PHOTO' AND "object_key" IS NOT NULL)
            OR ("kind" <> 'HOST_PHOTO' AND "object_key" IS NULL)
          ),
        CONSTRAINT "fk_dispute_evidence_dispute"
          FOREIGN KEY ("dispute_id") REFERENCES "disputes" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_dispute_evidence_submitted_by"
          FOREIGN KEY ("submitted_by") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_evidence_dispute" ON "dispute_evidence" ("dispute_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_evidence_submitted_by" ON "dispute_evidence" ("submitted_by")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_dispute_evidence_object"
        ON "dispute_evidence" ("object_key") WHERE "object_key" IS NOT NULL`,
    );
    // Retention scan: HOST_PHOTO objects still present (bytes not yet deleted).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_evidence_retention"
        ON "dispute_evidence" ("uploaded_at")
        WHERE "object_key" IS NOT NULL AND "object_deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "dispute_evidence" IS
        'Typed references to durable facts (never byte copies) + Host/Cleaner uploads. Visual kinds (HOST_PHOTO, CHECKLIST_PHOTO_REF) resolve to a pre-signed URL; structured kinds to gated data. object_deleted_at set once HOST_PHOTO bytes are hard-deleted. No deleted_at (metadata is audit).'`,
    );

    // ─── dispute_upload_grants (single-use grant; key != credential) ──────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dispute_upload_grants" (
        "object_key" VARCHAR(512) PRIMARY KEY,
        "dispute_id" UUID NOT NULL,
        "issued_to_user_id" UUID,
        "status" VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "consumed_evidence_id" UUID,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "chk_dispute_grants_status"
          CHECK ("status" IN ('ISSUED', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
        CONSTRAINT "fk_dispute_grants_dispute"
          FOREIGN KEY ("dispute_id") REFERENCES "disputes" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_dispute_grants_user"
          FOREIGN KEY ("issued_to_user_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_dispute_grants_evidence"
          FOREIGN KEY ("consumed_evidence_id") REFERENCES "dispute_evidence" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_grants_dispute" ON "dispute_upload_grants" ("dispute_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_grants_status_expires"
        ON "dispute_upload_grants" ("status", "expires_at")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "dispute_upload_grants" IS
        'Single-use grant binding a server-generated object_key to a dispute + issuing participant (key != credential). Persisted before the pre-signed PUT; reserves a per-dispute slot while ISSUED.'`,
    );

    // ─── dispute_escrow_intents (durable escrow-block command; survives the case) ─
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dispute_escrow_intents" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "dispute_id" UUID,
        "payment_id" UUID NOT NULL,
        "target" VARCHAR(10) NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "attempt" INTEGER NOT NULL DEFAULT 0,
        "dispatched_at" TIMESTAMP WITH TIME ZONE,
        "lease_until" TIMESTAMP WITH TIME ZONE,
        "last_error" TEXT,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "chk_dispute_escrow_intents_target" CHECK ("target" IN ('OPEN', 'NONE')),
        CONSTRAINT "chk_dispute_escrow_intents_status"
          CHECK ("status" IN ('PENDING', 'DISPATCHED', 'ACCEPTED', 'FAILED_RETRYABLE')),
        CONSTRAINT "fk_dispute_escrow_intents_dispute"
          FOREIGN KEY ("dispute_id") REFERENCES "disputes" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_escrow_intents_dispute" ON "dispute_escrow_intents" ("dispute_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_escrow_intents_payment" ON "dispute_escrow_intents" ("payment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_escrow_intents_drain"
        ON "dispute_escrow_intents" ("created_at")
        WHERE "status" IN ('PENDING', 'FAILED_RETRYABLE', 'DISPATCHED')`,
    );
    // Partial-unique (dispute_id nullable): at most one OPEN + one NONE intent per dispute while it exists.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_dispute_escrow_intent_target"
        ON "dispute_escrow_intents" ("dispute_id", "target") WHERE "dispute_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "dispute_escrow_intents" IS
        'Durable escrow-block command (OPEN on creation, NONE only after Spec 9 applies the financial action — clear-escrow-LAST). dispute_id ON DELETE SET NULL (NOT cascade) + payment_id NOT NULL so a pending clear survives the dispute deletion; the worker keys off payment_id.'`,
    );

    // ─── dispute_financial_intents (durable money-effect command; survives the case) ─
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dispute_financial_intents" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "dispute_id" UUID,
        "payment_id" UUID NOT NULL,
        "action" VARCHAR(20) NOT NULL,
        "amount_cents" INTEGER,
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "attempt" INTEGER NOT NULL DEFAULT 0,
        "dispatched_at" TIMESTAMP WITH TIME ZONE,
        "lease_until" TIMESTAMP WITH TIME ZONE,
        "outcome" VARCHAR(20),
        "outcome_reason" VARCHAR(40),
        "effective_amount_cents" INTEGER,
        "last_error" TEXT,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "chk_dispute_financial_intents_action"
          CHECK ("action" IN ('RELEASE', 'FULL_REFUND', 'PARTIAL_REFUND')),
        CONSTRAINT "chk_dispute_financial_intents_amount"
          CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0),
        CONSTRAINT "chk_dispute_financial_intents_status"
          CHECK ("status" IN ('PENDING', 'DISPATCHED', 'ACCEPTED', 'FAILED_RETRYABLE', 'ACTION_BLOCKED')),
        CONSTRAINT "chk_dispute_financial_intents_outcome"
          CHECK ("outcome" IS NULL OR "outcome" IN ('APPLIED', 'CEILING_CLAMPED', 'NO_OP', 'BLOCKED')),
        CONSTRAINT "chk_dispute_financial_intents_partial_amount"
          CHECK ("action" <> 'PARTIAL_REFUND' OR "amount_cents" IS NOT NULL),
        CONSTRAINT "fk_dispute_financial_intents_dispute"
          FOREIGN KEY ("dispute_id") REFERENCES "disputes" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_financial_intents_dispute" ON "dispute_financial_intents" ("dispute_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_financial_intents_payment" ON "dispute_financial_intents" ("payment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_financial_intents_drain"
        ON "dispute_financial_intents" ("created_at")
        WHERE "status" IN ('PENDING', 'FAILED_RETRYABLE', 'DISPATCHED')`,
    );
    // Operator needs-review scan.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_financial_intents_blocked"
        ON "dispute_financial_intents" ("created_at") WHERE "status" = 'ACTION_BLOCKED'`,
    );
    // Partial-unique (dispute_id nullable): at most one financial intent per dispute while it exists.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_dispute_financial_intent_dispute"
        ON "dispute_financial_intents" ("dispute_id") WHERE "dispute_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "dispute_financial_intents" IS
        'Durable money-effect command (release/refund) drained into Spec 9 with idempotent retries. dispute_id ON DELETE SET NULL (NOT cascade) + payment_id NOT NULL so a pending money effect survives the dispute deletion; the worker keys off payment_id. ACTION_BLOCKED = Spec 9 returned BLOCKED (money NOT moved), needs operator review.'`,
    );

    // ─── dispute_object_deletions (tombstone of freed HOST_PHOTO keys) ────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dispute_object_deletions" (
        "object_key" VARCHAR(512) PRIMARY KEY,
        "reason" VARCHAR(30) NOT NULL DEFAULT 'CASCADE',
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "processed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "chk_dispute_object_deletions_reason" CHECK ("reason" IN ('ROW_DELETED', 'CASCADE')),
        CONSTRAINT "chk_dispute_object_deletions_status" CHECK ("status" IN ('PENDING', 'DONE'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_object_deletions_status_created"
        ON "dispute_object_deletions" ("status", "created_at")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "dispute_object_deletions" IS
        'Tombstone of MinIO object_keys freed by a deleted/cascaded dispute_evidence HOST_PHOTO row; drained idempotently by the cleanup worker so a cascade never orphans a MinIO object.'`,
    );

    // Trigger: capture the freed object_key inside the deleting transaction (rolls back with it).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dispute_evidence_tombstone_object() RETURNS trigger AS $$
      BEGIN
        IF OLD."object_key" IS NOT NULL AND OLD."object_deleted_at" IS NULL THEN
          INSERT INTO "dispute_object_deletions" ("object_key", "reason")
          VALUES (OLD."object_key", 'CASCADE')
          ON CONFLICT ("object_key") DO NOTHING;
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_dispute_evidence_tombstone_object" ON "dispute_evidence"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "trg_dispute_evidence_tombstone_object"
        BEFORE DELETE ON "dispute_evidence"
        FOR EACH ROW EXECUTE FUNCTION dispute_evidence_tombstone_object()
    `);

    // ─── dispute_outbox (durable lifecycle events; fan-out, no relayed_at) ────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dispute_outbox" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" VARCHAR(255) NOT NULL,
        "aggregate_type" VARCHAR(30) NOT NULL DEFAULT 'dispute',
        "aggregate_id" UUID NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "payload" JSONB NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_dispute_outbox_event" UNIQUE ("event_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dispute_outbox_created" ON "dispute_outbox" ("created_at")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "dispute_outbox" IS
        'Durable dispute_opened/dispute_resolved facts written in the SAME tx as their transition; fanned out to push-notifications (Spec 16) via its own per-consumer checkpoint (no shared relayed_at).'`,
    );

    // ─── completion_outbox_consumers (per-consumer ack over Spec 20 completion_outbox) ─
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "completion_outbox_consumers" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" VARCHAR(255) NOT NULL,
        "consumer_name" VARCHAR(50) NOT NULL,
        "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_completion_outbox_consumers_event_consumer" UNIQUE ("event_id", "consumer_name"),
        CONSTRAINT "fk_completion_outbox_consumers_event"
          FOREIGN KEY ("event_id") REFERENCES "completion_outbox" ("event_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_completion_outbox_consumers_consumer"
        ON "completion_outbox_consumers" ("consumer_name")`,
    );
    await queryRunner.query(
      `COMMENT ON TABLE "completion_outbox_consumers" IS
        'Per-consumer ack of a completion_outbox event; each consumer drains events lacking its own (event_id, consumer_name) row so one consumer never starves another. dispute-system is the consumer_name = ''dispute'' consumer, coexisting with the Push (Spec 16) consumer on the same fan-out.'`,
    );

    // ─── Additive Spec 9 extension: mark a payment dispute-settled (P15 authority) ─
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_settled_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "payments"."dispute_settled_at" IS
        'Set by Spec 9 when a dispute-driven financial effect (refund/reversal/release) has durably landed for this payment. Guards P15: a second dispute-driven financial action on an already-settled payment is rejected with BLOCKED (PAYMENT_ALREADY_SETTLED). Additive, dispute-system (Spec 21).'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order. The additive payments column first (independent).
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN IF EXISTS "dispute_settled_at"`);

    // completion_outbox_consumers FKs completion_outbox(event_id); independent of the rest.
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_completion_outbox_consumers_consumer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "completion_outbox_consumers"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_outbox_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dispute_outbox"`);

    // Trigger + function before the table it fires on.
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_dispute_evidence_tombstone_object" ON "dispute_evidence"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS dispute_evidence_tombstone_object()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_object_deletions_status_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dispute_object_deletions"`);

    // Intents FK disputes(id) (SET NULL) — drop before disputes.
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_dispute_financial_intent_dispute"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_financial_intents_blocked"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_financial_intents_drain"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_financial_intents_payment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_financial_intents_dispute"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dispute_financial_intents"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "uq_dispute_escrow_intent_target"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_escrow_intents_drain"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_escrow_intents_payment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_escrow_intents_dispute"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dispute_escrow_intents"`);

    // Grants FK dispute_evidence(id) + disputes(id) — drop before evidence + disputes.
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_grants_status_expires"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_grants_dispute"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dispute_upload_grants"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_evidence_retention"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_dispute_evidence_object"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_evidence_submitted_by"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_evidence_dispute"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dispute_evidence"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_sla"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_cleaner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_host"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_initiator"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_payment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_offer"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_completion"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_disputes_active_completion"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "disputes"`);
  }
}
